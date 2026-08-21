import { EVENT, type EventType } from "../worker/event-broker"
import { log } from "../worker/logger"
import type { TabTrackActiveTabEventData } from "../worker/tab-tracker"
import { getHostname } from "../worker/utils"
import { SUBSCRIPTION_PLAN_LABEL, type SubscriptionExtensionData, type UserExtensionData } from "../worker/types"
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

    // The subscription record itself is the signal now. There is no server-minted token to check for -
    // tokens are built locally from credentials - and an expired record is handled further in, where
    // the expiry notice replaces the countdown.
    const rendered = this.subscription ? this.onMemberWithSubscription() : this.onMemberWithoutSubscription()

    return rendered.catch(reportFailure)
  }

  private async onMemberWithoutSubscription() {
    // The `clientData` exists, user has account
    $(".user.not-subscribed, .user .not-subscribed").show()
    await this.setupPublisherSiteUi()
  }

  private buildReportButtonUrl(baseUrl: string, visitedUrl: string, hostname: string) {
    // Reports address a site by hostname - that is what identifies it now, and it is right there in
    // the url the user is looking at
    const url = new URL(baseUrl)
    url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodeURIComponent(hostname)}`
    url.searchParams.set("url", visitedUrl)
    return url.toString()
  }

  private async setupPublisherSiteUi() {
    worker.on<TabTrackActiveTabEventData>(EVENT.MESSAGING.IS_ACTIVE_TAB_PUBLISHER, (data) => {
      const { isPublisher, url, telemetryEntry } = data

      const $reportBtn = $("#report-site-btn").toggle(isPublisher)
      const $publisherFeatures = $("#publisher-features").toggle(isPublisher)

      if (!isPublisher) {
        return
      }

      // One plan, so a participating site provides everything - there is nothing to strike through
      $publisherFeatures.$("li").show()

      // set up report button
      const reportBaseUrl = $reportBtn.data("href")
      if (reportBaseUrl) $reportBtn.href(this.buildReportButtonUrl(reportBaseUrl, url, getHostname(url)))
    })

    await worker.sendCommand(EVENT.POPUP.CHECK_IF_ACTIVE_TAB_PUBLISHER_REQUEST)
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

    $("#link-pricing").hide()
    $("#subscription-label span").text(SUBSCRIPTION_PLAN_LABEL[this.subscription.planName])

    $(`.${this.subscription.planName}`).show()

    if (this.subscription.hostname) {
      $("#developer-details").show()
      $("#developer-hostname-label span").text(this.subscription.hostname)
    }

    await this.setupPauseResumeButtons()
    await this.setupPublisherSiteUi()
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
