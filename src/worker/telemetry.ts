import { TabTrackerPartnerDetectedData } from "./tab-tracker";
import { EVENT, eventBroker, EventType } from "./event-broker";
import { arraysEqual, getHostname } from "./utils";
import { extension } from "./extension";
import { Hostname } from "./types";

export type Entry = {
  clientId: TabTrackerPartnerDetectedData["clientId"];
  features: TabTrackerPartnerDetectedData["features"];
  views: number;
  duration: number;
};

type StoredTelemetryMap = Record<Hostname, Entry>;
type TelemetryExportData = Record<string, { views: number; duration: number; hosts: Hostname[] }>;

const SAVE_DEBOUNCE_DELAY = 5000;

export class Telemetry {
  map: Map<Hostname, Entry> = this.createMap();
  private saveTimeout?: ReturnType<typeof setTimeout>;

  constructor() {
    this.load();

    eventBroker()
      .on<TabTrackerPartnerDetectedData>(EVENT.TAB_TRACKER.PARTNER_DETECTED, ({ clientId, url, features }) =>
        this.addEntry(clientId, url, features)
      )
      .on(EVENT.TELEMETRY.FLUSH, () => this.softReset())
      .on(EVENT.EXTENSION.SUBSCRIPTION_EXPIRED, () => this.softReset())
      .on(EVENT.EXTENSION.REQUEST_RESET, () => this.softReset());
  }

  private createMap(record?: StoredTelemetryMap) {
    return new Map<Hostname, Entry>(Object.entries(record || {}));
  }

  private exportMap(): StoredTelemetryMap {
    return Object.fromEntries(this.map);
  }

  private async softReset() {
    this.map.values().forEach((entry) => {
      entry.views = 0;
      entry.duration = 0;
    });

    return this.save();
  }

  private save() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);

    this.saveTimeout = setTimeout(() => {
      chrome.storage.local.set<{ telemetry: StoredTelemetryMap }>({ telemetry: this.exportMap() });
      this.saveTimeout = undefined;
    }, SAVE_DEBOUNCE_DELAY);
  }

  private async load() {
    const { telemetry } = await chrome.storage.local.get<{ telemetry: StoredTelemetryMap }>(["telemetry"]);
    this.map = this.createMap(telemetry);

    this.map.entries().forEach(([key, entry]) => {
      if (!entry.views && !entry.duration) {
        // Clean-up potentially old entries
        this.map.delete(key);
      }
    });

    this.save();
  }

  private addEntry(clientId: Entry["clientId"], url: string, features: Entry["features"]) {
    const hostname = getHostname(url);

    if (!hostname || !clientId) return;

    if (!this.map.has(hostname)) {
      this.map.set(hostname, { clientId, features, views: 0, duration: 0 });
      this.save();

      eventBroker().emit(EVENT.TELEMETRY.PARTNER_ADDED, { clientId });
    } else {
      const entry = this.map.get(hostname)!;

      let shouldSave = false;

      if (entry.clientId !== clientId) {
        entry.views = 0;
        entry.duration = 0;

        shouldSave = true;
      }

      if (!arraysEqual(features, entry.features || [])) {
        entry.features = features;
        shouldSave = true;
      }

      if (shouldSave) {
        this.save();
      }
    }
  }

  hasPartnerEntryByUrl(url: string | undefined): boolean {
    if (!url) return false;
    return this.map.has(getHostname(url));
  }

  findPartnerEntryByUrl(url: string | undefined): Entry | undefined {
    if (!url) return undefined;
    return this.map.get(getHostname(url));
  }

  private incrementStat(url: string | undefined, key: "views" | "duration", amount: number, eventName: EventType) {
    if (!url || !Number.isFinite(amount) || amount <= 0) return;

    const hostname = getHostname(url);
    const entry = this.map.get(hostname);

    if (!entry) return;
    if (!extension().isSubscriptionActive()) return;

    entry[key] += amount;

    if (key === "duration" && !entry.views) {
      // After the subscription is applied while partnered sites are already loaded in tabs,
      // it can be that duration will be bumped up, but the views haven't been set yet.
      // Hence, set `views` to 1
      entry.views = 1;
    }

    this.save();
    eventBroker().emit(eventName, { clientId: entry.clientId, [key]: amount });
  }

  addViews(url: string | undefined) {
    this.incrementStat(url, "views", 1, EVENT.TELEMETRY.VIEWS_ADDED);
  }

  addDuration(url: string | undefined, duration: number) {
    this.incrementStat(url, "duration", duration, EVENT.TELEMETRY.DURATION_ADDED);
  }

  export() {
    const data: TelemetryExportData = {};

    for (const [hostname, { clientId, views, duration }] of this.map) {
      if (!views || !duration) continue;

      if (!data[clientId]) {
        data[clientId] = { views, duration, hosts: [hostname] };
      } else {
        data[clientId].views += views;
        data[clientId].duration += duration;
        data[clientId].hosts.push(hostname);
      }
    }

    return data;
  }
}

const singleton = new Telemetry();
export const telemetry = () => singleton;
