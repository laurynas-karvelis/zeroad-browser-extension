import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { chromeMock } from "../__fixtures__/chrome"
import { classesOf, click, hrefOf, isShown, mountPopup, shownCount, textOf, titleOf } from "../__fixtures__/dom"
import { EVENT } from "../worker/event-broker"
import type { TabTrackActiveTabEventData } from "../worker/tab-tracker"
import type { Entry } from "../worker/telemetry"
import { SUBSCRIPTION_PLAN_NAME, type SubscriptionExtensionData, type UserExtensionData } from "../worker/types"
import { updateUrls } from "./dom"
import { UserState } from "./state"

const SITE_URL = "https://zeroad.network"
const DAY = 24 * 60 * 60 * 1000

const member: UserExtensionData = { firstName: "Ada", refreshToken: "refresh-token" }

function subscription(overrides: Partial<SubscriptionExtensionData> = {}): SubscriptionExtensionData {
  return {
    planName: SUBSCRIPTION_PLAN_NAME.CLEAN_WEB,
    extensionToken: "extension-token",
    telemetryToken: "telemetry-token",
    expiresAt: Date.now() + 20 * DAY,
    ...overrides,
  }
}

function partnerEntry(overrides: Partial<Entry> = {}): Entry {
  return { clientId: "client-id", features: ["CLEAN_WEB"], views: 1, duration: 0, ...overrides }
}

/** Delivers the event the worker pushes at the popup whenever the focused tab changes. */
function activeTabChangedTo(data: TabTrackActiveTabEventData) {
  return chromeMock.runtime.onMessage.dispatch({ event: EVENT.MESSAGING.IS_ACTIVE_TAB_PARTNER, data }, {}, () => {})
}

const commandsSent = () => chromeMock.runtime.sentMessages.map((message) => (message as { command: string }).command)

/** Lets a click handler's promise chain run out - nothing hands its promise back to the test. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

let logged: ReturnType<typeof spyOn>

beforeEach(() => {
  mountPopup()
  // popup.ts always absolutises the template's links before rendering, and the report button's
  // destination is built on top of that - rendering without it is not a state the popup can be in.
  updateUrls(SITE_URL)

  chromeMock.runtime.onMessage.clear()
  chromeMock.runtime.sentMessages = []
  chromeMock.runtime.sendMessageResponse = undefined
  chromeMock.runtime.sendMessageResponses = {}
  chromeMock.runtime.lastError = undefined

  logged = spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  logged.mockRestore()
})

describe("a guest", () => {
  test("sees the sign-up pitch and none of the member copy", async () => {
    await new UserState().render()

    expect(isShown(".guest.greeting")).toBe(true)
    expect(isShown("a.guest.btn")).toBe(true)
    expect(isShown(".user.not-subscribed.greeting")).toBe(false)
    expect(isShown(".user.subscribed")).toBe(false)
  })

  test("is anyone without a refresh token, not just a missing user record", async () => {
    await new UserState({ firstName: "Ada", refreshToken: "" }).render()

    expect(isShown(".guest.greeting")).toBe(true)
  })

  test("costs the worker nothing - no commands are sent for a signed-out popup", async () => {
    await new UserState().render()

    expect(commandsSent()).toEqual([])
  })
})

describe("a member without a subscription", () => {
  test("is greeted by name and pushed towards a plan", async () => {
    await new UserState(member, undefined).render()

    expect(textOf(".user.not-subscribed.greeting")).toBe("Hi Ada,")
    expect(isShown("a.user.not-subscribed.btn")).toBe(true)
    expect(isShown("a.guest.btn")).toBe(false)
  })

  test('falls back to "Member" when the account carries no first name', async () => {
    await new UserState({ firstName: null, refreshToken: "refresh-token" }, undefined).render()

    expect(textOf(".user.not-subscribed.greeting")).toBe("Hi Member,")
  })

  test("never sees the partner or developer sections, which live inside the subscribed block", async () => {
    await new UserState(member, undefined).render()
    await activeTabChangedTo({ isPartner: true, url: "https://news.example/a", telemetryEntry: partnerEntry() })

    expect(isShown("#partner-features")).toBe(false)
    expect(isShown("#report-site-btn")).toBe(false)
  })
})

describe("a member with an active subscription", () => {
  test("sees the paragraph for their own plan and no other", async () => {
    await new UserState(member, subscription({ planName: SUBSCRIPTION_PLAN_NAME.ONE_PASS })).render()

    expect(isShown("p.one-pass")).toBe(true)
    expect(shownCount(".subscription-valid > p")).toBe(1)
  })

  test("is told how long is left, phrased without a suffix", async () => {
    await new UserState(member, subscription({ expiresAt: Date.now() + 20 * DAY })).render()

    expect(textOf(".valid-until")).toBe("20 days")
  })

  test("loses the pricing link, having already chosen", async () => {
    await new UserState(member, subscription()).render()

    expect(isShown("#link-pricing")).toBe(false)
  })

  test("has their plan named in the developer badge", async () => {
    await new UserState(member, subscription({ planName: SUBSCRIPTION_PLAN_NAME.FREEDOM })).render()

    expect(textOf("#subscription-label span")).toBe("Freedom")
  })

  test("does not see the expiry notice", async () => {
    await new UserState(member, subscription()).render()

    expect(isShown(".subscription-expired")).toBe(false)
    expect(isShown(".subscription-valid")).toBe(true)
  })

  test("is not shown a stray line describing a plan they did not buy", async () => {
    // The Freedom paragraph used to carry a nested <p>, which the HTML parser closes the outer one
    // to open - hoisting that sentence out of the hidden block and onto every subscriber's popup.
    await new UserState(member, subscription({ planName: SUBSCRIPTION_PLAN_NAME.CLEAN_WEB })).render()

    const shownText = [...document.querySelectorAll<HTMLElement>(".subscription-valid *")]
      .filter((element) => !element.closest("[hidden]"))
      .map((element) => element.innerText)
      .join(" ")

    expect(shownText).not.toContain("paywalls")
  })
})

describe("a member whose token has expired", () => {
  test("gets the expiry notice instead of a countdown", async () => {
    await new UserState(member, subscription({ expiresAt: Date.now() - DAY })).render()

    expect(isShown(".subscription-expired")).toBe(true)
    expect(isShown(".subscription-valid")).toBe(false)
    expect(textOf(".valid-until")).toBe("")
  })

  test("is still a subscriber as far as the rest of the popup is concerned", async () => {
    await new UserState(member, subscription({ expiresAt: Date.now() - DAY })).render()

    expect(isShown(".user.subscribed")).toBe(true)
    expect(commandsSent()).toContain(EVENT.POPUP.IS_EXTENSION_PAUSED)
  })

  test("counts an expiry landing on this very moment as expired", async () => {
    await new UserState(member, subscription({ expiresAt: Date.now() - 1 })).render()

    expect(isShown(".subscription-expired")).toBe(true)
  })
})

describe("a developer token", () => {
  test("reveals the client id it is scoped to", async () => {
    await new UserState(member, subscription({ clientId: "acme-client-id" })).render()

    expect(isShown("#developer-details")).toBe(true)
    expect(textOf("#client-id-label span")).toBe("acme-client-id")
  })

  test("stays hidden for an ordinary subscriber", async () => {
    await new UserState(member, subscription()).render()

    expect(isShown("#developer-details")).toBe(false)
  })
})

describe("the pause control", () => {
  test("offers Pause and no banner while the extension is running", async () => {
    chromeMock.runtime.sendMessageResponses = { [EVENT.POPUP.IS_EXTENSION_PAUSED]: false }

    await new UserState(member, subscription()).render()

    expect(isShown("#pause-btn")).toBe(true)
    expect(isShown("#resume-btn")).toBe(false)
    expect(isShown("#extension-paused")).toBe(false)
  })

  test("offers Resume and warns loudly while it is paused", async () => {
    chromeMock.runtime.sendMessageResponses = { [EVENT.POPUP.IS_EXTENSION_PAUSED]: true }

    await new UserState(member, subscription()).render()

    expect(isShown("#resume-btn")).toBe(true)
    expect(isShown("#pause-btn")).toBe(false)
    expect(isShown("#extension-paused")).toBe(true)
  })

  test("swaps the buttons over once a pause has actually landed", async () => {
    chromeMock.runtime.sendMessageResponses = { [EVENT.POPUP.IS_EXTENSION_PAUSED]: false }
    await new UserState(member, subscription()).render()

    chromeMock.runtime.sendMessageResponses = { [EVENT.POPUP.IS_EXTENSION_PAUSED]: true }
    click("#pause-btn")
    await settle()

    expect(commandsSent()).toContain(EVENT.POPUP.EXTENSION_PAUSE_REQUEST)
    expect(isShown("#resume-btn")).toBe(true)
    expect(isShown("#extension-paused")).toBe(true)
  })

  test("swaps them back on resume", async () => {
    chromeMock.runtime.sendMessageResponses = { [EVENT.POPUP.IS_EXTENSION_PAUSED]: true }
    await new UserState(member, subscription()).render()

    chromeMock.runtime.sendMessageResponses = { [EVENT.POPUP.IS_EXTENSION_PAUSED]: false }
    click("#resume-btn")
    await settle()

    expect(commandsSent()).toContain(EVENT.POPUP.EXTENSION_RESUME_REQUEST)
    expect(isShown("#pause-btn")).toBe(true)
    expect(isShown("#extension-paused")).toBe(false)
  })

  test("shows neither button rather than a wrong one when the worker cannot answer", async () => {
    // The worker answers a failed handler with `{ error }`, which is an object and therefore truthy.
    // Read as a plain result that would mean "paused" - offering Resume and a warning banner to a
    // user whose extension is running perfectly well.
    chromeMock.runtime.sendMessageResponses = { [EVENT.POPUP.IS_EXTENSION_PAUSED]: { error: "Storage unavailable" } }

    await new UserState(member, subscription()).render()

    expect(isShown("#resume-btn")).toBe(false)
    expect(isShown("#pause-btn")).toBe(false)
    expect(isShown("#extension-paused")).toBe(false)
  })
})

describe("the partner site section", () => {
  const subscribed = (planName = SUBSCRIPTION_PLAN_NAME.CLEAN_WEB) =>
    new UserState(member, subscription({ planName })).render()

  test("stays out of the way on a site that is not a partner", async () => {
    await subscribed()

    await activeTabChangedTo({ isPartner: false, url: "https://example.com", telemetryEntry: undefined })

    expect(isShown("#partner-features")).toBe(false)
    expect(isShown("#report-site-btn")).toBe(false)
  })

  test("lists what the site offers once the worker says the tab is a partner", async () => {
    await subscribed()

    await activeTabChangedTo({
      isPartner: true,
      url: "https://news.example/story",
      telemetryEntry: partnerEntry({ features: ["CLEAN_WEB"] }),
    })

    expect(isShown("#partner-features")).toBe(true)
    expect(isShown("#partner-features li.clean_web")).toBe(true)
    expect(isShown("#partner-features li.one_pass")).toBe(false)
  })

  test("leaves a feature the plan covers plain and untitled", async () => {
    await subscribed(SUBSCRIPTION_PLAN_NAME.CLEAN_WEB)

    await activeTabChangedTo({
      isPartner: true,
      url: "https://news.example/story",
      telemetryEntry: partnerEntry({ features: ["CLEAN_WEB"] }),
    })

    expect(classesOf("#partner-features li.clean_web")).not.toContain("text-decoration-line-through")
    expect(titleOf("#partner-features li.clean_web")).toBe("")
  })

  test("strikes through what the site offers but the plan does not buy, and says why", async () => {
    await subscribed(SUBSCRIPTION_PLAN_NAME.CLEAN_WEB)

    await activeTabChangedTo({
      isPartner: true,
      url: "https://news.example/story",
      telemetryEntry: partnerEntry({ features: ["CLEAN_WEB", "ONE_PASS"] }),
    })

    expect(classesOf("#partner-features li.one_pass")).toContain("text-decoration-line-through")
    expect(titleOf("#partner-features li.one_pass")).toBe("This feature isn't included in your plan")
    expect(classesOf("#partner-features li.clean_web")).not.toContain("text-decoration-line-through")
  })

  test("strikes nothing through on the plan that buys everything", async () => {
    await subscribed(SUBSCRIPTION_PLAN_NAME.FREEDOM)

    await activeTabChangedTo({
      isPartner: true,
      url: "https://news.example/story",
      telemetryEntry: partnerEntry({ features: ["CLEAN_WEB", "ONE_PASS"] }),
    })

    expect(shownCount("#partner-features li")).toBe(2)
    expect(classesOf("#partner-features li.one_pass")).not.toContain("text-decoration-line-through")
  })

  test("drops a row that the previous tab had and this one does not", async () => {
    // The popup stays open while the user switches tabs, so each event has to re-describe the site
    // from scratch rather than add to what the last one left behind.
    await subscribed(SUBSCRIPTION_PLAN_NAME.FREEDOM)

    await activeTabChangedTo({
      isPartner: true,
      url: "https://both.example",
      telemetryEntry: partnerEntry({ features: ["CLEAN_WEB", "ONE_PASS"] }),
    })
    await activeTabChangedTo({
      isPartner: true,
      url: "https://clean.example",
      telemetryEntry: partnerEntry({ features: ["CLEAN_WEB"] }),
    })

    expect(isShown("#partner-features li.clean_web")).toBe(true)
    expect(isShown("#partner-features li.one_pass")).toBe(false)
  })

  test("ignores a feature the popup has no row for, rather than breaking the rest", async () => {
    // The site declares features; a site running ahead of the installed extension can name one it
    // has never heard of.
    await subscribed(SUBSCRIPTION_PLAN_NAME.FREEDOM)

    await activeTabChangedTo({
      isPartner: true,
      url: "https://ahead.example",
      telemetryEntry: partnerEntry({
        features: ["CLEAN_WEB", "SOMETHING_NEW"] as Entry["features"],
      }),
    })

    expect(isShown("#partner-features li.clean_web")).toBe(true)
    expect(shownCount("#partner-features li")).toBe(1)
  })

  test("points Report at the site being reported, client id and page url and all", async () => {
    await subscribed()

    await activeTabChangedTo({
      isPartner: true,
      url: "https://news.example/story?ref=a b",
      telemetryEntry: partnerEntry({ clientId: "acme/client" }),
    })

    const href = new URL(hrefOf("#report-site-btn") as string)

    expect(href.origin).toBe(SITE_URL)
    expect(href.pathname).toBe("/report/site/acme%2Fclient")
    expect(href.searchParams.get("url")).toBe("https://news.example/story?ref=a b")
  })

  test("re-points Report when the user moves to a different partner site", async () => {
    await subscribed()

    await activeTabChangedTo({
      isPartner: true,
      url: "https://first.example/",
      telemetryEntry: partnerEntry({ clientId: "first" }),
    })
    await activeTabChangedTo({
      isPartner: true,
      url: "https://second.example/",
      telemetryEntry: partnerEntry({ clientId: "second" }),
    })

    expect(hrefOf("#report-site-btn")).toContain("/report/site/second")
    expect(hrefOf("#report-site-btn")).not.toContain("first")
  })

  test("leaves Report without a destination rather than one pointing at the home page", async () => {
    // `data-href` is the only thing that says where reports go; without it there is nothing to build.
    document.querySelector("#report-site-btn")?.removeAttribute("data-href")
    await subscribed()

    await activeTabChangedTo({
      isPartner: true,
      url: "https://news.example/story",
      telemetryEntry: partnerEntry(),
    })

    expect(hrefOf("#report-site-btn")).toBeUndefined()
  })

  test("asks the worker which tab is active once the section is wired up", async () => {
    await subscribed()

    expect(commandsSent()).toContain(EVENT.POPUP.CHECK_IF_ACTIVE_TAB_PARTNER_REQUEST)
  })
})

describe("when the worker cannot be reached at all", () => {
  beforeEach(() => {
    chromeMock.runtime.lastError = { message: "Could not establish connection" }
  })

  test("still renders what it knows, instead of rejecting into nothing", async () => {
    await expect(new UserState(member, subscription()).render()).resolves.toBeUndefined()

    expect(isShown(".user.subscribed")).toBe(true)
    expect(isShown(".subscription-valid")).toBe(true)
    expect(textOf(".valid-until")).toBe("20 days")
  })

  test("leaves a trace of why the rest is missing", async () => {
    await new UserState(member, subscription()).render()

    expect(logged).toHaveBeenCalled()
  })
})
