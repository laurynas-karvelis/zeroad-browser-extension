import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { chromeMock } from "../__fixtures__/chrome"

const state = { active: true, telemetryToken: "tel-1" as string | undefined }
mock.module("./extension", () => ({
  extension: () => ({
    isSubscriptionActive: () => state.active,
    getTelemetryToken: () => state.telemetryToken,
  }),
}))

let exported: Record<string, { views: number; duration: number; hosts: string[] }> = {}
let readyResolved = false
let ready = Promise.resolve()
mock.module("./telemetry", () => ({
  telemetry: () => ({
    get ready() {
      return ready
    },
    export: () => (readyResolved ? exported : {}),
  }),
}))

const { EVENT, eventBroker } = await import("./event-broker")
const { telemetrySync } = await import("./telemetry-sync")

const PUSH_ALARM = "telemetry-push"

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("telemetrySync", () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>

  beforeEach(() => {
    state.active = true
    state.telemetryToken = "tel-1"
    exported = { "client-a": { hostnames: { "a.test": { views: 3, duration: 900 } } } }
    readyResolved = true
    ready = Promise.resolve()
    chromeMock.runtime.manifestVersion = "0.9.3"
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ received: true }))
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  test("registers a daily push alarm at start-up", () => {
    expect(chromeMock.alarms.peek().get(PUSH_ALARM)?.periodInMinutes).toBe(60 * 24)
  })

  test("posts the exported telemetry to the ingest endpoint", async () => {
    await telemetrySync().push()

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.zeroad.network/extension/telemetry")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tel-1")
    expect(JSON.parse(init.body as string)).toEqual({
      client: { source: "extension", extension: { version: "0.9.3" } },
      data: { publishers: { "client-a": { hostnames: { "a.test": { views: 3, duration: 900 } } } } },
    })
  })

  test("flushes only after the server accepted the batch", async () => {
    const flush = mock()
    eventBroker().on(EVENT.TELEMETRY.FLUSH, flush)

    await telemetrySync().push()

    expect(flush).toHaveBeenCalledTimes(1)
  })

  test("keeps the data when the push fails, so nothing is lost to a bad night", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: "boom" }, 500))
    const flush = mock()
    eventBroker().on(EVENT.TELEMETRY.FLUSH, flush)

    await telemetrySync().push()

    expect(flush).not.toHaveBeenCalled()
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
    test("an inactive subscription drops the data instead of sending it", async () => {
      // Nothing browsed without a live subscription may earn a publisher a payout.
      state.active = false
      const flush = mock()
      eventBroker().on(EVENT.TELEMETRY.FLUSH, flush)

      await telemetrySync().push()

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(flush).toHaveBeenCalledTimes(1)
    })

    test("a missing telemetry token skips the push but keeps the data", async () => {
      state.telemetryToken = undefined
      const flush = mock()
      eventBroker().on(EVENT.TELEMETRY.FLUSH, flush)

      await telemetrySync().push()

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(flush).not.toHaveBeenCalled()
    })

    test("an empty batch is not sent", async () => {
      exported = {}

      await telemetrySync().push()

      expect(fetchSpy).not.toHaveBeenCalled()
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
