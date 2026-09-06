import { log } from "./logger"
import { PUBLISHER_HEADER, PUBLISHER_ID_SCHEME } from "./publisher-id"

/**
 * Reads a loaded tab's DOM for the publisher's id, the way a visitor's browser rendered it - so pages
 * that only print their id client-side (a video description, a profile bio) are seen, which an edge
 * fetch of the raw HTML cannot. Shared by passive tab tracking and the on-demand "Add & verify" flow.
 */

/** Meta tag carrying the publisher id, e.g. `<meta name="better-web-publisher" content="...">`. */
const PUBLISHER_META_NAME = PUBLISHER_HEADER.toLowerCase()

/** Runs a reader in the page and returns its result, or undefined if the tab cannot be scripted. */
async function runInPage<T>(tabId: number, func: (...args: string[]) => T, args: string[]): Promise<T | undefined> {
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func, args })
    return injection?.result as T | undefined
  } catch (error) {
    log("warn", "[page-scan]", "Could not read the page", error)
    return undefined
  }
}

/** The `<meta name="better-web-publisher">` content of a loaded tab, trimmed, or undefined. */
export function readMetaPublisherValue(tabId: number): Promise<string | undefined> {
  return runInPage(
    tabId,
    (metaName: string) =>
      Array.from(document.head?.querySelectorAll("meta[name][content]") || [])
        .find((element) => element.getAttribute("name")?.trim().toLowerCase() === metaName)
        ?.getAttribute("content")
        ?.trim() || undefined,
    [PUBLISHER_META_NAME]
  )
}

/**
 * The topmost publisher id printed in a loaded tab's visible body, or undefined. Only the first
 * occurrence is honoured, so appending an id below someone else's cannot hijack it. Ids are matched
 * case-insensitively; the id is returned as it appears so the caller can validate its exact shape.
 */
export function readBodyPublisherId(tabId: number): Promise<string | undefined> {
  return runInPage(
    tabId,
    (scheme: string) => {
      const bodyText = document.body?.innerText || ""
      const schemeAt = bodyText.toLowerCase().indexOf(scheme.toLowerCase())
      if (schemeAt === -1) return undefined

      const random = bodyText.slice(schemeAt + scheme.length).match(/^[A-Za-z0-9]+/)
      return random ? bodyText.slice(schemeAt, schemeAt + scheme.length) + random[0] : undefined
    },
    [PUBLISHER_ID_SCHEME]
  )
}
