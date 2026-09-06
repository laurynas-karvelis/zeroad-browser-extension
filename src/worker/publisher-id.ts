/**
 * Publisher id constants, validation and `Better-Web-Publisher` header parsing.
 *
 * These values are copied - deliberately not imported - from the main project, so the extension ships
 * without an SDK dependency. Keep them in sync with `packages/database/schema/publishers/publishers.ts`
 * (id shape) and `packages/config` (prefix and header name) over there.
 */

/** Must match `PUBLISHER_HEADER` in the main project. */
export const PUBLISHER_HEADER = "Better-Web-Publisher"

/** Must match `PUBLISHER_ID_SCHEME` in the main project. */
export const PUBLISHER_ID_SCHEME = "zapub_"

/** Must match `PUBLISHER_ID_RANDOM_LENGTH` in the main project. */
export const PUBLISHER_ID_RANDOM_LENGTH = 24

/**
 * A publisher id is the prefix followed by exactly 24 alphanumerics, e.g.
 * `zapub_7Fq2xR9nKdW3mB6tYp1sVzAe`. Case-sensitive: the id is used verbatim wherever it appears, so a
 * re-cased copy is not the same id. The required prefix is what lets a page-content scan tell a real id
 * from arbitrary text that merely looks id-shaped.
 */
export const VALID_PUBLISHER_ID = new RegExp(`^${PUBLISHER_ID_SCHEME}[A-Za-z0-9]{${PUBLISHER_ID_RANDOM_LENGTH}}$`)

export function isValidPublisherId(value: string | null | undefined): value is string {
  return typeof value === "string" && VALID_PUBLISHER_ID.test(value)
}

/** Two publisher ids match when both are well-formed and exactly equal. */
export function publisherIdsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!isValidPublisherId(a) || !isValidPublisherId(b)) return false
  return a === b
}

/**
 * Reads a `Better-Web-Publisher` value and returns the publisher id, or `undefined` when the value is
 * absent or unusable. The value is the id and nothing else; surrounding whitespace and any trailing
 * `;`-separated parameter (which the format no longer uses) are tolerated so a legacy header resolves.
 */
export function parsePublisherHeader(headerValue: string | null | undefined): string | undefined {
  if (!headerValue) return undefined

  const publisherId = headerValue.split(";")[0].trim()
  return isValidPublisherId(publisherId) ? publisherId : undefined
}
