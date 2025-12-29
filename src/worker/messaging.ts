import { TabTrackActiveTabEventData, trackedTabs } from "./tab-tracker";
import { EVENT, eventBroker, EventType } from "./event-broker";
import { ExtensionSyncData } from "./types";
import { telemetry } from "./telemetry";
import { extension } from "./extension";
import { getConfig } from "./config";
import { log } from "./logger";

function onSiteMessage<T = unknown, P = unknown>(
  eventName: EventType,
  callback: (message: T & { command: typeof eventName }) => Promise<P>
) {
  if (typeof browser !== "undefined" && typeof browser.runtime !== "undefined") {
    // Firefox extension - has to communicate via `content.js` (facepalm)
    chrome.runtime.onMessage.addListener((message) => message?.command === eventName && callback(message));
  } else {
    // Chrome, Microsoft Edge and Safari inject `chrome.runtime.sendMessage()` into site's `window` context
    chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
      if (message?.command === eventName) callback(message).then(sendResponse).catch(sendResponse);
      return true;
    });
  }
}

function onPopupMessage<T = unknown, P = unknown>(
  eventName: EventType,
  callback: (message: T & { command: typeof eventName }) => Promise<P>
) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.command === eventName) callback(message).then(sendResponse).catch(sendResponse);
    return true;
  });
}

class Messaging {
  constructor() {
    this.proxyMessagesToPopup();
    this.listenToPopupMessages();
    this.listenToSiteMessages();
  }

  listenToPopupMessages() {
    onPopupMessage(EVENT.POPUP.RESET_EXTENSION_STATE, async () => {
      eventBroker().emit(EVENT.EXTENSION.REQUEST_RESET);
      log("info", "[runtime-message-service]", "extension state is reset.");
    });

    onPopupMessage(EVENT.POPUP.DISPLAY_TELEMETRY_DATA, async () => {
      log("info", "[runtime-message-service]", { map: telemetry().map, export: telemetry().export() });
    });

    onPopupMessage(EVENT.POPUP.GET_CONFIG, getConfig);
    onPopupMessage(EVENT.POPUP.GET_EXTENSION_DATA, async () => extension().getExtensionData());
    onPopupMessage(EVENT.POPUP.PUSH_TELEMETRY_REQUEST, async () => eventBroker().emit(EVENT.TELEMETRY.PUSH));
    onPopupMessage(EVENT.POPUP.IS_EXTENSION_PAUSED, async () => extension().isPaused());
    onPopupMessage(EVENT.POPUP.EXTENSION_PAUSE_REQUEST, () => extension().pause());
    onPopupMessage(EVENT.POPUP.EXTENSION_RESUME_REQUEST, () => extension().resume());
    onPopupMessage(EVENT.POPUP.CHECK_IF_ACTIVE_TAB_PARTNER_REQUEST, async () =>
      trackedTabs().notifyIfActiveTabIsPartner()
    );
  }

  proxyMessagesToPopup() {
    const defaultCallbackFn = () => {
      if (chrome.runtime.lastError) {
        // Ignore, the popup isn't active to consume the event
        return;
      }
    };

    const reloadPopup = () =>
      chrome.runtime.sendMessage({ event: EVENT.MESSAGING.POPUP_RELOAD_REQUEST }, defaultCallbackFn);

    const proxyIsActiveTabPartnerEvent = (data: TabTrackActiveTabEventData) =>
      chrome.runtime.sendMessage({ event: EVENT.MESSAGING.IS_ACTIVE_TAB_PARTNER, data }, defaultCallbackFn);

    // Send message to the popup
    eventBroker()
      .on(EVENT.EXTENSION.SUBSCRIPTION_ACTIVE, reloadPopup)
      .on(EVENT.EXTENSION.SUBSCRIPTION_EXPIRED, reloadPopup)
      .on(EVENT.TAB_TRACKER.IS_ACTIVE_TAB_PARTNER, proxyIsActiveTabPartnerEvent);
  }

  async listenToSiteMessages() {
    // Messages from https://zeroad.network site
    onSiteMessage(EVENT.WEBSITE.PING, async () => ({
      version: chrome.runtime.getManifest().version,
      userAgent: navigator.userAgent,
      reply: "PONG",
    }));

    onSiteMessage<{ payload: ExtensionSyncData }>(EVENT.WEBSITE.SYNC_CLIENT_DATA, async (message) => {
      if (message?.payload) {
        eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, message?.payload);
        return true;
      }

      return false;
    });
  }
}

const singleton = new Messaging();
export const messaging = () => singleton;
