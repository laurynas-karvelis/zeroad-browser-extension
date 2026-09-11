import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { chromeMock } from "../../__fixtures__/chrome"

const state = {
  extensionToken: "ext-1" as string | undefined,
  isSubscriptionActive: true,
  ready: Promise.resolve() as Promise<void>,
}
mock.module("../extension", () => ({
  extension: () => ({
    ready: state.ready,
    getExtensionToken: () => state.extensionToken,
    isSubscriptionActive: () => state.isSubscriptionActive,
  }),
}))

const pool = { needsRefresh: true, refresh: mock(async () => 250) }
mock.module("../token-pool", () => ({
  tokenPool: () => ({
    needsRefresh: async () => pool.needsRefresh,
    refresh: pool.refresh,
  }),
}))

const { EVENT, eventBroker } = await import("../event-broker")
const { credentials } = await import("../credentials")

const EXPIRY_ALARM = "EXTENSION_TOKEN_EXPIRATION_ALARM"
const RETRY_ALARM = "EXTENSION_TOKEN_RENEWAL_ATTEMPT_ALARM"
const POOL_ALARM = "TOKEN_POOL_CHECK_ALARM"

// Created at import, before the per-test reset clears every alarm.
await Bun.sleep(0)
const poolAlarmAtStartup = chromeMock.alarms.peek().get(POOL_ALARM)
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

const syncPayload = (expiresAt = Date.now() + HOUR) => ({
  payload: {
    user: { firstName: "Ada", extensionToken: "ext-1" },
    subscription: { planName: "clean-web", expiresAt },
  },
})

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const alarms = () => chromeMock.alarms.peek()
const storedAttempts = () => chromeMock.storage.local.peek().renewalAttempts
const retryDelay = () => (alarms().get(RETRY_ALARM)?.scheduledTime ?? 0) - Date.now()

describe("credentials", () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>

  beforeEach(async () => {
    state.extensionToken = "ext-1"
    state.isSubscriptionActive = true
    state.ready = Promise.resolve()
    pool.needsRefresh = true
    pool.refresh.mockClear()
    await chromeMock.alarms.clearAll()
    await chromeMock.storage.local.clear()
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(syncPayload()))
  })

  afterEach(() => {
    // Without this, re-spying in beforeEach reuses the same spy and its call log keeps growing.
    fetchSpy.mockRestore()
  })

  describe("scheduling", () => {
    test("enableRenewal arms an alarm for the moment the subscription expires", async () => {
      const when = Date.now() + HOUR

      await credentials().enableRenewal(when)

      expect(alarms().get(EXPIRY_ALARM)?.scheduledTime).toBe(when)
    })

    test("re-arming moves the alarm rather than adding a second one", async () => {
      await credentials().enableRenewal(Date.now() + HOUR)
      await credentials().enableRenewal(Date.now() + 2 * HOUR)

      expect(alarms().has(EXPIRY_ALARM)).toBe(true)
      expect([...alarms().keys()].filter((name) => name === EXPIRY_ALARM)).toHaveLength(1)
    })

    test("enableRenewal(0) arms nothing, since there is no expiry to renew against", async () => {
      await credentials().enableRenewal(0)

      expect(alarms().has(EXPIRY_ALARM)).toBe(false)
    })

    test("enableRenewal wipes a retry backlog left over from an earlier failure", async () => {
      await chromeMock.storage.local.set({ renewalAttempts: 3 })
      await chromeMock.alarms.create(RETRY_ALARM, { delayInMinutes: 5 })

      await credentials().enableRenewal(Date.now() + HOUR)

      expect(alarms().has(RETRY_ALARM)).toBe(false)
      expect(storedAttempts()).toBeUndefined()
    })

    test("cancelRenewal clears both renewal alarms and the attempt counter", async () => {
      await credentials().enableRenewal(Date.now() + HOUR)
      await chromeMock.storage.local.set({ renewalAttempts: 2 })
      await chromeMock.alarms.create(RETRY_ALARM, { delayInMinutes: 5 })

      await credentials().cancelRenewal()

      expect(alarms().has(EXPIRY_ALARM)).toBe(false)
      expect(alarms().has(RETRY_ALARM)).toBe(false)
      expect(storedAttempts()).toBeUndefined()
    })
  })

  describe("renewing on the expiry alarm", () => {
    test("fetches a fresh payload and hands it on", async () => {
      const body = syncPayload()
      fetchSpy.mockResolvedValue(jsonResponse(body))
      const received = mock()
      eventBroker().on(EVENT.EXTENSION.PAYLOAD_RECEIVED, received)

      await chromeMock.alarms.fire(EXPIRY_ALARM)

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe("https://zeroad.network/extension/sync")
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ext-1")
      expect(received).toHaveBeenCalledWith(body.payload)
    })

    test("clears the retry state after a successful renewal", async () => {
      await chromeMock.storage.local.set({ renewalAttempts: 3 })
      await chromeMock.alarms.create(RETRY_ALARM, { delayInMinutes: 5 })

      await chromeMock.alarms.fire(EXPIRY_ALARM)

      expect(alarms().has(RETRY_ALARM)).toBe(false)
      expect(storedAttempts()).toBeUndefined()
    })

    test("the retry alarm renews too", async () => {
      const received = mock()
      eventBroker().on(EVENT.EXTENSION.PAYLOAD_RECEIVED, received)

      await chromeMock.alarms.fire(RETRY_ALARM)

      expect(received).toHaveBeenCalled()
    })

    test("an unrelated alarm does not trigger a renewal", async () => {
      await chromeMock.alarms.fire("telemetry-push")

      expect(fetchSpy).not.toHaveBeenCalled()
    })

    test("waits for the stored state before renewing, so a waking worker is not mistaken for signed out", async () => {
      let finishLoading = () => {}
      state.ready = new Promise((resolve) => {
        finishLoading = resolve
      })
      const reset = mock()
      eventBroker().on(EVENT.EXTENSION.REQUEST_RESET, reset)

      const renewal = chromeMock.alarms.fire(EXPIRY_ALARM)
      await Bun.sleep(0)
      expect(fetchSpy).not.toHaveBeenCalled()

      finishLoading()
      await renewal

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(reset).not.toHaveBeenCalled()
    })

    test("a signed-out extension stops renewing instead of resetting", async () => {
      state.extensionToken = undefined
      const reset = mock()
      eventBroker().on(EVENT.EXTENSION.REQUEST_RESET, reset)
      await credentials().enableRenewal(Date.now() + HOUR)

      await chromeMock.alarms.fire(EXPIRY_ALARM)

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(reset).not.toHaveBeenCalled()
      expect(alarms().has(EXPIRY_ALARM)).toBe(false)
    })
  })

  describe("a renewal the platform has not processed yet", () => {
    const cases: [string, unknown][] = [
      ["a subscription that is still on its old period", syncPayload(Date.now() - 1000)],
      ["a payload with no subscription", { payload: { user: { extensionToken: "ext-1" } } }],
    ]

    for (const [description, body] of cases) {
      test(`stores ${description} and keeps retrying, without signing out`, async () => {
        fetchSpy.mockResolvedValue(jsonResponse(body))
        const received = mock()
        const reset = mock()
        eventBroker().on(EVENT.EXTENSION.PAYLOAD_RECEIVED, received)
        eventBroker().on(EVENT.EXTENSION.REQUEST_RESET, reset)

        await chromeMock.alarms.fire(EXPIRY_ALARM)

        expect(received).toHaveBeenCalledWith((body as { payload: unknown }).payload)
        expect(reset).not.toHaveBeenCalled()
        expect(storedAttempts()).toBe(1)
        expect(alarms().has(RETRY_ALARM)).toBe(true)
      })
    }
  })

  describe("retrying", () => {
    test("backs off from a minute to hourly, since renewal payments take hours to land", async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ error: "nope" }, 500))
      const delays: number[] = []

      for (let attempt = 0; attempt < 6; attempt++) {
        await chromeMock.alarms.fire(RETRY_ALARM)
        delays.push(Math.round(retryDelay() / MINUTE))
      }

      expect(delays).toEqual([1, 5, 15, 60, 60, 60])
    })

    test("a rejected token signs the extension out", async () => {
      fetchSpy.mockResolvedValue(jsonResponse({}, 403))
      const reset = mock()
      eventBroker().on(EVENT.EXTENSION.REQUEST_RESET, reset)

      await chromeMock.alarms.fire(EXPIRY_ALARM)

      expect(reset).toHaveBeenCalledTimes(1)
      expect(alarms().has(RETRY_ALARM)).toBe(false)
    })

    test("a server error is retried, never treated as a rejected token", async () => {
      fetchSpy.mockResolvedValue(jsonResponse({}, 500))
      const reset = mock()
      eventBroker().on(EVENT.EXTENSION.REQUEST_RESET, reset)

      await chromeMock.alarms.fire(EXPIRY_ALARM)

      expect(reset).not.toHaveBeenCalled()
      expect(storedAttempts()).toBe(1)
    })

    test("stops polling after about three days but stays signed in", async () => {
      fetchSpy.mockResolvedValue(jsonResponse({}, 500))
      const reset = mock()
      eventBroker().on(EVENT.EXTENSION.REQUEST_RESET, reset)
      await chromeMock.storage.local.set({ renewalAttempts: 75 })

      await chromeMock.alarms.fire(RETRY_ALARM)

      expect(alarms().has(RETRY_ALARM)).toBe(false)
      expect(storedAttempts()).toBeUndefined()
      expect(reset).not.toHaveBeenCalled()
    })

    test("a network failure retries the same way an error status does", async () => {
      fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"))

      await chromeMock.alarms.fire(EXPIRY_ALARM)

      expect(storedAttempts()).toBe(1)
    })
  })

  describe("keeping the token pool stocked", () => {
    test("checks the pool on its own hourly alarm", () => {
      expect(poolAlarmAtStartup?.periodInMinutes).toBe(60)
    })

    test("refreshes a pool that needs it when the subscription becomes active", async () => {
      eventBroker().emit(EVENT.EXTENSION.SUBSCRIPTION_ACTIVE)
      await Bun.sleep(0)

      expect(pool.refresh).toHaveBeenCalledTimes(1)
    })

    test("refreshes on the check alarm, independently of subscription renewal", async () => {
      await chromeMock.alarms.fire(POOL_ALARM)

      expect(pool.refresh).toHaveBeenCalledTimes(1)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    test("leaves a well-stocked pool alone", async () => {
      // A fresh batch every check would discard unspent credentials and move every site onto a new
      // anonymity set for no reason
      pool.needsRefresh = false

      await chromeMock.alarms.fire(POOL_ALARM)

      expect(pool.refresh).not.toHaveBeenCalled()
    })

    test("does not ask for credentials without a live subscription", async () => {
      state.isSubscriptionActive = false

      await chromeMock.alarms.fire(POOL_ALARM)

      expect(pool.refresh).not.toHaveBeenCalled()
    })

    test("a failed refresh is left for the next check rather than thrown", async () => {
      pool.refresh.mockRejectedValueOnce(new Error("rate_limited"))

      await expect(credentials().maintainTokenPool()).resolves.toBeUndefined()
    })

    test("renewing the subscription no longer touches the pool", async () => {
      await chromeMock.alarms.fire(EXPIRY_ALARM)

      expect(pool.refresh).not.toHaveBeenCalled()
    })
  })
})
