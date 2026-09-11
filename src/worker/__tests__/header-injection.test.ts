import { beforeEach, describe, expect, mock, test } from "bun:test"
import { chromeMock } from "../../__fixtures__/chrome"

const state = { active: true, paused: false }
mock.module("../extension", () => ({
  extension: () => ({
    ready: Promise.resolve(),
    isSubscriptionActive: () => state.active,
    isPaused: () => state.paused,
  }),
}))

const pool = {
  tokens: new Map<string, string>(),
  bound: [] as string[],
  exhausted: false,
}

mock.module("../token-pool", () => ({
  tokenPool: () => ({
    async tokenFor(hostname: string) {
      if (pool.exhausted) return undefined
      const existing = pool.tokens.get(hostname)
      if (existing) return existing

      const token = `token-for-${hostname}`
      pool.tokens.set(hostname, token)
      return token
    },
    async boundHostnames() {
      return pool.bound
    },
  }),
}))

const { EVENT, eventBroker } = await import("../event-broker")
const { headerInjection } = await import("../header-injection")

const TOKEN_HEADER = "Better-Web-Token"

const rules = () => chromeMock.declarativeNetRequest.sessionRules
const lastCall = () => chromeMock.declarativeNetRequest.updateSessionRuleCalls.at(-1)
// biome-ignore lint/suspicious/noExplicitAny: reaching into the recorded rule shape
const headerOf = (rule: unknown) => (rule as any).action.requestHeaders[0]

describe("headerInjection", () => {
  beforeEach(async () => {
    state.active = true
    state.paused = false
    pool.tokens.clear()
    pool.bound = []
    pool.exhausted = false
    chromeMock.declarativeNetRequest.sessionRules = []
    chromeMock.declarativeNetRequest.updateSessionRuleCalls = []
    await headerInjection().removeAllRules()
    chromeMock.declarativeNetRequest.sessionRules = []
    chromeMock.declarativeNetRequest.updateSessionRuleCalls = []
  })

  describe("installing a rule for a publisher hostname", () => {
    test("sets the token header over HTTPS only, for that exact host and none of its subdomains", async () => {
      // A token is reusable until it expires, so one sent in clear text could be replayed; `^` ends
      // the match at the host boundary, so `blog.publisher.test` does not match
      await headerInjection().enableForHostname("publisher.test")

      expect(rules()).toHaveLength(1)
      expect(rules()[0]).toMatchObject({
        priority: 99,
        condition: { urlFilter: "|https://publisher.test^", resourceTypes: ["main_frame", "media"] },
      })
      expect(headerOf(rules()[0])).toEqual({
        operation: "set",
        header: TOKEN_HEADER,
        value: "token-for-publisher.test",
      })
    })

    test("gives every hostname its own token and its own rule", async () => {
      // The whole point of binding: two sites must never see the same token, or they could compare
      // notes and link the same visitor across both
      await headerInjection().enableForHostname("one.test")
      await headerInjection().enableForHostname("two.test")

      expect(rules()).toHaveLength(2)

      const values = rules().map((rule) => headerOf(rule).value)
      expect(new Set(values).size).toBe(2)
      expect(rules().map((rule) => rule.id)).toEqual([...new Set(rules().map((rule) => rule.id))])
    })

    test("reuses the same rule id and token when a hostname is enabled twice", async () => {
      const first = await headerInjection().enableForHostname("publisher.test")
      const second = await headerInjection().enableForHostname("publisher.test")

      expect(second).toBe(first as number)
      expect(rules()).toHaveLength(1)
    })

    test("replaces a rule in one call, so no request slips through unheadered", async () => {
      const ruleId = await headerInjection().enableForHostname("publisher.test")
      await headerInjection().enableForHostname("publisher.test")

      expect(lastCall()?.removeRuleIds).toEqual([ruleId as number])
    })

    test("announces the hostname it installed a rule for", async () => {
      const installed = mock()
      eventBroker().on(EVENT.HEADER_INJECTION.RULE_INSTALLED, installed)

      const ruleId = await headerInjection().enableForHostname("publisher.test")

      expect(installed).toHaveBeenCalledWith({ hostname: "publisher.test", ruleId })
    })

    test("tracks which hostnames are carrying a rule", async () => {
      await headerInjection().enableForHostname("one.test")
      await headerInjection().enableForHostname("two.test")

      expect(headerInjection().installedHostnames().sort()).toEqual(["one.test", "two.test"])
    })
  })

  describe("declining to inject", () => {
    test("installs nothing without an active subscription", async () => {
      state.active = false

      expect(await headerInjection().enableForHostname("publisher.test")).toBeUndefined()
      expect(rules()).toHaveLength(0)
    })

    test("installs nothing while paused", async () => {
      state.paused = true

      expect(await headerInjection().enableForHostname("publisher.test")).toBeUndefined()
      expect(rules()).toHaveLength(0)
    })

    test("installs nothing for an empty hostname", async () => {
      expect(await headerInjection().enableForHostname("")).toBeUndefined()
      expect(rules()).toHaveLength(0)
    })

    test("an exhausted pool leaves the visitor looking ordinary rather than erroring", async () => {
      pool.exhausted = true

      expect(await headerInjection().enableForHostname("publisher.test")).toBeUndefined()
      expect(rules()).toHaveLength(0)
    })
  })

  describe("tearing rules down", () => {
    test("removes every installed rule", async () => {
      await headerInjection().enableForHostname("one.test")
      await headerInjection().enableForHostname("two.test")

      await headerInjection().removeAllRules()

      expect(rules()).toHaveLength(0)
      expect(headerInjection().installedHostnames()).toEqual([])
    })

    test("removes rules this worker never installed, since session rules outlive the worker", async () => {
      // Left by an earlier worker, or the old blanket rule of an extension updating in place
      chromeMock.declarativeNetRequest.sessionRules = [
        { id: 1 },
        { id: 104, condition: { urlFilter: "|https://a.test^" } },
      ]

      await headerInjection().removeAllRules()

      expect(lastCall()?.removeRuleIds).toEqual([1, 104])
      expect(rules()).toHaveLength(0)
    })

    test("removes a single hostname without touching the others", async () => {
      await headerInjection().enableForHostname("one.test")
      await headerInjection().enableForHostname("two.test")

      await headerInjection().removeRuleForHostname("one.test")

      expect(headerInjection().installedHostnames()).toEqual(["two.test"])
      expect(rules()).toHaveLength(1)
    })

    test("removing an unknown hostname is a no-op", async () => {
      await headerInjection().enableForHostname("one.test")
      const callsBefore = chromeMock.declarativeNetRequest.updateSessionRuleCalls.length

      await headerInjection().removeRuleForHostname("never-seen.test")

      expect(chromeMock.declarativeNetRequest.updateSessionRuleCalls).toHaveLength(callsBefore)
    })

    test("an expired subscription takes every rule down", async () => {
      await headerInjection().enableForHostname("one.test")

      eventBroker().emit(EVENT.EXTENSION.SUBSCRIPTION_EXPIRED, {})
      await Bun.sleep(0)

      expect(rules()).toHaveLength(0)
    })
  })

  describe("reset", () => {
    test("reinstates a rule for every hostname already holding a token", async () => {
      // A service worker is torn down constantly, taking the in-memory rule map with it, while the
      // bound tokens survive in storage
      pool.bound = ["one.test", "two.test"]

      await headerInjection().reset()

      expect(headerInjection().installedHostnames().sort()).toEqual(["one.test", "two.test"])
      expect(rules()).toHaveLength(2)
    })

    test("reinstates nothing while paused", async () => {
      pool.bound = ["one.test"]
      state.paused = true

      await headerInjection().reset()

      expect(rules()).toHaveLength(0)
    })
  })

  describe("a refreshed token pool", () => {
    test("rebinds every hostname the replaced batch held, so none keeps sending a dead token", async () => {
      // A meta-tag publisher is never rediscovered, so without this it would keep the old batch's token
      await headerInjection().enableForHostname("meta.test")
      pool.tokens.set("meta.test", "token-from-the-new-batch")

      eventBroker().emit(EVENT.TOKEN_POOL.REFRESHED, { hostnames: ["meta.test"] })
      await Bun.sleep(0)

      expect(rules()).toHaveLength(1)
      expect(headerOf(rules()[0]).value).toBe("token-from-the-new-batch")
    })
  })
})
