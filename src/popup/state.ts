import { EVENT, type EventType } from "../worker/event-broker"
import { log } from "../worker/logger"
import type { TabTrackActiveTabEventData } from "../worker/tab-tracker"
import type { SubscriptionExtensionData, UserExtensionData } from "../worker/types"
import { getHostname } from "../worker/utils"
import { from } from "./date"
import { $ } from "./dom"
import { worker } from "./worker"

export function reportFailure(error: unknown) {
  $("#popup-loading").hide()
  $("#popup-error").show()
  log("error", "[popup]", "Could not finish rendering", error)
}

export class UserState {
  constructor(
    private user?: UserExtensionData,
    private subscription?: SubscriptionExtensionData,
    private testing = false
  ) {}

  /** Resolves once the popup has settled, having reported rather than thrown any worker failure. */
  async render(): Promise<void> {
    $("#popup-loading").hide()

    if (!this.user?.extensionToken) {
      // User is brand new or not signed in
      $(".guest").show()

      return
    }

    // The subscription record itself is the signal now. There is no server-minted token to check for -
    // tokens are built locally from credentials - and an expired record is handled further in, where
    // the expiry notice replaces the countdown.
    try {
      if (this.subscription) await this.onMemberWithSubscription()
      else $(".user.not-subscribed, .user .not-subscribed").show()

      await this.setupPublisherSiteUi()
    } catch (error) {
      reportFailure(error)
    }
  }

  private buildReportButtonUrl(baseUrl: string, visitedUrl: string, hostname: string, publisherId: string) {
    const url = new URL(baseUrl)
    url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodeURIComponent(hostname)}`
    url.searchParams.set("url", visitedUrl)
    url.searchParams.set("publisherId", publisherId)

    return url.toString()
  }

  private async setupPublisherSiteUi() {
    worker.on<TabTrackActiveTabEventData>(EVENT.MESSAGING.IS_ACTIVE_TAB_PUBLISHER, (data) => {
      const { isPublisher, url } = data

      const $reportBtn = $("#report-site-btn").toggle(isPublisher)
      $("#publisher-site").toggle(isPublisher)

      if (!isPublisher) {
        return
      }

      const isCreator = data.telemetryEntry.source === "content"

      $("#publisher-hostname").text(getHostname(url))
      $("#publisher-kind")
        .text(isCreator ? "Creator integration" : "Website integration")
        .toggleClass("theme-primary", !isCreator)
        .toggleClass("theme-info", isCreator)

      // set up report button
      const reportBaseUrl = $reportBtn.data("href")

      if (reportBaseUrl)
        $reportBtn.href(
          this.buildReportButtonUrl(reportBaseUrl, url, getHostname(url), data.telemetryEntry.publisherId)
        )
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

    $(`.${this.subscription.planName}`).show()

    if (this.subscription.hostname) {
      $("#access-title").text(this.user?.extensionToken === "demo" ? "Demo access" : "Test access")
      $("#membership-expired-details").hide()
      $("#developer-details").show()
      $("#developer-hostname-label span").text(this.subscription.hostname)
    }

    if (this.testing) {
      $("#stop-testing-btn")
        .show()
        .onClick(async (event) => {
          const button = event.currentTarget as HTMLButtonElement
          button.disabled = true

          try {
            await worker.sendCommand(EVENT.POPUP.STOP_TESTING)
            window.location.reload()
          } catch (error) {
            reportFailure(error)
            button.disabled = false
          }
        })
    }

    await this.setupPauseResumeButtons()
  }

  private async setupPauseResumeButtons() {
    const request = (command: EventType) => async (event: Event) => {
      const button = event.currentTarget as HTMLButtonElement
      const hadFocus = document.activeElement === button
      this.setControlsDisabled(true)

      try {
        await worker.sendCommand(command)
        await this.checkExtensionPaused(true)

        $("#reload-tab-btn").show()
        $("#reload-tab-error, #popup-error").hide()
      } catch (error) {
        reportFailure(error)
      } finally {
        this.setControlsDisabled(false)
      }

      if (
        hadFocus &&
        button.hidden &&
        (document.activeElement === button || document.activeElement === document.body)
      ) {
        document.querySelector<HTMLButtonElement>("#reload-tab-btn")?.focus()
      }
    }

    $("#pause-btn").onClick(request(EVENT.POPUP.EXTENSION_PAUSE_REQUEST))
    $("#resume-btn").onClick(request(EVENT.POPUP.EXTENSION_RESUME_REQUEST))
    $("#reload-tab-btn").onClick(() => this.reloadActiveTab())

    await this.checkExtensionPaused()
  }

  private setControlsDisabled(disabled: boolean) {
    for (const button of document.querySelectorAll<HTMLButtonElement>("#extension-actions button")) {
      button.disabled = disabled
    }
  }

  private async reloadActiveTab() {
    const button = document.querySelector<HTMLButtonElement>("#reload-tab-btn")
    const hadFocus = document.activeElement === button
    this.setControlsDisabled(true)
    $("#reload-tab-error").hide()

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

      if (tab?.id === undefined) throw new Error("No active tab is available")

      await chrome.tabs.reload(tab.id)

      $("#reload-tab-btn").hide()
    } catch (error) {
      $("#reload-tab-error").show()
      log("warn", "[popup]", "Could not reload active tab", error)
    } finally {
      this.setControlsDisabled(false)
    }

    if (hadFocus && button?.hidden && (document.activeElement === button || document.activeElement === document.body)) {
      document.querySelector<HTMLButtonElement>("#extension-actions button:not([hidden])")?.focus()
    }
  }

  private async checkExtensionPaused(keepOpen = false) {
    const isPaused = await worker.sendCommand<boolean>(EVENT.POPUP.IS_EXTENSION_PAUSED)

    $("#resume-btn").toggle(isPaused)
    $("#pause-btn").toggle(!isPaused)
    $("#extension-paused").toggle(isPaused)

    const controls = document.querySelector<HTMLDetailsElement>("#freedom-controls")

    if (controls) controls.open = !!isPaused || keepOpen
  }
}
