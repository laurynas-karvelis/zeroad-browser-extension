import { inDevMode } from "./utils";

let devMode: boolean | undefined = undefined;

enum HOMEPAGE {
  DEV = "http://localhost:3000",
  PROD = "https://zeroad.network",
}

enum API_SERVER {
  DEV = "http://localhost:3010",
  PROD = "https://api.zeroad.network",
}

function buildUrl(path: string) {
  const host = (devMode && HOMEPAGE.DEV) || HOMEPAGE.PROD;
  return [host, path].join("");
}

function buildApiUrl(path: string) {
  const host = (devMode && API_SERVER.DEV) || API_SERVER.PROD;
  return [host, path].join("");
}

export type GetConfigResult = Awaited<ReturnType<typeof getConfig>>;

export async function getConfig() {
  if (devMode === undefined) devMode = await inDevMode();

  return {
    VERSION: chrome.runtime.getManifest().version,
    DEV_MODE: !!devMode,
    BASE_URL: buildUrl(""),
    GENERIC: {
      EXTENSION_SYNC_URL: buildUrl("/extension/sync"),
      UNINSTALL_URL: buildUrl("/extension/uninstall"),
      ONBOARDING_URL: buildUrl("/extension/onboarding"),
    },
    DATA_INGEST: {
      INGEST_URL: buildApiUrl("/extension/telemetry"),
    },
  };
}
