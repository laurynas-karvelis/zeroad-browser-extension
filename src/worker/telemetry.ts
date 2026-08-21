import { EVENT, type EventType, eventBroker } from "./event-broker"
import { extension } from "./extension"
import type { TabTrackerPublisherDetectedData } from "./tab-tracker"
import type { Hostname } from "./types"
import { getHostname } from "./utils"

export type Entry = {
  /** The publisher this hostname announced itself as belonging to, for crediting the visit. */
  publisherId: TabTrackerPublisherDetectedData["publisherId"]
  views: number
  duration: number
}

type StoredTelemetryMap = Record<Hostname, Entry>

/**
 * What gets sent: every hostname visited, grouped under the publisher that claimed it, with the views
 * and dwell time for each one kept separate.
 *
 * Per hostname rather than per publisher total, because a publisher with several sites needs each of
 * them credited on its own, and this is the only place that knows which site the time was spent on.
 */
export type TelemetryExportData = Record<string, { hostnames: Record<Hostname, { views: number; duration: number }> }>

const SAVE_DEBOUNCE_DELAY = 5000

export class Telemetry {
  map: Map<Hostname, Entry> = this.createMap()

  /**
   * Resolves once the stored map has been read back. A service worker restarts constantly, so
   * anything reading the map right after start-up (a push alarm, most notably) must await this
   * or it will see an empty map and conclude there is nothing to send.
   */
  readonly ready: Promise<void>

  private saveTimeout?: ReturnType<typeof setTimeout>

  /** @param saveDebounceDelay how long writes are coalesced for - only lowered by tests. */
  constructor(private readonly saveDebounceDelay = SAVE_DEBOUNCE_DELAY) {
    this.ready = this.load()

    eventBroker()
      .on<TabTrackerPublisherDetectedData>(EVENT.TAB_TRACKER.PUBLISHER_DETECTED, ({ publisherId, url }) =>
        this.addEntry(publisherId, url)
      )
      .on(EVENT.TELEMETRY.FLUSH, () => this.softReset())
      .on(EVENT.EXTENSION.SUBSCRIPTION_EXPIRED, () => this.softReset())
      .on(EVENT.EXTENSION.REQUEST_RESET, () => this.softReset())
  }

  private createMap(record?: StoredTelemetryMap) {
    return new Map<Hostname, Entry>(Object.entries(record || {}))
  }

  private exportMap(): StoredTelemetryMap {
    return Object.fromEntries(this.map)
  }

  private async softReset() {
    this.map.values().forEach((entry) => {
      entry.views = 0
      entry.duration = 0
    })

    return this.save()
  }

  private save() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout)

    this.saveTimeout = setTimeout(() => {
      chrome.storage.local.set<{ telemetry: StoredTelemetryMap }>({
        telemetry: this.exportMap(),
      })
      this.saveTimeout = undefined
    }, this.saveDebounceDelay)
  }

  private async load() {
    const { telemetry } = await chrome.storage.local.get<{
      telemetry: StoredTelemetryMap
    }>(["telemetry"])
    this.map = this.createMap(telemetry)

    // Clean-up potentially old entries
    const toDelete: Hostname[] = []
    for (const [key, entry] of this.map.entries()) {
      if (!entry.views && !entry.duration) {
        toDelete.push(key)
      }
    }
    toDelete.forEach((key) => this.map.delete(key))

    this.save()
  }

  private addEntry(publisherId: Entry["publisherId"], url: string) {
    const hostname = getHostname(url)

    if (!hostname || !publisherId) return

    if (!this.map.has(hostname)) {
      this.map.set(hostname, { publisherId, views: 0, duration: 0 })
      this.save()

      eventBroker().emit(EVENT.TELEMETRY.PUBLISHER_ADDED, { publisherId })
    } else {
      const entry = this.map.get(hostname)
      if (!entry) return

      if (entry.publisherId !== publisherId) {
        // The hostname changed hands: adopt the new owner and drop counters the old one earned.
        entry.publisherId = publisherId
        entry.views = 0
        entry.duration = 0

        this.save()
      }
    }
  }

  hasPublisherEntryByUrl(url: string | undefined): boolean {
    if (!url) return false
    return this.map.has(getHostname(url))
  }

  findPublisherEntryByUrl(url: string | undefined): Entry | undefined {
    if (!url) return undefined
    return this.map.get(getHostname(url))
  }

  private incrementStat(url: string | undefined, key: "views" | "duration", amount: number, eventName: EventType) {
    if (!url || !Number.isFinite(amount) || amount <= 0) return

    const hostname = getHostname(url)
    const entry = this.map.get(hostname)

    if (!entry) return
    if (!extension().isSubscriptionActive()) return

    entry[key] += amount

    if (key === "duration" && !entry.views) {
      // After the subscription is applied while publishered sites are already loaded in tabs,
      // it can be that duration will be bumped up, but the views haven't been set yet.
      // Hence, set `views` to 1
      entry.views = 1
    }

    this.save()
    eventBroker().emit(eventName, { publisherId: entry.publisherId, [key]: amount })
  }

  addViews(url: string | undefined) {
    this.incrementStat(url, "views", 1, EVENT.TELEMETRY.VIEWS_ADDED)
  }

  addDuration(url: string | undefined, duration: number) {
    this.incrementStat(url, "duration", duration, EVENT.TELEMETRY.DURATION_ADDED)
  }

  export(): TelemetryExportData {
    const data: TelemetryExportData = {}

    for (const [hostname, { publisherId, views, duration }] of this.map) {
      // Anything with activity ships. A view with no dwell time is still a visit, and if it is
      // dropped here it is never reported at all - `softReset` zeroes the entry on the next flush.
      if (!views && !duration) continue

      if (!data[publisherId]) data[publisherId] = { hostnames: {} }

      data[publisherId].hostnames[hostname] = { views, duration }
    }

    return data
  }
}

const singleton = new Telemetry()
export const telemetry = () => singleton
