import {
  PLAN_NAME_TO_FEATURE_NAMES,
  SUBSCRIPTION_PLAN_LABEL,
  SubscriptionExtensionData,
  UserExtensionData,
} from "../worker/types";
import { TabTrackActiveTabEventData } from "../worker/tab-tracker";
import { EVENT } from "../worker/event-broker";
import { worker } from "./worker";
import { from } from "./date";
import { $ } from "./dom";

export class UserState {
  constructor(
    private user?: UserExtensionData,
    private subscription?: SubscriptionExtensionData
  ) {}

  render() {
    if (this.user?.refreshToken) {
      $(".user.greeting").replace({ FIRST_NAME: this.user.firstName || "Member" });

      if (!this.subscription?.extensionToken) this.onMemberWithoutSubscription();
      else this.onMemberWithSubscription();
    } else {
      // User is brand new or not signed in
      $(".guest, .guest.greeting").show();
    }
  }

  private onMemberWithoutSubscription() {
    // The `clientData` exists, user has account
    $(".user.not-subscribed, .user .not-subscribed").show();
    this.setupPartnerSiteUi();
  }

  private buildReportButtonUrl(baseUrl: string, partnerUrl: string, clientId: string) {
    const url = new URL(baseUrl);
    url.pathname = url.pathname.replace(/\/$/, "") + "/" + encodeURIComponent(clientId);
    url.searchParams.set("url", partnerUrl);
    return url.toString();
  }

  private async setupPartnerSiteUi() {
    const planFeatureNames =
      (this.subscription?.planName && PLAN_NAME_TO_FEATURE_NAMES[this.subscription.planName]) || [];

    worker.on<TabTrackActiveTabEventData>(EVENT.MESSAGING.IS_ACTIVE_TAB_PARTNER, (data) => {
      const { isPartner, url, telemetryEntry } = data;

      const $reportBtn = $("#report-site-btn").visibleWhen(isPartner);
      const $partnerFeatures = $("#partner-features").visibleWhen(isPartner);

      if (!isPartner) {
        return;
      }

      const { features, clientId } = telemetryEntry;
      const unavailableFeatureClassList = ["text-decoration-line-through"];

      $partnerFeatures.$("li").hide();

      features.forEach((featureName) => {
        const planEnablesFeature = planFeatureNames.includes(featureName);

        $(`#partner-features li.${featureName.toLowerCase()}`)
          .title("", planEnablesFeature)
          .title("This feature isn't included in your plan", !planEnablesFeature)
          .removeClass(unavailableFeatureClassList, planEnablesFeature)
          .addClass(unavailableFeatureClassList, !planEnablesFeature)
          .show();
      });

      // set up report button
      $reportBtn.href(this.buildReportButtonUrl($reportBtn.dataset("href") as string, url, clientId));
    });

    await worker.sendCommand(EVENT.POPUP.CHECK_IF_ACTIVE_TAB_PARTNER_REQUEST);
  }

  private async onMemberWithSubscription() {
    if (!this.subscription) return;
    $(".user.subscribed, .user .subscribed").show();

    if (this.subscription.expiresAt < Date.now()) {
      // But expired
      $(".subscription-expired").show();
    } else {
      // And isn't expired yet
      $(".subscription-valid").show();
      $(".valid-until").text(from(this.subscription.expiresAt, new Date(), { withoutSuffix: true }));
    }

    // The `extensionToken` exists
    $("#link-pricing").hide();
    $("#subscription-label span").text(SUBSCRIPTION_PLAN_LABEL[this.subscription.planName]);

    $(`.${this.subscription.planName}`).show();

    if (this.subscription.clientId) {
      $("#developer-details").show();
      $("#client-id-label span").text(this.subscription.clientId);
    }

    this.setupPauseResumeButtons();
    this.setupPartnerSiteUi();
  }

  private async setupPauseResumeButtons() {
    $("#pause-btn").onClick(async () => {
      await worker.sendCommand(EVENT.POPUP.EXTENSION_PAUSE_REQUEST);
      await this.checkExtensionPaused();
    });

    $("#resume-btn").onClick(async () => {
      await worker.sendCommand(EVENT.POPUP.EXTENSION_RESUME_REQUEST);
      await this.checkExtensionPaused();
    });

    await this.checkExtensionPaused();
  }

  private async checkExtensionPaused() {
    const isPaused = await worker.sendCommand(EVENT.POPUP.IS_EXTENSION_PAUSED);

    $("#resume-btn").visibleWhen(isPaused);
    $("#pause-btn").hiddenWhen(isPaused);

    $("#extension-paused").visibleWhen(isPaused);
  }
}
