import { beforeEach, describe, expect, mock, test } from "bun:test"
import { chromeMock } from "../../__fixtures__/chrome"
import type { Entry } from "../telemetry"

// A hostname-keyed stand-in for the telemetry store: tab-tracker only ever asks it whether a URL
// belongs to a publisher and tells it how long the user stayed.
const publishers = new Map<string, Entry>()
const addDuration = mock<(url: string | undefined, duration: number) => void>()
const addViews = mock<(url: string | undefined) => void>()
const hostOf = (url: string | undefined) => {
  try {
    return new URL(url || "").hostname
  } catch {
    return ""
  }
}

const telemetryStub = {
  hasPublisherEntryByUrl: (url?: string) => publishers.has(hostOf(url)),
  findPublisherEntryByUrl: (url?: string) => publishers.get(hostOf(url)),
  addViews,
  addDuration,
}

mock.module("../telemetry", () => ({ telemetry: () => telemetryStub }))

// Tabs the site verifier has open, which the tracker must ignore.
const verificationTabIds = new Set<number>()
mock.module("../site-verification", () => ({ isVerificationTab: (tabId: number) => verificationTabIds.has(tabId) }))

const { EVENT, eventBroker } = await import("../event-broker")
const { trackedTabs } = await import("../tab-tracker")

type TabTrackActiveTabEventData = import("../tab-tracker").TabTrackActiveTabEventData

const TAB_REGISTER_SOURCE = {
  ON_TAB_ACTIVATED: "tabs.onActivated",
  ON_TAB_UPDATED: "tabs.onUpdated",
  ON_WINDOW_FOCUS_CHANGED: "window.onFocusChanged",
} as const

type Source = (typeof TAB_REGISTER_SOURCE)[keyof typeof TAB_REGISTER_SOURCE]

const makePublisher = (hostname: string, publisherId = `publisher-${hostname}`) =>
  publishers.set(hostname, { publisherId, source: "header", views: 0, duration: 0 })

const tab = (id: number, url: string, extra: Partial<chrome.tabs.Tab> = {}) =>
  ({ id, url, active: true, windowId: 1, ...extra }) as chrome.tabs.Tab

// biome-ignore lint/suspicious/noExplicitAny: the registry is keyed by the module's private enum
const register = (t: chrome.tabs.Tab, source: Source) => trackedTabs().register(t, source as any)

const activeTabEvents = () => {
  const seen: TabTrackActiveTabEventData[] = []
  eventBroker().on<TabTrackActiveTabEventData>(EVENT.TAB_TRACKER.IS_ACTIVE_TAB_PUBLISHER, (data) => seen.push(data))
  return seen
}

describe("trackedTabs", () => {
  beforeEach(() => {
    publishers.clear()
    trackedTabs().map.clear()
    trackedTabs().flushActive()
    addDuration.mockClear()
    addViews.mockClear()
  })

  describe("focus and duration accounting", () => {
    test("books time against the tab the user was actually on when they switch away", async () => {
      makePublisher("publisher.test")
      register(tab(1, "https://publisher.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)

      await Bun.sleep(25)
      register(tab(2, "https://other.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)

      expect(addDuration).toHaveBeenCalledTimes(1)
      const [url, duration] = addDuration.mock.calls[0]
      expect(url).toBe("https://publisher.test/")
      expect(duration).toBeGreaterThanOrEqual(20)
    })

    test("books nothing for a tab that is not a publisher", () => {
      register(tab(1, "https://stranger.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      register(tab(2, "https://elsewhere.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)

      expect(addDuration).not.toHaveBeenCalled()
    })

    test("re-activating the tab already in focus keeps its clock running", async () => {
      makePublisher("publisher.test")
      register(tab(1, "https://publisher.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      await Bun.sleep(25)

      // A duplicate activation (Chrome fires these) must not discard the elapsed time.
      register(tab(1, "https://publisher.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      expect(addDuration).not.toHaveBeenCalled()

      register(tab(2, "https://other.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      expect(addDuration.mock.calls[0][1]).toBeGreaterThanOrEqual(20)
    })

    test("navigating within the focused tab books the time against the page it was spent on", async () => {
      makePublisher("first.test")
      makePublisher("second.test")
      register(tab(1, "https://first.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)

      await Bun.sleep(25)
      register(tab(1, "https://second.test/"), TAB_REGISTER_SOURCE.ON_TAB_UPDATED)

      expect(addDuration.mock.calls[0][0]).toBe("https://first.test/")
    })

    test("a background tab finishing its load never steals focus", async () => {
      makePublisher("publisher.test")
      register(tab(1, "https://publisher.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      await Bun.sleep(25)

      // Another window's tab is `active` in its own window but the user is not looking at it.
      register(tab(2, "https://background.test/", { windowId: 2 }), TAB_REGISTER_SOURCE.ON_TAB_UPDATED)

      expect(addDuration).not.toHaveBeenCalled()
      expect(trackedTabs().findActiveTab()?.id).toBe(1)
    })

    test("switching windows books the outgoing tab and starts the incoming one", async () => {
      makePublisher("left.test")
      makePublisher("right.test")
      register(tab(1, "https://left.test/", { windowId: 1 }), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      await Bun.sleep(25)

      register(tab(2, "https://right.test/", { windowId: 2 }), TAB_REGISTER_SOURCE.ON_WINDOW_FOCUS_CHANGED)

      expect(addDuration).toHaveBeenCalledTimes(1)
      expect(addDuration.mock.calls[0][0]).toBe("https://left.test/")
      expect(trackedTabs().findActiveTab()?.id).toBe(2)
    })

    test("returning to a window that never lost its active tab keeps accumulating", async () => {
      makePublisher("left.test")
      register(tab(1, "https://left.test/"), TAB_REGISTER_SOURCE.ON_WINDOW_FOCUS_CHANGED)
      await Bun.sleep(25)

      register(tab(1, "https://left.test/"), TAB_REGISTER_SOURCE.ON_WINDOW_FOCUS_CHANGED)
      expect(addDuration).not.toHaveBeenCalled()

      trackedTabs().flushActive()
      expect(addDuration.mock.calls[0][1]).toBeGreaterThanOrEqual(20)
    })

    test("a tab finishing its load never takes focus, even with nothing focused", () => {
      // With nothing focused the user is in another app; a background reload must not start the clock.
      makePublisher("publisher.test")

      register(tab(1, "https://publisher.test/"), TAB_REGISTER_SOURCE.ON_TAB_UPDATED)

      expect(trackedTabs().hasFocus()).toBe(false)
    })

    test("persists the focused visit, so a restarted worker can pick the clock back up", async () => {
      register(tab(1, "https://publisher.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      await Bun.sleep(0)

      expect(chromeMock.storage.session.peek().focusedVisit).toMatchObject({ tabId: 1, url: "https://publisher.test/" })

      trackedTabs().flushActive()
      await Bun.sleep(0)

      expect(chromeMock.storage.session.peek().focusedVisit).toBeUndefined()
    })

    test("a checkpoint books the time so far and keeps the visit going", async () => {
      makePublisher("publisher.test")
      register(tab(1, "https://publisher.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      await Bun.sleep(25)

      trackedTabs().checkpoint()

      expect(addDuration).toHaveBeenCalledTimes(1)
      expect(addDuration.mock.calls[0][1]).toBeGreaterThanOrEqual(20)
      expect(trackedTabs().findActiveTab()?.id).toBe(1)

      // The next booking starts from the checkpoint, not from the start of the visit.
      trackedTabs().flushActive()
      expect(addDuration.mock.calls[1][1]).toBeLessThan(20)
    })

    test("the checkpoint alarm drives the checkpoint", async () => {
      makePublisher("publisher.test")
      register(tab(1, "https://publisher.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)

      await chromeMock.alarms.fire("dwell-checkpoint")

      expect(addDuration).toHaveBeenCalledTimes(1)
    })

    test("ignores a tab with no id", () => {
      register(
        { url: "https://publisher.test/", active: true } as chrome.tabs.Tab,
        TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED
      )

      expect(trackedTabs().map.size).toBe(0)
    })
  })

  describe("the user leaving the browser", () => {
    test("switching to another application books the time and stops the clock", async () => {
      makePublisher("publisher.test")
      register(tab(1, "https://publisher.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      await Bun.sleep(25)

      await chromeMock.windows.onFocusChanged.dispatch(chromeMock.windows.WINDOW_ID_NONE)

      expect(addDuration).toHaveBeenCalledTimes(1)
      expect(trackedTabs().hasFocus()).toBe(false)
    })

    test("locking the screen books the time and stops the clock", async () => {
      makePublisher("publisher.test")
      register(tab(1, "https://publisher.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)

      await chromeMock.idle.onStateChanged.dispatch("locked")

      expect(addDuration).toHaveBeenCalledTimes(1)
      expect(trackedTabs().hasFocus()).toBe(false)
    })

    test("mere inactivity keeps the clock running - a video or a long read touches nothing", async () => {
      register(tab(1, "https://publisher.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)

      await chromeMock.idle.onStateChanged.dispatch("idle")

      expect(trackedTabs().hasFocus()).toBe(true)
    })

    test("unlocking resumes on the active tab when the browser is what the user came back to", async () => {
      chromeMock.tabs.byId.set(4, tab(4, "https://publisher.test/") as unknown as Record<string, unknown>)
      chromeMock.windows.lastFocused = { id: 1, focused: true }

      await chromeMock.idle.onStateChanged.dispatch("active")

      expect(trackedTabs().findActiveTab()?.id).toBe(4)
      chromeMock.tabs.byId.delete(4)
    })

    test("unlocking leaves the clock stopped when another application has focus", async () => {
      chromeMock.tabs.byId.set(4, tab(4, "https://publisher.test/") as unknown as Record<string, unknown>)
      chromeMock.windows.lastFocused = { id: 1, focused: false }

      await chromeMock.idle.onStateChanged.dispatch("active")

      expect(trackedTabs().hasFocus()).toBe(false)
      chromeMock.tabs.byId.delete(4)
      chromeMock.windows.lastFocused = { id: 1, focused: true }
    })
  })

  describe("closing tabs and windows", () => {
    test("closing a background tab leaves the focused tab's clock running", async () => {
      makePublisher("publisher.test")
      register(tab(1, "https://publisher.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      register(tab(2, "https://other.test/", { active: false }), TAB_REGISTER_SOURCE.ON_TAB_UPDATED)
      await Bun.sleep(25)

      trackedTabs().delete(2)

      expect(addDuration).not.toHaveBeenCalled()
      expect(trackedTabs().findActiveTab()?.id).toBe(1)
    })

    test("closing the focused tab books its time", async () => {
      makePublisher("publisher.test")
      register(tab(1, "https://publisher.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      await Bun.sleep(25)

      trackedTabs().delete(1)

      expect(addDuration).toHaveBeenCalledTimes(1)
      expect(trackedTabs().findActiveTab()).toBeUndefined()
      expect(trackedTabs().map.size).toBe(0)
    })

    test("closing a window drops only that window's tabs", () => {
      register(tab(1, "https://a.test/", { windowId: 1 }), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      register(tab(2, "https://b.test/", { windowId: 2 }), TAB_REGISTER_SOURCE.ON_TAB_UPDATED)
      register(tab(3, "https://c.test/", { windowId: 1 }), TAB_REGISTER_SOURCE.ON_TAB_UPDATED)

      trackedTabs().deleteByWindowId(1)

      expect([...trackedTabs().map.keys()]).toEqual([2])
    })

    test("closing the window holding the focused tab books its time exactly once", async () => {
      makePublisher("publisher.test")
      register(tab(1, "https://publisher.test/", { windowId: 1 }), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      register(tab(2, "https://other.test/", { windowId: 1, active: false }), TAB_REGISTER_SOURCE.ON_TAB_UPDATED)
      await Bun.sleep(25)

      trackedTabs().deleteByWindowId(1)

      expect(addDuration).toHaveBeenCalledTimes(1)
    })
  })

  describe("notifyIfActiveTabIsPublisher", () => {
    test("reports the focused publisher tab with its telemetry entry", () => {
      makePublisher("publisher.test", "publisher-x")
      const seen = activeTabEvents()

      register(tab(7, "https://publisher.test/page"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)

      expect(seen.at(-1)).toEqual({
        isPublisher: true,
        url: "https://publisher.test/page",
        tabId: 7,
        telemetryEntry: { publisherId: "publisher-x", source: "header", views: 0, duration: 0 },
      })
    })

    test("reports a non-publisher tab, so the badge is turned off rather than left stale", () => {
      const seen = activeTabEvents()

      register(tab(7, "https://stranger.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)

      expect(seen.at(-1)).toEqual({
        isPublisher: false,
        url: "https://stranger.test/",
        tabId: 7,
        telemetryEntry: undefined,
      })
    })

    test("says nothing about a tab that is not the focused one", () => {
      makePublisher("publisher.test")
      register(tab(1, "https://publisher.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      const seen = activeTabEvents()

      register(tab(2, "https://publisher.test/", { windowId: 2 }), TAB_REGISTER_SOURCE.ON_TAB_UPDATED)

      expect(seen).toEqual([])
    })

    test("says nothing when no tab is focused", () => {
      const seen = activeTabEvents()

      trackedTabs().notifyIfActiveTabIsPublisher()

      expect(seen).toEqual([])
    })

    test("re-announces the focused tab on demand, which is what the popup asks for", () => {
      makePublisher("publisher.test")
      register(tab(1, "https://publisher.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      const seen = activeTabEvents()

      trackedTabs().notifyIfActiveTabIsPublisher()

      expect(seen.at(-1)?.isPublisher).toBe(true)
    })
  })

  test("a publisher recognised after its tab loaded still lights up the badge", () => {
    // Detection is asynchronous, so the tab can be registered before its site is known.
    register(tab(1, "https://publisher.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
    const seen = activeTabEvents()

    makePublisher("publisher.test")
    eventBroker().emit(EVENT.TELEMETRY.PUBLISHER_ADDED, { publisherId: "publisher-publisher.test" })

    expect(seen.at(-1)?.isPublisher).toBe(true)
    expect(trackedTabs().findActiveTab()?.publisher).toBe(true)
  })
})

describe("welcome-header detection", () => {
  const publisherId = "zapub_AbCdEfGhIjKlMnOpQrStUvWx"
  const publisherValue = publisherId

  const publisherDetections = () => {
    const seen: unknown[] = []
    eventBroker().on(EVENT.TAB_TRACKER.PUBLISHER_DETECTED, (data) => seen.push(data))
    return seen
  }

  beforeEach(() => {
    publishers.clear()
    trackedTabs().map.clear()
    trackedTabs().flushActive()
    addViews.mockClear()
    chromeMock.scripting.executeScriptResult = [{ result: undefined }]
  })

  describe("from a response header", () => {
    const complete = (url: string, headers: { name: string; value?: string }[]) =>
      chromeMock.webRequest.onCompleted.dispatch({ url, responseHeaders: headers })

    test("decodes the welcome header and announces the publisher", async () => {
      const seen = publisherDetections()

      await complete("https://publisher.test/", [{ name: "Better-Web-Publisher", value: publisherValue }])

      expect(seen.at(-1)).toEqual({
        publisherId,
        source: "header",
        url: "https://publisher.test/",
      })
    })

    test("matches the header name case-insensitively, as HTTP requires", async () => {
      const seen = publisherDetections()

      await complete("https://publisher.test/", [{ name: "better-web-publisher", value: publisherValue }])

      expect(seen).toHaveLength(1)
    })

    test("ignores responses with no publisher header, a malformed one, or no headers at all", async () => {
      const seen = publisherDetections()

      await complete("https://plain.test/", [{ name: "content-type", value: "text/html" }])
      await complete("https://plain.test/", [{ name: "Better-Web-Publisher", value: "" }])
      await complete("https://plain.test/", [{ name: "Better-Web-Publisher", value: "has space" }])
      await complete("https://plain.test/", [{ name: "Better-Web-Publisher", value: "pub_a" }])
      await chromeMock.webRequest.onCompleted.dispatch({ url: "https://plain.test/" })

      expect(seen).toEqual([])
    })

    test("tolerates a legacy trailing parameter on the header", async () => {
      // A publisher whose header still carries the old `; v=1` parameter continues to resolve
      const seen = publisherDetections()

      await complete("https://legacy.test/", [{ name: "Better-Web-Publisher", value: `${publisherId}; v=1` }])

      expect(seen).toHaveLength(1)
      expect(seen.at(-1)).toMatchObject({ publisherId })
    })

    test("skips URLs a browser serves for its own pages", async () => {
      const seen = publisherDetections()

      await complete("chrome://extensions", [{ name: "Better-Web-Publisher", value: publisherValue }])

      expect(seen).toEqual([])
    })
  })

  describe("from a meta tag", () => {
    const finishLoading = (t: chrome.tabs.Tab) =>
      chromeMock.tabs.onUpdated.dispatch(t.id as number, { status: "complete" }, t)

    test("reads the welcome value out of the page head and announces the publisher", async () => {
      chromeMock.scripting.executeScriptResult = [{ result: publisherValue }]
      const seen = publisherDetections()

      await finishLoading(tab(1, "https://meta.test/"))

      expect(seen.at(-1)).toMatchObject({ publisherId, source: "meta", url: "https://meta.test/" })
      expect(chromeMock.scripting.executeScriptCalls.at(-1)).toMatchObject({ target: { tabId: 1 } })
    })

    test("counts the very first page view of a meta-tag publisher", async () => {
      // The meta lookup is asynchronous; not awaiting it means the first visit is never counted.
      chromeMock.scripting.executeScriptResult = [{ result: publisherValue }]
      eventBroker().on(EVENT.TAB_TRACKER.PUBLISHER_DETECTED, () => makePublisher("meta.test"))

      await finishLoading(tab(1, "https://meta.test/"))

      expect(addViews).toHaveBeenCalledWith("https://meta.test/")
    })

    test("does not run a content script on a site already known to be a publisher", async () => {
      makePublisher("known.test")
      chromeMock.scripting.executeScriptCalls.length = 0

      await finishLoading(tab(1, "https://known.test/"))

      expect(chromeMock.scripting.executeScriptCalls).toEqual([])
    })

    test("ignores a page still loading", async () => {
      chromeMock.scripting.executeScriptCalls.length = 0

      await chromeMock.tabs.onUpdated.dispatch(1, { status: "loading" }, tab(1, "https://meta.test/"))

      expect(chromeMock.scripting.executeScriptCalls).toEqual([])
      expect(trackedTabs().map.size).toBe(0)
    })

    test("ignores a tab opened to verify a site, so a publisher's own check is not a visit", async () => {
      chromeMock.scripting.executeScriptResult = [{ result: publisherValue }]
      chromeMock.scripting.executeScriptCalls.length = 0
      verificationTabIds.add(9)
      const seen = publisherDetections()

      await finishLoading(tab(9, "https://meta.test/"))
      await chromeMock.webRequest.onCompleted.dispatch({
        url: "https://meta.test/",
        tabId: 9,
        responseHeaders: [{ name: "Better-Web-Publisher", value: publisherValue }],
      })

      expect(seen).toEqual([])
      expect(chromeMock.scripting.executeScriptCalls).toEqual([])
      expect(trackedTabs().map.has(9)).toBe(false)
      verificationTabIds.delete(9)
    })

    test("survives a page that cannot be scripted", async () => {
      chromeMock.scripting.executeScript = async () => {
        throw new Error("Cannot access contents of the page")
      }
      const seen = publisherDetections()

      await finishLoading(tab(1, "https://blocked.test/"))

      expect(seen).toEqual([])
      expect(trackedTabs().map.has(1)).toBe(true)
    })
  })
})
