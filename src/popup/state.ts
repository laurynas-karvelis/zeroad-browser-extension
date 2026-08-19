import { EVENT, type EventType } from "../worker/event-broker"
import { log } from "../worker/logger"
import type { TabTrackActiveTabEventData } from "../worker/tab-tracker"
import {
  PLAN_NAME_TO_FEATURE_NAMES,
  SUBSCRIPTION_PLAN_LABEL,
  type SubscriptionExtensionData,
  type UserExtensionData,
} from "../worker/types"
import { from } from "./date"
import { $ } from "./dom"
import { worker } from "./worker"

/**
 * The popup has no error surface of its own and a half-rendered popup is better than a blank one,
 * so a worker round-trip that fails is logged and the affected controls are simply left hidden.
 */
function reportFailure(error: unknown) {
  log("error", "[popup]", "Could not finish rendering", error)
}

export class UserState {
  constructor(
    private user?: UserExtensionData,
    private subscription?: SubscriptionExtensionData
  ) {}

  /** Resolves once the popup has settled, having reported rather than thrown any worker failure. */
  render(): Promise<void> {
    if (!this.user?.refreshToken) {
      // User is brand new or not signed in
      $(".guest, .guest.greeting").show()
      return Promise.resolve()
    }

    $(".user.greeting").replace({
      FIRST_NAME: this.user.firstName || "Member",
    })

    const rendered = this.subscription?.extensionToken
      ? this.onMemberWithSubscription()
      : this.onMemberWithoutSubscription()

    return rendered.catch(reportFailure)
  }

  private async onMemberWithoutSubscription() {
    // The `clientData` exists, user has account
    $(".user.not-subscribed, .user .not-subscribed").show()
    await this.setupPartnerSiteUi()
  }

  private buildReportButtonUrl(baseUrl: string, partnerUrl: string, clientId: string) {
    const url = new URL(baseUrl)
    url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodeURIComponent(clientId)}`
    url.searchParams.set("url", partnerUrl)
    return url.toString()
  }

  private async setupPartnerSiteUi() {
    const planFeatureNames =
      (this.subscription?.planName && PLAN_NAME_TO_FEATURE_NAMES[this.subscription.planName]) || []

    worker.on<TabTrackActiveTabEventData>(EVENT.MESSAGING.IS_ACTIVE_TAB_PARTNER, (data) => {
      const { isPartner, url, telemetryEntry } = data

      const $reportBtn = $("#report-site-btn").toggle(isPartner)
      const $partnerFeatures = $("#partner-features").toggle(isPartner)

      if (!isPartner) {
        return
      }

      const { features, clientId } = telemetryEntry
      const unavailableFeatureClassList = ["text-decoration-line-through"]

      $partnerFeatures.$("li").hide()

      features.forEach((featureName) => {
        const planEnablesFeature = planFeatureNames.includes(featureName)

        $(`#partner-features li.${featureName.toLowerCase()}`)
          .title(planEnablesFeature ? "" : "This feature isn't included in your plan")
          .toggleClass(unavailableFeatureClassList, !planEnablesFeature)
          .show()
      })

      // set up report button
      const reportBaseUrl = $reportBtn.data("href")
      if (reportBaseUrl) $reportBtn.href(this.buildReportButtonUrl(reportBaseUrl, url, clientId))
    })

    await worker.sendCommand(EVENT.POPUP.CHECK_IF_ACTIVE_TAB_PARTNER_REQUEST)
  }

  private async onMemberWithSubscription() {
    if (!this.subscription) return
    $(".user.subscribed, .user .subscribed").show()

    if (this.subscription.expiresAt < Date.now()) {
      // But expired
      $(".subscription-expired").show()
    } else {
      // And isn't expired yet
      $(".subscription-valid").show()
      $(".valid-until").text(from(this.subscription.expiresAt, new Date(), { withoutSuffix: true }))
    }

    // The `extensionToken` exists
    $("#link-pricing").hide()
    $("#subscription-label span").text(SUBSCRIPTION_PLAN_LABEL[this.subscription.planName])

    $(`.${this.subscription.planName}`).show()

    if (this.subscription.clientId) {
      $("#developer-details").show()
      $("#client-id-label span").text(this.subscription.clientId)
    }

    await this.setupPauseResumeButtons()
    await this.setupPartnerSiteUi()
  }

  private async setupPauseResumeButtons() {
    const request = (command: EventType) => async () => {
      // A click handler is the one place nothing is awaiting us, so it owns its own failures.
      try {
        await worker.sendCommand(command)
        await this.checkExtensionPaused()
      } catch (error) {
        reportFailure(error)
      }
    }

    $("#pause-btn").onClick(request(EVENT.POPUP.EXTENSION_PAUSE_REQUEST))
    $("#resume-btn").onClick(request(EVENT.POPUP.EXTENSION_RESUME_REQUEST))

    await this.checkExtensionPaused()
  }

  private async checkExtensionPaused() {
    const isPaused = await worker.sendCommand<boolean>(EVENT.POPUP.IS_EXTENSION_PAUSED)

    $("#resume-btn").toggle(isPaused)
    $("#pause-btn").toggle(!isPaused)

    $("#extension-paused").toggle(isPaused)
  }
}
