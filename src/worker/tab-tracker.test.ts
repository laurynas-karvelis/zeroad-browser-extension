import { beforeEach, describe, expect, mock, test } from "bun:test"
import { chromeMock } from "../__fixtures__/chrome"

// A hostname-keyed stand-in for the telemetry store: tab-tracker only ever asks it whether a URL
// belongs to a partner and tells it how long the user stayed.
const partners = new Map<string, { clientId: string; features: string[]; views: number; duration: number }>()
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
  hasPartnerEntryByUrl: (url?: string) => partners.has(hostOf(url)),
  findPartnerEntryByUrl: (url?: string) => partners.get(hostOf(url)),
  addViews,
  addDuration,
}

mock.module("./telemetry", () => ({ telemetry: () => telemetryStub }))

const { EVENT, eventBroker } = await import("./event-broker")
const { trackedTabs } = await import("./tab-tracker")

type TabTrackActiveTabEventData = import("./tab-tracker").TabTrackActiveTabEventData

const TAB_REGISTER_SOURCE = {
  ON_TAB_ACTIVATED: "tabs.onActivated",
  ON_TAB_UPDATED: "tabs.onUpdated",
  ON_WINDOW_FOCUS_CHANGED: "window.onFocusChanged",
} as const

type Source = (typeof TAB_REGISTER_SOURCE)[keyof typeof TAB_REGISTER_SOURCE]

const makePartner = (hostname: string, clientId = `client-${hostname}`) =>
  partners.set(hostname, { clientId, features: ["CLEAN_WEB"], views: 0, duration: 0 })

const tab = (id: number, url: string, extra: Partial<chrome.tabs.Tab> = {}) =>
  ({ id, url, active: true, windowId: 1, ...extra }) as chrome.tabs.Tab

// biome-ignore lint/suspicious/noExplicitAny: the registry is keyed by the module's private enum
const register = (t: chrome.tabs.Tab, source: Source) => trackedTabs().register(t, source as any)

const activeTabEvents = () => {
  const seen: TabTrackActiveTabEventData[] = []
  eventBroker().on<TabTrackActiveTabEventData>(EVENT.TAB_TRACKER.IS_ACTIVE_TAB_PARTNER, (data) => seen.push(data))
  return seen
}

describe("trackedTabs", () => {
  beforeEach(() => {
    partners.clear()
    trackedTabs().map.clear()
    trackedTabs().flushActive()
    addDuration.mockClear()
    addViews.mockClear()
  })

  describe("focus and duration accounting", () => {
    test("books time against the tab the user was actually on when they switch away", async () => {
      makePartner("partner.test")
      register(tab(1, "https://partner.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)

      await Bun.sleep(25)
      register(tab(2, "https://other.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)

      expect(addDuration).toHaveBeenCalledTimes(1)
      const [url, duration] = addDuration.mock.calls[0]
      expect(url).toBe("https://partner.test/")
      expect(duration).toBeGreaterThanOrEqual(20)
    })

    test("books nothing for a tab that is not a partner", () => {
      register(tab(1, "https://stranger.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      register(tab(2, "https://elsewhere.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)

      expect(addDuration).not.toHaveBeenCalled()
    })

    test("re-activating the tab already in focus keeps its clock running", async () => {
      makePartner("partner.test")
      register(tab(1, "https://partner.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      await Bun.sleep(25)

      // A duplicate activation (Chrome fires these) must not discard the elapsed time.
      register(tab(1, "https://partner.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      expect(addDuration).not.toHaveBeenCalled()

      register(tab(2, "https://other.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      expect(addDuration.mock.calls[0][1]).toBeGreaterThanOrEqual(20)
    })

    test("navigating within the focused tab books the time against the page it was spent on", async () => {
      makePartner("first.test")
      makePartner("second.test")
      register(tab(1, "https://first.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)

      await Bun.sleep(25)
      register(tab(1, "https://second.test/"), TAB_REGISTER_SOURCE.ON_TAB_UPDATED)

      expect(addDuration.mock.calls[0][0]).toBe("https://first.test/")
    })

    test("a background tab finishing its load never steals focus", async () => {
      makePartner("partner.test")
      register(tab(1, "https://partner.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      await Bun.sleep(25)

      // Another window's tab is `active` in its own window but the user is not looking at it.
      register(tab(2, "https://background.test/", { windowId: 2 }), TAB_REGISTER_SOURCE.ON_TAB_UPDATED)

      expect(addDuration).not.toHaveBeenCalled()
      expect(trackedTabs().findActiveTab()?.id).toBe(1)
    })

    test("switching windows books the outgoing tab and starts the incoming one", async () => {
      makePartner("left.test")
      makePartner("right.test")
      register(tab(1, "https://left.test/", { windowId: 1 }), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      await Bun.sleep(25)

      register(tab(2, "https://right.test/", { windowId: 2 }), TAB_REGISTER_SOURCE.ON_WINDOW_FOCUS_CHANGED)

      expect(addDuration).toHaveBeenCalledTimes(1)
      expect(addDuration.mock.calls[0][0]).toBe("https://left.test/")
      expect(trackedTabs().findActiveTab()?.id).toBe(2)
    })

    test("returning to a window that never lost its active tab keeps accumulating", async () => {
      makePartner("left.test")
      register(tab(1, "https://left.test/"), TAB_REGISTER_SOURCE.ON_WINDOW_FOCUS_CHANGED)
      await Bun.sleep(25)

      register(tab(1, "https://left.test/"), TAB_REGISTER_SOURCE.ON_WINDOW_FOCUS_CHANGED)
      expect(addDuration).not.toHaveBeenCalled()

      trackedTabs().flushActive()
      expect(addDuration.mock.calls[0][1]).toBeGreaterThanOrEqual(20)
    })

    test("adopts an active tab when a restarted worker has no idea what is focused", () => {
      // Only `onUpdated` may fire after a service worker wake-up; without this the clock never starts.
      makePartner("partner.test")

      register(tab(1, "https://partner.test/"), TAB_REGISTER_SOURCE.ON_TAB_UPDATED)

      expect(trackedTabs().findActiveTab()?.id).toBe(1)
    })

    test("ignores a tab with no id", () => {
      register({ url: "https://partner.test/", active: true } as chrome.tabs.Tab, TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)

      expect(trackedTabs().map.size).toBe(0)
    })
  })

  describe("closing tabs and windows", () => {
    test("closing a background tab leaves the focused tab's clock running", async () => {
      makePartner("partner.test")
      register(tab(1, "https://partner.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      register(tab(2, "https://other.test/", { active: false }), TAB_REGISTER_SOURCE.ON_TAB_UPDATED)
      await Bun.sleep(25)

      trackedTabs().delete(2)

      expect(addDuration).not.toHaveBeenCalled()
      expect(trackedTabs().findActiveTab()?.id).toBe(1)
    })

    test("closing the focused tab books its time", async () => {
      makePartner("partner.test")
      register(tab(1, "https://partner.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
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
      makePartner("partner.test")
      register(tab(1, "https://partner.test/", { windowId: 1 }), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      register(tab(2, "https://other.test/", { windowId: 1, active: false }), TAB_REGISTER_SOURCE.ON_TAB_UPDATED)
      await Bun.sleep(25)

      trackedTabs().deleteByWindowId(1)

      expect(addDuration).toHaveBeenCalledTimes(1)
    })
  })

  describe("notifyIfActiveTabIsPartner", () => {
    test("reports the focused partner tab with its telemetry entry", () => {
      makePartner("partner.test", "client-x")
      const seen = activeTabEvents()

      register(tab(7, "https://partner.test/page"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)

      expect(seen.at(-1)).toEqual({
        isPartner: true,
        url: "https://partner.test/page",
        tabId: 7,
        telemetryEntry: { clientId: "client-x", features: ["CLEAN_WEB"], views: 0, duration: 0 },
      })
    })

    test("reports a non-partner tab, so the badge is turned off rather than left stale", () => {
      const seen = activeTabEvents()

      register(tab(7, "https://stranger.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)

      expect(seen.at(-1)).toEqual({
        isPartner: false,
        url: "https://stranger.test/",
        tabId: 7,
        telemetryEntry: undefined,
      })
    })

    test("says nothing about a tab that is not the focused one", () => {
      makePartner("partner.test")
      register(tab(1, "https://partner.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      const seen = activeTabEvents()

      register(tab(2, "https://partner.test/", { windowId: 2 }), TAB_REGISTER_SOURCE.ON_TAB_UPDATED)

      expect(seen).toEqual([])
    })

    test("says nothing when no tab is focused", () => {
      const seen = activeTabEvents()

      trackedTabs().notifyIfActiveTabIsPartner()

      expect(seen).toEqual([])
    })

    test("re-announces the focused tab on demand, which is what the popup asks for", () => {
      makePartner("partner.test")
      register(tab(1, "https://partner.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
      const seen = activeTabEvents()

      trackedTabs().notifyIfActiveTabIsPartner()

      expect(seen.at(-1)?.isPartner).toBe(true)
    })
  })

  test("a partner recognised after its tab loaded still lights up the badge", () => {
    // Detection is asynchronous, so the tab can be registered before its site is known.
    register(tab(1, "https://partner.test/"), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
    const seen = activeTabEvents()

    makePartner("partner.test")
    eventBroker().emit(EVENT.TELEMETRY.PARTNER_ADDED, { clientId: "client-partner.test" })

    expect(seen.at(-1)?.isPartner).toBe(true)
    expect(trackedTabs().findActiveTab()?.partner).toBe(true)
  })
})

describe("welcome-header detection", () => {
  const publisherValue = "client-abc; v=1"

  const partnerDetections = () => {
    const seen: unknown[] = []
    eventBroker().on(EVENT.TAB_TRACKER.PARTNER_DETECTED, (data) => seen.push(data))
    return seen
  }

  beforeEach(() => {
    partners.clear()
    trackedTabs().map.clear()
    trackedTabs().flushActive()
    addViews.mockClear()
    chromeMock.scripting.executeScriptResult = [{ result: undefined }]
  })

  describe("from a response header", () => {
    const complete = (url: string, headers: { name: string; value?: string }[]) =>
      chromeMock.webRequest.onCompleted.dispatch({ url, responseHeaders: headers })

    test("decodes the welcome header and announces the partner", async () => {
      const seen = partnerDetections()

      await complete("https://partner.test/", [{ name: "Better-Web-Publisher", value: publisherValue }])

      expect(seen.at(-1)).toEqual({
        publisherId: "client-abc",
        version: 1,
        source: "header",
        url: "https://partner.test/",
      })
    })

    test("matches the header name case-insensitively, as HTTP requires", async () => {
      const seen = partnerDetections()

      await complete("https://partner.test/", [{ name: "better-web-publisher", value: publisherValue }])

      expect(seen).toHaveLength(1)
    })

    test("ignores responses with no publisher header, a malformed one, or no headers at all", async () => {
      const seen = partnerDetections()

      await complete("https://plain.test/", [{ name: "content-type", value: "text/html" }])
      await complete("https://plain.test/", [{ name: "Better-Web-Publisher", value: "" }])
      await complete("https://plain.test/", [{ name: "Better-Web-Publisher", value: "has space" }])
      await complete("https://plain.test/", [{ name: "Better-Web-Publisher", value: "pub_a; v=0" }])
      await chromeMock.webRequest.onCompleted.dispatch({ url: "https://plain.test/" })

      expect(seen).toEqual([])
    })

    test("leaves a publisher announcing a newer protocol alone", async () => {
      // Sending a v1 token to a site expecting v2 would just be rejected. Skipping it keeps the
      // credential in the pool and lets an extension update sort it out.
      const seen = partnerDetections()

      await complete("https://future.test/", [{ name: "Better-Web-Publisher", value: "pub_a; v=2" }])

      expect(seen).toEqual([])
    })

    test("accepts a bare publisher id, which predates the version parameter", async () => {
      const seen = partnerDetections()

      await complete("https://bare.test/", [{ name: "Better-Web-Publisher", value: "pub_bare" }])

      expect(seen).toHaveLength(1)
      expect(seen.at(-1)).toMatchObject({ publisherId: "pub_bare", version: 1 })
    })

    test("skips URLs a browser serves for its own pages", async () => {
      const seen = partnerDetections()

      await complete("chrome://extensions", [{ name: "Better-Web-Publisher", value: publisherValue }])

      expect(seen).toEqual([])
    })
  })

  describe("from a meta tag", () => {
    const finishLoading = (t: chrome.tabs.Tab) =>
      chromeMock.tabs.onUpdated.dispatch(t.id as number, { status: "complete" }, t)

    test("reads the welcome value out of the page head and announces the partner", async () => {
      chromeMock.scripting.executeScriptResult = [{ result: publisherValue }]
      const seen = partnerDetections()

      await finishLoading(tab(1, "https://meta.test/"))

      expect(seen.at(-1)).toMatchObject({ publisherId: "client-abc", source: "meta", url: "https://meta.test/" })
      expect(chromeMock.scripting.executeScriptCalls.at(-1)).toMatchObject({ target: { tabId: 1 } })
    })

    test("counts the very first page view of a meta-tag partner", async () => {
      // The meta lookup is asynchronous; not awaiting it means the first visit is never counted.
      chromeMock.scripting.executeScriptResult = [{ result: publisherValue }]
      eventBroker().on(EVENT.TAB_TRACKER.PARTNER_DETECTED, () => makePartner("meta.test"))

      await finishLoading(tab(1, "https://meta.test/"))

      expect(addViews).toHaveBeenCalledWith("https://meta.test/")
    })

    test("does not run a content script on a site already known to be a partner", async () => {
      makePartner("known.test")
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

    test("survives a page that cannot be scripted", async () => {
      chromeMock.scripting.executeScript = async () => {
        throw new Error("Cannot access contents of the page")
      }
      const seen = partnerDetections()

      await finishLoading(tab(1, "https://blocked.test/"))

      expect(seen).toEqual([])
      expect(trackedTabs().map.has(1)).toBe(true)
    })
  })
})
