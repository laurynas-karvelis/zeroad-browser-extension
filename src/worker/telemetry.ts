import { EVENT, type EventType, eventBroker } from "./event-broker"
import { extension } from "./extension"
import type { TabTrackerPublisherDetectedData } from "./tab-tracker"
import type { Hostname } from "./types"
import { getHostname } from "./utils"

export type Entry = {
  /** The publisher this hostname announced itself as belonging to, for crediting the visit. */
  publisherId: TabTrackerPublisherDetectedData["publisherId"]
  /** Where the id was found. Decides the monetization tier server-side, so it has to travel with the visit. */
  source: TabTrackerPublisherDetectedData["source"]
  views: number
  duration: number
}

type StoredTelemetryMap = Record<Hostname, Entry>

/**
 * What gets sent: a flat list of observations, one per hostname visited, each self-identifying with the
 * publisher it announced, where that id was found, and the views and dwell time earned there.
 *
 * Per hostname rather than per publisher total, because a publisher with several sites needs each of
 * them credited on its own, and this is the only place that knows which site the time was spent on.
 * The shape is exactly what `POST /extension/telemetry` accepts - see `ExtensionTelemetryObservation`.
 */
export type TelemetryObservation = {
  publisherId: string
  source: TabTrackerPublisherDetectedData["source"]
  hostname: Hostname
  views: number
  duration: number
}

export type TelemetryExportData = TelemetryObservation[]

export class Telemetry {
  map = new Map<Hostname, Entry>()

  /**
   * Resolves once the stored map has been read back. A service worker restarts constantly, so
   * anything reading the map right after start-up (a push alarm, most notably) must await this
   * or it will see an empty map and conclude there is nothing to send.
   */
  readonly ready: Promise<void>

  constructor() {
    this.ready = this.load()

    eventBroker()
      .on<TabTrackerPublisherDetectedData>(EVENT.TAB_TRACKER.PUBLISHER_DETECTED, ({ publisherId, source, url }) =>
        this.addEntry(publisherId, source, url)
      )
      .on(EVENT.EXTENSION.REQUEST_RESET, () => this.clear())
  }

  /**
   * Takes a successfully pushed batch off the counters. Subtracted rather than zeroed, so whatever was
   * recorded while the upload was in flight stays for the next push.
   */
  acknowledge(observations: TelemetryExportData) {
    for (const { hostname, publisherId, views, duration } of observations) {
      const entry = this.map.get(hostname)

      // The hostname changed hands mid-flight, and its counters already started over for the new owner.
      if (!entry || entry.publisherId !== publisherId) continue

      entry.views = Math.max(0, entry.views - views)
      entry.duration = Math.max(0, entry.duration - duration)
    }

    return this.save()
  }

  private clear() {
    this.map.clear()
    return this.save()
  }

  // Written through rather than debounced: the worker can be torn down at any moment, and the map is small.
  private save() {
    return chrome.storage.local.set<{ telemetry: StoredTelemetryMap }>({ telemetry: Object.fromEntries(this.map) })
  }

  private async load() {
    const { telemetry } = await chrome.storage.local.get<{ telemetry: StoredTelemetryMap }>(["telemetry"])

    // Merged into, not swapped for, the in-memory map: an event can land before this read returns.
    // Entries with nothing left to send are dropped - the site is simply rediscovered on its next visit.
    for (const [hostname, stored] of Object.entries(telemetry || {})) {
      const current = this.map.get(hostname)

      if (!current) {
        if (stored.views || stored.duration) this.map.set(hostname, stored)
      } else if (current.publisherId === stored.publisherId) {
        current.views += stored.views
        current.duration += stored.duration
      }
    }

    await this.save()
  }

  private addEntry(publisherId: Entry["publisherId"], source: Entry["source"], url: string) {
    const hostname = getHostname(url)

    if (!hostname || !publisherId) return

    const entry = this.map.get(hostname)

    if (!entry) {
      this.map.set(hostname, { publisherId, source, views: 0, duration: 0 })
      this.save()

      eventBroker().emit(EVENT.TELEMETRY.PUBLISHER_ADDED, { publisherId })
      return
    }

    if (entry.publisherId !== publisherId) {
      // The hostname changed hands: adopt the new owner and drop counters the old one earned.
      entry.publisherId = publisherId
      entry.source = source
      entry.views = 0
      entry.duration = 0

      this.save()
    } else if (source === "header" && entry.source !== "header") {
      // A stronger proof arrived for the same publisher - a response header outranks a meta tag.
      entry.source = source
      this.save()
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
    const observations: TelemetryExportData = []

    for (const [hostname, { publisherId, source, views, duration }] of this.map) {
      // Anything with activity ships. A view with no dwell time is still a visit, and if it is
      // dropped here it is never reported at all - `acknowledge` takes it off after the push.
      if (!views && !duration) continue

      observations.push({ publisherId, source, hostname, views, duration })
    }

    return observations
  }
}

const singleton = new Telemetry()
export const telemetry = () => singleton
