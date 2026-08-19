// A real DOM for the popup tests, built from the very template the extension ships.
//
// `popup.pug` is compiled here rather than copied into a fixture string, so a selector in
// `dom.ts`/`state.ts` that stops matching the markup fails a test instead of silently doing
// nothing - which is exactly how the `$` wrapper behaves in production.

import { Window } from "happy-dom"
import pug from "pug"

const TEMPLATE_PATH = new URL("../popup/popup.pug", import.meta.url).pathname

// Compiling pug is the slow part, so it happens once and every mount re-parses the same HTML.
let templateHtml: string | undefined

/** Replaces the global `window`/`document` with a freshly rendered popup. Call from `beforeEach`. */
export function mountPopup() {
  templateHtml ??= pug.renderFile(TEMPLATE_PATH, { pretty: true })

  const window = new Window({ url: "chrome-extension://test-extension-id/popup.html" })
  window.document.write(templateHtml)

  const globals = globalThis as unknown as Record<string, unknown>
  globals.window = window
  globals.document = window.document

  for (const name of ["HTMLElement", "Element", "Node", "Event", "CustomEvent", "MouseEvent"]) {
    globals[name] = (window as unknown as Record<string, unknown>)[name]
  }

  return window
}

function first(selector: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(selector)
}

/**
 * Whether the user can actually see the first match. Ancestors count: the template nests the
 * partner and developer sections inside `.user.subscribed`, so un-hiding one of them means
 * nothing while that wrapper is still hidden.
 */
export function isShown(selector: string): boolean {
  let element = first(selector)
  if (!element) return false

  while (element) {
    if (element.hidden) return false
    element = element.parentElement
  }

  return true
}

/** Same question asked of every match, so "all three plan paragraphs are hidden" is one assertion. */
export function shownCount(selector: string): number {
  return [...document.querySelectorAll<HTMLElement>(selector)].filter((element) => {
    let node: HTMLElement | null = element
    while (node) {
      if (node.hidden) return false
      node = node.parentElement
    }
    return true
  }).length
}

export function textOf(selector: string): string | undefined {
  return first(selector)?.innerText
}

export function classesOf(selector: string): string[] {
  return [...(first(selector)?.classList ?? [])]
}

export function titleOf(selector: string): string | undefined {
  return first(selector)?.title
}

export function hrefOf(selector: string): string | undefined {
  return first(selector)?.getAttribute("href") ?? undefined
}

export function click(selector: string) {
  first(selector)?.click()
}
