import { beforeEach, describe, expect, mock, test } from "bun:test"
import { chromeMock } from "../__fixtures__/chrome"

const { worker } = await import("./worker")

describe("worker.sendCommand", () => {
  beforeEach(() => {
    chromeMock.runtime.sentMessages = []
    chromeMock.runtime.sendMessageResponse = undefined
    chromeMock.runtime.sendMessageResponses = {}
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

  test("resolves with false, which several commands legitimately answer", async () => {
    chromeMock.runtime.sendMessageResponse = false

    await expect(worker.sendCommand("POPUP:IS_EXTENSION_PAUSED")).resolves.toBe(false)
  })

  test("rejects when the worker could not be reached", async () => {
    // A popup opened while the service worker is being torn down hits exactly this.
    chromeMock.runtime.lastError = { message: "Could not establish connection" }

    await expect(worker.sendCommand("POPUP:GET_CONFIG")).rejects.toThrow("Could not establish connection")
  })

  test("rejects on the error envelope a failed handler replies with", async () => {
    // `messaging.ts` cannot send an Error back, so it answers `{ error }` with a 200-shaped reply.
    // Resolving that would hand every truthiness check in the popup a failure dressed up as a "yes":
    // `IS_EXTENSION_PAUSED` in particular would light up the "paused" banner because an object is truthy.
    chromeMock.runtime.sendMessageResponses = { "POPUP:IS_EXTENSION_PAUSED": { error: "Storage unavailable" } }

    await expect(worker.sendCommand("POPUP:IS_EXTENSION_PAUSED")).rejects.toThrow("Storage unavailable")
  })

  test("rejects with a real Error, so a caller can log a stack", async () => {
    chromeMock.runtime.sendMessageResponse = { error: "boom" }

    await expect(worker.sendCommand("POPUP:GET_CONFIG")).rejects.toBeInstanceOf(Error)
  })

  test("passes through a reply that merely carries a non-string error field", async () => {
    // The envelope check is deliberately narrow - only `{ error: string }` is the failure shape.
    chromeMock.runtime.sendMessageResponse = { error: null, value: 1 }

    await expect(worker.sendCommand("POPUP:GET_CONFIG")).resolves.toEqual({ error: null, value: 1 })
  })
})

describe("worker.on", () => {
  beforeEach(() => {
    chromeMock.runtime.onMessage.clear()
    chromeMock.runtime.lastError = undefined
  })

  test("passes the data of a matching event to the callback", async () => {
    const callback = mock()
    worker.on("MESSAGING:IS_ACTIVE_TAB_PUBLISHER", callback)

    await chromeMock.runtime.onMessage.dispatch(
      { event: "MESSAGING:IS_ACTIVE_TAB_PUBLISHER", data: { isPublisher: true } },
      {},
      () => {}
    )

    expect(callback).toHaveBeenCalledWith({ isPublisher: true })
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

  test("survives a message that is not an object at all", async () => {
    const callback = mock()
    worker.on("MESSAGING:POPUP_RELOAD_REQUEST", callback)

    await expect(chromeMock.runtime.onMessage.dispatch(undefined, {}, () => {})).resolves.toBeDefined()
    expect(callback).not.toHaveBeenCalled()
  })

  test("never asks Chrome to hold the reply channel open, whatever the callback returns", async () => {
    // Returning `true` from an onMessage listener means "a response is coming". These are one-way
    // notifications and no response ever comes, so the port would hang until Chrome tore it down.
    worker.on("MESSAGING:POPUP_RELOAD_REQUEST", () => true)

    const results = await chromeMock.runtime.onMessage.dispatch(
      { event: "MESSAGING:POPUP_RELOAD_REQUEST" },
      {},
      () => {}
    )

    expect(results).toEqual([false])
  })

  test("is chainable", () => {
    expect(worker.on("A", () => {})).toBe(worker)
  })
})
