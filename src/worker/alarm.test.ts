import { beforeEach, describe, expect, mock, test } from "bun:test"
import { chromeMock } from "./__fixtures__/chrome"

const { schedule } = await import("./alarm")

describe("schedule", () => {
  beforeEach(async () => {
    await chromeMock.alarms.clearAll()
  })

  describe("create", () => {
    test("creates an alarm that does not exist yet", async () => {
      await schedule.create("sync", { periodInMinutes: 60 })

      expect(await schedule.has("sync")).toBe(true)
      expect(chromeMock.alarms.peek().get("sync")?.periodInMinutes).toBe(60)
    })

    test("leaves an existing alarm alone, so a worker restart never resets its period", async () => {
      // The worker re-runs its module top level on every wake-up; re-creating the alarm
      // there would push its next firing back forever.
      await schedule.create("sync", { periodInMinutes: 60 })
      const scheduledTime = chromeMock.alarms.peek().get("sync")?.scheduledTime

      await schedule.create("sync", { periodInMinutes: 5 })

      expect(chromeMock.alarms.peek().get("sync")?.periodInMinutes).toBe(60)
      expect(chromeMock.alarms.peek().get("sync")?.scheduledTime).toBe(scheduledTime)
    })
  })

  describe("recreate", () => {
    test("replaces an existing alarm with the new options", async () => {
      await schedule.create("renew", { when: 1_000 })

      await schedule.recreate("renew", { when: 2_000 })

      expect(chromeMock.alarms.peek().get("renew")?.scheduledTime).toBe(2_000)
    })

    test("creates the alarm when there is nothing to replace", async () => {
      await schedule.recreate("renew", { when: 2_000 })

      expect(await schedule.has("renew")).toBe(true)
    })
  })

  test("clear removes the alarm and has() reports it gone", async () => {
    await schedule.create("renew", { when: 1_000 })

    await schedule.clear("renew")

    expect(await schedule.has("renew")).toBe(false)
  })

  describe("on", () => {
    test("runs the callback only for the named alarm", async () => {
      const callback = mock()
      schedule.on("renew", callback)

      await chromeMock.alarms.fire("something-else")
      expect(callback).not.toHaveBeenCalled()

      await chromeMock.alarms.fire("renew")
      expect(callback).toHaveBeenCalledTimes(1)
    })

    test("accepts a list of alarm names", async () => {
      const callback = mock()
      schedule.on(["expiry", "retry"], callback)

      await chromeMock.alarms.fire("expiry")
      await chromeMock.alarms.fire("retry")
      await chromeMock.alarms.fire("unrelated")

      expect(callback).toHaveBeenCalledTimes(2)
    })

    test("is chainable", () => {
      expect(schedule.on("a", () => {})).toBe(schedule)
    })

    test("fires for an alarm name even when nothing registered it", async () => {
      // Chrome delivers onAlarm globally; `on` is a name filter, not a subscription.
      const callback = mock()
      schedule.on("ghost", callback)

      await chromeMock.alarms.fire("ghost")

      expect(callback).toHaveBeenCalledTimes(1)
      expect(await schedule.has("ghost")).toBe(false)
    })
  })
})
