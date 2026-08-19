import { beforeEach, describe, expect, mock, test } from "bun:test"
import { CLIENT_HEADER } from "@zeroad.network/token/browser"
import { chromeMock } from "../__fixtures__/chrome"

const state = { active: true, paused: false, token: "hello-token" as string | undefined }
mock.module("./extension", () => ({
  extension: () => ({
    isSubscriptionActive: () => state.active,
    isPaused: () => state.paused,
    getExtensionToken: () => state.token,
  }),
}))

const { EVENT, eventBroker } = await import("./event-broker")
const { headerInjection } = await import("./header-injection")

const RULE_ID = 1
const rules = () => chromeMock.declarativeNetRequest.sessionRules
const lastCall = () => chromeMock.declarativeNetRequest.updateSessionRuleCalls.at(-1)

describe("headerInjection", () => {
  beforeEach(() => {
    state.active = true
    state.paused = false
    state.token = "hello-token"
    chromeMock.declarativeNetRequest.sessionRules = []
    chromeMock.declarativeNetRequest.updateSessionRuleCalls = []
  })

  test("installs a rule that sets the Hello header on top-level and media requests", async () => {
    await headerInjection().enableBaseRule()

    expect(rules()).toHaveLength(1)
    expect(rules()[0]).toEqual({
      id: RULE_ID,
      priority: 99,
      condition: { resourceTypes: ["main_frame", "media"] },
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ operation: "set", header: CLIENT_HEADER.HELLO, value: "hello-token" }],
      },
    })
  })

  test("replaces the previous rule in one call, so no request slips through unheadered", async () => {
    await headerInjection().enableBaseRule()
    state.token = "hello-token-2"

    await headerInjection().enableBaseRule()

    expect(lastCall()?.removeRuleIds).toEqual([RULE_ID])
    expect(rules()).toHaveLength(1)
    // biome-ignore lint/suspicious/noExplicitAny: reaching into the recorded rule shape
    expect((rules()[0] as any).action.requestHeaders[0].value).toBe("hello-token-2")
  })

  test("announces the installed rule with the token it carries", async () => {
    const installed = mock()
    eventBroker().on(EVENT.HEADER_INJECTION.BASE_RULE_INSTALLED, installed)

    await expect(headerInjection().enableBaseRule()).resolves.toBe(RULE_ID)
    expect(installed).toHaveBeenCalledWith({ extensionToken: "hello-token", ruleId: RULE_ID })
  })

  test("installs nothing without an active subscription", async () => {
    state.active = false

    await headerInjection().enableBaseRule()

    expect(rules()).toEqual([])
    expect(lastCall()).toEqual({ removeRuleIds: [RULE_ID] })
  })

  test("installs nothing while the extension is paused", async () => {
    // Pausing is the user asking to stop identifying themselves to partner sites; nothing
    // that re-runs the setup may quietly undo that.
    state.paused = true

    await headerInjection().enableBaseRule()

    expect(rules()).toEqual([])
  })

  test("removeBaseRule takes the rule down and is safe when nothing is installed", async () => {
    await headerInjection().enableBaseRule()

    await headerInjection().removeBaseRule()
    await headerInjection().removeBaseRule()

    expect(rules()).toEqual([])
  })

  describe("reacting to subscription changes", () => {
    test("installs the rule when a subscription becomes active", () => {
      eventBroker().emit(EVENT.EXTENSION.SUBSCRIPTION_ACTIVE)

      expect(lastCall()?.addRules).toHaveLength(1)
    })

    test("removes the rule when the subscription expires", async () => {
      await headerInjection().enableBaseRule()
      state.active = false

      eventBroker().emit(EVENT.EXTENSION.SUBSCRIPTION_EXPIRED)
      await Bun.sleep(0)

      expect(rules()).toEqual([])
    })
  })
})
