import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { chromeMock } from "../../__fixtures__/chrome"
import { click, hrefOf, isShown, mountPopup, shownCount, textOf } from "../../__fixtures__/dom"
import { EVENT } from "../../worker/event-broker"
import type { TabTrackActiveTabEventData } from "../../worker/tab-tracker"
import type { Entry } from "../../worker/telemetry"
import { SUBSCRIPTION_PLAN_NAME, type SubscriptionExtensionData, type UserExtensionData } from "../../worker/types"
import { updateUrls } from "../dom"
import { UserState } from "../state"

const SITE_URL = "https://zeroad.network"
const DAY = 24 * 60 * 60 * 1000

const member: UserExtensionData = { firstName: "Ada", extensionToken: "refresh-token" }

function subscription(overrides: Partial<SubscriptionExtensionData> = {}): SubscriptionExtensionData {
  return {
    planName: SUBSCRIPTION_PLAN_NAME.FREEDOM,
    expiresAt: Date.now() + 20 * DAY,
    ...overrides,
  }
}

function publisherEntry(overrides: Partial<Entry> = {}): Entry {
  return { publisherId: "publisher-id", source: "header", views: 1, duration: 0, ...overrides }
}

/** Delivers the event the worker pushes at the popup whenever the focused tab changes. */
function activeTabChangedTo(data: TabTrackActiveTabEventData) {
  return chromeMock.runtime.onMessage.dispatch({ event: EVENT.MESSAGING.IS_ACTIVE_TAB_PUBLISHER, data }, {}, () => {})
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
    expect(isShown("a.guest.btn-solid")).toBe(true)
    expect(isShown(".user.not-subscribed.greeting")).toBe(false)
    expect(isShown(".user.subscribed")).toBe(false)
  })

  test("is anyone without a refresh token, not just a missing user record", async () => {
    await new UserState({ firstName: "Ada", extensionToken: "" }).render()

    expect(isShown(".guest.greeting")).toBe(true)
  })

  test("costs the worker nothing - no commands are sent for a signed-out popup", async () => {
    await new UserState().render()

    expect(commandsSent()).toEqual([])
  })
})

describe("a member without a subscription", () => {
  test("uses the dashboard membership heading and offers a plan", async () => {
    await new UserState(member, undefined).render()

    expect(textOf(".user.not-subscribed.greeting")).toBe("Freedom membership")
    expect(isShown("a.user.not-subscribed.btn-solid")).toBe(true)
    expect(isShown("a.guest.btn-solid")).toBe(false)
  })

  test("never sees the publisher or developer sections, which live inside the subscribed block", async () => {
    await new UserState(member, undefined).render()
    await activeTabChangedTo({ isPublisher: true, url: "https://news.example/a", telemetryEntry: publisherEntry() })

    expect(isShown("#publisher-site")).toBe(false)
    expect(isShown("#report-site-btn")).toBe(false)
  })
})

describe("a member with an active subscription", () => {
  test("sees the paragraph for their own plan and no other", async () => {
    await new UserState(member, subscription({ planName: SUBSCRIPTION_PLAN_NAME.FREEDOM })).render()

    expect(isShown(".subscription-valid .freedom")).toBe(true)
    expect(shownCount(".subscription-valid > div")).toBe(1)
  })

  test("is told how long is left, phrased without a suffix", async () => {
    await new UserState(member, subscription({ expiresAt: Date.now() + 20 * DAY })).render()

    expect(textOf(".valid-until")).toBe("20 days")
  })

  test("loses the pricing link, having already chosen", async () => {
    await new UserState(member, subscription()).render()

    expect(isShown("#link-pricing")).toBe(false)
  })

  test("has their plan named in the membership heading", async () => {
    await new UserState(member, subscription({ planName: SUBSCRIPTION_PLAN_NAME.FREEDOM })).render()

    expect(textOf("#access-title")).toBe("Freedom membership")
  })

  test("does not see the expiry notice", async () => {
    await new UserState(member, subscription()).render()

    expect(isShown(".subscription-expired")).toBe(false)
    expect(isShown(".subscription-valid")).toBe(true)
  })

  test("only contains Freedom membership details", async () => {
    await new UserState(member, subscription()).render()

    const content = document.querySelector(".user.subscribed")

    if (!content) throw new Error("Missing membership details")

    expect(content.textContent).toContain("Freedom")
    expect(content.textContent).not.toContain("Clean Web")
    expect(content.textContent).not.toContain("One Pass")
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
  test("reveals the site it is scoped to", async () => {
    await new UserState(member, subscription({ hostname: "acme.example" })).render()

    expect(isShown("#developer-details")).toBe(true)
    expect(textOf("#developer-hostname-label span")).toBe("acme.example")
    expect(textOf("#access-title")).toBe("Test access")
  })

  test("labels demo access separately from a paid membership", async () => {
    await new UserState(
      { firstName: null, extensionToken: "demo" },
      subscription({ hostname: "demo.example" })
    ).render()

    expect(textOf("#access-title")).toBe("Demo access")
    expect(isShown("#stop-testing-btn")).toBe(false)
  })

  test("does not ask a test user to pay when scoped access expires", async () => {
    await new UserState(member, subscription({ hostname: "test.example", expiresAt: Date.now() - DAY }), true).render()

    expect(isShown(".subscription-expired")).toBe(true)
    expect(isShown("#membership-expired-details")).toBe(false)
    expect(isShown("#stop-testing-btn")).toBe(true)
  })

  test("stays hidden for an ordinary subscriber", async () => {
    await new UserState(member, subscription()).render()

    expect(isShown("#developer-details")).toBe(false)
  })
})

test("offers Stop testing only for explicit website test access", async () => {
  await new UserState(member, subscription({ hostname: "publisher.test" }), true).render()

  expect(isShown("#stop-testing-btn")).toBe(true)
  click("#stop-testing-btn")
  await settle()

  expect(commandsSent()).toContain(EVENT.POPUP.STOP_TESTING)
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

  test("keeps the previous state and lets the user retry a failed pause", async () => {
    chromeMock.runtime.sendMessageResponses = { [EVENT.POPUP.IS_EXTENSION_PAUSED]: false }
    await new UserState(member, subscription()).render()

    chromeMock.runtime.sendMessageResponses[EVENT.POPUP.EXTENSION_PAUSE_REQUEST] = { error: "Storage unavailable" }
    click("#pause-btn")
    await settle()

    expect(isShown("#popup-error")).toBe(true)
    expect(isShown("#pause-btn")).toBe(true)
    expect(document.querySelector<HTMLButtonElement>("#pause-btn")?.disabled).toBe(false)
    expect(isShown("#extension-paused")).toBe(false)

    chromeMock.runtime.sendMessageResponses = { [EVENT.POPUP.IS_EXTENSION_PAUSED]: true }
    click("#pause-btn")
    await settle()

    expect(isShown("#popup-error")).toBe(false)
    expect(isShown("#resume-btn")).toBe(true)
  })

  test("prevents repeated clicks while the pause command is pending", async () => {
    chromeMock.runtime.sendMessageResponses = { [EVENT.POPUP.IS_EXTENSION_PAUSED]: false }
    await new UserState(member, subscription()).render()

    let complete: ((response: unknown) => void) | undefined
    const sendMessage = spyOn(chromeMock.runtime, "sendMessage").mockImplementation((_message, callback) => {
      complete = callback
    })

    try {
      click("#pause-btn")
      click("#pause-btn")

      expect(sendMessage).toHaveBeenCalledTimes(1)
      expect(document.querySelector<HTMLButtonElement>("#pause-btn")?.disabled).toBe(true)

      sendMessage.mockRestore()
      complete?.(undefined)
      await settle()

      expect(document.querySelector<HTMLButtonElement>("#pause-btn")?.disabled).toBe(false)
    } finally {
      sendMessage.mockRestore()
    }
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

describe("the publisher site section", () => {
  const subscribed = (planName = SUBSCRIPTION_PLAN_NAME.FREEDOM) =>
    new UserState(member, subscription({ planName })).render()

  test("stays out of the way on a site that is not a publisher", async () => {
    await subscribed()

    await activeTabChangedTo({ isPublisher: false, url: "https://example.com", telemetryEntry: undefined })

    expect(isShown("#publisher-site")).toBe(false)
    expect(isShown("#report-site-btn")).toBe(false)
  })

  test("identifies the participating website without repeating plan features", async () => {
    await subscribed()

    await activeTabChangedTo({
      isPublisher: true,
      url: "https://news.example/story",
      telemetryEntry: publisherEntry(),
    })

    expect(isShown("#publisher-site")).toBe(true)
    expect(textOf("#publisher-hostname")).toBe("news.example")
    expect(document.querySelector("#publisher-site ul")).toBeNull()
  })

  test("distinguishes creator content and updates when moving to a website", async () => {
    await subscribed()

    await activeTabChangedTo({
      isPublisher: true,
      url: "https://platform.example/watch?id=42",
      telemetryEntry: publisherEntry({ source: "content" }),
    })

    expect(textOf("#publisher-kind")).toBe("Creator integration")
    expect(new URL(hrefOf("#report-site-btn") as string).searchParams.get("url")).toBe(
      "https://platform.example/watch?id=42"
    )

    await activeTabChangedTo({
      isPublisher: true,
      url: "https://news.example/story",
      telemetryEntry: publisherEntry({ source: "meta" }),
    })

    expect(textOf("#publisher-kind")).toBe("Website integration")
    expect(textOf("#publisher-hostname")).toBe("news.example")
  })

  test("clears the site context when moving away from a publisher", async () => {
    await subscribed()

    await activeTabChangedTo({
      isPublisher: true,
      url: "https://news.example/story",
      telemetryEntry: publisherEntry(),
    })
    await activeTabChangedTo({ isPublisher: false, url: "https://example.com", telemetryEntry: undefined })

    expect(isShown("#publisher-site")).toBe(false)
    expect(isShown("#report-site-btn")).toBe(false)
  })

  test("points Report at the site being reported, hostname and page url and all", async () => {
    // Sites are addressed by hostname now, and the hostname is right there in the url being viewed
    await subscribed()

    await activeTabChangedTo({
      isPublisher: true,
      url: "https://news.example/story?ref=a b",
      telemetryEntry: publisherEntry(),
    })

    const href = new URL(hrefOf("#report-site-btn") as string)

    expect(href.origin).toBe(SITE_URL)
    expect(href.pathname).toBe("/report/site/news.example")
    expect(href.searchParams.get("url")).toBe("https://news.example/story?ref=a b")
    expect(href.searchParams.get("publisherId")).toBe("publisher-id")
  })

  test("re-points Report when the user moves to a different publisher site", async () => {
    await subscribed()

    await activeTabChangedTo({
      isPublisher: true,
      url: "https://first.example/",
      telemetryEntry: publisherEntry(),
    })
    await activeTabChangedTo({
      isPublisher: true,
      url: "https://second.example/",
      telemetryEntry: publisherEntry(),
    })

    expect(textOf("#publisher-hostname")).toBe("second.example")
    expect(hrefOf("#report-site-btn")).toContain("/report/site/second.example")
    expect(hrefOf("#report-site-btn")).not.toContain("first.example")
  })

  test("leaves Report without a destination rather than one pointing at the home page", async () => {
    // `data-href` is the only thing that says where reports go; without it there is nothing to build.
    document.querySelector("#report-site-btn")?.removeAttribute("data-href")
    await subscribed()

    await activeTabChangedTo({
      isPublisher: true,
      url: "https://news.example/story",
      telemetryEntry: publisherEntry(),
    })

    expect(hrefOf("#report-site-btn")).toBeUndefined()
  })

  test("asks the worker which tab is active once the section is wired up", async () => {
    await subscribed()

    expect(commandsSent()).toContain(EVENT.POPUP.CHECK_IF_ACTIVE_TAB_PUBLISHER_REQUEST)
  })
})

describe("when the worker cannot be reached at all", () => {
  beforeEach(() => {
    chromeMock.runtime.lastError = { message: "Could not establish connection" }
  })

  test("still renders what it knows, instead of rejecting into nothing", async () => {
    await expect(new UserState(member, subscription()).render()).resolves.toBeUndefined()

    expect(isShown("#popup-loading")).toBe(false)
    expect(isShown("#popup-error")).toBe(true)
    expect(isShown(".user.subscribed")).toBe(true)
    expect(isShown(".subscription-valid")).toBe(true)
    expect(textOf(".valid-until")).toBe("20 days")
  })

  test("leaves a trace of why the rest is missing", async () => {
    await new UserState(member, subscription()).render()

    expect(logged).toHaveBeenCalled()
  })
})
