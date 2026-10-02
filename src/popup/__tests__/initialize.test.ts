import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test"
import { chromeMock } from "../../__fixtures__/chrome"
import { click, hrefOf, isShown, mountPopup, textOf } from "../../__fixtures__/dom"
import { EVENT } from "../../worker/event-broker"
import { initializePopup } from "../initialize"

let reload: ReturnType<typeof mock>
let logged: ReturnType<typeof spyOn>

beforeEach(() => {
  const window = mountPopup()
  reload = mock()
  Object.defineProperty(window.location, "reload", { value: reload, configurable: true })

  chromeMock.runtime.onMessage.clear()
  chromeMock.runtime.sentMessages = []
  chromeMock.runtime.lastError = undefined
  chromeMock.runtime.sendMessageResponses = {
    [EVENT.POPUP.GET_CONFIG]: { VERSION: "1.0.1", BASE_URL: "https://zeroad.network", DEV_MODE: false },
    [EVENT.POPUP.GET_EXTENSION_DATA]: {},
  }

  logged = spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  logged.mockRestore()
})

test("replaces loading with the signed-out experience and resolves its links", async () => {
  expect(isShown("#popup-loading")).toBe(true)

  await initializePopup()

  expect(isShown("#popup-loading")).toBe(false)
  expect(isShown("#popup-error")).toBe(false)
  expect(isShown("a.guest")).toBe(true)
  expect(hrefOf("a.guest")).toBe("https://zeroad.network/login")
  expect(textOf("#version")).toBe("Version 1.0.1")
})

for (const command of [EVENT.POPUP.GET_CONFIG, EVENT.POPUP.GET_EXTENSION_DATA]) {
  test(`offers a retry instead of a blank or signed-out popup when ${command} fails`, async () => {
    chromeMock.runtime.sendMessageResponses[command] = { error: "Worker unavailable" }

    await initializePopup()

    expect(isShown("#popup-loading")).toBe(false)
    expect(isShown("#popup-error")).toBe(true)
    expect(isShown("a.guest")).toBe(false)

    click("#retry-btn")

    expect(reload).toHaveBeenCalledTimes(1)
  })
}
