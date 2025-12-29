export type LeafPaths<T, Prefix extends string = ""> = {
  [K in keyof T]: T[K] extends string ? `${Prefix}${K & string}` : LeafPaths<T[K], `${Prefix}${K & string}.`>;
}[keyof T];

export type LeafValues<T> = {
  [K in keyof T]: T[K] extends string ? T[K] : LeafValues<T[K]>;
}[keyof T];

export enum SUBSCRIPTION_PLAN_NAME {
  CLEAN_WEB = "clean-web",
  ONE_PASS = "one-pass",
  FREEDOM = "freedom",
}

export const SUBSCRIPTION_PLAN_LABEL = {
  [SUBSCRIPTION_PLAN_NAME.CLEAN_WEB]: "Clean Web",
  [SUBSCRIPTION_PLAN_NAME.ONE_PASS]: "One Pass",
  [SUBSCRIPTION_PLAN_NAME.FREEDOM]: "Freedom",
};

export const PLAN_NAME_TO_FEATURE_NAMES = {
  [SUBSCRIPTION_PLAN_NAME.CLEAN_WEB]: ["CLEAN_WEB"],
  [SUBSCRIPTION_PLAN_NAME.ONE_PASS]: ["ONE_PASS"],
  [SUBSCRIPTION_PLAN_NAME.FREEDOM]: ["CLEAN_WEB", "ONE_PASS"],
};

export type ExtensionSyncData = {
  user: UserExtensionData;
  subscription?: SubscriptionExtensionData;
};

export type UserExtensionData = {
  firstName: string | null;
  refreshToken: string;
};

export type SubscriptionExtensionData = {
  planName: SUBSCRIPTION_PLAN_NAME;
  extensionToken: string;
  telemetryToken: string;
  expiresAt: number; // A UNIX timestamp
  clientId?: string; // The "dev" token will contain `clientId` to test their site
};

export type Hostname = string;
