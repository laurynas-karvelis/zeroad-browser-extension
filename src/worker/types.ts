export type LeafValues<T> = {
  [K in keyof T]: T[K] extends string ? T[K] : LeafValues<T[K]>
}[keyof T]

export enum SUBSCRIPTION_PLAN_NAME {
  FREEDOM = "freedom",
}

export const SUBSCRIPTION_PLAN_LABEL = {
  [SUBSCRIPTION_PLAN_NAME.FREEDOM]: "Freedom",
}

export type ExtensionSyncData = {
  user: UserExtensionData
  subscription?: SubscriptionExtensionData
  testAccess?: WebsiteTestAccess
}

export type UserExtensionData = {
  accountClosed?: boolean
  firstName: string | null
  /** The single token the extension authenticates every platform call with. Never expires. */
  extensionToken: string
  /**
   * The user's public publisher id. Site verification checks for this id and nothing else, so a page
   * cannot have the extension look for someone else's. Absent for the demo user, and in data synced
   * before the platform started sending it.
   */
  publisherId?: string
}

export type WebsiteTestAccess = SubscriptionExtensionData & {
  hostname: string
  visitorToken: string
}

export type SubscriptionExtensionData = {
  planName: SUBSCRIPTION_PLAN_NAME
  expiresAt: number // A UNIX timestamp
  /** Restricts demo or developer access to one site. */
  hostname?: string
  /** A complete token bound to hostname; its signing keys never leave the server. */
  visitorToken?: string
}

export type Hostname = string
