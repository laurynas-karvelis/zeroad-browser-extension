import { schedule } from "./alarm"
import { EVENT, eventBroker } from "./event-broker"
import { extension } from "./extension"
import { headerInjection } from "./header-injection"
import { readMetaPublisherValue } from "./page-scan"
import { PUBLISHER_HEADER, parsePublisherHeader } from "./publisher-id"
import { isVerificationTab } from "./site-verification"
import { type Entry, telemetry } from "./telemetry"
import { isValidUrl } from "./utils"

type BrowserTab = chrome.tabs.Tab & { publisher: boolean }

/** The tab the user is looking at, the page on it, and since when its time is unbooked. */
type FocusedVisit = { tabId: number; url?: string; since: number }

const FOCUSED_VISIT_STORAGE_KEY = "focusedVisit"

/**
 * Books the focused visit's time every minute without ending it. The worker is torn down after ~30s
 * of quiet, so a long read would otherwise only be booked on the next tab switch - by a worker that
 * may have been restarted in between. This also wakes the worker, which keeps a visit from going
 * unbooked for longer than the interval.
 */
const DWELL_CHECKPOINT_ALARM = "dwell-checkpoint"
const DWELL_CHECKPOINT_INTERVAL_IN_MINUTES = 1

export type TabTrackerPublisherDetectedData = {
  publisherId: string
  source: "header" | "meta"
  url: string
}

export type TabTrackActiveTabEventData =
  | {
      telemetryEntry: Entry
      tabId?: number
      isPublisher: true
      url: string
    }
  | {
      telemetryEntry: undefined
      tabId?: number
      isPublisher: false
      url?: string
    }

enum TAB_REGISTER_SOURCE {
  ON_TAB_ACTIVATED = "tabs.onActivated",
  ON_TAB_UPDATED = "tabs.onUpdated",
  ON_WINDOW_FOCUS_CHANGED = "window.onFocusChanged",
  ON_SCREEN_UNLOCKED = "idle.onStateChanged",
}

class TrackedTabs {
  map = new Map<number, BrowserTab>()

  // Chrome marks one tab `active` per window, so the flag alone cannot say which tab the user is
  // actually looking at. The worker remembers that itself, and times the visit itself rather than
  // trusting `tab.lastAccessed`, whose meaning varies with how the tab was reached. It is mirrored to
  // `storage.session`, since the worker is torn down mid-visit all the time.
  private focused?: FocusedVisit

  /** Resolves once a focused visit persisted by an earlier worker has been restored. */
  readonly ready: Promise<void>

  constructor() {
    this.ready = this.restoreFocus()
  }

  notifyIfActiveTabIsPublisher(tab?: BrowserTab) {
    tab = tab || this.findActiveTab()

    // Only the focused tab drives the badge; a background window's "active" tab must not.
    if (!tab || tab.id !== this.focused?.tabId) return

    const telemetryEntry = tab.publisher ? telemetry().findPublisherEntryByUrl(tab.url) : undefined

    const data: TabTrackActiveTabEventData =
      telemetryEntry && tab.url
        ? { isPublisher: true, url: tab.url, tabId: tab.id, telemetryEntry }
        : { isPublisher: false, url: tab.url, tabId: tab.id, telemetryEntry: undefined }

    eventBroker().emit<TabTrackActiveTabEventData>(EVENT.TAB_TRACKER.IS_ACTIVE_TAB_PUBLISHER, data)
  }

  findActiveTab() {
    return this.focused === undefined ? undefined : this.map.get(this.focused.tabId)
  }

  /** Whether any tab has the user's attention - false once the browser loses focus or the screen locks. */
  hasFocus() {
    return this.focused !== undefined
  }

  /** Books the time spent on the focused tab and leaves nothing focused. */
  flushActive() {
    this.bookFocusedTime()
    this.setFocused(undefined)
  }

  /** Books the focused visit's time so far and keeps it going. */
  checkpoint() {
    if (!this.focused) return

    this.bookFocusedTime()
    this.setFocused({ ...this.focused, since: Date.now() })
  }

  register(tab: chrome.tabs.Tab, source: TAB_REGISTER_SOURCE) {
    if (!tab.id) return

    // Time already spent belongs to the page it was spent on, not to whatever navigated over it.
    if (this.focused?.tabId === tab.id && this.focused.url !== tab.url) {
      this.bookFocusedTime()
      this.setFocused({ tabId: tab.id, url: tab.url, since: Date.now() })
    }

    const trackedTab = { ...tab, publisher: telemetry().hasPublisherEntryByUrl(tab.url) }
    this.map.set(tab.id, trackedTab)

    // A tab finishing its load says nothing about where the user is looking - only switching does.
    if (source !== TAB_REGISTER_SOURCE.ON_TAB_UPDATED) this.focus(tab)

    this.notifyIfActiveTabIsPublisher(trackedTab)
  }

  /** Re-reads publisher status for every tracked tab, for when a site is recognised after it loaded. */
  refreshPublisherFlags() {
    for (const tab of this.map.values()) {
      tab.publisher = telemetry().hasPublisherEntryByUrl(tab.url)
    }

    this.notifyIfActiveTabIsPublisher()
  }

  delete(tabId: number) {
    // Closing a background tab must not stop the clock on the tab the user is reading.
    if (tabId === this.focused?.tabId) this.flushActive()
    this.map.delete(tabId)
  }

  deleteByWindowId(windowId: number) {
    for (const tab of [...this.map.values()]) {
      if (tab.windowId === windowId && tab.id) this.delete(tab.id)
    }
  }

  private focus(tab: chrome.tabs.Tab) {
    // Re-focusing the same tab keeps its clock running instead of discarding the elapsed time.
    if (this.focused?.tabId === tab.id) return

    this.flushActive()
    if (tab.id) this.setFocused({ tabId: tab.id, url: tab.url, since: Date.now() })
  }

  private bookFocusedTime() {
    if (!this.focused) return

    const { url, since } = this.focused
    if (telemetry().hasPublisherEntryByUrl(url)) telemetry().addDuration(url, Math.floor(Date.now() - since))
  }

  private setFocused(focused: FocusedVisit | undefined) {
    this.focused = focused

    void (focused
      ? chrome.storage.session.set({ [FOCUSED_VISIT_STORAGE_KEY]: focused })
      : chrome.storage.session.remove([FOCUSED_VISIT_STORAGE_KEY]))
  }

  private async restoreFocus() {
    const stored = await chrome.storage.session.get<{ focusedVisit?: FocusedVisit }>([FOCUSED_VISIT_STORAGE_KEY])

    // Whatever this worker has already seen is newer than what the last one left behind.
    this.focused ??= stored.focusedVisit
  }
}

const singleton = new TrackedTabs()
export const trackedTabs = () => singleton

/** Handlers run only once every store they read is back from storage - see `extension().ready`. */
const allReady = () => Promise.all([trackedTabs().ready, extension().ready, telemetry().ready])

const helpers = {
  PUBLISHER_SITE_HEADER_NAME: PUBLISHER_HEADER.toLocaleLowerCase(),
  testPublisherHeaderValue(url: string, headerValue: string | undefined, source: "header" | "meta") {
    const publisherId = parsePublisherHeader(headerValue)
    if (!publisherId) return

    eventBroker().emit<TabTrackerPublisherDetectedData>(EVENT.TAB_TRACKER.PUBLISHER_DETECTED, {
      publisherId,
      source,
      url,
    })
  },

  async testHtmlMetaTags(tab: chrome.tabs.Tab) {
    if (!tab.id || !tab.url) return

    const metaValue = await readMetaPublisherValue(tab.id)
    helpers.testPublisherHeaderValue(tab.url, metaValue, "meta")
  },

  testWebRequestHeaders(url: string, headers: chrome.webRequest.HttpHeader[]) {
    const headerValue = headers.find(
      (header) => header.name.toLocaleLowerCase() === helpers.PUBLISHER_SITE_HEADER_NAME
    )?.value

    helpers.testPublisherHeaderValue(url, headerValue, "header")
  },
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await allReady()
  trackedTabs().register(await chrome.tabs.get(tabId), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
})

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || isVerificationTab(tabId)) {
    return
  }

  await allReady()

  if (isValidUrl(tab.url)) {
    if (!telemetry().hasPublisherEntryByUrl(tab.url)) {
      // Might include "Welcome header" inside one of their <meta> tags. This has to be awaited:
      // the very first visit to a meta-tag publisher is only recognised once the script comes back,
      // and an un-awaited check would leave that page view uncounted.
      await helpers.testHtmlMetaTags(tab)
    }

    if (telemetry().hasPublisherEntryByUrl(tab.url)) {
      telemetry().addViews(tab.url)
    }
  }

  trackedTabs().register(tab, TAB_REGISTER_SOURCE.ON_TAB_UPDATED)
})

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  await allReady()

  // The user moved to another application - the page is no longer being read.
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    trackedTabs().flushActive()
    return
  }

  // A special case: the `onActivated` event won't fire when switching between windows, so this is
  // the only signal that the user moved their attention to whatever is active over here.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab) trackedTabs().register(tab, TAB_REGISTER_SOURCE.ON_WINDOW_FOCUS_CHANGED)
})

// Only a locked screen stops the clock, not mere inactivity: someone watching a video or reading a
// long page touches nothing for minutes at a time. Firefox never reports "locked", so there only the
// browser losing focus stops it.
chrome.idle.onStateChanged.addListener(async (state) => {
  await allReady()

  if (state === "locked") {
    trackedTabs().flushActive()
    return
  }

  if (state !== "active" || trackedTabs().hasFocus()) return

  // Unlocked: resume on the active tab, but only if the browser is what the user came back to.
  const lastFocusedWindow = await chrome.windows.getLastFocused()
  if (!lastFocusedWindow.focused) return

  const [tab] = await chrome.tabs.query({ active: true, windowId: lastFocusedWindow.id })
  if (tab) trackedTabs().register(tab, TAB_REGISTER_SOURCE.ON_SCREEN_UNLOCKED)
})

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await allReady()
  trackedTabs().delete(tabId)
})

chrome.windows.onRemoved.addListener(async (windowId) => {
  await allReady()
  trackedTabs().deleteByWindowId(windowId)
})

schedule
  .on(DWELL_CHECKPOINT_ALARM, async () => {
    await allReady()
    trackedTabs().checkpoint()
  })
  .create(DWELL_CHECKPOINT_ALARM, { periodInMinutes: DWELL_CHECKPOINT_INTERVAL_IN_MINUTES })

eventBroker().on(EVENT.TELEMETRY.PUBLISHER_ADDED, () => trackedTabs().refreshPublisherFlags())

// Phase D, the discovery loop: the first response from a participating site is what reveals it takes
// part. From then on it gets a token bound to its hostname, so the visit after this one arrives
// identified. Nothing is spent on a site that never announced itself.
eventBroker().on<TabTrackerPublisherDetectedData>(EVENT.TAB_TRACKER.PUBLISHER_DETECTED, async ({ url }) => {
  try {
    await headerInjection().enableForHostname(new URL(url).hostname)
  } catch (_err) {
    // A malformed url or an exhausted pool must not break tab tracking
  }
})

chrome.webRequest.onCompleted.addListener(
  async (details) => {
    if (!isValidUrl(details.url) || isVerificationTab(details.tabId)) return

    await allReady()
    helpers.testWebRequestHeaders(details.url, details.responseHeaders || [])
  },
  { types: ["main_frame"], urls: ["<all_urls>"] },
  ["responseHeaders"]
)
