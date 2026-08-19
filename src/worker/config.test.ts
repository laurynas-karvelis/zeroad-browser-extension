import { describe, expect, test } from "bun:test"
import { chromeMock } from "./__fixtures__/chrome"

chromeMock.management.installType = "normal"
chromeMock.runtime.manifestVersion = "1.2.3"

const { getConfig } = await import("./config")

describe("getConfig", () => {
  test("points at production hosts for a store-installed extension", async () => {
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

  test("caches the install type, so a later management change cannot flip live hosts", async () => {
    // `chrome.management.getSelf()` is only consulted once per worker lifetime.
    chromeMock.management.installType = "development"

    expect((await getConfig()).BASE_URL).toBe("https://zeroad.network")
  })
})
