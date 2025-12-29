import { log } from "./logger";
import { LeafValues } from "./types";

class EventBroker extends EventTarget {
  emit<T = unknown>(eventName: EventType, data?: T) {
    const logData: unknown[] = ["[event-broken]", eventName];
    if (data !== undefined) logData.push(data);
    log("debug", ...logData);

    this.dispatchEvent(new CustomEvent(eventName, { detail: data }));
    return this;
  }

  on<T = unknown>(eventName: EventType, callback: (data: T) => void) {
    // @ts-expect-error Cant be bothered
    this.addEventListener(eventName, (e: CustomEvent) => callback(e.detail as T));
    return this;
  }
}

const singleton = new EventBroker();
export const eventBroker = () => singleton;

export type EventType = LeafValues<typeof EVENT>;

export const EVENT = {
  EXTENSION: {
    READY: "EXTENSION:READY",
    SYNCED: "EXTENSION:SYNCED",
    PAYLOAD_RECEIVED: "EXTENSION:PAYLOAD_RECEIVED",
    REQUEST_RESET: "EXTENSION:REQUEST_RESET",
    SUBSCRIPTION_ACTIVE: "EXTENSION:SUBSCRIPTION_ACTIVE",
    SUBSCRIPTION_EXPIRED: "EXTENSION:SUBSCRIPTION_EXPIRED",
  },
  TELEMETRY: {
    PUSH: "TELEMETRY:PUSH",
    FLUSH: "TELEMETRY:FLUSH",
    PARTNER_ADDED: "TELEMETRY:PARTNER:ADDED",
    VIEWS_ADDED: "TELEMETRY:PARTNER:VIEWS_ADDED",
    DURATION_ADDED: "TELEMETRY:PARTNER:DURATION_ADDED",
  },
  TAB_TRACKER: {
    PARTNER_DETECTED: "TAB_TRACKER:PARTNER_DETECTED",
    IS_ACTIVE_TAB_PARTNER: "TAB_TRACKER:IS_ACTIVE_TAB_PARTNER",
  },
  HEADER_INJECTION: {
    BASE_RULE_INSTALLED: "HEADER_INJECTION:BASE_RULE_INSTALLED",
  },
  MESSAGING: {
    POPUP_RELOAD_REQUEST: "MESSAGING:POPUP_RELOAD_REQUEST",
    IS_ACTIVE_TAB_PARTNER: "MESSAGING:IS_ACTIVE_TAB_PARTNER",
  },
  POPUP: {
    GET_CONFIG: "POPUP:GET_CONFIG",
    GET_EXTENSION_DATA: "POPUP:GET_EXTENSION_DATA",
    RESET_EXTENSION_STATE: "POPUP:RESET_EXTENSION_STATE",
    DISPLAY_TELEMETRY_DATA: "POPUP:DISPLAY_TELEMETRY_DATA",
    PUSH_TELEMETRY_REQUEST: "POPUP:PUSH_TELEMETRY_REQUEST",
    IS_EXTENSION_PAUSED: "POPUP:IS_EXTENSION_PAUSED",
    EXTENSION_PAUSE_REQUEST: "POPUP:EXTENSION_PAUSE_REQUEST",
    EXTENSION_RESUME_REQUEST: "POPUP:EXTENSION_RESUME_REQUEST",
    CHECK_IF_ACTIVE_TAB_PARTNER_REQUEST: "POPUP:CHECK_IF_ACTIVE_TAB_PARTNER_REQUEST",
  },
  WEBSITE: {
    PING: "PING",
    SYNC_CLIENT_DATA: "SYNC_CLIENT_DATA",
  },
} as const;
