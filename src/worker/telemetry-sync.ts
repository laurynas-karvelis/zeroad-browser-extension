import { schedule } from "./alarm"
import { getConfig } from "./config"
import type { ExtensionError } from "./error"
import { EVENT, eventBroker } from "./event-broker"
import { extension } from "./extension"
import { log } from "./logger"
import { telemetry } from "./telemetry"
import { httpPost } from "./utils"

class TelemetrySync {
  SCHEDULE_NAME = "telemetry-push"
  PRE_EXPIRY_SCHEDULE_NAME = "telemetry-push-before-expiry"

  /** Hourly: the platform dates a push by when it arrives, so this bounds how far usage can be misdated. */
  SCHEDULE_INTERVAL = 60

  /** The platform only accepts usage while the subscription is live, so the last of it goes out just before. */
  PRE_EXPIRY_LEAD_MS = 60 * 1000

  constructor() {
    eventBroker()
      .on(EVENT.TELEMETRY.PUSH, () => this.push())
      .on(EVENT.EXTENSION.SUBSCRIPTION_ACTIVE, () => this.schedulePushBeforeExpiry())

    schedule
      .on([this.SCHEDULE_NAME, this.PRE_EXPIRY_SCHEDULE_NAME], () => this.push())
      .create(this.SCHEDULE_NAME, { periodInMinutes: this.SCHEDULE_INTERVAL })
  }

  async push() {
    // The push alarm can fire the instant the worker wakes up, before the stored state is back.
    await Promise.all([telemetry().ready, extension().ready])

    if (!extension().isSubscriptionActive()) {
      // Kept rather than discarded: a renewal that lands late makes it sendable again.
      log("warn", "[telemetry-sync]", "Inactive subscription. Skip telemetry push.")
      return
    }

    const extensionToken = extension().getExtensionToken()
    if (!extensionToken) {
      log("warn", "[telemetry-sync]", "Extension token is empty. Skip telemetry push.")
      return
    }

    const observations = telemetry().export()
    if (!observations.length) {
      log("warn", "[telemetry-sync]", "No useful telemetry data. Skip telemetry push.")
      return
    }

    const payload = {
      client: {
        source: "extension",
        extension: { version: chrome.runtime.getManifest().version },
      },
      data: {
        observations,
      },
    }

    try {
      const config = await getConfig()
      await httpPost(config.DATA_INGEST.INGEST_URL, extensionToken, payload)
      await telemetry().acknowledge(observations)

      log("info", "[telemetry-sync]", "Telemetry pushed.")
    } catch (error) {
      log(
        "error",
        "[telemetry-sync]",
        "Sync error",
        (error as ExtensionError)?.message,
        (error as ExtensionError)?.cause
      )
    }
  }

  private async schedulePushBeforeExpiry() {
    const expiresAt = extension().getExtensionData().subscription?.expiresAt ?? 0
    const when = expiresAt - this.PRE_EXPIRY_LEAD_MS

    if (when > Date.now()) await schedule.recreate(this.PRE_EXPIRY_SCHEDULE_NAME, { when })
  }
}

const singleton = new TelemetrySync()
export const telemetrySync = () => singleton
