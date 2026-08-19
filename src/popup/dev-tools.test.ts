import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { chromeMock } from "../__fixtures__/chrome"
import { click, isShown, mountPopup } from "../__fixtures__/dom"
import { EVENT } from "../worker/event-broker"
import { enableDevTools } from "./dev-tools"

const commandsSent = () => chromeMock.runtime.sentMessages.map((message) => (message as { command: string }).command)

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// One test swaps this out to hold a reply back; the mock is module-level, so it is put back per test.
const answerImmediately = chromeMock.runtime.sendMessage

let reload: ReturnType<typeof mock>
let logged: ReturnType<typeof spyOn>

beforeEach(() => {
  const window = mountPopup()

  reload = mock()
  Object.defineProperty(window.location, "reload", { value: reload, configurable: true })

  chromeMock.runtime.sendMessage = answerImmediately
  chromeMock.runtime.sentMessages = []
  chromeMock.runtime.sendMessageResponse = undefined
  chromeMock.runtime.sendMessageResponses = {}
  chromeMock.runtime.lastError = undefined

  logged = spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  logged.mockRestore()
})

describe("enableDevTools", () => {
  test("reveals the debug menu, which ships hidden", () => {
    expect(isShown("#debug-menu")).toBe(false)

    enableDevTools()

    expect(isShown("#debug-menu")).toBe(true)
  })

  test("wires each debug link to its own command", async () => {
    enableDevTools()

    click("a#push-telemetry")
    click("a#display-telemetry")
    await settle()

    expect(commandsSent()).toEqual([EVENT.POPUP.PUSH_TELEMETRY_REQUEST, EVENT.POPUP.DISPLAY_TELEMETRY_DATA])
  })

  test("keeps the popup open - these anchors carry an href that would navigate away", () => {
    enableDevTools()

    const event = new window.MouseEvent("click", { bubbles: true, cancelable: true })
    document.querySelector("a#push-telemetry")?.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  test("only the reset link reloads the popup", async () => {
    enableDevTools()

    click("a#push-telemetry")
    click("a#display-telemetry")
    await settle()

    expect(reload).not.toHaveBeenCalled()
  })
})

describe("resetting the extension state", () => {
  /** Holds the worker's reply back, so the ordering between command and reload is observable. */
  function deferWorkerReply() {
    let reply: (() => void) | undefined

    chromeMock.runtime.sendMessage = (message: unknown, callback?: (response: unknown) => void) => {
      chromeMock.runtime.sentMessages.push(message)
      reply = () => callback?.(undefined)
    }

    return async () => {
      reply?.()
      await settle()
    }
  }

  test("waits for the reset to land before reloading", async () => {
    // Reloading first races the worker: the fresh popup asks for extension data while the reset is
    // still in flight and can render the very state it just asked to have thrown away.
    const replyFromWorker = deferWorkerReply()
    enableDevTools()

    click("a#reset-extension-state")
    await settle()

    expect(commandsSent()).toEqual([EVENT.POPUP.RESET_EXTENSION_STATE])
    expect(reload).not.toHaveBeenCalled()

    await replyFromWorker()

    expect(reload).toHaveBeenCalledTimes(1)
  })

  test("does not reload when the reset failed", async () => {
    chromeMock.runtime.lastError = { message: "Could not establish connection" }
    enableDevTools()

    click("a#reset-extension-state")
    await settle()

    expect(reload).not.toHaveBeenCalled()
    expect(logged).toHaveBeenCalled()
  })
})
