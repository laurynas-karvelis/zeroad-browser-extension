import { EVENT, eventBroker } from "./event-broker"
import { extension } from "./extension"
import { log } from "./logger"
import { type TokenPoolRefreshedData, tokenPool } from "./token-pool"
import type { Hostname } from "./types"
import { inDevMode } from "./utils"

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

/**
 * The exact host on any port, never a subdomain - `^` stops the match at the host's boundary, and a
 * token bound to `example.com` would only fail verification at `blog.example.com` anyway. HTTPS only:
 * a token is reusable until it expires, so one sent in clear text could be replayed by anyone on the
 * network. A development build also allows http, which the local demo site is served over.
 */
async function tokenUrlFilter(hostname: Hostname) {
  return `${(await inDevMode()) ? "|http*://" : "|https://"}${hostname}^`
}

function hostnameFromUrlFilter(urlFilter: string | undefined): Hostname | undefined {
  return urlFilter?.match(/:\/\/(.+)\^$/)?.[1]
}

class HeaderInjection {
  private ruleIdByHostname = new Map<Hostname, number>()
  private nextRuleId = FIRST_RULE_ID
  private restoredRuleIds?: Promise<void>

  constructor() {
    eventBroker()
      .on(EVENT.EXTENSION.SUBSCRIPTION_ACTIVE, () => this.reset())
      .on(EVENT.EXTENSION.SUBSCRIPTION_EXPIRED, () => this.removeAllRules())
      .on<TokenPoolRefreshedData>(EVENT.TOKEN_POOL.REFRESHED, ({ hostnames }) => this.rebind(hostnames))
  }

  /** Reinstates rules for every hostname already holding a token, after a worker restart. */
  async reset() {
    await this.removeAllRules()

    if (!(await this.shouldInject())) return

    for (const hostname of await tokenPool().boundHostnames()) {
      await this.enableForHostname(hostname)
    }
  }

  async removeAllRules() {
    // Read from Chrome rather than from memory: session rules outlive the worker that installed them.
    const installedRules = await chrome.declarativeNetRequest.getSessionRules()
    this.ruleIdByHostname.clear()

    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: installedRules.map((rule) => rule.id) })
  }

  async removeRuleForHostname(hostname: Hostname) {
    await this.restoreRuleIds()

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
    if (!hostname || !(await this.shouldInject())) return undefined

    await this.restoreRuleIds()

    const token = await tokenPool().tokenFor(hostname)
    if (!token) return undefined

    const ruleId = this.ruleIdByHostname.get(hostname) ?? this.nextRuleId++

    const rule: chrome.declarativeNetRequest.Rule = {
      id: ruleId,
      priority: 99,
      condition: {
        urlFilter: await tokenUrlFilter(hostname),
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

  private async shouldInject() {
    // A paused extension stays paused no matter who asks for a rule to go up
    await extension().ready
    return !extension().isPaused() && extension().isSubscriptionActive()
  }

  /** Swaps in tokens from a new batch for sites bound in the one it replaced. */
  private async rebind(hostnames: Hostname[]) {
    for (const hostname of hostnames) {
      await this.enableForHostname(hostname)
    }
  }

  /**
   * Session rules survive a worker restart and this map does not, so it is rebuilt from the installed
   * rules before first use - otherwise a new rule could reuse a live rule's id, and a stale rule would be
   * unknown to `removeRuleForHostname`.
   */
  private restoreRuleIds() {
    this.restoredRuleIds ??= chrome.declarativeNetRequest.getSessionRules().then((rules) => {
      for (const rule of rules) {
        const hostname = hostnameFromUrlFilter(rule.condition.urlFilter)
        if (hostname && !this.ruleIdByHostname.has(hostname)) this.ruleIdByHostname.set(hostname, rule.id)
        this.nextRuleId = Math.max(this.nextRuleId, rule.id + 1)
      }
    })

    return this.restoredRuleIds
  }
}

const singleton = new HeaderInjection()
export const headerInjection = () => singleton
