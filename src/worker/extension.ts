import { getConfig } from "./config"
import { credentials } from "./credentials"
import { EVENT, eventBroker } from "./event-broker"
import { headerInjection } from "./header-injection"
import { log, setLogLevel } from "./logger"
import { telemetrySync } from "./telemetry-sync"
import type { ExtensionSyncData, SubscriptionExtensionData, UserExtensionData } from "./types"
import { inDevMode } from "./utils"

type StoredPause = { isHeaderInjectionPaused?: boolean }

class Extension {
  private state: {
    user?: UserExtensionData
    subscription?: SubscriptionExtensionData
    isHeaderInjectionPaused: boolean
  } = { isHeaderInjectionPaused: false }

  /**
   * Resolves once the stored state has been read back. The worker is usually woken by the very event it
   * then handles, so anything reading this state from an event handler must await this first, or it
   * sees a signed-out, unsubscribed extension and drops the event.
   */
  readonly ready: Promise<void>

  constructor() {
    inDevMode().then((devMode) => setLogLevel((devMode && "debug") || "warn"))

    this.setupLinks()
    this.ready = this.load()

    eventBroker()
      .on<ExtensionSyncData>(EVENT.EXTENSION.PAYLOAD_RECEIVED, (payload) => this.reload(payload))
      .on(EVENT.EXTENSION.REQUEST_RESET, async () => {
        await this.reset()
        await this.load()
      })
  }

  private setupLinks() {
    chrome.runtime.onInstalled.addListener(async (details) => {
      if (details.reason !== chrome.runtime.OnInstalledReason.INSTALL) return

      const config = await getConfig()

      chrome.runtime.setUninstallURL(config.GENERIC.UNINSTALL_URL)
      await chrome.tabs.create({ url: config.GENERIC.ONBOARDING_URL })
    })
  }

  getExtensionData() {
    return { user: this.state.user, subscription: this.state.subscription }
  }

  getExtensionToken() {
    return this.state.user?.extensionToken
  }

  isSubscriptionActive() {
    if (!this.state.subscription) return false
    if (!this.state.subscription?.expiresAt) return false

    // No longer gated on a server-minted token: there is none. What makes injection possible is a
    // stocked token pool, and `headerInjection` already declines when the pool is empty.
    return this.state.subscription.expiresAt > Date.now()
  }

  // Stored, not just held in memory: the worker restarts constantly, and a pause that silently lifted
  // itself within a minute would not be a pause.
  async pause() {
    // Otherwise the initial load, still in flight, would overwrite the pause with the stored state
    await this.ready
    this.state.isHeaderInjectionPaused = true
    await chrome.storage.local.set<StoredPause>({ isHeaderInjectionPaused: true })
    return headerInjection().removeAllRules()
  }

  async resume() {
    await this.ready
    this.state.isHeaderInjectionPaused = false
    await chrome.storage.local.remove<StoredPause>(["isHeaderInjectionPaused"])
    return headerInjection().reset()
  }

  isPaused() {
    return this.state.isHeaderInjectionPaused
  }

  private async load() {
    const [{ user, subscription }, { isHeaderInjectionPaused }] = await Promise.all([
      chrome.storage.sync.get<ExtensionSyncData>(["user", "subscription"]),
      chrome.storage.local.get<StoredPause>(["isHeaderInjectionPaused"]),
    ])

    this.state.user = user
    this.state.subscription = subscription
    this.state.isHeaderInjectionPaused = !!isHeaderInjectionPaused

    if (this.isSubscriptionActive()) {
      // Schedule for subscription data reload
      await credentials().enableRenewal(this.state.subscription?.expiresAt || 0)
      eventBroker().emit(EVENT.EXTENSION.SUBSCRIPTION_ACTIVE)
    } else {
      if (!this.state.user?.extensionToken) await credentials().cancelRenewal()
      eventBroker().emit(EVENT.EXTENSION.SUBSCRIPTION_EXPIRED)
    }
  }

  private async reload(payload: ExtensionSyncData) {
    const { user, subscription } = payload || {}

    // A payload can arrive straight from the website, so it is not trusted to be well-formed.
    if (!user?.extensionToken) {
      log("warn", "[extension]", "Ignoring a sync payload that carries no extension token")
      return
    }

    const previousToken = this.state.user?.extensionToken

    if (previousToken && previousToken !== user.extensionToken) {
      // Switching to another user, push telemetry
      await telemetrySync().push()
    }

    // Whether this sync brought a token we did not have before - a first install, or a switch to a
    // different user. A repeat sync of the same token is not news and must not re-announce.
    const hasNewToken = previousToken !== user.extensionToken

    if (subscription) {
      await chrome.storage.sync.set<ExtensionSyncData>({ user, subscription })
    } else {
      // The subscription is gone (cancelled, lapsed) - drop the stored one rather than writing
      // `undefined` over it, which `storage.sync` would keep as-is.
      await chrome.storage.sync.set<Pick<ExtensionSyncData, "user">>({ user })
      await chrome.storage.sync.remove(["subscription"])
    }

    // Only a token that was unset before or has changed is worth announcing - that is what the badge's
    // "ON" confirmation keys off.
    if (hasNewToken) eventBroker().emit(EVENT.EXTENSION.SYNCED)

    // Always reload. Reloading only on a change left a cancelled or downgraded subscription live in
    // memory, so header injection kept running on credentials the server had already withdrawn.
    return this.load()
  }

  private async reset() {
    this.state = { isHeaderInjectionPaused: false }
    await Promise.all([chrome.storage.local.clear(), chrome.storage.sync.clear(), chrome.alarms.clearAll()])
  }
}

const singleton = new Extension()
export const extension = () => singleton
