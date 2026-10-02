import { describe, expect, mock, test } from "bun:test"
import { chromeMock } from "../../__fixtures__/chrome"

// Firefox for Android has no windows API. Registering a listener on it threw while the worker
// loaded, before `messaging` was imported, so the popup and the site got no answer at all.
// biome-ignore lint/suspicious/noExplicitAny: removing an API the Android build does not have
delete (chromeMock as any).windows

mock.module("../telemetry", () => ({
  telemetry: () => ({
    ready: Promise.resolve(),
    hasPublisherEntryByUrl: () => false,
    findPublisherEntryByUrl: () => undefined,
    addViews: mock(),
    addDuration: mock(),
    prune: mock(async () => {}),
  }),
}))

const { trackedTabs } = await import("../tab-tracker")

describe("trackedTabs without a windows API, as on Firefox for Android", () => {
  test("loads and restores the open tabs", async () => {
    await trackedTabs().ready

    expect(trackedTabs().hasFocus()).toBe(false)
  })

  test("returning from idle with nothing focused leaves nothing focused", async () => {
    await trackedTabs().ready

    await chromeMock.idle.onStateChanged.dispatch("active")

    expect(trackedTabs().hasFocus()).toBe(false)
  })
})
