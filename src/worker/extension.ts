import { getConfig } from "./config"
import { credentials } from "./credentials"
import { EVENT, eventBroker } from "./event-broker"
import { headerInjection } from "./header-injection"
import { log, setLogLevel } from "./logger"
import { telemetrySync } from "./telemetry-sync"
import type { ExtensionSyncData, SubscriptionExtensionData, UserExtensionData, WebsiteTestAccess } from "./types"
import { inDevMode } from "./utils"

type StoredTestAccess = { websiteTest?: { extensionToken: string; access: WebsiteTestAccess } }

type StoredPause = { isHeaderInjectionPaused?: boolean }

class Extension {
  private state: {
    user?: UserExtensionData
    subscription?: SubscriptionExtensionData
    testAccess?: WebsiteTestAccess
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
    return {
      user: this.state.user,
      subscription: this.state.testAccess ?? this.state.subscription,
      testAccess: this.state.testAccess,
    }
  }

  getExtensionToken() {
    return this.state.user?.extensionToken
  }

  isSubscriptionActive() {
    return (this.getExtensionData().subscription?.expiresAt ?? 0) > Date.now()
  }

  hasPaidSubscription() {
    const subscription = this.state.subscription
    return !!subscription && !subscription.hostname && subscription.expiresAt > Date.now()
  }

  canRecordUsage() {
    return !this.state.testAccess && this.hasPaidSubscription()
  }

  async stopTesting() {
    await this.ready
    eventBroker().emit(EVENT.EXTENSION.ACCESS_WILL_CHANGE)
    await chrome.storage.local.remove(["websiteTest"])
    this.state.testAccess = undefined
    await credentials().cancelRenewal()
    await this.load()
    await headerInjection().reset()
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

  async sync(payload: ExtensionSyncData): Promise<boolean> {
    await this.ready
    if (!payload?.user?.extensionToken) return false

    await this.reload(payload)

    const { subscription } = this.getExtensionData()
    if (subscription?.visitorToken) {
      await headerInjection().reset()
      if (!subscription.hostname || !headerInjection().installedHostnames().includes(subscription.hostname))
        return false
    }

    return true
  }

  private async load() {
    const [{ user, subscription }, { isHeaderInjectionPaused, websiteTest }] = await Promise.all([
      chrome.storage.sync.get<ExtensionSyncData>(["user", "subscription"]),
      chrome.storage.local.get<StoredPause & StoredTestAccess>(["isHeaderInjectionPaused", "websiteTest"]),
    ])

    this.state.user = user
    this.state.subscription = subscription
    this.state.testAccess = websiteTest?.extensionToken === user?.extensionToken ? websiteTest?.access : undefined
    this.state.isHeaderInjectionPaused = !!isHeaderInjectionPaused

    if (this.isSubscriptionActive()) {
      // Schedule for subscription data reload
      await credentials().enableRenewal(this.getExtensionData().subscription?.expiresAt || 0)
      eventBroker().emit(EVENT.EXTENSION.SUBSCRIPTION_ACTIVE)
    } else {
      if (this.state.testAccess) await credentials().enableRenewal(Date.now() + 1000)
      if (!this.state.user?.extensionToken) await credentials().cancelRenewal()
      eventBroker().emit(EVENT.EXTENSION.SUBSCRIPTION_EXPIRED)
    }
  }

  private async reload(payload: ExtensionSyncData) {
    const { user, subscription, testAccess } = payload || {}

    // A payload can arrive straight from the website, so it is not trusted to be well-formed.
    if (!user?.extensionToken) {
      log("warn", "[extension]", "Ignoring a sync payload that carries no extension token")
      return
    }

    eventBroker().emit(EVENT.EXTENSION.ACCESS_WILL_CHANGE)
    const previousToken = this.state.user?.extensionToken

    if (previousToken && previousToken !== user.extensionToken) {
      // Switching to another user, push telemetry
      await telemetrySync().push()
    }

    // Whether this sync brought a token we did not have before - a first install, or a switch to a
    // different user. A repeat sync of the same token is not news and must not re-announce.
    const hasNewToken = previousToken !== user.extensionToken

    if (hasNewToken) await chrome.storage.local.remove(["websiteTest"])
    if (testAccess?.hostname && testAccess.visitorToken) {
      await chrome.storage.local.set<StoredTestAccess>({
        websiteTest: { extensionToken: user.extensionToken, access: testAccess },
      })
    }

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
