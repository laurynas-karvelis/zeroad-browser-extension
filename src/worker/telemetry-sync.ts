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
  SCHEDULE_INTERVAL = 60 * 24 // Every 24 hours

  constructor() {
    eventBroker().on(EVENT.TELEMETRY.PUSH, () => this.push())
    schedule
      .on(this.SCHEDULE_NAME, () => eventBroker().emit(EVENT.TELEMETRY.PUSH))
      .create(this.SCHEDULE_NAME, { periodInMinutes: this.SCHEDULE_INTERVAL })
  }

  async push() {
    // The push alarm can fire the instant the worker wakes up, before the stored map is back.
    await telemetry().ready

    if (!extension().isSubscriptionActive()) {
      eventBroker().emit(EVENT.TELEMETRY.FLUSH)
      log("warn", "[telemetry-sync]", "Inactive subscription. Skip telemetry push and flush its data.")
      return
    }

    const telemetryToken = extension().getTelemetryToken()
    if (!telemetryToken) {
      log("warn", "[telemetry-sync]", "Telemetry token is empty. Skip telemetry push.")
      return
    }

    const telemetryData = telemetry().export()
    if (!Object.keys(telemetryData).length) {
      log("warn", "[telemetry-sync]", "No useful telemetry data. Skip telemetry push.")
      return
    }

    const payload = {
      client: {
        source: "extension",
        extension: { version: chrome.runtime.getManifest().version },
      },
      data: {
        publishers: telemetryData,
      },
    }

    try {
      const config = await getConfig()
      await httpPost(config.DATA_INGEST.INGEST_URL, telemetryToken, payload)
      eventBroker().emit(EVENT.TELEMETRY.FLUSH)

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
}

const singleton = new TelemetrySync()
export const telemetrySync = () => singleton
