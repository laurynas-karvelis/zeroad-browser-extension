import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { chromeMock } from "../../__fixtures__/chrome"

chromeMock.management.installType = "development"
chromeMock.runtime.manifestVersion = "1.2.3"

const { getConfig } = await import("../config")

describe("getConfig", () => {
  afterEach(() => {
    chromeMock.runtime.externalMatches = ["https://zeroad.network/*"]
    chromeMock.management.installType = "development"
  })

  test("points at production hosts for a production build loaded unpacked", async () => {
    const config = await getConfig()

    expect(config.DEV_MODE).toBe(false)
    expect(config.BASE_URL).toBe("https://zeroad.network")
    expect(config.GENERIC.EXTENSION_SYNC_URL).toBe("https://zeroad.network/extension/sync")
    expect(config.GENERIC.UNINSTALL_URL).toBe("https://zeroad.network/extension/uninstall")
    expect(config.GENERIC.ONBOARDING_URL).toBe("https://zeroad.network/extension/onboarding")
    expect(config.DATA_INGEST.INGEST_URL).toBe("https://api.zeroad.network/extension/telemetry")
  })

  test("reports the manifest version", async () => {
    expect((await getConfig()).VERSION).toBe("1.2.3")
  })

  test("keeps a normally installed development build on production hosts", async () => {
    chromeMock.runtime.externalMatches.push("https://local.zeroad.network/*")
    chromeMock.management.installType = "normal"

    const config = await getConfig()
    expect(config.DEV_MODE).toBe(false)
    expect(config.BASE_URL).toBe("https://zeroad.network")
    expect(config.DATA_INGEST.INGEST_URL).toBe("https://api.zeroad.network/extension/telemetry")
  })

  test("points at local hosts for a Chromium development build", async () => {
    chromeMock.runtime.externalMatches.push("https://local.zeroad.network/*")

    const config = await getConfig()
    expect(config.DEV_MODE).toBe(true)
    expect(config.BASE_URL).toBe("https://local.zeroad.network")
    expect(config.DATA_INGEST.INGEST_URL).toBe("https://api.local.zeroad.network/extension/telemetry")
  })

  test("uses content script matches for a Firefox development build", async () => {
    const manifestSpy = spyOn(chrome.runtime, "getManifest").mockReturnValue({
      manifest_version: 3,
      name: "Zero Ad Network",
      version: "1.2.3",
      content_scripts: [
        { matches: ["https://zeroad.network/*", "https://local.zeroad.network/*"], js: ["js/content.js"] },
      ],
    })

    try {
      const config = await getConfig()
      expect(config.DEV_MODE).toBe(true)
      expect(config.BASE_URL).toBe("https://local.zeroad.network")
    } finally {
      manifestSpy.mockRestore()
    }
  })
})
