import { beforeEach, describe, expect, mock, test } from "bun:test"
import { chromeMock } from "../__fixtures__/chrome"

const { worker } = await import("./worker")

describe("worker.sendCommand", () => {
  beforeEach(() => {
    chromeMock.runtime.sentMessages = []
    chromeMock.runtime.sendMessageResponse = undefined
    chromeMock.runtime.lastError = undefined
  })

  test("sends the command and resolves with the worker's reply", async () => {
    chromeMock.runtime.sendMessageResponse = { VERSION: "1.2.3" }

    await expect(worker.sendCommand("POPUP:GET_CONFIG")).resolves.toEqual({ VERSION: "1.2.3" })
    expect(chromeMock.runtime.sentMessages).toEqual([{ command: "POPUP:GET_CONFIG" }])
  })

  test("resolves with undefined when the worker replies with nothing", async () => {
    await expect(worker.sendCommand("POPUP:EXTENSION_PAUSE_REQUEST")).resolves.toBeUndefined()
  })

  test("rejects when the worker could not be reached", async () => {
    // A popup opened while the service worker is being torn down hits exactly this.
    chromeMock.runtime.lastError = { message: "Could not establish connection" }

    await expect(worker.sendCommand("POPUP:GET_CONFIG")).rejects.toEqual({
      message: "Could not establish connection",
    })
  })
})

describe("worker.on", () => {
  beforeEach(() => {
    chromeMock.runtime.lastError = undefined
  })

  test("passes the data of a matching event to the callback", async () => {
    const callback = mock()
    worker.on("MESSAGING:IS_ACTIVE_TAB_PARTNER", callback)

    await chromeMock.runtime.onMessage.dispatch(
      { event: "MESSAGING:IS_ACTIVE_TAB_PARTNER", data: { isPartner: true } },
      {},
      () => {}
    )

    expect(callback).toHaveBeenCalledWith({ isPartner: true })
  })

  test("ignores other events", async () => {
    const callback = mock()
    worker.on("MESSAGING:POPUP_RELOAD_REQUEST", callback)

    await chromeMock.runtime.onMessage.dispatch({ event: "SOMETHING:ELSE" }, {}, () => {})

    expect(callback).not.toHaveBeenCalled()
  })

  test("ignores a command-shaped message, which is what the worker's own handlers receive", async () => {
    const callback = mock()
    worker.on("MESSAGING:POPUP_RELOAD_REQUEST", callback)

    await chromeMock.runtime.onMessage.dispatch({ command: "POPUP:GET_CONFIG" }, {}, () => {})

    expect(callback).not.toHaveBeenCalled()
  })

  test("is chainable", () => {
    expect(worker.on("A", () => {})).toBe(worker)
  })
})
