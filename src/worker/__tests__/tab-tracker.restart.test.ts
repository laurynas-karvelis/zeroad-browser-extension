import { describe, expect, mock, test } from "bun:test"
import { chromeMock } from "../../__fixtures__/chrome"

// What a restarted worker finds: the visit the previous worker was timing, left in session storage,
// and the tab it is on, still open in the browser.
const visitStartedAt = Date.now() - 90_000
await chromeMock.storage.session.set({
  focusedVisit: { tabId: 3, url: "https://publisher.test/article", since: visitStartedAt },
})
chromeMock.tabs.byId.set(3, { id: 3, url: "https://publisher.test/article", active: true, windowId: 1 })

const isPublisherUrl = (url?: string) => url?.startsWith("https://publisher.test/") ?? false
const addDuration = mock<(url: string | undefined, duration: number) => void>()
const prune = mock<(openTabUrls: (string | undefined)[]) => Promise<void>>(async () => {})
mock.module("../telemetry", () => ({
  telemetry: () => ({
    hasPublisherEntryByUrl: isPublisherUrl,
    findPublisherEntryByUrl: (url?: string) =>
      isPublisherUrl(url) ? { publisherId: "publisher-x", source: "header", views: 0, duration: 0 } : undefined,
    addViews: mock(),
    addDuration,
    prune,
  }),
}))

const { EVENT, eventBroker } = await import("../event-broker")
const { trackedTabs } = await import("../tab-tracker")

describe("trackedTabs after a worker restart", () => {
  test("knows the open tabs again, so the popup can tell the page being read is a publisher's", async () => {
    const seen = mock()
    eventBroker().on(EVENT.TAB_TRACKER.IS_ACTIVE_TAB_PUBLISHER, seen)
    await trackedTabs().ready

    trackedTabs().notifyIfActiveTabIsPublisher()

    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ isPublisher: true, tabId: 3 }))
  })

  test("prunes telemetry only after the open tabs are known, keeping the pages they are on", async () => {
    await trackedTabs().ready

    expect(prune).toHaveBeenCalledWith(["https://publisher.test/article"])
  })

  test("books the time of a visit the previous worker was still timing", async () => {
    await trackedTabs().ready

    trackedTabs().flushActive()

    const [url, duration] = addDuration.mock.calls[0]

    expect(url).toBe("https://publisher.test/article")
    expect(duration).toBeGreaterThanOrEqual(90_000)
  })
})
