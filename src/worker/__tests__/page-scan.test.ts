import { beforeEach, describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { chromeMock } from "../../__fixtures__/chrome"
import { readBodyPublisherId, readMetaPublisherValue } from "../page-scan"

const PUBLISHER_ID = "zapub_7Fq2xR9nKdW3mB6tYp1sVzAe"

type Injection = { func: (...args: string[]) => unknown; args: string[] }

/** Runs the injected reader against `html`, the way `chrome.scripting` would run it in the tab. */
function loadPage(html: string) {
  const window = new Window({ url: "https://publisher.test/" })
  window.document.write(html)
  ;(globalThis as unknown as { document: unknown }).document = window.document

  chromeMock.scripting.executeScript = async (injection: unknown) => {
    const { func, args } = injection as Injection
    return [{ result: func(...args) as string | undefined }]
  }
}

describe("readMetaPublisherValue", () => {
  test("reads the publisher meta tag, whatever the case of its name, trimmed", async () => {
    loadPage(`<html><head><meta name="Better-Web-Publisher" content="  ${PUBLISHER_ID} "></head></html>`)

    expect(await readMetaPublisherValue(1)).toBe(PUBLISHER_ID)
  })

  test("returns undefined for a page without one", async () => {
    loadPage(`<html><head><meta name="description" content="${PUBLISHER_ID}"></head></html>`)

    expect(await readMetaPublisherValue(1)).toBeUndefined()
  })
})

describe("readBodyPublisherId", () => {
  test("returns the id printed in the page, as it appears", async () => {
    loadPage(`<html><body><p>Support me: ${PUBLISHER_ID}</p></body></html>`)

    expect(await readBodyPublisherId(1)).toBe(PUBLISHER_ID)
  })

  test("honours only the topmost id, so one appended below cannot hijack the page", async () => {
    const intruder = "zapub_AbCdEfGhIjKlMnOpQrStUvWx"
    loadPage(`<html><body><p>${PUBLISHER_ID}</p><p>comment: ${intruder}</p></body></html>`)

    expect(await readBodyPublisherId(1)).toBe(PUBLISHER_ID)
  })

  test("returns undefined when the page prints no id", async () => {
    loadPage("<html><body><p>Nothing to see</p></body></html>")

    expect(await readBodyPublisherId(1)).toBeUndefined()
  })
})

describe("an unscriptable page", () => {
  beforeEach(() => {
    chromeMock.scripting.executeScript = async () => {
      throw new Error("Cannot access contents of the page")
    }
  })

  test("reads as nothing rather than throwing", async () => {
    expect(await readMetaPublisherValue(1)).toBeUndefined()
    expect(await readBodyPublisherId(1)).toBeUndefined()
  })
})
