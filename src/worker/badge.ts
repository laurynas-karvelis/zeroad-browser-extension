import { EVENT, eventBroker } from "./event-broker";
import { TabTrackActiveTabEventData } from "./tab-tracker";

enum BADGE_ICON {
  ACTIVE = "./images/dove-128.png",
  INACTIVE = "./images/dove-gray-128.png",
}

class Badge {
  constructor() {
    eventBroker()
      .on(EVENT.EXTENSION.SYNCED, () => this.setText("ON"))
      .on<TabTrackActiveTabEventData>(EVENT.TAB_TRACKER.IS_ACTIVE_TAB_PARTNER, ({ tabId, isPartner }) => {
        if (isPartner) this.setIcon(tabId, BADGE_ICON.ACTIVE);
        else this.setIcon(tabId, BADGE_ICON.INACTIVE);
      });
  }

  private setIcon(tabId: number | undefined, icon: BADGE_ICON) {
    return chrome.action.setIcon({ tabId, path: chrome.runtime.getURL(icon) });
  }

  async setText(text: string) {
    await chrome.action.setBadgeText({ text: text });
    setTimeout(() => this.setText(""), 5000);
  }
}

const singleton = new Badge();
export const badge = () => singleton;
