import { EVENT, eventBroker } from "./event-broker";
import { ExtensionError } from "./error";
import { telemetry } from "./telemetry";
import { extension } from "./extension";
import { getConfig } from "./config";
import { httpPost } from "./utils";
import { schedule } from "./alarm";
import { log } from "./logger";

class TelemetrySync {
  SCHEDULE_NAME = "telemetry-push";
  SCHEDULE_INTERVAL = 60 * 24; // Every 24 hours

  constructor() {
    eventBroker().on(EVENT.TELEMETRY.PUSH, () => this.push());
    schedule
      .on(this.SCHEDULE_NAME, () => eventBroker().emit(EVENT.TELEMETRY.PUSH))
      .create(this.SCHEDULE_NAME, { periodInMinutes: this.SCHEDULE_INTERVAL });
  }

  async push() {
    if (!extension().isSubscriptionActive()) {
      eventBroker().emit(EVENT.TELEMETRY.FLUSH);
      log("warn", "[telemetry-sync]", "Inactive subscription. Skip telemetry push and flush its data.");
      return;
    }

    const telemetryToken = extension().getTelemetryToken();
    if (!telemetryToken) {
      log("warn", "[telemetry-sync]", "Telemetry token is empty. Skip telemetry push.");
      return;
    }

    const telemetryData = telemetry().export();
    if (!Object.keys(telemetryData).length) {
      log("warn", "[telemetry-sync]", "No useful telemetry data. Skip telemetry push.");
      return;
    }

    const payload = {
      client: {
        source: "extension",
        extension: { version: chrome.runtime.getManifest().version },
      },
      data: {
        sites: telemetryData,
      },
    };

    try {
      const config = await getConfig();
      await httpPost(config.DATA_INGEST.INGEST_URL, telemetryToken, payload);
      eventBroker().emit(EVENT.TELEMETRY.FLUSH);

      log("info", "[telemetry-sync]", "Telemetry pushed.");
    } catch (error) {
      log(
        "error",
        "[telemetry-sync]",
        "Sync error",
        (error as ExtensionError)?.message,
        (error as ExtensionError)?.cause
      );
    }
  }
}

const singleton = new TelemetrySync();
export const telemetrySync = () => singleton;
