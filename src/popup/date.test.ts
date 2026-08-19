import { describe, expect, test } from "bun:test"
import { from } from "./date"

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const base = new Date("2026-06-15T12:00:00.000Z")
const after = (ms: number) => new Date(base.getTime() + ms)
const before = (ms: number) => new Date(base.getTime() - ms)

describe("from", () => {
  describe("scale", () => {
    const cases: [string, number, string][] = [
      ["moments", 5 * SECOND, "a few seconds"],
      ["just under the minute threshold", 44 * SECOND, "a few seconds"],
      ["45 seconds", 45 * SECOND, "a minute"],
      ["89 seconds", 89 * SECOND, "a minute"],
      ["90 seconds", 90 * SECOND, "2 minutes"],
      ["30 minutes", 30 * MINUTE, "30 minutes"],
      ["45 minutes", 45 * MINUTE, "an hour"],
      ["90 minutes", 90 * MINUTE, "2 hours"],
      ["12 hours", 12 * HOUR, "12 hours"],
      ["22 hours", 22 * HOUR, "a day"],
      ["36 hours", 36 * HOUR, "2 days"],
      ["10 days", 10 * DAY, "10 days"],
      ["26 days", 26 * DAY, "a month"],
      ["46 days", 46 * DAY, "2 months"],
      ["200 days", 200 * DAY, "7 months"],
      ["320 days", 320 * DAY, "a year"],
      ["548 days", 548 * DAY, "2 years"],
      ["3 years", 3 * 365 * DAY, "3 years"],
    ]

    for (const [description, offset, expected] of cases) {
      test(`${description} reads as "${expected}"`, () => {
        expect(from(after(offset), base, { withoutSuffix: true })).toBe(expected)
      })
    }

    test("measures backwards the same way it measures forwards", () => {
      for (const [, offset, expected] of cases) {
        expect(from(before(offset), base, { withoutSuffix: true })).toBe(expected)
      }
    })
  })

  describe("suffixes", () => {
    test("puts the marker in front for a future time", () => {
      expect(from(after(30 * MINUTE), base)).toBe("in 30 minutes")
    })

    test("puts it behind for a past time", () => {
      expect(from(before(30 * MINUTE), base)).toBe("30 minutes ago")
    })

    test("omits it entirely when asked, which is how the plan expiry is rendered", () => {
      expect(from(after(20 * DAY), base, { withoutSuffix: true })).toBe("20 days")
    })

    test("treats the exact same moment as the past", () => {
      expect(from(base, base)).toBe("a few seconds ago")
    })
  })

  describe("inputs", () => {
    test("accepts a Date, a timestamp and an ISO string alike", () => {
      const target = after(2 * HOUR)

      expect(from(target, base, { withoutSuffix: true })).toBe("2 hours")
      expect(from(target.getTime(), base, { withoutSuffix: true })).toBe("2 hours")
      expect(from(target.toISOString(), base, { withoutSuffix: true })).toBe("2 hours")
    })

    test("accepts the same three forms for the base it compares against", () => {
      const target = after(2 * HOUR)

      expect(from(target, base.getTime(), { withoutSuffix: true })).toBe("2 hours")
      expect(from(target, base.toISOString(), { withoutSuffix: true })).toBe("2 hours")
    })

    test("compares against now when no base is given", () => {
      expect(from(Date.now() + 2 * HOUR, undefined, { withoutSuffix: true })).toBe("2 hours")
    })

    test("does not throw on an unparseable date, though what it returns is not meaningful", () => {
      // Every comparison against NaN is false, so the last branch wins and yields "NaN years".
      // Nothing reaches this today - the one caller has already checked the expiry is in the future.
      expect(() => from("not a date", base)).not.toThrow()
    })
  })
})
