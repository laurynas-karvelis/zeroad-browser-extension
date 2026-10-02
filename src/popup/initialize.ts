import type { GetConfigResult } from "../worker/config"
import { EVENT } from "../worker/event-broker"
import type { ExtensionSyncData } from "../worker/types"
import { enableDevTools } from "./dev-tools"
import { $, setVersion, updateUrls } from "./dom"
import { reportFailure, UserState } from "./state"
import { worker } from "./worker"

function getConfig() {
  return worker.sendCommand<GetConfigResult>(EVENT.POPUP.GET_CONFIG)
}

function getExtensionData() {
  return worker.sendCommand<ExtensionSyncData>(EVENT.POPUP.GET_EXTENSION_DATA)
}

function listenToReloadRequests() {
  worker.on(EVENT.MESSAGING.POPUP_RELOAD_REQUEST, () => {
    // Reload popup contents to reflect updated extension state
    window.location.reload()
  })
}

export async function initializePopup() {
  $("#retry-btn").onClick(() => window.location.reload())
  listenToReloadRequests()

  try {
    const config = await getConfig()

    setVersion(config.VERSION)
    updateUrls(config.BASE_URL)

    const extensionData = await getExtensionData()

    await new UserState(extensionData.user, extensionData.subscription, !!extensionData.testAccess).render()

    if (config.DEV_MODE) enableDevTools()
  } catch (error) {
    reportFailure(error)
  }
}
