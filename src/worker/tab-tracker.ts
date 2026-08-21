import { EVENT, eventBroker } from "./event-broker"
import { headerInjection } from "./header-injection"
import { type Entry, telemetry } from "./telemetry"
import { isValidUrl } from "./utils"

type BrowserTab = chrome.tabs.Tab & { partner: boolean }

export type TabTrackerPartnerDetectedData = {
  publisherId: string
  /** Protocol version the publisher announced, so a newer one can be skipped rather than mis-served. */
  version: number
  source: "header" | "meta"
  url: string
}

export type TabTrackActiveTabEventData =
  | {
      telemetryEntry: Entry
      tabId?: number
      isPartner: true
      url: string
    }
  | {
      telemetryEntry: undefined
      tabId?: number
      isPartner: false
      url?: string
    }

enum TAB_REGISTER_SOURCE {
  ON_TAB_ACTIVATED = "tabs.onActivated",
  ON_TAB_UPDATED = "tabs.onUpdated",
  ON_WINDOW_FOCUS_CHANGED = "window.onFocusChanged",
}

class TrackedTabs {
  map = new Map<number, BrowserTab>()

  // Chrome marks one tab `active` per window, so the flag alone cannot say which tab the user is
  // actually looking at. The worker remembers that itself, and times the visit itself rather than
  // trusting `tab.lastAccessed`, whose meaning varies with how the tab was reached.
  private focusedTabId?: number
  private focusedSince?: number

  notifyIfActiveTabIsPartner(tab?: BrowserTab) {
    tab = tab || this.findActiveTab()

    // Only the focused tab drives the badge; a background window's "active" tab must not.
    if (!tab || tab.id !== this.focusedTabId) return

    const telemetryEntry = tab.partner ? telemetry().findPartnerEntryByUrl(tab.url) : undefined

    const data: TabTrackActiveTabEventData =
      telemetryEntry && tab.url
        ? { isPartner: true, url: tab.url, tabId: tab.id, telemetryEntry }
        : { isPartner: false, url: tab.url, tabId: tab.id, telemetryEntry: undefined }

    eventBroker().emit<TabTrackActiveTabEventData>(EVENT.TAB_TRACKER.IS_ACTIVE_TAB_PARTNER, data)
  }

  findActiveTab() {
    return this.focusedTabId === undefined ? undefined : this.map.get(this.focusedTabId)
  }

  /** Books the time spent on the focused tab and leaves nothing focused. */
  flushActive() {
    const tab = this.findActiveTab()

    if (tab?.partner && this.focusedSince) {
      telemetry().addDuration(tab.url, Math.floor(Date.now() - this.focusedSince))
    }

    this.focusedTabId = undefined
    this.focusedSince = undefined
  }

  register(tab: chrome.tabs.Tab, source: TAB_REGISTER_SOURCE) {
    if (!tab.id) return

    const previous = this.map.get(tab.id)

    // Time already spent belongs to the page it was spent on, not to whatever navigated over it.
    if (tab.id === this.focusedTabId && previous && previous.url !== tab.url) this.flushActive()

    const trackedTab = { ...tab, partner: telemetry().hasPartnerEntryByUrl(tab.url) }
    this.map.set(tab.id, trackedTab)

    const takesFocus =
      source === TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED ||
      source === TAB_REGISTER_SOURCE.ON_WINDOW_FOCUS_CHANGED ||
      // A restarted worker has no idea what is focused until the user switches something.
      (this.focusedTabId === undefined && !!tab.active)

    if (takesFocus) this.focus(tab.id)

    this.notifyIfActiveTabIsPartner(trackedTab)
  }

  /** Re-reads partner status for every tracked tab, for when a site is recognised after it loaded. */
  refreshPartnerFlags() {
    for (const tab of this.map.values()) {
      tab.partner = telemetry().hasPartnerEntryByUrl(tab.url)
    }

    this.notifyIfActiveTabIsPartner()
  }

  delete(tabId: number) {
    // Closing a background tab must not stop the clock on the tab the user is reading.
    if (tabId === this.focusedTabId) this.flushActive()
    this.map.delete(tabId)
  }

  deleteByWindowId(windowId: number) {
    for (const tab of [...this.map.values()]) {
      if (tab.windowId === windowId && tab.id) this.delete(tab.id)
    }
  }

  private focus(tabId: number) {
    // Re-focusing the same tab keeps its clock running instead of discarding the elapsed time.
    if (this.focusedTabId === tabId) return

    this.flushActive()
    this.focusedTabId = tabId
    this.focusedSince = Date.now()
  }
}

const singleton = new TrackedTabs()
export const trackedTabs = () => singleton

/** Must match `PUBLISHER_HEADER` and `PROTOCOL_VERSION` in @zeroad.network/token. */
const PUBLISHER_HEADER = "Better-Web-Publisher"
const SUPPORTED_PROTOCOL_VERSION = 1

/**
 * Reads a `Better-Web-Publisher` value: the publisher id, optionally followed by `; v=N`.
 * A bare id predates the version parameter and is read as version 1.
 */
export function parsePublisherHeader(headerValue: string | null | undefined) {
  if (!headerValue) return undefined

  const [rawId, ...parameters] = headerValue.split(";")
  const publisherId = rawId.trim()

  if (!/^[\x21-\x7e]{1,128}$/.test(publisherId)) return undefined

  let version = SUPPORTED_PROTOCOL_VERSION

  for (const parameter of parameters) {
    const [name, value] = parameter.split("=", 2)
    if (name?.trim().toLowerCase() !== "v") continue

    const parsed = Number(value?.trim())
    if (!Number.isSafeInteger(parsed) || parsed < 1) return undefined

    version = parsed
  }

  return { publisherId, version }
}

const helpers = {
  PARTNER_SITE_HEADER_NAME: PUBLISHER_HEADER.toLocaleLowerCase(),
  testPartnerHeaderValue(url: string, headerValue: string | undefined, source: "header" | "meta") {
    const decodedValue = parsePublisherHeader(headerValue)
    if (!decodedValue) return

    // A publisher announcing a format this extension predates gets left alone rather than sent a
    // token it cannot read
    if (decodedValue.version !== SUPPORTED_PROTOCOL_VERSION) return

    eventBroker().emit<TabTrackerPartnerDetectedData>(EVENT.TAB_TRACKER.PARTNER_DETECTED, {
      publisherId: decodedValue.publisherId,
      version: decodedValue.version,
      source,
      url,
    })
  },

  async testHtmlMetaTags(tab: chrome.tabs.Tab) {
    if (!tab.id || !tab.url) return

    let headerValue: string | undefined
    try {
      const [{ result: metaContentValue }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (lookupHeaderName: string) => {
          return Array.from(document.head.querySelectorAll("meta[name][content]"))
            .find((el) => el.getAttribute("name")?.trim().toLocaleLowerCase() === lookupHeaderName)
            ?.getAttribute("content")
            ?.trim()
        },
        args: [this.PARTNER_SITE_HEADER_NAME],
      })

      headerValue = metaContentValue || undefined
    } catch (_err) {
      // Ignore
    }

    helpers.testPartnerHeaderValue(tab.url, headerValue, "meta")
  },

  testWebRequestHeaders(url: string, headers: chrome.webRequest.HttpHeader[]) {
    const headerValue = headers.find(
      (header) => header.name.toLocaleLowerCase() === helpers.PARTNER_SITE_HEADER_NAME
    )?.value

    helpers.testPartnerHeaderValue(url, headerValue, "header")
  },
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  trackedTabs().register(await chrome.tabs.get(tabId), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED)
})

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") {
    return
  }

  if (isValidUrl(tab.url)) {
    if (!telemetry().hasPartnerEntryByUrl(tab.url)) {
      // Might include "Welcome header" inside one of their <meta> tags. This has to be awaited:
      // the very first visit to a meta-tag partner is only recognised once the script comes back,
      // and an un-awaited check would leave that page view uncounted.
      await helpers.testHtmlMetaTags(tab)
    }

    if (telemetry().hasPartnerEntryByUrl(tab.url)) {
      telemetry().addViews(tab.url)
    }
  }

  trackedTabs().register(tab, TAB_REGISTER_SOURCE.ON_TAB_UPDATED)
})

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return

  // A special case: the `onActivated` event won't fire when switching between windows, so this is
  // the only signal that the user moved their attention to whatever is active over here.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab) trackedTabs().register(tab, TAB_REGISTER_SOURCE.ON_WINDOW_FOCUS_CHANGED)
})

chrome.tabs.onRemoved.addListener((tabId) => trackedTabs().delete(tabId))

chrome.windows.onRemoved.addListener((windowId) => trackedTabs().deleteByWindowId(windowId))

eventBroker().on(EVENT.TELEMETRY.PARTNER_ADDED, () => trackedTabs().refreshPartnerFlags())

// Phase D, the discovery loop: the first response from a participating site is what reveals it takes
// part. From then on it gets a token bound to its hostname, so the visit after this one arrives
// identified. Nothing is spent on a site that never announced itself.
eventBroker().on<TabTrackerPartnerDetectedData>(EVENT.TAB_TRACKER.PARTNER_DETECTED, async ({ url }) => {
  try {
    await headerInjection().enableForHostname(new URL(url).hostname)
  } catch (_err) {
    // A malformed url or an exhausted pool must not break tab tracking
  }
})

chrome.webRequest.onCompleted.addListener(
  async (details) => {
    if (isValidUrl(details.url)) {
      helpers.testWebRequestHeaders(details.url, details.responseHeaders || [])
    }
  },
  { types: ["main_frame"], urls: ["<all_urls>"] },
  ["responseHeaders"]
)
