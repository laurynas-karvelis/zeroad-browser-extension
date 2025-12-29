import { SERVER_HEADER, FEATURE, decodeServerHeader } from "@zeroad.network/token/browser";
import { EVENT, eventBroker } from "./event-broker";
import { Entry, telemetry } from "./telemetry";

type BrowserTab = chrome.tabs.Tab & { partner: boolean };

export type TabTrackerPartnerDetectedData = {
  clientId: string;
  features: (keyof typeof FEATURE)[];
  source: "header" | "meta";
  url: string;
};

export type TabTrackActiveTabEventData =
  | {
      telemetryEntry: Entry;
      tabId?: number;
      isPartner: true;
      url: string;
    }
  | {
      telemetryEntry: undefined;
      tabId?: number;
      isPartner: false;
      url?: string;
    };

enum TAB_REGISTER_SOURCE {
  ON_TAB_ACTIVATED = "tabs.onActivated",
  ON_TAB_UPDATED = "tabs.onUpdated",
  ON_WINDOW_FOCUS_CHANGED = "window.onFocusChanged",
}

class TrackedTabs {
  map = new Map<number, BrowserTab>();

  notifyIfActiveTabIsPartner(tab?: BrowserTab) {
    tab = tab || this.findActiveTab();

    if (tab?.active) {
      let data: TabTrackActiveTabEventData;

      if (tab.partner) {
        data = {
          isPartner: tab.partner,
          url: tab.url!,
          tabId: tab.id,
          telemetryEntry: telemetry().findPartnerEntryByUrl(tab.url)!,
        };
      } else {
        data = {
          isPartner: tab.partner,
          url: tab.url,
          tabId: tab.id,
          telemetryEntry: undefined,
        };
      }

      eventBroker().emit<TabTrackActiveTabEventData>(EVENT.TAB_TRACKER.IS_ACTIVE_TAB_PARTNER, data);
    }
  }

  findActiveTab() {
    return this.map.values().find((tab) => tab.active);
  }

  flushActive(currentTabId?: number) {
    const tab = this.findActiveTab();
    if (currentTabId && currentTabId === tab?.id) return;

    if (tab?.active) {
      if (tab.partner && tab.lastAccessed) telemetry().addDuration(tab.url, Math.floor(Date.now() - tab.lastAccessed));
      tab.active = false;
    }
  }

  register(tab: chrome.tabs.Tab, source: TAB_REGISTER_SOURCE) {
    if ([TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED, TAB_REGISTER_SOURCE.ON_WINDOW_FOCUS_CHANGED].includes(source)) {
      this.flushActive(tab.id);
    }

    if (!tab.id) {
      return;
    }

    const partner = telemetry().hasPartnerEntryByUrl(tab.url);
    const trackedTab = { ...tab, partner };

    this.map.set(tab.id, trackedTab);
    this.notifyIfActiveTabIsPartner(trackedTab);
  }

  delete(tabId: number) {
    this.flushActive();
    this.map.delete(tabId);
  }

  deleteByWindowId(windowId: number) {
    this.map.forEach((tab) => {
      if (tab.windowId === windowId && tab.id) {
        this.delete(tab.id);
      }
    });
  }
}

const singleton = new TrackedTabs();
export const trackedTabs = () => singleton;

const helpers = {
  PARTNER_SITE_HEADER_NAME: SERVER_HEADER.WELCOME.toLocaleLowerCase(),
  testPartnerWelcomeHeaderValue(url: string, welcomeHeaderValue: string | undefined, source: "header" | "meta") {
    const decodedValue = decodeServerHeader(welcomeHeaderValue);

    if (decodedValue) {
      eventBroker().emit<TabTrackerPartnerDetectedData>(EVENT.TAB_TRACKER.PARTNER_DETECTED, {
        clientId: decodedValue.clientId,
        features: decodedValue.features,
        source,
        url,
      });
    }
  },

  async testHtmlMetaTags(tab: chrome.tabs.Tab) {
    if (!tab.id || !tab.url) return;

    let welcomeHeaderValue: string | undefined;
    try {
      const [{ result: metaContentValue }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (lookupHeaderName: string) => {
          return Array.from(document.head.querySelectorAll("meta[name][content]"))
            .find((el) => el.getAttribute("name")?.trim().toLocaleLowerCase() === lookupHeaderName)
            ?.getAttribute("content")
            ?.trim();
        },
        args: [this.PARTNER_SITE_HEADER_NAME],
      });

      welcomeHeaderValue = metaContentValue || undefined;
    } catch (_err) {
      // Ignore
    }

    helpers.testPartnerWelcomeHeaderValue(tab.url, welcomeHeaderValue, "meta");
  },

  testWebRequestHeaders(url: string, headers: chrome.webRequest.HttpHeader[]) {
    const welcomeHeaderValue = headers.find(
      (header) => header.name.toLocaleLowerCase() === helpers.PARTNER_SITE_HEADER_NAME
    )?.value;

    helpers.testPartnerWelcomeHeaderValue(url, welcomeHeaderValue, "header");
  },
};

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  trackedTabs().register(await chrome.tabs.get(tabId), TAB_REGISTER_SOURCE.ON_TAB_ACTIVATED);
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") {
    return;
  }

  if (tab.url) {
    if (!telemetry().hasPartnerEntryByUrl(tab.url)) {
      // Might include "Welcome header" inside one of their <meta> tags
      helpers.testHtmlMetaTags(tab);
    }

    if (telemetry().hasPartnerEntryByUrl(tab.url)) {
      telemetry().addViews(tab.url);
    }
  }

  trackedTabs().register(tab, TAB_REGISTER_SOURCE.ON_TAB_UPDATED);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;

  // A special case: the `onActivated` event won't fire when switching between windows
  // We have to inject current timestamp as `lastAccessed` ourselves
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) trackedTabs().register({ ...tab, lastAccessed: Date.now() }, TAB_REGISTER_SOURCE.ON_WINDOW_FOCUS_CHANGED);
});

chrome.tabs.onRemoved.addListener((tabId) => trackedTabs().delete(tabId));

chrome.windows.onRemoved.addListener((windowId) => trackedTabs().deleteByWindowId(windowId));

chrome.webRequest.onCompleted.addListener(
  async (details) => helpers.testWebRequestHeaders(details.url, details.responseHeaders || []),
  { types: ["main_frame"], urls: ["<all_urls>"] },
  ["responseHeaders"]
);
