import { beforeEach, describe, expect, mock, test } from "bun:test"
import { chromeMock } from "../../__fixtures__/chrome"

const enableRenewal = mock<(when: number) => Promise<void>>(async () => {})
const cancelRenewal = mock<() => Promise<void>>(async () => {})
mock.module("../credentials", () => ({ credentials: () => ({ enableRenewal, cancelRenewal }) }))

const push = mock<() => Promise<void>>(async () => {})
mock.module("../telemetry-sync", () => ({ telemetrySync: () => ({ push }) }))

const removeAllRules = mock<() => Promise<void>>(async () => {})
const reset = mock<() => Promise<void>>(async () => {})
mock.module("../header-injection", () => ({
  headerInjection: () => ({ removeAllRules, reset }),
}))

const { EVENT, eventBroker } = await import("../event-broker")
const { extension } = await import("../extension")

const HOUR = 60 * 60 * 1000

const user = (extensionToken = "ext-token-1") => ({ firstName: "Ada", extensionToken })
const subscription = (expiresAt = Date.now() + HOUR) => ({
  planName: "clean-web",
  expiresAt,
})

describe("Extension", () => {
  beforeEach(async () => {
    await chromeMock.storage.sync.clear()
    await chromeMock.storage.local.clear()
    await chromeMock.alarms.clearAll()

    // The singleton keeps its state in memory between tests, so wipe it back to a clean slate -
    // otherwise a token stored by an earlier test makes a later "first sync" look like a repeat.
    eventBroker().emit(EVENT.EXTENSION.REQUEST_RESET)
    await Bun.sleep(0)

    for (const spy of [enableRenewal, cancelRenewal, push, removeAllRules, reset]) spy.mockClear()
  })

  describe("isSubscriptionActive", () => {
    test("is false with no subscription at all", async () => {
      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, { user: user() })
      await Bun.sleep(0)

      expect(extension().isSubscriptionActive()).toBe(false)
    })

    test("is true for an unexpired subscription", async () => {
      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, { user: user(), subscription: subscription() })
      await Bun.sleep(0)

      expect(extension().isSubscriptionActive()).toBe(true)
    })

    test("is false once the expiry has passed", async () => {
      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, {
        user: user(),
        subscription: subscription(Date.now() - 1000),
      })
      await Bun.sleep(0)

      expect(extension().isSubscriptionActive()).toBe(false)
    })
  })

  describe("receiving a sync payload", () => {
    test("stores the payload and announces the sync", async () => {
      const synced = mock()
      eventBroker().on(EVENT.EXTENSION.SYNCED, synced)

      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, { user: user(), subscription: subscription() })
      await Bun.sleep(0)

      expect(chromeMock.storage.sync.peek().user).toEqual(user())
      expect(extension().getExtensionToken()).toBe("ext-token-1")
      expect(synced).toHaveBeenCalled()
    })

    test("does not re-announce a token that has not changed", async () => {
      // The badge's "ON" confirmation should only kick in on a first install or a switch of user -
      // a repeat sync of the same token is not news.
      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, { user: user(), subscription: subscription() })
      await Bun.sleep(0)
      const synced = mock()
      eventBroker().on(EVENT.EXTENSION.SYNCED, synced)

      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, { user: user(), subscription: subscription() })
      await Bun.sleep(0)

      expect(synced).not.toHaveBeenCalled()
    })

    test("announces again when the token changes, e.g. a different user signs in", async () => {
      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, { user: user("ext-token-1"), subscription: subscription() })
      await Bun.sleep(0)
      const synced = mock()
      eventBroker().on(EVENT.EXTENSION.SYNCED, synced)

      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, { user: user("ext-token-2"), subscription: subscription() })
      await Bun.sleep(0)

      expect(synced).toHaveBeenCalled()
    })

    test("a payload without a subscription takes the live one down", async () => {
      // Cancelling used to leave the old subscription in memory, so the Hello header kept
      // being injected with credentials the server had already withdrawn.
      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, { user: user(), subscription: subscription() })
      await Bun.sleep(0)
      expect(extension().isSubscriptionActive()).toBe(true)

      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, { user: user() })
      await Bun.sleep(0)

      expect(extension().isSubscriptionActive()).toBe(false)
      expect(chromeMock.storage.sync.peek().subscription).toBeUndefined()
    })

    test("an expired subscription in the payload is applied rather than ignored", async () => {
      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, { user: user(), subscription: subscription() })
      await Bun.sleep(0)

      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, {
        user: user(),
        subscription: subscription(Date.now() - 1000),
      })
      await Bun.sleep(0)

      expect(extension().isSubscriptionActive()).toBe(false)
    })

    test("ignores a malformed payload instead of throwing out the current state", async () => {
      // The Chrome path takes this straight off an external site message.
      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, { user: user(), subscription: subscription() })
      await Bun.sleep(0)

      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, {})
      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, { user: { firstName: "Ada" } })
      await Bun.sleep(0)

      expect(extension().getExtensionToken()).toBe("ext-token-1")
    })

    test("pushes pending telemetry before switching to a different user", async () => {
      // Whatever the previous account browsed belongs to that account, not the new one.
      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, { user: user("refresh-1"), subscription: subscription() })
      await Bun.sleep(0)
      push.mockClear()

      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, { user: user("refresh-2"), subscription: subscription() })
      await Bun.sleep(0)

      expect(push).toHaveBeenCalledTimes(1)
    })

    test("does not push telemetry when the same user syncs again", async () => {
      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, { user: user("refresh-1"), subscription: subscription() })
      await Bun.sleep(0)
      push.mockClear()

      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, { user: user("refresh-1"), subscription: subscription() })
      await Bun.sleep(0)

      expect(push).not.toHaveBeenCalled()
    })
  })

  describe("renewal scheduling", () => {
    test("schedules renewal for the moment an active subscription expires", async () => {
      const expiresAt = Date.now() + HOUR
      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, { user: user(), subscription: subscription(expiresAt) })
      await Bun.sleep(0)

      expect(enableRenewal).toHaveBeenCalledWith(expiresAt)
    })

    test("cancels renewal when there is no extension token left to renew with", async () => {
      eventBroker().emit(EVENT.EXTENSION.REQUEST_RESET)
      await Bun.sleep(0)

      expect(cancelRenewal).toHaveBeenCalled()
    })
  })

  describe("pausing", () => {
    test("pause takes the header rule down and resume puts it back", async () => {
      await extension().pause()
      expect(extension().isPaused()).toBe(true)
      expect(removeAllRules).toHaveBeenCalled()

      await extension().resume()
      expect(extension().isPaused()).toBe(false)
      expect(reset).toHaveBeenCalled()
    })

    test("the pause is stored, so it survives the stored state being read back", async () => {
      // A sync re-reads everything from storage, exactly as a restarted worker does.
      await extension().pause()
      expect(chromeMock.storage.local.peek().isHeaderInjectionPaused).toBe(true)

      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, { user: user(), subscription: subscription() })
      await Bun.sleep(0)

      expect(extension().isPaused()).toBe(true)
    })

    test("resume forgets the stored pause", async () => {
      await extension().pause()
      await extension().resume()

      expect(chromeMock.storage.local.peek().isHeaderInjectionPaused).toBeUndefined()
    })
  })

  describe("reset", () => {
    test("wipes both storage areas and every alarm", async () => {
      await chromeMock.storage.sync.set({ user: user(), subscription: subscription() })
      await chromeMock.storage.local.set({ telemetry: { "a.test": {} } })
      await chromeMock.alarms.create("something", { periodInMinutes: 1 })

      eventBroker().emit(EVENT.EXTENSION.REQUEST_RESET)
      await Bun.sleep(0)

      expect(chromeMock.storage.sync.peek()).toEqual({})
      expect(chromeMock.storage.local.peek()).toEqual({})
      expect(chromeMock.alarms.peek().size).toBe(0)
      expect(extension().getExtensionData()).toEqual({ user: undefined, subscription: undefined })
    })
  })

  describe("install", () => {
    test("opens onboarding and registers the uninstall survey on a fresh install", async () => {
      await chromeMock.runtime.onInstalled.dispatch({ reason: "install" })

      expect(chromeMock.runtime.uninstallUrl).toBe("https://zeroad.network/extension/uninstall")
      expect(chromeMock.tabs.created.at(-1)).toEqual({ url: "https://zeroad.network/extension/onboarding" })
    })

    test("does nothing on an update, so a refresh never reopens onboarding", async () => {
      chromeMock.tabs.created.length = 0

      await chromeMock.runtime.onInstalled.dispatch({ reason: "update" })

      expect(chromeMock.tabs.created).toEqual([])
    })
  })
})
