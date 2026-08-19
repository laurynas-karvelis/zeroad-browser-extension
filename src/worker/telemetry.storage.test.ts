import { beforeEach, describe, expect, mock, test } from "bun:test"
import { chromeMock } from "./__fixtures__/chrome"

mock.module("./extension", () => ({ extension: () => ({ isSubscriptionActive: () => true }) }))

const { EVENT, eventBroker } = await import("./event-broker")
const { Telemetry } = await import("./telemetry")

// Persistence lives in its own file because instances stay subscribed to the shared event bus for
// the lifetime of the module registry - a second instance would race this one's debounced writes.
const SAVE_DEBOUNCE_DELAY = 5

const detectPartner = (clientId: string, url: string) =>
  eventBroker().emit(EVENT.TAB_TRACKER.PARTNER_DETECTED, { clientId, url, features: ["CLEAN_WEB"] })

const storedTelemetry = () => chromeMock.storage.local.peek().telemetry as Record<string, unknown> | undefined

const settle = () => Bun.sleep(SAVE_DEBOUNCE_DELAY * 4)

describe("Telemetry persistence", () => {
  beforeEach(async () => {
    await chromeMock.storage.local.clear()
  })

  test("coalesces a burst of changes into a single debounced write", async () => {
    const telemetry = new Telemetry(SAVE_DEBOUNCE_DELAY)
    await telemetry.ready

    detectPartner("client-a", "https://a.test/")
    telemetry.addViews("https://a.test/")
    telemetry.addDuration("https://a.test/", 750)

    // Nothing is written until the burst stops.
    expect(storedTelemetry()?.["a.test"]).toBeUndefined()

    await settle()

    expect(storedTelemetry()).toEqual({
      "a.test": { clientId: "client-a", features: ["CLEAN_WEB"], views: 1, duration: 750 },
    })
  })

  test("what was written is what a restarted worker reads back", async () => {
    const first = new Telemetry(SAVE_DEBOUNCE_DELAY)
    await first.ready
    detectPartner("client-a", "https://a.test/")
    first.addViews("https://a.test/")
    first.addDuration("https://a.test/", 750)
    await settle()

    // A service worker is torn down and rebuilt constantly; counters must not restart from zero.
    const restarted = new Telemetry(SAVE_DEBOUNCE_DELAY)
    await restarted.ready

    expect(restarted.map.get("a.test")).toEqual({
      clientId: "client-a",
      features: ["CLEAN_WEB"],
      views: 1,
      duration: 750,
    })
  })

  test("a flush is persisted, so a pushed batch is never counted twice", async () => {
    await chromeMock.storage.local.seed({
      telemetry: { "a.test": { clientId: "client-a", features: ["CLEAN_WEB"], views: 2, duration: 200 } },
    })
    const telemetry = new Telemetry(SAVE_DEBOUNCE_DELAY)
    await telemetry.ready

    eventBroker().emit(EVENT.TELEMETRY.FLUSH)
    await settle()

    expect(storedTelemetry()).toEqual({
      "a.test": { clientId: "client-a", features: ["CLEAN_WEB"], views: 0, duration: 0 },
    })
  })

  test("`ready` resolves only after the stored map is in place", async () => {
    await chromeMock.storage.local.seed({
      telemetry: { "a.test": { clientId: "client-a", features: [], views: 1, duration: 1 } },
    })

    const telemetry = new Telemetry(SAVE_DEBOUNCE_DELAY)
    // Reading before awaiting `ready` is exactly the empty-export bug telemetry-sync guards against.
    expect(telemetry.export()).toEqual({})

    await telemetry.ready

    expect(telemetry.export()).toEqual({ "client-a": { views: 1, duration: 1, hosts: ["a.test"] } })
  })
})
