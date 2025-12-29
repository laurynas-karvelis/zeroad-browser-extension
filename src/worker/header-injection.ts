import { CLIENT_HEADER } from "@zeroad.network/token/browser";
import { EVENT, eventBroker } from "./event-broker";
import { extension } from "./extension";

class HeaderInjection {
  constructor() {
    eventBroker()
      .on(EVENT.EXTENSION.SUBSCRIPTION_ACTIVE, () => this.reset())
      .on(EVENT.EXTENSION.SUBSCRIPTION_EXPIRED, () => this.reset());
  }

  reset() {
    return this.enableBaseRule();
  }

  async removeBaseRule() {
    // Delete any pre-existing rule
    const ruleId = 1;
    return chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
  }

  async enableBaseRule() {
    const ruleId = 1;

    if (!extension().isSubscriptionActive()) {
      return this.removeBaseRule();
    }

    const helloHeaderInjectionRule: chrome.declarativeNetRequest.Rule = {
      id: ruleId,
      priority: 99,
      condition: { resourceTypes: ["main_frame", "media"] },
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ operation: "set", header: CLIENT_HEADER.HELLO, value: extension().getExtensionToken() }],
      },
    };

    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [helloHeaderInjectionRule],
      removeRuleIds: [ruleId],
    });

    eventBroker().emit(EVENT.HEADER_INJECTION.BASE_RULE_INSTALLED, {
      extensionToken: extension().getExtensionToken(),
      ruleId,
    });

    return ruleId;
  }
}

const singleton = new HeaderInjection();
export const headerInjection = () => singleton;
