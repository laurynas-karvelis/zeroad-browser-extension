import { getConfig } from "./config"
import { credentials } from "./credentials"
import { EVENT, eventBroker } from "./event-broker"
import { headerInjection } from "./header-injection"
import { log, setLogLevel } from "./logger"
import { telemetrySync } from "./telemetry-sync"
import type { ExtensionSyncData, SubscriptionExtensionData, UserExtensionData } from "./types"
import { inDevMode } from "./utils"

class Extension {
  private state: {
    user?: UserExtensionData
    subscription?: SubscriptionExtensionData
    isHeaderInjectionPaused: boolean
  } = { isHeaderInjectionPaused: false }

  constructor() {
    inDevMode().then((devMode) => setLogLevel((devMode && "debug") || "warn"))

    this.setupLinks()
    this.load()

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

  getRefreshToken() {
    return this.state.user?.refreshToken
  }

  getTelemetryToken() {
    return this.state.subscription?.telemetryToken
  }

  getExtensionToken() {
    return this.state.subscription?.extensionToken
  }

  isSubscriptionActive() {
    if (!this.state.subscription) return false
    if (!this.state.subscription?.extensionToken) return false
    if (!this.state.subscription?.expiresAt) return false

    return this.state.subscription.expiresAt > Date.now()
  }

  pause() {
    this.state.isHeaderInjectionPaused = true
    return headerInjection().removeBaseRule()
  }

  resume() {
    this.state.isHeaderInjectionPaused = false
    return headerInjection().enableBaseRule()
  }

  isPaused() {
    return this.state.isHeaderInjectionPaused
  }

  private async load() {
    const { user, subscription } = await chrome.storage.sync.get<ExtensionSyncData>(["user", "subscription"])

    this.state.user = user
    this.state.subscription = subscription
    this.state.isHeaderInjectionPaused = false

    if (this.isSubscriptionActive()) {
      // Schedule for subscription data reload
      await credentials().enableRenewal(this.state.subscription?.expiresAt || 0)
      eventBroker().emit(EVENT.EXTENSION.SUBSCRIPTION_ACTIVE)
    } else {
      if (!this.state.user?.refreshToken) await credentials().cancelRenewal()
      eventBroker().emit(EVENT.EXTENSION.SUBSCRIPTION_EXPIRED)
    }
  }

  private async reload(payload: ExtensionSyncData) {
    const { user, subscription } = payload || {}

    // A payload can arrive straight from the website, so it is not trusted to be well-formed.
    if (!user?.refreshToken) {
      log("warn", "[extension]", "Ignoring a sync payload that carries no refresh token")
      return
    }

    if (this.state.user?.refreshToken && this.state.user?.refreshToken !== user.refreshToken) {
      // Switching to another user, push telemetry
      await telemetrySync().push()
    }

    const hasNewExtensionToken =
      !!subscription?.extensionToken && subscription.extensionToken !== this.state.subscription?.extensionToken

    if (subscription) {
      await chrome.storage.sync.set<ExtensionSyncData>({ user, subscription })
    } else {
      // The subscription is gone (cancelled, lapsed) - drop the stored one rather than writing
      // `undefined` over it, which `storage.sync` would keep as-is.
      await chrome.storage.sync.set<Pick<ExtensionSyncData, "user">>({ user })
      await chrome.storage.sync.remove(["subscription"])
    }

    if (hasNewExtensionToken) eventBroker().emit(EVENT.EXTENSION.SYNCED)

    // Always reload. Reloading only for a brand new token left a cancelled or downgraded
    // subscription live in memory, so header injection kept running on credentials the
    // server had already withdrawn.
    return this.load()
  }

  private async reset() {
    this.state = { isHeaderInjectionPaused: false }
    await Promise.all([chrome.storage.local.clear(), chrome.storage.sync.clear(), chrome.alarms.clearAll()])
  }
}

const singleton = new Extension()
export const extension = () => singleton
