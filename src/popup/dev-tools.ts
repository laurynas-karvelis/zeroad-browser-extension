import { EVENT } from "../worker/event-broker";
import { worker } from "./worker";
import { $ } from "./dom";

export function enableDevTools() {
  const $parent = $("#debug-menu").show();

  $("a#reset-extension-state", $parent).onClick(() => {
    worker.sendCommand(EVENT.POPUP.RESET_EXTENSION_STATE);
    window.location.reload();
  });

  $("a#push-telemetry", $parent).onClick(() => worker.sendCommand(EVENT.POPUP.PUSH_TELEMETRY_REQUEST));
  $("a#display-telemetry", $parent).onClick(() => worker.sendCommand(EVENT.POPUP.DISPLAY_TELEMETRY_DATA));
}
