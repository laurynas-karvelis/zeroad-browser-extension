import { getConfig } from "./config"
import { extension } from "./extension"
import { log } from "./logger"
import type { Hostname } from "./types"
import { httpPost } from "./utils"

/**
 * The client half of the token protocol.
 *
 * The platform signs throwaway public keys without ever learning what they will be used for. This
 * module holds the matching private keys, which never leave the browser, and spends one per partner
 * site: on first contact with a site it signs that site's hostname, producing a token only that site
 * can accept. A site therefore receives a public key and a signature over its own name, and can no
 * more present it elsewhere than it could log in with somebody's SSH public key.
 *
 * One key per site is what stops two sites comparing notes. Reusing a key across sites would hand
 * them a shared identifier, so a credential is spent and never reused for a second hostname.
 */

/** Wire format version. Must match `PROTOCOL_VERSION` in @zeroad.network/token. */
const PROTOCOL_VERSION = 1

const TOKEN_BYTES = 174
const EPHEMERAL_PUBLIC_KEY_OFFSET = 6
const AUTHORITY_SIGNATURE_OFFSET = 38
const NONCE_OFFSET = 102
const NONCE_BYTES = 8
const HOSTNAME_SIGNATURE_OFFSET = 110

/** Domain separation tag, byte-identical to the verifier's. */
const HOSTNAME_DOMAIN = "better-web:hostname:v1"

/**
 * Credentials requested per refresh. Fixed rather than sized to demand: asking for exactly as many as
 * the last day needed would tell the platform how much the subscriber browses, which is precisely the
 * kind of signal the rest of this design goes out of its way not to leak.
 */
const BATCH_SIZE = 250

/** Below this, the next refresh is brought forward rather than waiting for the daily one. */
const LOW_WATER_MARK = 25

const STORAGE_KEY = "tokenPool"

const textEncoder = new TextEncoder()

type PooledCredential = {
  /** base64url, raw 32 bytes. */
  publicKey: string
  /**
   * The private key, exported. `chrome.storage.local` cannot hold a `CryptoKey`, and a service worker
   * is torn down constantly, so the key has to survive as data. Extension storage is already the trust
   * boundary for the refresh token and telemetry token, so this does not widen it.
   */
  privateKey: JsonWebKey
  /** base64url, the authority's 64-byte signature over this key. */
  signature: string
}

type BoundToken = {
  /** base64url, the full 174-byte token. */
  token: string
  /** Unix seconds, from the credential it was minted from. */
  expiresAt: number
}

type StoredPool = {
  version: number
  plan: number
  /** Unix seconds, shared by every credential in the batch. */
  expiresAt: number
  unused: PooledCredential[]
  bound: Record<Hostname, BoundToken>
}

const toBase64Url = (bytes: Uint8Array) => {
  let binary = ""
  for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index])
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

const fromBase64Url = (value: string) => {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

class TokenPool {
  private pool?: StoredPool

  private async load(): Promise<StoredPool | undefined> {
    if (this.pool) return this.pool

    const stored = await chrome.storage.local.get<{ tokenPool?: StoredPool }>([STORAGE_KEY])
    this.pool = stored?.tokenPool

    return this.pool
  }

  private async save(pool: StoredPool) {
    this.pool = pool
    await chrome.storage.local.set({ [STORAGE_KEY]: pool })
  }

  async clear() {
    this.pool = undefined
    await chrome.storage.local.remove([STORAGE_KEY])
  }

  /** Unspent credentials remaining, for the popup and for deciding whether to refresh early. */
  async size() {
    const pool = await this.load()
    return this.isUsable(pool) ? pool.unused.length : 0
  }

  async needsRefresh() {
    const pool = await this.load()
    return !this.isUsable(pool) || pool.unused.length <= LOW_WATER_MARK
  }

  private isUsable(pool: StoredPool | undefined): pool is StoredPool {
    return !!pool && pool.version === PROTOCOL_VERSION && pool.expiresAt > nowSeconds()
  }

  /**
   * Generates a fresh batch of keypairs and has the platform sign the public halves.
   *
   * Everything already in the pool is discarded: credentials from an older batch carry the previous
   * expiry, and mixing the two would leave sites seeing tokens from two different anonymity sets.
   */
  async refresh() {
    const refreshToken = extension().getRefreshToken()
    if (!refreshToken) throw new Error("Cannot refresh the token pool without a refresh token")

    const keyPairs = await Promise.all(Array.from({ length: BATCH_SIZE }, () => generateEphemeralKeyPair()))
    const config = await getConfig()

    const { payload } = await httpPost<{
      payload: { version: number; plan: number; expiresAt: number; signatures: string[] }
    }>(config.GENERIC.EXTENSION_CREDENTIALS_URL, refreshToken, { publicKeys: keyPairs.map((pair) => pair.publicKey) })

    if (payload?.version !== PROTOCOL_VERSION) {
      throw new Error(`Platform issued protocol version ${payload?.version}, which this extension cannot use`)
    }

    if (payload.signatures?.length !== keyPairs.length) {
      throw new Error("Platform returned a different number of credentials than keys sent")
    }

    if (payload.expiresAt <= nowSeconds()) throw new Error("Platform issued already-expired credentials")

    await this.save({
      version: payload.version,
      plan: payload.plan,
      expiresAt: payload.expiresAt,
      unused: keyPairs.map((pair, index) => ({
        publicKey: pair.publicKey,
        privateKey: pair.privateKey,
        signature: payload.signatures[index],
      })),
      // Bindings from the previous batch die with it - their credentials have the old expiry
      bound: {},
    })

    log("debug", "[token-pool]", `stored ${keyPairs.length} credentials, expiring ${payload.expiresAt}`)

    return payload.signatures.length
  }

  /**
   * The token to send to `hostname`, minting one if this is the first time.
   *
   * Repeat visits reuse the same token, which is what the multi-use design intends: re-binding on
   * every request would burn the pool in minutes and gain nothing, since the site already saw the
   * first one.
   */
  async tokenFor(hostname: Hostname): Promise<string | undefined> {
    const pool = await this.load()
    if (!this.isUsable(pool)) return undefined

    const existing = pool.bound[hostname]
    if (existing && existing.expiresAt > nowSeconds()) return existing.token

    const credential = pool.unused.pop()

    if (!credential) {
      log("debug", "[token-pool]", "exhausted, cannot bind", hostname)
      return undefined
    }

    const token = await bindToHostname(credential, pool, hostname)

    pool.bound[hostname] = { token, expiresAt: pool.expiresAt }
    await this.save(pool)

    return token
  }

  /** Hostnames already carrying a token, so their injection rules can be reinstated after a restart. */
  async boundHostnames(): Promise<Hostname[]> {
    const pool = await this.load()
    return this.isUsable(pool) ? Object.keys(pool.bound) : []
  }
}

async function generateEphemeralKeyPair() {
  const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair

  const [raw, privateKey] = await Promise.all([
    crypto.subtle.exportKey("raw", keyPair.publicKey),
    crypto.subtle.exportKey("jwk", keyPair.privateKey),
  ])

  return { publicKey: toBase64Url(new Uint8Array(raw)), privateKey }
}

/**
 * Assembles the 174-byte token and signs the hostname into it.
 *
 * The hostname itself is not written to the wire - the verifier reconstructs the signed message from
 * the host it serves, so a token bound elsewhere fails the signature rather than a string comparison.
 */
async function bindToHostname(credential: PooledCredential, pool: StoredPool, hostname: Hostname): Promise<string> {
  const token = new Uint8Array(TOKEN_BYTES)

  token[0] = pool.version
  token[1] = pool.plan
  token[2] = pool.expiresAt & 0xff
  token[3] = (pool.expiresAt >>> 8) & 0xff
  token[4] = (pool.expiresAt >>> 16) & 0xff
  token[5] = (pool.expiresAt >>> 24) & 0xff

  token.set(fromBase64Url(credential.publicKey), EPHEMERAL_PUBLIC_KEY_OFFSET)
  token.set(fromBase64Url(credential.signature), AUTHORITY_SIGNATURE_OFFSET)
  token.set(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)), NONCE_OFFSET)

  const hostnameBytes = textEncoder.encode(hostname)
  const domainBytes = textEncoder.encode(HOSTNAME_DOMAIN)

  const message = new Uint8Array(domainBytes.length + HOSTNAME_SIGNATURE_OFFSET + hostnameBytes.length)
  message.set(domainBytes, 0)
  message.set(token.subarray(0, HOSTNAME_SIGNATURE_OFFSET), domainBytes.length)
  message.set(hostnameBytes, domainBytes.length + HOSTNAME_SIGNATURE_OFFSET)

  const signingKey = await crypto.subtle.importKey("jwk", credential.privateKey, { name: "Ed25519" }, false, ["sign"])
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, signingKey, message)

  token.set(new Uint8Array(signature), HOSTNAME_SIGNATURE_OFFSET)

  return toBase64Url(token)
}

const singleton = new TokenPool()
export const tokenPool = () => singleton
