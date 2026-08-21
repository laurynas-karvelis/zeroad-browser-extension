import { beforeEach, describe, expect, mock, test } from "bun:test"
import { chromeMock } from "../__fixtures__/chrome"

// On Firefox the site cannot talk to the worker directly - `content.js` relays for it, so site
// messages arrive on the ordinary runtime channel and must be told apart from popup messages.
// biome-ignore lint/suspicious/noExplicitAny: standing in for the WebExtension `browser` global
;(globalThis as any).browser = { runtime: chromeMock.runtime }
// biome-ignore lint/suspicious/noExplicitAny: the manifest shape differs per target
;(chromeMock.runtime as any).getManifest = () => ({
  version: "1.0.0",
  content_scripts: [{ matches: ["https://zeroad.network/*", "http://localhost/*"], js: ["js/content.js"] }],
})

mock.module("./extension", () => ({ extension: () => ({ getExtensionData: () => ({}), isPaused: () => false }) }))
mock.module("./tab-tracker", () => ({ trackedTabs: () => ({ notifyIfActiveTabIsPublisher: mock() }) }))
mock.module("./telemetry", () => ({ telemetry: () => ({ map: new Map(), export: () => ({}) }) }))

const { EVENT, eventBroker } = await import("./event-broker")
await import("./messaging")

const relayFromSite = (message: object, sender: object) =>
  chromeMock.runtime.onMessage.dispatch(message, sender, () => {})

const contentScriptSender = (url: string) => ({ tab: { id: 1 }, url })

describe("site messages relayed by the Firefox content script", () => {
  let received: ReturnType<typeof mock>

  beforeEach(() => {
    received = mock()
    eventBroker().on(EVENT.EXTENSION.PAYLOAD_RECEIVED, received)
  })

  test("accepts a sync payload relayed from the account site", async () => {
    const payload = { user: { refreshToken: "r" } }

    const results = await relayFromSite(
      { command: EVENT.WEBSITE.SYNC_CLIENT_DATA, payload },
      contentScriptSender("https://zeroad.network/extension/sync")
    )

    expect(received).toHaveBeenCalledWith(payload)
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  test("accepts the local development origin", async () => {
    await relayFromSite(
      { command: EVENT.WEBSITE.SYNC_CLIENT_DATA, payload: { user: { refreshToken: "r" } } },
      contentScriptSender("http://localhost:3000/extension/sync")
    )

    expect(received).toHaveBeenCalled()
  })

  test("answers a ping from a trusted origin", async () => {
    const results = await relayFromSite({ command: EVENT.WEBSITE.PING }, contentScriptSender("https://zeroad.network/"))

    expect(results.find(Boolean)).toMatchObject({ version: "1.0.0", reply: "PONG" })
  })

  test("rejects a payload relayed from any other site", async () => {
    // This message hands the extension a refresh token, so the worker checks the origin itself
    // rather than trusting the content script to be the only thing that ever calls it.
    await relayFromSite(
      { command: EVENT.WEBSITE.SYNC_CLIENT_DATA, payload: { user: { refreshToken: "stolen" } } },
      contentScriptSender("https://evil.test/")
    )

    expect(received).not.toHaveBeenCalled()
  })

  test("rejects a look-alike hostname that merely contains the trusted one", async () => {
    await relayFromSite(
      { command: EVENT.WEBSITE.SYNC_CLIENT_DATA, payload: { user: { refreshToken: "stolen" } } },
      contentScriptSender("https://zeroad.network.evil.test/")
    )

    expect(received).not.toHaveBeenCalled()
  })

  test("rejects a sender that is not a tab, which is how the popup arrives", async () => {
    await relayFromSite({ command: EVENT.WEBSITE.SYNC_CLIENT_DATA, payload: { user: { refreshToken: "x" } } }, {})

    expect(received).not.toHaveBeenCalled()
  })

  test("rejects a tab sender with no URL to check", async () => {
    await relayFromSite(
      { command: EVENT.WEBSITE.SYNC_CLIENT_DATA, payload: { user: { refreshToken: "x" } } },
      {
        tab: { id: 1 },
      }
    )

    expect(received).not.toHaveBeenCalled()
  })
})
