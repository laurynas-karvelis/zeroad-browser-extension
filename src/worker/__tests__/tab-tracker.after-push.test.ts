import { expect, test } from "bun:test"
import { chromeMock } from "../../__fixtures__/chrome"

// The real telemetry store this time: what matters is whether it still knows the page being read.
// Starting up with a live subscription refreshes the token pool, which must not reach the platform.
globalThis.fetch = (async () => {
  throw new Error("offline")
}) as unknown as typeof fetch

const HOSTNAME = "publisher.test"
const URL = `https://${HOSTNAME}/long-article`
const READING_FOR_MS = 50_000

// A subscriber reading a publisher's page, and a worker torn down right after an acknowledged push:
// the page's entry is still stored, with nothing left to send.
await chromeMock.storage.sync.set({
  user: { firstName: "Ada", extensionToken: "ext-token" },
  subscription: { planName: "freedom", expiresAt: Date.now() + 24 * 60 * 60 * 1000 },
})
await chromeMock.storage.local.set({
  telemetry: { [HOSTNAME]: { publisherId: "zapub_7Fq2xR9nKdW3mB6tYp1sVzAe", source: "header", views: 0, duration: 0 } },
})
await chromeMock.storage.session.set({ focusedVisit: { tabId: 3, url: URL, since: Date.now() - READING_FOR_MS } })
chromeMock.tabs.byId.set(3, { id: 3, url: URL, active: true, windowId: 1 })

const { extension } = await import("../extension")
const { telemetry } = await import("../telemetry")
const { trackedTabs } = await import("../tab-tracker")

test("a page still being read after a push keeps having its time booked by a restarted worker", async () => {
  await Promise.all([extension().ready, telemetry().ready, trackedTabs().ready])

  await chromeMock.alarms.fire("dwell-checkpoint")

  expect(telemetry().map.get(HOSTNAME)?.duration).toBeGreaterThanOrEqual(READING_FOR_MS)
})
