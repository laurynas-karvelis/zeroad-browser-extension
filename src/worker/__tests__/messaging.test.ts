import { beforeEach, describe, expect, mock, test } from "bun:test"
import { chromeMock } from "../../__fixtures__/chrome"

// No `browser` global, so `messaging` takes the Chrome path: sites reach the worker directly
// through `onMessageExternal`, which the browser gates with `externally_connectable`.
let finishLoading = () => {}
const extensionStub = {
  ready: Promise.resolve() as Promise<void>,
  getExtensionData: mock(() => ({ user: { firstName: "Ada", extensionToken: "r" }, subscription: undefined })),
  isPaused: mock(() => false),
  pause: mock(async () => "paused"),
  resume: mock(async () => "resumed"),
}
mock.module("../extension", () => ({ extension: () => extensionStub }))

const notifyIfActiveTabIsPublisher = mock()
mock.module("../tab-tracker", () => ({ trackedTabs: () => ({ notifyIfActiveTabIsPublisher }) }))

mock.module("../telemetry", () => ({ telemetry: () => ({ map: new Map(), export: () => ({}) }) }))

const { EVENT, eventBroker } = await import("../event-broker")
await import("../messaging")

const POPUP_SENDER = { id: chromeMock.runtime.id, url: "chrome-extension://test-extension-id/popup.html" }

/** Sends a message the way the popup does and resolves with whatever the worker replies. */
async function askPopupChannel(command: string, sender: object = POPUP_SENDER) {
  let response: unknown
  const results = await chromeMock.runtime.onMessage.dispatch({ command }, sender, (value: unknown) => {
    response = value
  })
  // Handlers reply asynchronously, after awaiting the worker's stored state.
  await Bun.sleep(0)
  return { response, keptChannelOpen: results.filter(Boolean).length }
}

async function askSiteChannel(message: object) {
  let response: unknown
  await chromeMock.runtime.onMessageExternal.dispatch(message, {}, (value: unknown) => {
    response = value
  })
  return response
}

describe("popup messages", () => {
  beforeEach(() => {
    chromeMock.runtime.sentMessages = []
    notifyIfActiveTabIsPublisher.mockClear()
    for (const spy of Object.values(extensionStub)) spy.mockClear()
  })

  test("returns the config", async () => {
    const { response } = await askPopupChannel(EVENT.POPUP.GET_CONFIG)

    expect(response).toMatchObject({ BASE_URL: "https://zeroad.network", DEV_MODE: false })
  })

  test("returns the stored user and subscription", async () => {
    const { response } = await askPopupChannel(EVENT.POPUP.GET_EXTENSION_DATA)

    expect(response).toEqual({ user: { firstName: "Ada", extensionToken: "r" }, subscription: undefined })
  })

  test("reports and changes the paused state", async () => {
    expect((await askPopupChannel(EVENT.POPUP.IS_EXTENSION_PAUSED)).response).toBe(false)

    await askPopupChannel(EVENT.POPUP.EXTENSION_PAUSE_REQUEST)
    expect(extensionStub.pause).toHaveBeenCalled()

    await askPopupChannel(EVENT.POPUP.EXTENSION_RESUME_REQUEST)
    expect(extensionStub.resume).toHaveBeenCalled()
  })

  test("a reset request is broadcast to the worker", async () => {
    const reset = mock()
    eventBroker().on(EVENT.EXTENSION.REQUEST_RESET, reset)

    await askPopupChannel(EVENT.POPUP.RESET_EXTENSION_STATE)

    expect(reset).toHaveBeenCalled()
  })

  test("a push request is broadcast to the worker", async () => {
    const push = mock()
    eventBroker().on(EVENT.TELEMETRY.PUSH, push)

    await askPopupChannel(EVENT.POPUP.PUSH_TELEMETRY_REQUEST)

    expect(push).toHaveBeenCalled()
  })

  test("asks the tab tracker to re-announce the current tab", async () => {
    await askPopupChannel(EVENT.POPUP.CHECK_IF_ACTIVE_TAB_PUBLISHER_REQUEST)

    expect(notifyIfActiveTabIsPublisher).toHaveBeenCalled()
  })

  test("exactly one handler claims a known command", async () => {
    const { keptChannelOpen } = await askPopupChannel(EVENT.POPUP.GET_CONFIG)

    expect(keptChannelOpen).toBe(1)
  })

  test("an unknown command is not answered and no handler holds the channel open", async () => {
    // Holding it open for commands nobody handles leaves the popup waiting for a reply
    // that never comes, until the browser tears the port down.
    const { response, keptChannelOpen } = await askPopupChannel("POPUP:NOT_A_REAL_COMMAND")

    expect(response).toBeUndefined()
    expect(keptChannelOpen).toBe(0)
  })

  test("refuses popup commands sent from a tab, where a site's content script runs", async () => {
    // On Firefox the page bridge shares this channel; a site must never read the extension token.
    const fromTab = { id: chromeMock.runtime.id, tab: { id: 3 }, url: "https://zeroad.network/" }

    const { response, keptChannelOpen } = await askPopupChannel(EVENT.POPUP.GET_EXTENSION_DATA, fromTab)

    expect(response).toBeUndefined()
    expect(keptChannelOpen).toBe(0)
    expect(extensionStub.getExtensionData).not.toHaveBeenCalled()
  })

  test("refuses popup commands from another extension", async () => {
    const { response } = await askPopupChannel(EVENT.POPUP.RESET_EXTENSION_STATE, { id: "someone-else" })

    expect(response).toBeUndefined()
  })

  test("waits for the stored state before answering, so a waking worker does not report a guest", async () => {
    extensionStub.ready = new Promise((resolve) => {
      finishLoading = resolve
    })
    const pending = askPopupChannel(EVENT.POPUP.GET_EXTENSION_DATA)

    await Bun.sleep(0)
    expect(extensionStub.getExtensionData).not.toHaveBeenCalled()

    finishLoading()
    expect((await pending).response).toMatchObject({ user: { firstName: "Ada" } })
    extensionStub.ready = Promise.resolve()
  })

  test("a failing handler replies with a serializable error rather than an empty object", async () => {
    extensionStub.pause.mockImplementationOnce(async () => {
      throw new Error("rule update failed")
    })

    const { response } = await askPopupChannel(EVENT.POPUP.EXTENSION_PAUSE_REQUEST)

    expect(response).toEqual({ error: "rule update failed" })
  })
})

describe("site messages over the Chrome external channel", () => {
  test("answers a ping with the extension version", async () => {
    chromeMock.runtime.manifestVersion = "1.2.3"

    const response = await askSiteChannel({ command: EVENT.WEBSITE.PING })

    expect(response).toMatchObject({ version: "1.2.3", reply: "PONG" })
  })

  test("hands a sync payload to the worker", async () => {
    const received = mock()
    eventBroker().on(EVENT.EXTENSION.PAYLOAD_RECEIVED, received)
    const payload = { user: { extensionToken: "r" }, subscription: { planName: "clean-web" } }

    const response = await askSiteChannel({ command: EVENT.WEBSITE.SYNC_CLIENT_DATA, payload })

    expect(received).toHaveBeenCalledWith(payload)
    expect(response).toBe(true)
  })

  test("refuses a sync message with no payload", async () => {
    const received = mock()
    eventBroker().on(EVENT.EXTENSION.PAYLOAD_RECEIVED, received)

    const response = await askSiteChannel({ command: EVENT.WEBSITE.SYNC_CLIENT_DATA })

    expect(received).not.toHaveBeenCalled()
    expect(response).toBe(false)
  })

  test("ignores commands the site channel does not serve", async () => {
    const response = await askSiteChannel({ command: EVENT.POPUP.RESET_EXTENSION_STATE })

    expect(response).toBeUndefined()
  })
})

describe("events proxied to the popup", () => {
  beforeEach(() => {
    chromeMock.runtime.sentMessages = []
  })

  test("a subscription change tells the popup to reload", () => {
    eventBroker().emit(EVENT.EXTENSION.SUBSCRIPTION_ACTIVE)
    eventBroker().emit(EVENT.EXTENSION.SUBSCRIPTION_EXPIRED)

    expect(chromeMock.runtime.sentMessages).toEqual([
      { event: EVENT.MESSAGING.POPUP_RELOAD_REQUEST },
      { event: EVENT.MESSAGING.POPUP_RELOAD_REQUEST },
    ])
  })

  test("the active-tab verdict is forwarded with its data", () => {
    const data = { isPublisher: true, tabId: 5, url: "https://a.test/", telemetryEntry: undefined }

    eventBroker().emit(EVENT.TAB_TRACKER.IS_ACTIVE_TAB_PUBLISHER, data)

    expect(chromeMock.runtime.sentMessages).toEqual([{ event: EVENT.MESSAGING.IS_ACTIVE_TAB_PUBLISHER, data }])
  })

  test("a closed popup is not an error", () => {
    chromeMock.runtime.lastError = { message: "Could not establish connection" }

    expect(() => eventBroker().emit(EVENT.EXTENSION.SUBSCRIPTION_ACTIVE)).not.toThrow()

    chromeMock.runtime.lastError = undefined
  })
})
