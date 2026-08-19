import { beforeEach, describe, expect, mock, test } from "bun:test"
import { classesOf, hrefOf, mountPopup, textOf, titleOf } from "../__fixtures__/dom"
import { $, applyBootstrapTheme, setVersion, updateUrls } from "./dom"

const SITE_URL = "https://zeroad.network"

beforeEach(() => {
  mountPopup()
})

describe("$", () => {
  test("collects every match", () => {
    expect($(".nav-item").elements).toHaveLength(2)
  })

  test("leaves an unmatched selector as a chain of no-ops rather than throwing", () => {
    // The popup renders whichever sections apply to the account and never matches the rest, so a
    // selector finding nothing is the normal case, not an error.
    const missing = $("#no-such-thing")

    expect(() =>
      missing
        .show()
        .hide()
        .toggle(true)
        .text("x")
        .replace({ A: "b" })
        .title("t")
        .href("/x")
        .toggleClass("c", true)
        .onClick(() => {})
    ).not.toThrow()

    expect(missing.elements).toEqual([])
    expect(missing.data("href")).toBeUndefined()
  })

  test("narrows a nested lookup to descendants of the current match", () => {
    expect($("li", $("#partner-features")).elements).toHaveLength(2)
    expect($("li").elements.length).toBeGreaterThan(2)
  })

  test("gathers descendants from every element of the outer match", () => {
    // Two `.nav-item`s, one anchor each - proof the outer selection is walked, not just its first element.
    expect($("a", $(".nav-item")).elements).toHaveLength(2)
  })

  test("narrows an empty match to an empty match", () => {
    expect($("li", $("#no-such-thing")).elements).toEqual([])
  })
})

describe("visibility", () => {
  test("show and hide flip the hidden attribute on every match", () => {
    $(".subscription-valid p").show()
    expect($(".subscription-valid p").elements.every((element) => !element.hidden)).toBe(true)

    $(".subscription-valid p").hide()
    expect($(".subscription-valid p").elements.every((element) => element.hidden)).toBe(true)
  })

  test("toggle reads its argument for truthiness, since command results arrive loosely typed", () => {
    const banner = () => $("#extension-paused").elements[0]

    for (const falsy of [false, undefined, null, 0, ""]) {
      $("#extension-paused").toggle(falsy)
      expect(banner()?.hidden).toBe(true)
    }

    for (const truthy of [true, 1, "no", {}]) {
      $("#extension-paused").toggle(truthy)
      expect(banner()?.hidden).toBe(false)
    }
  })
})

describe("text", () => {
  test("writes the value as text, never as markup", () => {
    $("#version").text("<b>1.2.3</b>")

    expect(textOf("#version")).toBe("<b>1.2.3</b>")
    expect($("#version b").elements).toEqual([])
  })
})

describe("replace", () => {
  test("substitutes the placeholder the template ships with", () => {
    setVersion("0.9.3")

    expect(textOf("#version")).toBe("Version 0.9.3")
  })

  test("substitutes every occurrence, not just the first", () => {
    document.body.innerHTML = '<p id="twice">{NAME} and {NAME}</p>'

    $("#twice").replace({ NAME: "Ada" })

    expect(textOf("#twice")).toBe("Ada and Ada")
  })

  test("leaves a placeholder it was given no value for alone", () => {
    document.body.innerHTML = '<p id="partial">{KNOWN} / {UNKNOWN}</p>'

    $("#partial").replace({ KNOWN: "yes" })

    expect(textOf("#partial")).toBe("yes / {UNKNOWN}")
  })

  test("writes the value as text, so a name with angle brackets cannot inject markup", () => {
    setVersion("<img src=x>")

    expect(textOf("#version")).toBe("Version <img src=x>")
    expect($("#version img").elements).toEqual([])
  })
})

describe("toggleClass", () => {
  test("adds and removes a single class", () => {
    $("#version").toggleClass("marked", true)
    expect(classesOf("#version")).toContain("marked")

    $("#version").toggleClass("marked", false)
    expect(classesOf("#version")).not.toContain("marked")
  })

  test("applies every class in a list", () => {
    $("#version").toggleClass(["a", "b"], true)
    expect(classesOf("#version")).toEqual(expect.arrayContaining(["a", "b"]))

    $("#version").toggleClass(["a", "b"], 0)
    expect(classesOf("#version")).not.toContain("a")
    expect(classesOf("#version")).not.toContain("b")
  })
})

describe("title", () => {
  test("sets the tooltip on every match", () => {
    $("#partner-features li").title("Not in your plan")

    expect($("#partner-features li").elements.map((element) => element.title)).toEqual([
      "Not in your plan",
      "Not in your plan",
    ])
  })
})

describe("onClick", () => {
  test("runs the handler and stops the default, which in a popup would be a navigation", () => {
    const handler = mock()
    $("#version").onClick(handler)

    const event = new window.MouseEvent("click", { bubbles: true, cancelable: true })
    $("#version").elements[0]?.dispatchEvent(event)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  test("binds every match", () => {
    const handler = mock()
    $("#partner-features li").onClick(handler)

    for (const element of $("#partner-features li").elements) element.click()

    expect(handler).toHaveBeenCalledTimes(2)
  })
})

describe("data", () => {
  test("reads a data-* value off the first match", () => {
    expect($("#report-site-btn").data("href")).toBe("/report/site")
  })

  test("returns undefined when the attribute is not there", () => {
    expect($("#report-site-btn").data("nothing")).toBeUndefined()
  })
})

describe("updateUrls", () => {
  test("resolves the template's site-relative links against the real site", () => {
    updateUrls(SITE_URL)

    expect(hrefOf(".navbar-brand")).toBe("https://zeroad.network/")
    expect(hrefOf("#link-pricing a")).toBe("https://zeroad.network/#features")
    expect(hrefOf("#choose-plan-btn")).toBe("https://zeroad.network/dashboard")
  })

  test("opens them in a new tab, since the popup itself is dismissed on click", () => {
    updateUrls(SITE_URL)

    expect(document.querySelectorAll<HTMLAnchorElement>("a[href]").length).toBeGreaterThan(0)
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      expect(anchor.target).toBe("_blank")
    }
  })

  test("resolves the report button's deferred destination too", () => {
    updateUrls(SITE_URL)

    expect($("#report-site-btn").data("href")).toBe("https://zeroad.network/report/site")
  })

  test("leaves an anchor with no href of its own without one", () => {
    // The report button is a button in disguise; its real destination is only known once the active
    // tab turns out to be a partner site. Handing it the home page here hides that it never got set.
    updateUrls(SITE_URL)

    expect(hrefOf("#report-site-btn")).toBeUndefined()
  })

  test("is safe to run twice", () => {
    updateUrls(SITE_URL)
    updateUrls(SITE_URL)

    expect(hrefOf("#link-pricing a")).toBe("https://zeroad.network/#features")
    expect($("#report-site-btn").data("href")).toBe("https://zeroad.network/report/site")
  })

  test("resolves against a base carrying a path, as the dev server's does not", () => {
    updateUrls("http://localhost:3000")

    expect(hrefOf("#choose-plan-btn")).toBe("http://localhost:3000/dashboard")
  })
})

describe("applyBootstrapTheme", () => {
  function stubColourScheme(prefersDark: boolean) {
    const listeners: (() => void)[] = []
    const query = {
      matches: prefersDark,
      addEventListener: (_event: string, listener: () => void) => void listeners.push(listener),
    }

    ;(window as unknown as { matchMedia: unknown }).matchMedia = () => query

    return {
      switchTo(dark: boolean) {
        query.matches = dark
        for (const listener of listeners) listener()
      },
    }
  }

  const theme = () => document.documentElement.getAttribute("data-bs-theme")

  test('resolves the template\'s "auto" against the OS preference', () => {
    stubColourScheme(true)

    applyBootstrapTheme()

    expect(theme()).toBe("dark")
  })

  test("resolves it the other way when the OS is light", () => {
    stubColourScheme(false)

    applyBootstrapTheme()

    expect(theme()).toBe("light")
  })

  test("follows the OS while the popup stays open", () => {
    const scheme = stubColourScheme(false)
    applyBootstrapTheme()

    scheme.switchTo(true)

    expect(theme()).toBe("dark")
  })

  test("leaves an explicitly authored theme as it is", () => {
    document.documentElement.setAttribute("data-bs-theme", "light")
    const scheme = stubColourScheme(true)

    applyBootstrapTheme()
    scheme.switchTo(true)

    expect(theme()).toBe("light")
  })
})

describe("the template the popup is written against", () => {
  // These are not assertions about `dom.ts` - they pin the markup its selectors rely on, so a
  // template edit that renames one of them fails here instead of silently rendering an empty popup.
  test("still carries every hook the popup code looks for", () => {
    for (const selector of [
      "#version",
      "#extension-paused",
      "#link-pricing",
      "#debug-menu",
      "#report-site-btn",
      "#partner-features",
      "#developer-details",
      "#subscription-label span",
      "#client-id-label span",
      "#pause-btn",
      "#resume-btn",
      ".guest",
      ".user.greeting",
      ".subscription-valid",
      ".subscription-expired",
      ".valid-until",
    ]) {
      expect({ selector, found: $(selector).elements.length > 0 }).toEqual({ selector, found: true })
    }
  })

  test("starts with everything conditional hidden", () => {
    for (const selector of [".guest", ".user.subscribed", "#partner-features", "#debug-menu", "#extension-paused"]) {
      expect({ selector, hidden: $(selector).elements.every((element) => element.hidden) }).toEqual({
        selector,
        hidden: true,
      })
    }
  })

  test("carries the version placeholder setVersion substitutes", () => {
    expect(textOf("#version")).toContain("{VERSION}")
  })
})

describe("titleOf", () => {
  test("is empty on a freshly rendered feature row", () => {
    expect(titleOf("#partner-features li.clean_web")).toBe("")
  })
})
