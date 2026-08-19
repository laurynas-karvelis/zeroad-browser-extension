import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { chromeMock } from "../__fixtures__/chrome"

const state = { refreshToken: "refresh-1" as string | undefined }
mock.module("./extension", () => ({ extension: () => ({ getRefreshToken: () => state.refreshToken }) }))

const { EVENT, eventBroker } = await import("./event-broker")
const { credentials } = await import("./credentials")

const EXPIRY_ALARM = "EXTENSION_TOKEN_EXPIRATION_ALARM"
const RETRY_ALARM = "EXTENSION_TOKEN_RENEWAL_ATTEMPT_ALARM"
const HOUR = 60 * 60 * 1000

const syncPayload = (expiresAt = Date.now() + HOUR, extensionToken = "ext-new") => ({
  payload: {
    user: { firstName: "Ada", refreshToken: "refresh-1" },
    subscription: { planName: "clean-web", extensionToken, telemetryToken: "tel", expiresAt },
  },
})

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const alarms = () => chromeMock.alarms.peek()
const storedAttempts = () => chromeMock.storage.local.peek().renewalAttempts

describe("credentials", () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>

  beforeEach(async () => {
    state.refreshToken = "refresh-1"
    await chromeMock.alarms.clearAll()
    await chromeMock.storage.local.clear()
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(syncPayload()))
  })

  afterEach(() => {
    // Without this, re-spying in beforeEach reuses the same spy and its call log keeps growing.
    fetchSpy.mockRestore()
  })

  describe("scheduling", () => {
    test("enableRenewal arms an alarm for the moment the token expires", async () => {
      const when = Date.now() + HOUR

      await credentials().enableRenewal(when)

      expect(alarms().get(EXPIRY_ALARM)?.scheduledTime).toBe(when)
    })

    test("re-arming moves the alarm rather than adding a second one", async () => {
      await credentials().enableRenewal(Date.now() + HOUR)
      await credentials().enableRenewal(Date.now() + 2 * HOUR)

      expect(alarms().size).toBe(1)
    })

    test("enableRenewal(0) arms nothing, since there is no expiry to renew against", async () => {
      await credentials().enableRenewal(0)

      expect(alarms().size).toBe(0)
    })

    test("enableRenewal wipes a retry backlog left over from an earlier failure", async () => {
      await chromeMock.storage.local.set({ renewalAttempts: 3 })
      await chromeMock.alarms.create(RETRY_ALARM, { periodInMinutes: 1 })

      await credentials().enableRenewal(Date.now() + HOUR)

      expect(alarms().has(RETRY_ALARM)).toBe(false)
      expect(storedAttempts()).toBeUndefined()
    })

    test("cancelRenewal clears both alarms and the attempt counter", async () => {
      await credentials().enableRenewal(Date.now() + HOUR)
      await chromeMock.storage.local.set({ renewalAttempts: 2 })
      await chromeMock.alarms.create(RETRY_ALARM, { periodInMinutes: 1 })

      await credentials().cancelRenewal()

      expect(alarms().size).toBe(0)
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
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer refresh-1")
      expect(received).toHaveBeenCalledWith(body.payload)
    })

    test("clears the retry state after a successful renewal", async () => {
      await chromeMock.storage.local.set({ renewalAttempts: 3 })
      await chromeMock.alarms.create(RETRY_ALARM, { periodInMinutes: 1 })

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

    test("asks for a reset instead of renewing when there is no refresh token", async () => {
      state.refreshToken = undefined
      const reset = mock()
      eventBroker().on(EVENT.EXTENSION.REQUEST_RESET, reset)

      await chromeMock.alarms.fire(EXPIRY_ALARM)

      expect(reset).toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe("rejecting a bad renewal", () => {
    const cases: [string, unknown][] = [
      ["a subscription that is already expired", syncPayload(Date.now() - 1000)],
      ["a payload with no subscription", { payload: { user: { refreshToken: "refresh-1" } } }],
      ["a subscription with no extension token", syncPayload(Date.now() + HOUR, "")],
    ]

    for (const [description, body] of cases) {
      test(`does not accept ${description}`, async () => {
        fetchSpy.mockResolvedValue(jsonResponse(body))
        const received = mock()
        eventBroker().on(EVENT.EXTENSION.PAYLOAD_RECEIVED, received)

        await chromeMock.alarms.fire(EXPIRY_ALARM)

        expect(received).not.toHaveBeenCalled()
        expect(alarms().get(RETRY_ALARM)?.periodInMinutes).toBe(1)
      })
    }
  })

  describe("retrying", () => {
    test("a failed renewal counts the attempt and arms a one-minute retry", async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ error: "nope" }, 500))

      await chromeMock.alarms.fire(EXPIRY_ALARM)

      expect(storedAttempts()).toBe(1)
      expect(alarms().get(RETRY_ALARM)?.periodInMinutes).toBe(1)
    })

    test("keeps the existing retry alarm across attempts rather than pushing it back", async () => {
      fetchSpy.mockResolvedValue(jsonResponse({}, 500))

      await chromeMock.alarms.fire(EXPIRY_ALARM)
      const scheduledTime = alarms().get(RETRY_ALARM)?.scheduledTime
      await chromeMock.alarms.fire(RETRY_ALARM)

      expect(storedAttempts()).toBe(2)
      expect(alarms().get(RETRY_ALARM)?.scheduledTime).toBe(scheduledTime)
    })

    test("gives up and asks for a reset once the attempts run out", async () => {
      // Five failures means the refresh token is not coming back; keeping it would retry forever.
      fetchSpy.mockResolvedValue(jsonResponse({}, 500))
      const reset = mock()
      eventBroker().on(EVENT.EXTENSION.REQUEST_RESET, reset)

      for (let attempt = 0; attempt < 5; attempt++) await chromeMock.alarms.fire(RETRY_ALARM)
      expect(reset).not.toHaveBeenCalled()

      await chromeMock.alarms.fire(RETRY_ALARM)

      expect(reset).toHaveBeenCalledTimes(1)
      expect(fetchSpy).toHaveBeenCalledTimes(5)
    })

    test("a network failure retries the same way an error status does", async () => {
      fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"))

      await chromeMock.alarms.fire(EXPIRY_ALARM)

      expect(storedAttempts()).toBe(1)
    })
  })
})
