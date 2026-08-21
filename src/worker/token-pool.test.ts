import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { chromeMock } from "../__fixtures__/chrome"

const state = { refreshToken: "refresh-1" as string | undefined }
mock.module("./extension", () => ({ extension: () => ({ getRefreshToken: () => state.refreshToken }) }))

const { tokenPool } = await import("./token-pool")

const HOUR = 3600
const nowSeconds = () => Math.floor(Date.now() / 1000)

const BATCH_SIZE = 250
const TOKEN_BYTES = 174
const EPHEMERAL_PUBLIC_KEY_OFFSET = 6
const AUTHORITY_SIGNATURE_OFFSET = 38
const NONCE_OFFSET = 102
const HOSTNAME_SIGNATURE_OFFSET = 110
const HOSTNAME_DOMAIN = "better-web:hostname:v1"

const fromBase64Url = (value: string) => new Uint8Array(Buffer.from(value, "base64url"))

/**
 * Stands in for the platform: signs whatever public keys it is given with a throwaway authority key,
 * so a token the pool produces can be verified exactly as a publisher would verify it.
 */
async function fakeAuthority() {
  const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair

  return {
    publicKey: keyPair.publicKey,
    async sign(publicKeys: string[], expiresAt: number, version = 1, plan = 1) {
      const signatures = await Promise.all(
        publicKeys.map(async (encodedKey) => {
          const message = new Uint8Array(24 + 38)
          message.set(new TextEncoder().encode("better-web:credential:v1"), 0)
          message[24] = version
          message[25] = plan
          message[26] = expiresAt & 0xff
          message[27] = (expiresAt >>> 8) & 0xff
          message[28] = (expiresAt >>> 16) & 0xff
          message[29] = (expiresAt >>> 24) & 0xff
          message.set(fromBase64Url(encodedKey), 30)

          const signature = await crypto.subtle.sign({ name: "Ed25519" }, keyPair.privateKey, message)
          return Buffer.from(new Uint8Array(signature)).toString("base64url")
        })
      )

      return { version, plan, expiresAt, signatures }
    },
  }
}

let authority: Awaited<ReturnType<typeof fakeAuthority>>
let lastRequestBody: { publicKeys: string[] } | undefined
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>

function respondWith(build: (publicKeys: string[]) => Promise<unknown> | unknown) {
  fetchSpy.mockImplementation(async (_url, init) => {
    lastRequestBody = JSON.parse(String((init as RequestInit).body))
    const payload = await build(lastRequestBody?.publicKeys ?? [])

    return new Response(JSON.stringify({ payload }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  })
}

describe("tokenPool", () => {
  beforeEach(async () => {
    state.refreshToken = "refresh-1"
    lastRequestBody = undefined
    await chromeMock.storage.local.clear()
    await tokenPool().clear()

    authority = await fakeAuthority()
    fetchSpy = spyOn(globalThis, "fetch")
    respondWith((publicKeys) => authority.sign(publicKeys, nowSeconds() + 24 * HOUR))
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  describe("refreshing", () => {
    test("sends a fixed batch of freshly generated public keys", async () => {
      await tokenPool().refresh()

      expect(lastRequestBody?.publicKeys).toHaveLength(BATCH_SIZE)

      // Every key distinct - a repeated key would be a shared identifier across two sites
      expect(new Set(lastRequestBody?.publicKeys).size).toBe(BATCH_SIZE)

      for (const key of lastRequestBody?.publicKeys ?? []) {
        expect(fromBase64Url(key)).toHaveLength(32)
      }
    })

    test("asks for the same number every time, whatever the demand was", async () => {
      // Sizing the request to demand would tell the platform how much this subscriber browses
      await tokenPool().refresh()
      for (const hostname of ["a.test", "b.test", "c.test"]) await tokenPool().tokenFor(hostname)

      await tokenPool().refresh()

      expect(lastRequestBody?.publicKeys).toHaveLength(BATCH_SIZE)
    })

    test("never sends a private key anywhere", async () => {
      await tokenPool().refresh()

      const body = String((fetchSpy.mock.calls.at(-1)?.[1] as RequestInit).body)

      expect(Object.keys(JSON.parse(body))).toEqual(["publicKeys"])
      expect(body).not.toContain('"d"')
    })

    test("stores the batch so it survives a worker restart", async () => {
      await tokenPool().refresh()

      expect(await tokenPool().size()).toBe(BATCH_SIZE)
      expect(chromeMock.storage.local.peek().tokenPool).toBeDefined()
    })

    test("refuses a batch of the wrong size", async () => {
      respondWith(async (publicKeys) => {
        const batch = await authority.sign(publicKeys, nowSeconds() + HOUR)
        return { ...batch, signatures: batch.signatures.slice(0, 10) }
      })

      expect(tokenPool().refresh()).rejects.toThrow(/different number/)
    })

    test("refuses a protocol version it cannot build a token for", async () => {
      respondWith((publicKeys) => authority.sign(publicKeys, nowSeconds() + HOUR, 2))

      expect(tokenPool().refresh()).rejects.toThrow(/protocol version 2/)
    })

    test("refuses credentials that are already expired", async () => {
      respondWith((publicKeys) => authority.sign(publicKeys, nowSeconds() - 10))

      expect(tokenPool().refresh()).rejects.toThrow(/already-expired/)
    })

    test("refuses to refresh with no refresh token", async () => {
      state.refreshToken = undefined

      expect(tokenPool().refresh()).rejects.toThrow(/refresh token/)
    })

    test("discards the previous batch, so two anonymity sets never mix", async () => {
      await tokenPool().refresh()
      await tokenPool().tokenFor("partner.test")
      expect(await tokenPool().boundHostnames()).toEqual(["partner.test"])

      await tokenPool().refresh()

      expect(await tokenPool().boundHostnames()).toEqual([])
      expect(await tokenPool().size()).toBe(BATCH_SIZE)
    })
  })

  describe("binding a token to a hostname", () => {
    beforeEach(async () => {
      await tokenPool().refresh()
    })

    test("produces a token the publisher SDK's format expects", async () => {
      const token = await tokenPool().tokenFor("partner.test")
      const bytes = fromBase64Url(token as string)

      expect(bytes).toHaveLength(TOKEN_BYTES)
      expect(bytes[0]).toBe(1)
      expect(bytes[1]).toBe(1)
    })

    test("the hostname signature verifies against the ephemeral key in the token", async () => {
      // This is the check a publisher runs, reproduced exactly: reconstruct the message from the host
      // being served and verify it with the key the token carries
      const hostname = "partner.test"
      const bytes = fromBase64Url((await tokenPool().tokenFor(hostname)) as string)

      const encoder = new TextEncoder()
      const domain = encoder.encode(HOSTNAME_DOMAIN)
      const host = encoder.encode(hostname)

      const message = new Uint8Array(domain.length + HOSTNAME_SIGNATURE_OFFSET + host.length)
      message.set(domain, 0)
      message.set(bytes.subarray(0, HOSTNAME_SIGNATURE_OFFSET), domain.length)
      message.set(host, domain.length + HOSTNAME_SIGNATURE_OFFSET)

      const ephemeralKey = await crypto.subtle.importKey(
        "raw",
        bytes.subarray(EPHEMERAL_PUBLIC_KEY_OFFSET, EPHEMERAL_PUBLIC_KEY_OFFSET + 32),
        { name: "Ed25519" },
        false,
        ["verify"]
      )

      const verified = await crypto.subtle.verify(
        { name: "Ed25519" },
        ephemeralKey,
        bytes.subarray(HOSTNAME_SIGNATURE_OFFSET),
        message
      )

      expect(verified).toBe(true)
    })

    test("the same token fails for any other hostname", async () => {
      const bytes = fromBase64Url((await tokenPool().tokenFor("partner.test")) as string)

      const encoder = new TextEncoder()
      const domain = encoder.encode(HOSTNAME_DOMAIN)
      const host = encoder.encode("attacker.test")

      const message = new Uint8Array(domain.length + HOSTNAME_SIGNATURE_OFFSET + host.length)
      message.set(domain, 0)
      message.set(bytes.subarray(0, HOSTNAME_SIGNATURE_OFFSET), domain.length)
      message.set(host, domain.length + HOSTNAME_SIGNATURE_OFFSET)

      const ephemeralKey = await crypto.subtle.importKey(
        "raw",
        bytes.subarray(EPHEMERAL_PUBLIC_KEY_OFFSET, EPHEMERAL_PUBLIC_KEY_OFFSET + 32),
        { name: "Ed25519" },
        false,
        ["verify"]
      )

      expect(
        await crypto.subtle.verify(
          { name: "Ed25519" },
          ephemeralKey,
          bytes.subarray(HOSTNAME_SIGNATURE_OFFSET),
          message
        )
      ).toBe(false)
    })

    test("carries the authority signature through untouched", async () => {
      const token = await tokenPool().tokenFor("partner.test")
      const bytes = fromBase64Url(token as string)

      const stored = chromeMock.storage.local.peek().tokenPool as { unused: { signature: string }[] }
      const signatures = new Set(stored.unused.map((credential) => credential.signature))
      const carried = Buffer.from(bytes.subarray(AUTHORITY_SIGNATURE_OFFSET, NONCE_OFFSET)).toString("base64url")

      // The one that was spent is no longer in `unused`, so it must not be found there
      expect(signatures.has(carried)).toBe(false)
      expect(fromBase64Url(carried)).toHaveLength(64)
    })

    test("gives two hostnames entirely different tokens and keys", async () => {
      const first = fromBase64Url((await tokenPool().tokenFor("one.test")) as string)
      const second = fromBase64Url((await tokenPool().tokenFor("two.test")) as string)

      const keyOf = (bytes: Uint8Array) =>
        Buffer.from(bytes.subarray(EPHEMERAL_PUBLIC_KEY_OFFSET, EPHEMERAL_PUBLIC_KEY_OFFSET + 32)).toString("hex")

      // A shared key would be a shared identifier - the one thing this design exists to prevent
      expect(keyOf(first)).not.toBe(keyOf(second))
    })

    test("spends exactly one credential per new hostname", async () => {
      await tokenPool().tokenFor("one.test")
      await tokenPool().tokenFor("two.test")

      expect(await tokenPool().size()).toBe(BATCH_SIZE - 2)
    })

    test("reuses the same token for a returning visit", async () => {
      const first = await tokenPool().tokenFor("partner.test")
      const second = await tokenPool().tokenFor("partner.test")

      expect(second).toBe(first as string)
      expect(await tokenPool().size()).toBe(BATCH_SIZE - 1)
    })

    test("uses a fresh random nonce per binding", async () => {
      const one = fromBase64Url((await tokenPool().tokenFor("one.test")) as string)
      const two = fromBase64Url((await tokenPool().tokenFor("two.test")) as string)

      const nonceOf = (bytes: Uint8Array) =>
        Buffer.from(bytes.subarray(NONCE_OFFSET, HOSTNAME_SIGNATURE_OFFSET)).toString("hex")

      expect(nonceOf(one)).not.toBe(nonceOf(two))
    })

    test("remembers which hostnames are bound, so rules can be reinstated", async () => {
      await tokenPool().tokenFor("one.test")
      await tokenPool().tokenFor("two.test")

      expect((await tokenPool().boundHostnames()).sort()).toEqual(["one.test", "two.test"])
    })
  })

  describe("when there is nothing to spend", () => {
    test("returns nothing rather than throwing with no pool at all", async () => {
      expect(await tokenPool().tokenFor("partner.test")).toBeUndefined()
    })

    test("returns nothing once the batch has expired", async () => {
      respondWith((publicKeys) => authority.sign(publicKeys, nowSeconds() + 1))
      await tokenPool().refresh()

      await Bun.sleep(1100)

      expect(await tokenPool().tokenFor("partner.test")).toBeUndefined()
      expect(await tokenPool().size()).toBe(0)
    })

    test("reports that a refresh is needed when the pool is empty or expired", async () => {
      expect(await tokenPool().needsRefresh()).toBe(true)

      await tokenPool().refresh()

      expect(await tokenPool().needsRefresh()).toBe(false)
    })

    test("clear wipes both the credentials and the bindings", async () => {
      await tokenPool().refresh()
      await tokenPool().tokenFor("partner.test")

      await tokenPool().clear()

      expect(await tokenPool().size()).toBe(0)
      expect(await tokenPool().boundHostnames()).toEqual([])
    })
  })
})
