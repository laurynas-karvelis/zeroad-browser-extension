import { describe, expect, mock, test } from "bun:test"
import { EVENT, eventBroker } from "./event-broker"

describe("eventBroker", () => {
  test("is a singleton, so every worker module shares one bus", () => {
    expect(eventBroker()).toBe(eventBroker())
  })

  test("delivers the emitted payload to every subscriber", () => {
    const first = mock()
    const second = mock()

    eventBroker().on(EVENT.TELEMETRY.PARTNER_ADDED, first).on(EVENT.TELEMETRY.PARTNER_ADDED, second)
    eventBroker().emit(EVENT.TELEMETRY.PARTNER_ADDED, { clientId: "abc" })

    expect(first).toHaveBeenCalledWith({ clientId: "abc" })
    expect(second).toHaveBeenCalledWith({ clientId: "abc" })
  })

  test("passes null when an event carries no payload", () => {
    // CustomEvent defaults `detail` to null, so payload-less events deliver null rather
    // than undefined - listeners for those events must not destructure their argument.
    const listener = mock()

    eventBroker().on(EVENT.EXTENSION.READY, listener)
    eventBroker().emit(EVENT.EXTENSION.READY)

    expect(listener).toHaveBeenCalledWith(null)
  })

  test("only notifies subscribers of the emitted event", () => {
    const listener = mock()

    eventBroker().on(EVENT.EXTENSION.SYNCED, listener)
    eventBroker().emit(EVENT.EXTENSION.SUBSCRIPTION_EXPIRED)

    expect(listener).not.toHaveBeenCalled()
  })

  test("dispatches synchronously, so an emit is observable on the next line", () => {
    let seen = false

    eventBroker().on(EVENT.HEADER_INJECTION.RULE_INSTALLED, () => {
      seen = true
    })
    eventBroker().emit(EVENT.HEADER_INJECTION.RULE_INSTALLED)

    expect(seen).toBe(true)
  })

  test("both emit and on are chainable", () => {
    expect(eventBroker().emit(EVENT.EXTENSION.READY)).toBe(eventBroker())
    expect(eventBroker().on(EVENT.EXTENSION.READY, () => {})).toBe(eventBroker())
  })

  test("event names are unique across the whole EVENT tree", () => {
    const collect = (node: object): string[] =>
      Object.values(node).flatMap((value) => (typeof value === "string" ? [value] : collect(value)))

    const names = collect(EVENT)

    expect(new Set(names).size).toBe(names.length)
  })
})
