import { beforeEach, describe, expect, test } from "bun:test"
import { chromeMock } from "../../__fixtures__/chrome"
import { isVerificationTab, verifySite } from "../site-verification"

const PUBLISHER_ID = "zapub_7Fq2xR9nKdW3mB6tYp1sVzAe"
const OTHER_ID = "zapub_AbCdEfGhIjKlMnOpQrStUvWx"

type Page = { header?: string; meta?: string; body?: string; finalUrl?: string }

let nextTabId = 100
let openTabs = 0
let mostOpenAtOnce = 0
const openedDuringCheck: boolean[] = []

/** Serves `page` to whichever tab the verifier opens: headers, a finished load, and the scripted DOM reads. */
function servePage(page: Page) {
  chromeMock.tabs.create = async (options: { url: string }) => {
    const id = nextTabId++
    openTabs++
    mostOpenAtOnce = Math.max(mostOpenAtOnce, openTabs)
    chromeMock.tabs.byId.set(id, { id, url: options.url, status: "complete" })

    await chromeMock.webRequest.onCompleted.dispatch({
      url: page.finalUrl ?? options.url,
      tabId: id,
      type: "main_frame",
      responseHeaders: page.header ? [{ name: "Better-Web-Publisher", value: page.header }] : [],
    } as never)

    return { id, ...options }
  }

  // The meta reader is handed the meta tag name, the body reader the id prefix.
  chromeMock.scripting.executeScript = async (injection: unknown) => {
    const [arg] = (injection as { args: string[] }).args
    openedDuringCheck.push(isVerificationTab(nextTabId - 1))
    return [{ result: arg === "zapub_" ? page.body : page.meta }]
  }
}

const originalRemove = chromeMock.tabs.remove
chromeMock.tabs.remove = async (tabId: number) => {
  openTabs--
  await originalRemove(tabId)
}

describe("verifySite", () => {
  beforeEach(() => {
    chromeMock.tabs.removed = []
    openedDuringCheck.length = 0
    mostOpenAtOnce = 0
  })

  test("refuses a malformed publisher id without opening anything", async () => {
    const result = await verifySite({ url: "https://site.test/", publisherId: "zapub_short" })

    expect(result).toMatchObject({ success: false, method: null })
    expect(chromeMock.tabs.removed).toEqual([])
  })

  test("refuses an address that is not http(s)", async () => {
    const result = await verifySite({ url: "javascript:alert(1)", publisherId: PUBLISHER_ID })

    expect(result).toMatchObject({ success: false, method: null })
  })

  test("a matching response header proves control of the site", async () => {
    servePage({ header: PUBLISHER_ID, finalUrl: "https://www.site.test/" })

    const result = await verifySite({ url: "https://site.test/", publisherId: PUBLISHER_ID })

    expect(result).toEqual({ success: true, method: "header", finalUrl: "https://www.site.test/" })
  })

  test("a matching meta tag proves control when there is no header", async () => {
    servePage({ meta: PUBLISHER_ID })

    expect(await verifySite({ url: "https://site.test/", publisherId: PUBLISHER_ID })).toMatchObject({
      success: true,
      method: "meta",
    })
  })

  test("the id in the page content marks a platform the publisher doesn't control", async () => {
    servePage({ body: PUBLISHER_ID })

    expect(await verifySite({ url: "https://site.test/", publisherId: PUBLISHER_ID })).toMatchObject({
      success: true,
      method: "content",
    })
  })

  test("someone else's id proves nothing", async () => {
    servePage({ header: OTHER_ID, meta: OTHER_ID, body: OTHER_ID })

    const result = await verifySite({ url: "https://site.test/", publisherId: PUBLISHER_ID })

    expect(result).toMatchObject({ success: false, method: null })
    expect(result.error).toBeDefined()
  })

  test("closes the tab afterwards and marks it as a verification tab only while checking", async () => {
    // A content proof, so the page is actually read while the check runs
    servePage({ body: PUBLISHER_ID })

    await verifySite({ url: "https://site.test/", publisherId: PUBLISHER_ID })
    const tabId = chromeMock.tabs.removed[0]

    expect(chromeMock.tabs.removed).toHaveLength(1)
    expect(openedDuringCheck.length).toBeGreaterThan(0)
    expect(openedDuringCheck.every(Boolean)).toBe(true)
    expect(isVerificationTab(tabId)).toBe(false)
  })

  test("runs verifications one at a time, so a page cannot open tabs without limit", async () => {
    servePage({ body: PUBLISHER_ID })

    await Promise.all(
      Array.from({ length: 3 }, () => verifySite({ url: "https://site.test/", publisherId: PUBLISHER_ID }))
    )

    expect(mostOpenAtOnce).toBe(1)
    expect(chromeMock.tabs.removed).toHaveLength(3)
  })
})
