import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { log, setLogLevel } from "./logger"

describe("logger", () => {
  let consoleSpy: ReturnType<typeof spyOn<Console, "log">>

  beforeEach(() => {
    consoleSpy = spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    setLogLevel("error")
  })

  test("defaults to error only, so a released extension stays quiet", () => {
    log("error", "boom")
    log("warn", "hmm")
    log("info", "fyi")
    log("debug", "details")

    expect(consoleSpy).toHaveBeenCalledTimes(1)
    expect(consoleSpy).toHaveBeenCalledWith("[ERROR]", "boom")
  })

  test("a level lets through everything at or above its severity", () => {
    setLogLevel("info")

    log("error", "e")
    log("warn", "w")
    log("info", "i")
    log("debug", "d")

    expect(consoleSpy.mock.calls.map(([prefix]) => prefix)).toEqual(["[ERROR]", "[WARN]", "[INFO]"])
  })

  test("debug lets through every level", () => {
    setLogLevel("debug")

    log("error", "e")
    log("debug", "d")

    expect(consoleSpy).toHaveBeenCalledTimes(2)
  })

  test("forwards every argument to the console", () => {
    setLogLevel("debug")

    log("debug", "[scope]", { a: 1 }, [2])

    expect(consoleSpy).toHaveBeenCalledWith("[DEBUG]", "[scope]", { a: 1 }, [2])
  })

  test("ignores an unknown level instead of silencing the logger", () => {
    setLogLevel("info")
    // @ts-expect-error deliberately passing a level outside the union
    setLogLevel("verbose")

    log("info", "still here")

    expect(consoleSpy).toHaveBeenCalledWith("[INFO]", "still here")
  })
})
