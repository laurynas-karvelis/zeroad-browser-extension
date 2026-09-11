import { schedule } from "./alarm"
import { getConfig } from "./config"
import { ExtensionError } from "./error"
import { EVENT, eventBroker } from "./event-broker"
import { extension } from "./extension"
import { log } from "./logger"
import { tokenPool } from "./token-pool"
import type { ExtensionSyncData } from "./types"
import { httpPost } from "./utils"

type StoredAttempt = { renewalAttempts: number }

/**
 * Minutes to wait before each renewal retry; attempts past the end repeat the last delay. A renewal is
 * not charged the instant a period ends - Stripe finalizes the invoice about an hour later and retries
 * a failed payment for days - so giving up after a few minutes would drop a paying subscriber.
 */
const RENEWAL_RETRY_DELAYS_IN_MINUTES = [1, 5, 15, 60]

/** Roughly three days of hourly retries, matching how long a late renewal payment can take. */
const MAX_RENEWAL_ATTEMPTS = 75

/** How often the token pool is checked; it refreshes itself only when running low or close to expiry. */
const TOKEN_POOL_CHECK_INTERVAL_IN_MINUTES = 60

const getAttempt = async () => {
  const { renewalAttempts } = await chrome.storage.local.get<StoredAttempt>(["renewalAttempts"])
  return renewalAttempts || 0
}

const increaseAttempt = async () => {
  const renewalAttempts = (await getAttempt()) + 1
  await chrome.storage.local.set<StoredAttempt>({ renewalAttempts })
  return renewalAttempts
}

const clearAttempt = async () => {
  await chrome.storage.local.remove<StoredAttempt>(["renewalAttempts"])
}

// The sync endpoint answers 403 only when it cannot identify the user from the token. A lapsed or
// missing subscription still comes back as a normal payload.
const isTokenRejected = (error: unknown) => error instanceof ExtensionError && error.status === 403

class Credentials {
  EXTENSION_TOKEN_EXPIRATION_ALARM = "EXTENSION_TOKEN_EXPIRATION_ALARM"
  EXTENSION_TOKEN_RENEWAL_ATTEMPT_ALARM = "EXTENSION_TOKEN_RENEWAL_ATTEMPT_ALARM"
  TOKEN_POOL_CHECK_ALARM = "TOKEN_POOL_CHECK_ALARM"

  constructor() {
    schedule.on([this.EXTENSION_TOKEN_EXPIRATION_ALARM, this.EXTENSION_TOKEN_RENEWAL_ATTEMPT_ALARM], () =>
      this.attemptToRenewToken()
    )

    schedule
      .on(this.TOKEN_POOL_CHECK_ALARM, () => this.maintainTokenPool())
      .create(this.TOKEN_POOL_CHECK_ALARM, { periodInMinutes: TOKEN_POOL_CHECK_INTERVAL_IN_MINUTES })

    eventBroker().on(EVENT.EXTENSION.SUBSCRIPTION_ACTIVE, () => this.maintainTokenPool())
  }

  async enableRenewal(when: number) {
    await this.cancelRenewalAttempts()
    if (when) await schedule.recreate(this.EXTENSION_TOKEN_EXPIRATION_ALARM, { when })
  }

  async cancelRenewal() {
    await Promise.all([schedule.clear(this.EXTENSION_TOKEN_EXPIRATION_ALARM), this.cancelRenewalAttempts()])
  }

  /**
   * Keeps the token pool stocked. Credentials live one to two days while a subscription lasts a month or
   * a year, so the pool is maintained on its own schedule rather than alongside subscription renewal.
   */
  async maintainTokenPool() {
    await extension().ready
    if (!extension().isSubscriptionActive()) return

    try {
      if (await tokenPool().needsRefresh()) await tokenPool().refresh()
    } catch (error) {
      // The next check retries. Until then sites see an ordinary visitor, which is not an error.
      log("warn", "[token-pool]", "refresh failed", error)
    }
  }

  private async cancelRenewalAttempts() {
    await Promise.all([schedule.clear(this.EXTENSION_TOKEN_RENEWAL_ATTEMPT_ALARM), clearAttempt()])
  }

  private async request() {
    const extensionToken = extension().getExtensionToken()
    if (!extensionToken) throw new Error("Client extension token doesn't exist")

    const config = await getConfig()
    const { payload } = await httpPost<{ payload: ExtensionSyncData }>(
      config.GENERIC.EXTENSION_SYNC_URL,
      extensionToken,
      {}
    )

    return payload
  }

  private async attemptToRenewToken() {
    // An alarm is often what wakes the worker; renewing against unread state would look signed out.
    await extension().ready

    if (!extension().getExtensionToken()) {
      await this.cancelRenewal()
      return
    }

    try {
      const payload = await this.request()

      // The platform's answer is stored even when the subscription has not been extended yet, so a
      // lapse turns injection off instead of leaving it running on the old period.
      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, payload)

      if ((payload?.subscription?.expiresAt || 0) > Date.now()) {
        await this.cancelRenewalAttempts()
        return
      }
    } catch (error) {
      if (isTokenRejected(error)) {
        log("warn", "[token-renew]", "the platform rejected the extension token, signing out")
        eventBroker().emit(EVENT.EXTENSION.REQUEST_RESET)
        return
      }

      log("debug", "[token-renew]", error)
    }

    await this.scheduleRenewalRetry()
  }

  private async scheduleRenewalRetry() {
    const attempt = await increaseAttempt()

    if (attempt > MAX_RENEWAL_ATTEMPTS) {
      // Stop polling but stay signed in - the next sync from the website picks the subscription back up.
      log("debug", "[token-renew]", "max attempts reached, give up")
      await this.cancelRenewalAttempts()
      return
    }

    const delayInMinutes = RENEWAL_RETRY_DELAYS_IN_MINUTES[attempt - 1] ?? RENEWAL_RETRY_DELAYS_IN_MINUTES.at(-1)
    await schedule.recreate(this.EXTENSION_TOKEN_RENEWAL_ATTEMPT_ALARM, { delayInMinutes })
  }
}

const singleton = new Credentials()
export const credentials = () => singleton
