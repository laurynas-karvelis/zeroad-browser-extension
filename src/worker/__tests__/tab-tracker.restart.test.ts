import { describe, expect, mock, test } from "bun:test"
import { chromeMock } from "../../__fixtures__/chrome"

// What a restarted worker finds: the visit the previous worker was timing, left in session storage.
const visitStartedAt = Date.now() - 90_000
await chromeMock.storage.session.set({
  focusedVisit: { tabId: 3, url: "https://publisher.test/article", since: visitStartedAt },
})

const addDuration = mock<(url: string | undefined, duration: number) => void>()
mock.module("../telemetry", () => ({
  telemetry: () => ({
    hasPublisherEntryByUrl: (url?: string) => url?.startsWith("https://publisher.test/") ?? false,
    findPublisherEntryByUrl: () => undefined,
    addViews: mock(),
    addDuration,
  }),
}))

const { trackedTabs } = await import("../tab-tracker")

describe("trackedTabs after a worker restart", () => {
  test("books the time of a visit the previous worker was still timing", async () => {
    await trackedTabs().ready

    trackedTabs().flushActive()

    const [url, duration] = addDuration.mock.calls[0]
    expect(url).toBe("https://publisher.test/article")
    expect(duration).toBeGreaterThanOrEqual(90_000)
  })
})
