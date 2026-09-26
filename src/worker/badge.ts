import { EVENT, eventBroker } from "./event-broker"
import type { TabTrackActiveTabEventData } from "./tab-tracker"

class Badge {
  private badgeTimeout?: ReturnType<typeof setTimeout>

  constructor() {
    eventBroker()
      .on(EVENT.EXTENSION.SYNCED, () => this.setText("ON"))
      .on<TabTrackActiveTabEventData>(EVENT.TAB_TRACKER.IS_ACTIVE_TAB_PUBLISHER, ({ tabId, isPublisher }) =>
        this.setIcon(tabId, isPublisher)
      )
  }

  // Each target's manifest lists icons in a format its browser accepts (Chrome rejects SVG). The color
  // extension icon marks publishers; the grayscale action default marks everything else.
  private setIcon(tabId: number | undefined, isPublisher: boolean) {
    const manifest = chrome.runtime.getManifest() as chrome.runtime.ManifestV3
    const icon = (isPublisher ? manifest.icons : manifest.action?.default_icon) as chrome.runtime.ManifestIcons
    const path = Object.fromEntries(Object.entries(icon).map(([size, file]) => [size, chrome.runtime.getURL(file)]))

    return chrome.action.setIcon({ tabId, path })
  }

  async setText(text: string, durationMs = 5000) {
    if (this.badgeTimeout) {
      clearTimeout(this.badgeTimeout)
    }

    await chrome.action.setBadgeText({ text })

    if (text) {
      this.badgeTimeout = setTimeout(() => {
        chrome.action.setBadgeText({ text: "" })
        this.badgeTimeout = undefined
      }, durationMs)
    }
  }
}

const singleton = new Badge()
export const badge = () => singleton
