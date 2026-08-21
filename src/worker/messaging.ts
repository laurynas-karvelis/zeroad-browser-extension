import { getConfig } from "./config"
import { EVENT, type EventType, eventBroker } from "./event-broker"
import { extension } from "./extension"
import { log } from "./logger"
import { type TabTrackActiveTabEventData, trackedTabs } from "./tab-tracker"
import { telemetry } from "./telemetry"
import type { ExtensionSyncData } from "./types"
import { getHostname } from "./utils"

/**
 * Hostnames the Firefox content script is allowed to run on, straight out of the manifest. Chrome
 * enforces the equivalent list itself via `externally_connectable`, but on Firefox the site talks to
 * us through `content.js`, which arrives as an ordinary runtime message - so the worker checks the
 * origin too rather than trusting the content script to have done it.
 */
function trustedSiteHostnames(): string[] {
  const contentScripts = chrome.runtime.getManifest().content_scripts || []

  return contentScripts
    .flatMap((entry) => entry.matches || [])
    .flatMap((match) => {
      const hostname = getHostname(match)
      return hostname ? [hostname] : []
    })
}

/** Replies with something serializable - an Error structured-clones to an empty object. */
function respondWith<P>(work: Promise<P>, sendResponse: (response: unknown) => void) {
  work.then(sendResponse).catch((error: unknown) => {
    log("error", "[messaging]", "Handler failed", error)
    sendResponse({ error: (error as Error)?.message || "Unknown error" })
  })
}

function onSiteMessage<T = unknown, P = unknown>(
  eventName: EventType,
  callback: (message: T & { command: typeof eventName }) => Promise<P>
) {
  if (typeof browser !== "undefined" && typeof browser.runtime !== "undefined") {
    // Firefox extension - has to communicate via `content.js` (facepalm)
    chrome.runtime.onMessage.addListener((message, sender) => {
      // Verify sender is our content script, running on a site we actually trust
      if (!sender.tab || !sender.url) {
        log("warn", "[messaging]", "Rejected message from non-tab sender")
        return
      }

      if (!trustedSiteHostnames().includes(getHostname(sender.url))) {
        log("warn", "[messaging]", "Rejected message from untrusted origin:", sender.url)
        return
      }

      if (message?.command === eventName) {
        return callback(message)
      }
    })
  } else {
    // Chrome and Microsoft Edge into site's `window` context
    chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
      if (message?.command !== eventName) return false

      respondWith(callback(message), sendResponse)
      return true
    })
  }
}

function onPopupMessage<T = unknown, P = unknown>(
  eventName: EventType,
  callback: (message: T & { command: typeof eventName }) => Promise<P>
) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Returning true unconditionally held the reply channel open for commands this listener
    // does not handle, so an unknown command hung until Chrome tore the port down.
    if (message?.command !== eventName) return false

    respondWith(callback(message), sendResponse)
    return true
  })
}

class Messaging {
  constructor() {
    this.proxyMessagesToPopup()
    this.listenToPopupMessages()
    this.listenToSiteMessages()
  }

  listenToPopupMessages() {
    onPopupMessage(EVENT.POPUP.RESET_EXTENSION_STATE, async () => {
      eventBroker().emit(EVENT.EXTENSION.REQUEST_RESET)
      log("info", "[runtime-message-service]", "extension state is reset.")
    })

    onPopupMessage(EVENT.POPUP.DISPLAY_TELEMETRY_DATA, async () => {
      log("info", "[runtime-message-service]", {
        map: telemetry().map,
        export: telemetry().export(),
      })
    })

    onPopupMessage(EVENT.POPUP.GET_CONFIG, getConfig)
    onPopupMessage(EVENT.POPUP.GET_EXTENSION_DATA, async () => extension().getExtensionData())
    onPopupMessage(EVENT.POPUP.PUSH_TELEMETRY_REQUEST, async () => eventBroker().emit(EVENT.TELEMETRY.PUSH))
    onPopupMessage(EVENT.POPUP.IS_EXTENSION_PAUSED, async () => extension().isPaused())
    onPopupMessage(EVENT.POPUP.EXTENSION_PAUSE_REQUEST, () => extension().pause())
    onPopupMessage(EVENT.POPUP.EXTENSION_RESUME_REQUEST, () => extension().resume())
    onPopupMessage(EVENT.POPUP.CHECK_IF_ACTIVE_TAB_PUBLISHER_REQUEST, async () =>
      trackedTabs().notifyIfActiveTabIsPublisher()
    )
  }

  proxyMessagesToPopup() {
    const defaultCallbackFn = () => {
      if (chrome.runtime.lastError) {
        // Ignore, the popup isn't active to consume the event
        return
      }
    }

    const reloadPopup = () =>
      chrome.runtime.sendMessage({ event: EVENT.MESSAGING.POPUP_RELOAD_REQUEST }, defaultCallbackFn)

    const proxyIsActiveTabPublisherEvent = (data: TabTrackActiveTabEventData) =>
      chrome.runtime.sendMessage({ event: EVENT.MESSAGING.IS_ACTIVE_TAB_PUBLISHER, data }, defaultCallbackFn)

    // Send message to the popup
    eventBroker()
      .on(EVENT.EXTENSION.SUBSCRIPTION_ACTIVE, reloadPopup)
      .on(EVENT.EXTENSION.SUBSCRIPTION_EXPIRED, reloadPopup)
      .on(EVENT.TAB_TRACKER.IS_ACTIVE_TAB_PUBLISHER, proxyIsActiveTabPublisherEvent)
  }

  async listenToSiteMessages() {
    // Messages from https://zeroad.network site
    onSiteMessage(EVENT.WEBSITE.PING, async () => ({
      version: chrome.runtime.getManifest().version,
      userAgent: navigator.userAgent,
      reply: "PONG",
    }))

    onSiteMessage<{ payload: ExtensionSyncData }>(EVENT.WEBSITE.SYNC_CLIENT_DATA, async (message) => {
      if (message?.payload) {
        eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, message?.payload)
        return true
      }

      return false
    })
  }
}

const singleton = new Messaging()
export const messaging = () => singleton
