import { applyBootstrapTheme, setVersion, updateUrls } from "./popup/dom";
import { enableDevTools } from "./popup/dev-tools";
import { ExtensionSyncData } from "./worker/types";
import { GetConfigResult } from "./worker/config";
import { EVENT } from "./worker/event-broker";
import { UserState } from "./popup/state";
import { worker } from "./popup/worker";

function getConfig() {
  return worker.sendCommand<GetConfigResult>(EVENT.POPUP.GET_CONFIG);
}

function getExtensionData() {
  return worker.sendCommand<ExtensionSyncData>(EVENT.POPUP.GET_EXTENSION_DATA);
}

function listenToReloadRequests() {
  worker.on(EVENT.MESSAGING.POPUP_RELOAD_REQUEST, () => {
    // Reload popup contents to reflect updated extension state
    window.location.reload();
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  applyBootstrapTheme();
  listenToReloadRequests();

  const config = await getConfig();
  const extensionData = await getExtensionData();

  setVersion(config.VERSION);
  updateUrls(config.BASE_URL);

  new UserState(extensionData.user, extensionData.subscription).render();

  if (config.DEV_MODE) enableDevTools();
});
