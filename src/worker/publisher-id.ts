/**
 * Publisher id constants, validation and `Better-Web-Publisher` header parsing.
 *
 * These values are copied - deliberately not imported - from the main project, so the extension ships
 * without an SDK dependency. Keep them in sync with `packages/database/schema/publishers/publishers.ts`
 * (id shape) and `packages/config` (scheme and header name) over there.
 */

/** Must match `PUBLISHER_HEADER` in the main project. */
export const PUBLISHER_HEADER = "Better-Web-Publisher"

/** Must match `PUBLISHER_ID_SCHEME` in the main project. */
export const PUBLISHER_ID_SCHEME = "ZERO_AD:PUB_ID:"

/** Must match `PROTOCOL_VERSION` in the main project. */
export const SUPPORTED_PROTOCOL_VERSION = 1

/** Must match `PUBLISHER_ID_RANDOM_LENGTH` in the main project. */
export const PUBLISHER_ID_RANDOM_LENGTH = 24

/**
 * A publisher id is the scheme prefix followed by exactly 24 alphanumerics, e.g.
 * `ZERO_AD:PUB_ID:7Fq2xR9nKdW3mB6tYp1sVzAe`. Matched case-insensitively so an id a publisher pasted or
 * a platform re-cased still verifies. The required scheme is what lets a page-content scan tell a real
 * id from arbitrary text that merely looks id-shaped.
 */
export const VALID_PUBLISHER_ID = new RegExp(`^${PUBLISHER_ID_SCHEME}[A-Za-z0-9]{${PUBLISHER_ID_RANDOM_LENGTH}}$`, "i")

export function isValidPublisherId(value: string | null | undefined): value is string {
  return typeof value === "string" && VALID_PUBLISHER_ID.test(value)
}

/** Two publisher ids match when both are well-formed and equal ignoring case. */
export function publisherIdsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!isValidPublisherId(a) || !isValidPublisherId(b)) return false
  return a.toLowerCase() === b.toLowerCase()
}

export type PublisherHeader = {
  publisherId: string
  version: number
}

/**
 * Reads a `Better-Web-Publisher` value: the publisher id, optionally followed by `; v=N`.
 * A bare id predates the version parameter and is read as version 1. Returns `undefined` when the
 * value is absent or unusable.
 */
export function parsePublisherHeader(headerValue: string | null | undefined): PublisherHeader | undefined {
  if (!headerValue) return undefined

  const [rawId, ...parameters] = headerValue.split(";")
  const publisherId = rawId.trim()

  if (!isValidPublisherId(publisherId)) return undefined

  let version = SUPPORTED_PROTOCOL_VERSION

  for (const parameter of parameters) {
    const [name, value] = parameter.split("=", 2)
    if (name?.trim().toLowerCase() !== "v") continue

    const parsed = Number(value?.trim())
    if (!Number.isSafeInteger(parsed) || parsed < 1) return undefined

    version = parsed
  }

  return { publisherId, version }
}
