import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { chromeMock } from "../__fixtures__/chrome"

// `telemetry` refuses to count anything while the subscription is inactive, and the real
// `extension` singleton drags in half the worker - stub it down to just that decision.
let subscriptionActive = true
mock.module("./extension", () => ({
  extension: () => ({ isSubscriptionActive: () => subscriptionActive }),
}))

const { EVENT, eventBroker } = await import("./event-broker")
const { Telemetry } = await import("./telemetry")

// Every instance built here subscribes to the shared event bus and stays subscribed, so instances
// from earlier tests still react to later emits. That is harmless for map assertions (each applies
// the same mutation to its own map) but not for storage ones - those live in telemetry.storage.test.ts.
const SAVE_DEBOUNCE_DELAY = 5

type StoredMap = Record<string, { publisherId: string; views: number; duration: number }>

const seedStored = (telemetry: StoredMap) => chromeMock.storage.local.seed({ telemetry })

/** Builds an instance whose stored map has already been read back. */
async function createTelemetry() {
  const instance = new Telemetry(SAVE_DEBOUNCE_DELAY)
  await instance.ready
  return instance
}

const entry = (publisherId: string, views = 0, duration = 0) => ({
  publisherId,
  views,
  duration,
})

describe("Telemetry", () => {
  beforeEach(async () => {
    subscriptionActive = true
    await chromeMock.storage.local.clear()
  })

  afterEach(() => {
    mock.restore()
  })

  describe("load", () => {
    test("restores entries from local storage", async () => {
      seedStored({ "a.test": entry("client-a", 2, 30) })

      const telemetry = await createTelemetry()

      expect(telemetry.map.get("a.test")).toEqual(entry("client-a", 2, 30))
    })

    test("drops entries that carry no activity, so the map does not grow forever", async () => {
      seedStored({ "stale.test": entry("client-a"), "busy.test": entry("client-b", 1, 0) })

      const telemetry = await createTelemetry()

      expect([...telemetry.map.keys()]).toEqual(["busy.test"])
    })

    test("starts empty when nothing was stored", async () => {
      const telemetry = await createTelemetry()

      expect(telemetry.map.size).toBe(0)
    })
  })

  describe("publisher detection", () => {
    test("adds an entry and announces the publisher when a new hostname is detected", async () => {
      const telemetry = await createTelemetry()
      const publisherAdded = mock()
      eventBroker().on(EVENT.TELEMETRY.PUBLISHER_ADDED, publisherAdded)

      eventBroker().emit(EVENT.TAB_TRACKER.PUBLISHER_DETECTED, {
        publisherId: "client-a",
        url: "https://a.test/some/page?q=1",
      })

      expect(telemetry.map.get("a.test")).toEqual(entry("client-a"))
      expect(publisherAdded).toHaveBeenCalledWith({ publisherId: "client-a" })
    })

    test("keys entries by hostname, so every page of a site shares one entry", async () => {
      const telemetry = await createTelemetry()

      for (const url of ["https://a.test/one", "https://a.test/two", "http://a.test:8080/three"]) {
        eventBroker().emit(EVENT.TAB_TRACKER.PUBLISHER_DETECTED, { publisherId: "client-a", url, version: 1 })
      }

      expect(telemetry.map.size).toBe(1)
    })

    test("ignores detections with no usable hostname or no publisherId", async () => {
      const telemetry = await createTelemetry()

      eventBroker().emit(EVENT.TAB_TRACKER.PUBLISHER_DETECTED, { publisherId: "c", url: "not a url", version: 1 })
      eventBroker().emit(EVENT.TAB_TRACKER.PUBLISHER_DETECTED, { publisherId: "", url: "https://a.test/", version: 1 })

      expect(telemetry.map.size).toBe(0)
    })

    test("re-detecting the same publisher leaves its counters alone", async () => {
      seedStored({ "a.test": entry("client-a", 3, 500) })
      const telemetry = await createTelemetry()

      eventBroker().emit(EVENT.TAB_TRACKER.PUBLISHER_DETECTED, {
        publisherId: "client-a",
        url: "https://a.test/",
      })

      expect(telemetry.map.get("a.test")).toEqual(entry("client-a", 3, 500))
    })

    test("a hostname changing owner adopts the new publisherId and drops the old counters", async () => {
      // Otherwise every later visit is credited to whoever used to own the domain.
      seedStored({ "a.test": entry("old-client", 9, 900) })
      const telemetry = await createTelemetry()

      eventBroker().emit(EVENT.TAB_TRACKER.PUBLISHER_DETECTED, {
        publisherId: "new-client",
        url: "https://a.test/",
      })

      expect(telemetry.map.get("a.test")).toEqual(entry("new-client"))
    })

    test("addDuration accumulates milliseconds", async () => {
      seedStored({ "a.test": entry("client-a", 1, 10) })
      const telemetry = await createTelemetry()

      telemetry.addDuration("https://a.test/", 250)
      telemetry.addDuration("https://a.test/", 250)

      expect(telemetry.map.get("a.test")?.duration).toBe(510)
    })

    test("duration on a never-viewed entry backfills a single view", async () => {
      // A publisher tab already open when the subscription activates accrues time before any
      // page load is seen; reporting duration with zero views would be nonsense.
      const telemetry = await createTelemetry()
      eventBroker().emit(EVENT.TAB_TRACKER.PUBLISHER_DETECTED, {
        publisherId: "client-a",
        url: "https://a.test/",
      })

      telemetry.addDuration("https://a.test/", 400)

      expect(telemetry.map.get("a.test")).toMatchObject({ views: 1, duration: 400 })
    })

    test("ignores hostnames that are not publishers", async () => {
      const telemetry = await createTelemetry()

      telemetry.addViews("https://stranger.test/")
      telemetry.addDuration("https://stranger.test/", 100)

      expect(telemetry.map.size).toBe(0)
    })

    test("counts nothing while the subscription is inactive", async () => {
      // The user is not paying, so nothing they browse may earn a publisher a payout.
      seedStored({ "a.test": entry("client-a", 1, 10) })
      const telemetry = await createTelemetry()
      subscriptionActive = false

      telemetry.addViews("https://a.test/")
      telemetry.addDuration("https://a.test/", 100)

      expect(telemetry.map.get("a.test")).toEqual(entry("client-a", 1, 10))
    })

    test("rejects durations that are absent, negative or not finite", async () => {
      seedStored({ "a.test": entry("client-a", 1, 10) })
      const telemetry = await createTelemetry()

      telemetry.addDuration("https://a.test/", -50)
      telemetry.addDuration("https://a.test/", 0)
      telemetry.addDuration("https://a.test/", Number.NaN)
      telemetry.addDuration("https://a.test/", Number.POSITIVE_INFINITY)
      telemetry.addDuration(undefined, 100)

      expect(telemetry.map.get("a.test")?.duration).toBe(10)
    })
  })

  describe("export", () => {
    test("groups every hostname under its publisher, keeping each hostname's counters separate", async () => {
      seedStored({
        "a.test": entry("client-a", 2, 200),
        "blog.a.test": entry("client-a", 3, 300),
        "b.test": entry("client-b", 1, 100),
      })
      const telemetry = await createTelemetry()

      // Each hostname keeps its own counters - a publisher with several sites needs each credited
      expect(telemetry.export()).toEqual({
        "client-a": {
          hostnames: {
            "a.test": { views: 2, duration: 200 },
            "blog.a.test": { views: 3, duration: 300 },
          },
        },
        "client-b": { hostnames: { "b.test": { views: 1, duration: 100 } } },
      })
    })

    test("includes a publisher that was viewed but never dwelled on", async () => {
      // Revenue is duration-weighted, but the visit still belongs in the user's stats.
      seedStored({ "a.test": entry("client-a", 4, 0) })
      const telemetry = await createTelemetry()

      expect(telemetry.export()).toEqual({ "client-a": { hostnames: { "a.test": { views: 4, duration: 0 } } } })
    })

    test("skips publishers with no activity at all", async () => {
      const telemetry = await createTelemetry()
      eventBroker().emit(EVENT.TAB_TRACKER.PUBLISHER_DETECTED, {
        publisherId: "client-a",
        url: "https://a.test/",
      })

      expect(telemetry.export()).toEqual({})
    })
  })

  describe("flushing", () => {
    test("zeroes counters but keeps the publishers, so re-detection is not needed", async () => {
      seedStored({ "a.test": entry("client-a", 2, 200) })
      const telemetry = await createTelemetry()

      eventBroker().emit(EVENT.TELEMETRY.FLUSH)

      expect(telemetry.map.get("a.test")).toEqual(entry("client-a"))
      expect(telemetry.export()).toEqual({})
    })

    test("an expired subscription and a reset request both flush", async () => {
      for (const event of [EVENT.EXTENSION.SUBSCRIPTION_EXPIRED, EVENT.EXTENSION.REQUEST_RESET]) {
        seedStored({ "a.test": entry("client-a", 2, 200) })
        const telemetry = await createTelemetry()

        eventBroker().emit(event)

        expect(telemetry.map.get("a.test")?.views).toBe(0)
      }
    })
  })
})
