import { describe, expect, mock, test } from "bun:test"
import { chromeMock } from "../../__fixtures__/chrome"

// What a freshly started worker finds: a development install, and a session rule installed by the worker
// before it - session rules last until the browser restarts, the worker's memory does not.
chromeMock.management.installType = "development"
chromeMock.declarativeNetRequest.sessionRules = [{ id: 107, condition: { urlFilter: "|https://earlier.test^" } }]

mock.module("../extension", () => ({
  extension: () => ({ ready: Promise.resolve(), isSubscriptionActive: () => true, isPaused: () => false }),
}))
mock.module("../token-pool", () => ({
  tokenPool: () => ({ tokenFor: async (hostname: string) => `token-for-${hostname}`, boundHostnames: async () => [] }),
}))

const { headerInjection } = await import("../header-injection")

const ruleFor = (hostname: string) =>
  chromeMock.declarativeNetRequest.sessionRules.find((rule) => rule.condition?.urlFilter?.includes(`//${hostname}^`))

describe("headerInjection after a worker restart", () => {
  test("knows the rules an earlier worker installed, so it can take them down one by one", async () => {
    await headerInjection().removeRuleForHostname("earlier.test")

    expect(ruleFor("earlier.test")).toBeUndefined()
  })

  test("never hands a new rule an id an earlier worker's rule still holds", async () => {
    chromeMock.declarativeNetRequest.sessionRules.push({ id: 107, condition: { urlFilter: "|https://earlier.test^" } })

    const ruleId = await headerInjection().enableForHostname("new.test")

    expect(ruleId).toBeGreaterThan(107)
    expect(ruleFor("earlier.test")).toBeDefined()
  })

  test("a development build also sends the token over http, for the locally served demo site", async () => {
    await headerInjection().enableForHostname("localhost")

    expect(ruleFor("localhost")?.condition?.urlFilter).toBe("|http*://localhost^")
  })
})
