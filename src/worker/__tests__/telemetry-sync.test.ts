import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { chromeMock } from "../../__fixtures__/chrome"

const HOUR = 60 * 60 * 1000

const state = { active: true, extensionToken: "ext-1" as string | undefined, expiresAt: Date.now() + HOUR }
mock.module("../extension", () => ({
  extension: () => ({
    ready: Promise.resolve(),
    isSubscriptionActive: () => state.active,
    getExtensionToken: () => state.extensionToken,
    getExtensionData: () => ({ subscription: { expiresAt: state.expiresAt } }),
  }),
}))

type Observation = { publisherId: string; source: string; hostname: string; views: number; duration: number }
let exported: Observation[] = []
let readyResolved = false
let ready = Promise.resolve()
const acknowledge = mock(async (_observations: Observation[]) => {})
mock.module("../telemetry", () => ({
  telemetry: () => ({
    get ready() {
      return ready
    },
    export: () => (readyResolved ? exported : []),
    acknowledge,
  }),
}))

const { EVENT, eventBroker } = await import("../event-broker")
const { telemetrySync } = await import("../telemetry-sync")

const PUSH_ALARM = "telemetry-push"
const PRE_EXPIRY_ALARM = "telemetry-push-before-expiry"

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("telemetrySync", () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>

  beforeEach(() => {
    state.active = true
    state.extensionToken = "ext-1"
    state.expiresAt = Date.now() + HOUR
    exported = [{ publisherId: "client-a", source: "header", hostname: "a.test", views: 3, duration: 900 }]
    readyResolved = true
    ready = Promise.resolve()
    acknowledge.mockClear()
    chromeMock.runtime.manifestVersion = "0.9.3"
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ received: true }))
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  test("registers an hourly push alarm at start-up, bounding how far usage can be misdated", () => {
    expect(chromeMock.alarms.peek().get(PUSH_ALARM)?.periodInMinutes).toBe(60)
  })

  test("posts the exported telemetry to the ingest endpoint", async () => {
    await telemetrySync().push()

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.zeroad.network/extension/telemetry")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ext-1")
    expect(JSON.parse(init.body as string)).toEqual({
      client: { source: "extension", extension: { version: "0.9.3" } },
      data: {
        observations: [{ publisherId: "client-a", source: "header", hostname: "a.test", views: 3, duration: 900 }],
      },
    })
  })

  test("acknowledges exactly what was sent, once the server accepted it", async () => {
    const sent = exported

    await telemetrySync().push()

    expect(acknowledge).toHaveBeenCalledWith(sent)
  })

  test("keeps the data when the push fails, so nothing is lost to a bad night", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: "boom" }, 500))

    await telemetrySync().push()

    expect(acknowledge).not.toHaveBeenCalled()
  })

  test("swallows a network failure rather than letting it escape the alarm handler", async () => {
    fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"))

    await expect(telemetrySync().push()).resolves.toBeUndefined()
  })

  test("waits for the stored telemetry before deciding there is nothing to send", async () => {
    // The push alarm can fire the moment a service worker wakes up, well before storage is read.
    readyResolved = false
    let markLoaded = () => {}
    ready = new Promise<void>((resolve) => {
      markLoaded = () => {
        readyResolved = true
        resolve()
      }
    })

    const pushed = telemetrySync().push()
    markLoaded()
    await pushed

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  describe("skipping", () => {
    test("an inactive subscription skips the push but keeps the data for a late renewal", async () => {
      state.active = false

      await telemetrySync().push()

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(acknowledge).not.toHaveBeenCalled()
    })

    test("a missing extension token skips the push but keeps the data", async () => {
      state.extensionToken = undefined

      await telemetrySync().push()

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(acknowledge).not.toHaveBeenCalled()
    })

    test("an empty batch is not sent", async () => {
      exported = []

      await telemetrySync().push()

      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe("pushing before the subscription expires", () => {
    test("an active subscription arms a push a minute before it expires", async () => {
      // The platform refuses usage after expiry, so the last of it has to go out while still live.
      eventBroker().emit(EVENT.EXTENSION.SUBSCRIPTION_ACTIVE)
      await Bun.sleep(0)

      expect(chromeMock.alarms.peek().get(PRE_EXPIRY_ALARM)?.scheduledTime).toBe(state.expiresAt - 60 * 1000)
    })

    test("arms nothing when that moment has already passed", async () => {
      await chromeMock.alarms.clear(PRE_EXPIRY_ALARM)
      state.expiresAt = Date.now() + 30 * 1000

      eventBroker().emit(EVENT.EXTENSION.SUBSCRIPTION_ACTIVE)
      await Bun.sleep(0)

      expect(chromeMock.alarms.peek().has(PRE_EXPIRY_ALARM)).toBe(false)
    })

    test("the pre-expiry alarm pushes", async () => {
      await chromeMock.alarms.fire(PRE_EXPIRY_ALARM)
      await Bun.sleep(0)

      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe("triggers", () => {
    test("the push alarm asks for a push", async () => {
      await chromeMock.alarms.fire(PUSH_ALARM)
      await Bun.sleep(0)

      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    test("an unrelated alarm does not", async () => {
      await chromeMock.alarms.fire("EXTENSION_TOKEN_EXPIRATION_ALARM")
      await Bun.sleep(0)

      expect(fetchSpy).not.toHaveBeenCalled()
    })

    test("a PUSH event asks for a push", async () => {
      eventBroker().emit(EVENT.TELEMETRY.PUSH)
      await Bun.sleep(0)

      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
  })
})
