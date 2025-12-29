import { ExtensionSyncData, SubscriptionExtensionData, UserExtensionData } from "./types";
import { headerInjection } from "./header-injection";
import { EVENT, eventBroker } from "./event-broker";
import { telemetrySync } from "./telemetry-sync";
import { credentials } from "./credentials";
import { setLogLevel } from "./logger";
import { getConfig } from "./config";
import { inDevMode } from "./utils";

class Extension {
  private state: {
    user?: UserExtensionData;
    subscription?: SubscriptionExtensionData;
    isHeaderInjectionPaused: boolean;
  } = { isHeaderInjectionPaused: false };

  constructor() {
    inDevMode().then((devMode) => setLogLevel((devMode && "debug") || "warn"));

    this.setupLinks();
    this.load();

    eventBroker()
      .on<ExtensionSyncData>(EVENT.EXTENSION.PAYLOAD_RECEIVED, (payload) => this.reload(payload))
      .on(EVENT.EXTENSION.REQUEST_RESET, async () => {
        await this.reset();
        await this.load();
      });
  }

  private setupLinks() {
    chrome.runtime.onInstalled.addListener(async (details) => {
      if (details.reason !== chrome.runtime.OnInstalledReason.INSTALL) return;

      const config = await getConfig();

      chrome.runtime.setUninstallURL(config.GENERIC.UNINSTALL_URL);
      await chrome.tabs.create({ url: config.GENERIC.ONBOARDING_URL });
    });
  }

  getExtensionData() {
    return { user: this.state.user, subscription: this.state.subscription };
  }

  getRefreshToken() {
    return this.state.user?.refreshToken;
  }

  getTelemetryToken() {
    return this.state.subscription?.telemetryToken;
  }

  getExtensionToken() {
    return this.state.subscription?.extensionToken;
  }

  isSubscriptionActive() {
    if (!this.state.subscription) return false;
    if (!this.state.subscription?.extensionToken) return false;
    if (!this.state.subscription?.expiresAt) return false;

    return this.state.subscription.expiresAt > Date.now();
  }

  pause() {
    this.state.isHeaderInjectionPaused = true;
    return headerInjection().removeBaseRule();
  }

  resume() {
    this.state.isHeaderInjectionPaused = false;
    return headerInjection().enableBaseRule();
  }

  isPaused() {
    return this.state.isHeaderInjectionPaused;
  }

  private async load() {
    const { user, subscription } = await chrome.storage.sync.get<ExtensionSyncData>(["user", "subscription"]);

    this.state.user = user;
    this.state.subscription = subscription;
    this.state.isHeaderInjectionPaused = false;

    if (this.isSubscriptionActive()) {
      // Schedule for subscription data reload
      await credentials().enableRenewal(this.state.subscription?.expiresAt || 0);
      eventBroker().emit(EVENT.EXTENSION.SUBSCRIPTION_ACTIVE);
    } else {
      if (!this.state.user?.refreshToken) await credentials().cancelRenewal();
      eventBroker().emit(EVENT.EXTENSION.SUBSCRIPTION_EXPIRED);
    }
  }

  private async reload(payload: ExtensionSyncData) {
    const { user, subscription } = payload;

    if (this.state.user?.refreshToken && this.state.user?.refreshToken !== user.refreshToken) {
      // Switching to another user, push telemetry
      await telemetrySync().push();
    }

    await chrome.storage.sync.set<ExtensionSyncData>({ user, subscription });

    if (subscription?.extensionToken && subscription?.extensionToken !== this.state.subscription?.extensionToken) {
      // We got a new extension token
      eventBroker().emit(EVENT.EXTENSION.SYNCED);
      return this.load();
    }
  }

  private async reset() {
    this.state = { isHeaderInjectionPaused: false };
    await Promise.all([chrome.storage.local.clear(), chrome.storage.sync.clear(), chrome.alarms.clearAll()]);
  }
}

const singleton = new Extension();
export const extension = () => singleton;
