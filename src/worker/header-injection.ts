import { EVENT, eventBroker } from "./event-broker"
import { extension } from "./extension"
import { log } from "./logger"
import { tokenPool } from "./token-pool"
import type { Hostname } from "./types"

/**
 * Installs the `declarativeNetRequest` rules that attach a token to outgoing requests.
 *
 * There is one rule per publisher hostname rather than a single blanket rule, because there is no longer
 * a single token to blanket with: every site gets one bound to its own name. That is the whole point -
 * a shared token would be a shared identifier, and any site holding it could spend it at another.
 *
 * Rules are only installed for hostnames already recognised as publishers, so an ordinary site never
 * sees a token and the pool is not spent on sites that would ignore it.
 */

/** Must match `TOKEN_HEADER` in @zeroad.network/token. */
const TOKEN_HEADER = "Better-Web-Token"

/** Rule ids start above the range the old single blanket rule used. */
const FIRST_RULE_ID = 100

class HeaderInjection {
  private ruleIdByHostname = new Map<Hostname, number>()
  private nextRuleId = FIRST_RULE_ID

  constructor() {
    eventBroker()
      .on(EVENT.EXTENSION.SUBSCRIPTION_ACTIVE, () => this.reset())
      .on(EVENT.EXTENSION.SUBSCRIPTION_EXPIRED, () => this.removeAllRules())
  }

  /** Reinstates rules for every hostname already holding a token, after a worker restart. */
  async reset() {
    await this.removeAllRules()

    if (!this.shouldInject()) return

    for (const hostname of await tokenPool().boundHostnames()) {
      await this.enableForHostname(hostname)
    }
  }

  private shouldInject() {
    // A paused extension stays paused no matter who asks for a rule to go up
    return !extension().isPaused() && extension().isSubscriptionActive()
  }

  async removeAllRules() {
    const ruleIds = [...this.ruleIdByHostname.values()]
    this.ruleIdByHostname.clear()

    // Rule 1 was the old blanket rule. Removing it is harmless when absent and necessary when an
    // extension updates in place with it still installed
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [1, ...ruleIds] })
  }

  async removeRuleForHostname(hostname: Hostname) {
    const ruleId = this.ruleIdByHostname.get(hostname)
    if (ruleId === undefined) return

    this.ruleIdByHostname.delete(hostname)
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] })
  }

  /**
   * Binds a token to `hostname` if it has none yet, and installs the rule that sends it.
   *
   * Returns the rule id, or undefined when nothing was installed - no subscription, paused, or the
   * pool is empty. An exhausted pool is not an error: the site simply sees an ordinary visitor.
   */
  async enableForHostname(hostname: Hostname): Promise<number | undefined> {
    if (!hostname || !this.shouldInject()) return undefined

    const token = await tokenPool().tokenFor(hostname)
    if (!token) return undefined

    const ruleId = this.ruleIdByHostname.get(hostname) ?? this.nextRuleId++

    const rule: chrome.declarativeNetRequest.Rule = {
      id: ruleId,
      priority: 99,
      condition: {
        // Scoped to this host and its subdomains' parent - a token bound to `example.com` must not be
        // attached to a request for anything else, or that other site would just see it fail
        requestDomains: [hostname],
        resourceTypes: ["main_frame", "media"],
      },
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ operation: "set", header: TOKEN_HEADER, value: token }],
      },
    }

    // Added and removed in one call so no request slips through between the two
    await chrome.declarativeNetRequest.updateSessionRules({ addRules: [rule], removeRuleIds: [ruleId] })

    this.ruleIdByHostname.set(hostname, ruleId)

    eventBroker().emit(EVENT.HEADER_INJECTION.RULE_INSTALLED, { hostname, ruleId })
    log("debug", "[header-injection]", "installed rule for", hostname)

    return ruleId
  }

  /** Hostnames currently carrying an injection rule, for diagnostics and the popup. */
  installedHostnames(): Hostname[] {
    return [...this.ruleIdByHostname.keys()]
  }
}

const singleton = new HeaderInjection()
export const headerInjection = () => singleton
