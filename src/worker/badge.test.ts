import { beforeEach, describe, expect, test } from "bun:test"
import { chromeMock } from "../__fixtures__/chrome"

const { EVENT, eventBroker } = await import("./event-broker")
const { badge } = await import("./badge")

const ACTIVE_ICON = "chrome-extension://test-extension-id/images/dove-128.png"
const INACTIVE_ICON = "chrome-extension://test-extension-id/images/dove-gray-128.png"

describe("badge", () => {
  beforeEach(() => {
    chromeMock.action.icons = []
    chromeMock.action.badgeText = ""
  })

  test("shows ON when the extension syncs, then clears itself", async () => {
    eventBroker().emit(EVENT.EXTENSION.SYNCED)
    await Bun.sleep(0)

    expect(chromeMock.action.badgeText).toBe("ON")

    await badge().setText("BRIEF", 10)
    await Bun.sleep(30)

    expect(chromeMock.action.badgeText).toBe("")
  })

  test("a second message restarts the countdown instead of stacking timers", async () => {
    await badge().setText("ONE", 40)
    await Bun.sleep(20)
    await badge().setText("TWO", 40)
    await Bun.sleep(30)

    // The first timer must not have fired and wiped the second message.
    expect(chromeMock.action.badgeText).toBe("TWO")

    await Bun.sleep(30)
    expect(chromeMock.action.badgeText).toBe("")
  })

  test("clearing the badge does not schedule another clear", async () => {
    await badge().setText("", 10)

    expect(chromeMock.action.badgeText).toBe("")
  })

  test("marks the tab with the active icon when the user is on a publisher site", () => {
    eventBroker().emit(EVENT.TAB_TRACKER.IS_ACTIVE_TAB_PUBLISHER, { tabId: 42, isPublisher: true })

    expect(chromeMock.action.icons.at(-1)).toEqual({ tabId: 42, path: ACTIVE_ICON })
  })

  test("marks the tab with the inactive icon everywhere else", () => {
    eventBroker().emit(EVENT.TAB_TRACKER.IS_ACTIVE_TAB_PUBLISHER, { tabId: 42, isPublisher: false })

    expect(chromeMock.action.icons.at(-1)).toEqual({ tabId: 42, path: INACTIVE_ICON })
  })

  test("the icon is scoped to the tab it was reported for", () => {
    eventBroker().emit(EVENT.TAB_TRACKER.IS_ACTIVE_TAB_PUBLISHER, { tabId: 1, isPublisher: true })
    eventBroker().emit(EVENT.TAB_TRACKER.IS_ACTIVE_TAB_PUBLISHER, { tabId: 2, isPublisher: false })

    expect(chromeMock.action.icons).toEqual([
      { tabId: 1, path: ACTIVE_ICON },
      { tabId: 2, path: INACTIVE_ICON },
    ])
  })
})
