import { readBodyPublisherId, readMetaPublisherValue } from "./page-scan"
import { PUBLISHER_HEADER, isValidPublisherId, parsePublisherHeader, publisherIdsMatch } from "./publisher-id"
import { isValidUrl } from "./utils"

/**
 * On-demand site verification, driven from the zeroad.network site's "Add & verify" flow.
 *
 * A background tab is opened towards the address the publisher entered, loaded in a real browser (so
 * pages that only render their id client-side - a video description, a profile bio - are seen the way
 * a visitor sees them, which an edge fetch cannot), and checked for the publisher's id in three
 * places, in order of strength:
 *
 *   1. the `Better-Web-Publisher` response header  -> proves control of the site (a full site)
 *   2. a `<meta name="better-web-publisher">` tag  -> proves control of the site (a full site)
 *   3. the id printed in the visible page content  -> a platform the publisher doesn't control
 *
 * The tab is opened inactive and closed as soon as the check finishes, so the publisher barely sees it.
 */

export type VerifySiteRequest = {
  url: string
  publisherId: string
}

export type VerifySiteResult = {
  success: boolean
  /** Which proof matched the expected id, or null when none did. */
  method: "header" | "meta" | "content" | null
  /** The address the tab settled on after any redirects. */
  finalUrl?: string
  /** A short, human-readable reason when verification did not succeed. */
  error?: string
}

const LOAD_TIMEOUT_MS = 20000
const PUBLISHER_HEADER_LOWERCASE = PUBLISHER_HEADER.toLowerCase()

/**
 * Buffers the `Better-Web-Publisher` response header (and final URL) of every main-frame navigation,
 * keyed by tab. Registered before the tab is opened so the navigation cannot complete before we are
 * listening, then read back by the tab id once the page has finished loading.
 */
function captureMainFrameHeaders() {
  const headerByTabId = new Map<number, string | undefined>()
  const finalUrlByTabId = new Map<number, string>()

  const handler = (details: chrome.webRequest.OnCompletedDetails) => {
    if (details.type !== "main_frame") return

    const headerValue = (details.responseHeaders || []).find(
      (header) => header.name.toLowerCase() === PUBLISHER_HEADER_LOWERCASE
    )?.value

    headerByTabId.set(details.tabId, headerValue)
    finalUrlByTabId.set(details.tabId, details.url)
  }

  chrome.webRequest.onCompleted.addListener(handler, { urls: ["<all_urls>"], types: ["main_frame"] }, [
    "responseHeaders",
  ])

  return {
    headerFor: (tabId: number) => headerByTabId.get(tabId),
    finalUrlFor: (tabId: number) => finalUrlByTabId.get(tabId),
    dispose: () => chrome.webRequest.onCompleted.removeListener(handler),
  }
}

/** Resolves when the tab reports `complete`, rejects on timeout or if the tab is closed first. */
function waitForTabLoad(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      chrome.tabs.onRemoved.removeListener(onRemoved)
    }

    const timer = setTimeout(() => {
      cleanup()
      reject(new Error("Timed out loading the page"))
    }, timeoutMs)

    const onUpdated = (updatedTabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        cleanup()
        resolve()
      }
    }

    const onRemoved = (removedTabId: number) => {
      if (removedTabId === tabId) {
        cleanup()
        reject(new Error("The page was closed before it could be checked"))
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.tabs.onRemoved.addListener(onRemoved)

    // The page may have finished loading between opening the tab and attaching the listener above.
    chrome.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === "complete") {
          cleanup()
          resolve()
        }
      },
      () => {
        /* The get can fail if the tab is already gone; onRemoved handles that case. */
      }
    )
  })
}

export async function verifySite(request: VerifySiteRequest): Promise<VerifySiteResult> {
  const publisherId = (request?.publisherId || "").trim()
  const url = (request?.url || "").trim()

  if (!isValidPublisherId(publisherId)) {
    return { success: false, method: null, error: "The publisher id is not valid." }
  }

  if (!isValidUrl(url)) {
    return { success: false, method: null, error: "That doesn't look like a valid web address." }
  }

  const capture = captureMainFrameHeaders()
  let tabId: number | undefined

  try {
    const tab = await chrome.tabs.create({ url, active: false })
    tabId = tab.id

    if (tabId === undefined) {
      return { success: false, method: null, error: "Couldn't open the page to check it." }
    }

    await waitForTabLoad(tabId, LOAD_TIMEOUT_MS)

    const finalUrl = capture.finalUrlFor(tabId) || url

    if (publisherIdsMatch(parsePublisherHeader(capture.headerFor(tabId))?.publisherId, publisherId)) {
      return { success: true, method: "header", finalUrl }
    }

    const [metaValue, bodyId] = await Promise.all([readMetaPublisherValue(tabId), readBodyPublisherId(tabId)])

    if (publisherIdsMatch(parsePublisherHeader(metaValue)?.publisherId, publisherId)) {
      return { success: true, method: "meta", finalUrl }
    }

    if (publisherIdsMatch(bodyId, publisherId)) {
      return { success: true, method: "content", finalUrl }
    }

    return {
      success: false,
      method: null,
      finalUrl,
      error: "We reached the page but couldn't find your publisher id in a response header, a meta tag, or the page content.",
    }
  } catch (error) {
    return {
      success: false,
      method: null,
      error: (error as Error)?.message || "Couldn't reach the page to check it.",
    }
  } finally {
    capture.dispose()
    if (tabId !== undefined) {
      try {
        await chrome.tabs.remove(tabId)
      } catch {
        /* The tab may already be closed. */
      }
    }
  }
}
