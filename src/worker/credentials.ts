import { EVENT, eventBroker } from "./event-broker";
import { ExtensionSyncData } from "./types";
import { extension } from "./extension";
import { getConfig } from "./config";
import { httpPost } from "./utils";
import { schedule } from "./alarm";
import { log } from "./logger";

type StoredAttempt = { renewalAttempts: number };

const getAttempt = async () => {
  const { renewalAttempts } = await chrome.storage.local.get<StoredAttempt>(["renewalAttempts"]);
  return renewalAttempts || 0;
};

const increaseAttempt = async () => {
  return chrome.storage.local.set<StoredAttempt>({ renewalAttempts: (await getAttempt()) + 1 });
};

const clearAttempt = async () => {
  await chrome.storage.local.remove<StoredAttempt>(["renewalAttempts"]);
};

class Credentials {
  EXTENSION_TOKEN_EXPIRATION_ALARM = "EXTENSION_TOKEN_EXPIRATION_ALARM";
  EXTENSION_TOKEN_RENEWAL_ATTEMPT_ALARM = "EXTENSION_TOKEN_RENEWAL_ATTEMPT_ALARM";

  MAX_ATTEMPTS = 5;

  constructor() {
    // Attempt to renew a new extension token
    schedule.on([this.EXTENSION_TOKEN_EXPIRATION_ALARM, this.EXTENSION_TOKEN_RENEWAL_ATTEMPT_ALARM], () =>
      this.attemptToRenewToken()
    );
  }

  async enableRenewal(when: number) {
    await this.cancelRenewalAttempts();
    if (when) await schedule.recreate(this.EXTENSION_TOKEN_EXPIRATION_ALARM, { when });
  }

  async cancelRenewal() {
    await Promise.all([schedule.clear(this.EXTENSION_TOKEN_EXPIRATION_ALARM), this.cancelRenewalAttempts()]);
  }

  private async cancelRenewalAttempts() {
    await Promise.all([schedule.clear(this.EXTENSION_TOKEN_RENEWAL_ATTEMPT_ALARM), clearAttempt()]);
  }

  private async request() {
    const refreshToken = extension().getRefreshToken();
    if (!refreshToken) throw new Error("Client refresh token doesn't exist");

    const config = await getConfig();
    const { payload } = await httpPost<{ payload: ExtensionSyncData }>(
      config.GENERIC.EXTENSION_SYNC_URL,
      refreshToken,
      {}
    );

    if ((payload?.subscription?.expiresAt || 0) < Date.now()) throw new Error("Replied with old subscription");
    if (!payload?.subscription?.extensionToken) throw new Error("Extension token wasn't provided");

    return payload;
  }

  private async attemptToRenewToken() {
    if (!extension().getRefreshToken()) {
      eventBroker().emit(EVENT.EXTENSION.REQUEST_RESET);
      return;
    }

    if ((await getAttempt()) >= this.MAX_ATTEMPTS) {
      eventBroker().emit(EVENT.EXTENSION.REQUEST_RESET);
      log("debug", "[token-renew]", "max attempts reached, give up");
      return;
    }

    try {
      const payload = await this.request();
      eventBroker().emit(EVENT.EXTENSION.PAYLOAD_RECEIVED, payload);

      await this.cancelRenewalAttempts();
    } catch (err) {
      // Attempt to retry in a minute
      log("debug", "[token-renew]", err);
      await Promise.all([
        increaseAttempt(),
        schedule.create(this.EXTENSION_TOKEN_RENEWAL_ATTEMPT_ALARM, { periodInMinutes: 1 }),
      ]);
    }
  }
}

const singleton = new Credentials();
export const credentials = () => singleton;
