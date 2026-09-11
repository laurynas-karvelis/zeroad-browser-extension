import { beforeEach, describe, expect, mock, test } from "bun:test"
import { chromeMock } from "../../__fixtures__/chrome"

mock.module("../extension", () => ({ extension: () => ({ isSubscriptionActive: () => true }) }))

const { EVENT, eventBroker } = await import("../event-broker")
const { Telemetry } = await import("../telemetry")

// Persistence lives in its own file because instances stay subscribed to the shared event bus for the
// lifetime of the module registry - each test uses its own hostname so earlier instances stay out of it.

const detectPublisher = (publisherId: string, url: string) =>
  eventBroker().emit(EVENT.TAB_TRACKER.PUBLISHER_DETECTED, { publisherId, source: "header", url })

const storedTelemetry = () => chromeMock.storage.local.peek().telemetry as Record<string, unknown> | undefined

describe("Telemetry persistence", () => {
  beforeEach(async () => {
    await chromeMock.storage.local.clear()
  })

  test("writes every change straight through, so a worker torn down a moment later loses nothing", async () => {
    const telemetry = new Telemetry()
    await telemetry.ready

    detectPublisher("client-a", "https://a.test/")
    telemetry.addViews("https://a.test/")
    telemetry.addDuration("https://a.test/", 750)
    await Bun.sleep(0)

    expect(storedTelemetry()).toEqual({
      "a.test": { publisherId: "client-a", source: "header", views: 1, duration: 750 },
    })
  })

  test("what was written is what a restarted worker reads back", async () => {
    const first = new Telemetry()
    await first.ready
    detectPublisher("client-b", "https://b.test/")
    first.addViews("https://b.test/")
    first.addDuration("https://b.test/", 750)
    await Bun.sleep(0)

    // A service worker is torn down and rebuilt constantly; counters must not restart from zero.
    const restarted = new Telemetry()
    await restarted.ready

    expect(restarted.map.get("b.test")).toEqual({
      publisherId: "client-b",
      source: "header",
      views: 1,
      duration: 750,
    })
  })

  test("an acknowledged push is persisted, so a sent batch is never counted twice", async () => {
    const entry = { publisherId: "client-c", source: "header" as const, views: 2, duration: 200 }
    await chromeMock.storage.local.seed({ telemetry: { "c.test": entry } })
    const telemetry = new Telemetry()
    await telemetry.ready

    await telemetry.acknowledge([{ ...entry, hostname: "c.test" }])

    expect(storedTelemetry()).toEqual({ "c.test": { ...entry, views: 0, duration: 0 } })
  })

  test("acknowledging keeps whatever was recorded while the push was in flight", async () => {
    await chromeMock.storage.local.seed({
      telemetry: { "d.test": { publisherId: "client-d", source: "header", views: 2, duration: 200 } },
    })
    const telemetry = new Telemetry()
    await telemetry.ready

    const sent = telemetry.export()
    telemetry.addViews("https://d.test/")
    telemetry.addDuration("https://d.test/", 50)
    await telemetry.acknowledge(sent)

    expect(telemetry.map.get("d.test")).toMatchObject({ views: 1, duration: 50 })
  })

  test("`ready` resolves only after the stored map is in place", async () => {
    await chromeMock.storage.local.seed({
      telemetry: { "e.test": { publisherId: "client-e", source: "header", views: 1, duration: 1 } },
    })

    const telemetry = new Telemetry()
    // Reading before awaiting `ready` is exactly the empty-export bug telemetry-sync guards against.
    expect(telemetry.export()).toEqual([])

    await telemetry.ready

    expect(telemetry.export()).toEqual([
      { publisherId: "client-e", source: "header", hostname: "e.test", views: 1, duration: 1 },
    ])
  })

  test("usage recorded before the stored map is read is merged in, not overwritten", async () => {
    await chromeMock.storage.local.seed({
      telemetry: { "f.test": { publisherId: "client-f", source: "header", views: 1, duration: 100 } },
    })

    const telemetry = new Telemetry()
    // The event that woke the worker can land before storage answers.
    telemetry.map.set("f.test", { publisherId: "client-f", source: "header", views: 1, duration: 40 })
    await telemetry.ready

    expect(telemetry.map.get("f.test")).toMatchObject({ views: 2, duration: 140 })
  })
})
