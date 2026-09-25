import { inDevMode } from "./utils"

enum HOMEPAGE {
  DEV = "https://local.zeroad.network",
  PROD = "https://zeroad.network",
}

enum API_SERVER {
  DEV = "https://api.local.zeroad.network",
  PROD = "https://api.zeroad.network",
}

// Account pages display publisher IDs for management, not as participating integrations.
export const PUBLISHER_DISCOVERY_EXCLUDED_HOSTNAMES: ReadonlySet<string> = new Set(
  Object.values(HOMEPAGE).map((url) => new URL(url).hostname)
)

export type GetConfigResult = Awaited<ReturnType<typeof getConfig>>

export async function getConfig() {
  const devMode = await inDevMode()
  const buildUrl = (path: string) => (devMode ? HOMEPAGE.DEV : HOMEPAGE.PROD) + path
  const buildApiUrl = (path: string) => (devMode ? API_SERVER.DEV : API_SERVER.PROD) + path

  return {
    VERSION: chrome.runtime.getManifest().version,
    DEV_MODE: devMode,
    BASE_URL: buildUrl(""),
    GENERIC: {
      EXTENSION_SYNC_URL: buildUrl("/extension/sync"),
      EXTENSION_CREDENTIALS_URL: buildUrl("/extension/credentials"),
      UNINSTALL_URL: buildUrl("/extension/uninstall"),
      ONBOARDING_URL: buildUrl("/extension/onboarding"),
    },
    DATA_INGEST: {
      INGEST_URL: buildApiUrl("/extension/telemetry"),
    },
  }
}
