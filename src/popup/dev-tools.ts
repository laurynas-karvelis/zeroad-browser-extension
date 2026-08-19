import { EVENT, type EventType } from "../worker/event-broker"
import { log } from "../worker/logger"
import { $ } from "./dom"
import { worker } from "./worker"

/** Nothing awaits a click handler, so each one reports its own failure rather than leaking it. */
function send(command: EventType, onDone?: () => void) {
  return () => {
    worker
      .sendCommand(command)
      .then(() => onDone?.())
      .catch((error: unknown) => log("error", "[popup]", "Dev tools command failed", error))
  }
}

export function enableDevTools() {
  const $parent = $("#debug-menu").show()

  // The reload has to wait for the reset to land: reloading first races the worker, and the fresh
  // popup can read back the very state it asked to have thrown away.
  $("a#reset-extension-state", $parent).onClick(send(EVENT.POPUP.RESET_EXTENSION_STATE, () => window.location.reload()))

  $("a#push-telemetry", $parent).onClick(send(EVENT.POPUP.PUSH_TELEMETRY_REQUEST))
  $("a#display-telemetry", $parent).onClick(send(EVENT.POPUP.DISPLAY_TELEMETRY_DATA))
}
