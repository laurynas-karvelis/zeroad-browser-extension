import { describe, expect, test } from "bun:test"
import { isValidPublisherId, parsePublisherHeader, publisherIdsMatch } from "../publisher-id"

const PUBLISHER_ID = "zapub_7Fq2xR9nKdW3mB6tYp1sVzAe"

describe("isValidPublisherId", () => {
  test("accepts the prefix followed by exactly 24 alphanumerics", () => {
    expect(isValidPublisherId(PUBLISHER_ID)).toBe(true)
  })

  test.each([
    ["a missing prefix", "7Fq2xR9nKdW3mB6tYp1sVzAe"],
    ["a re-cased prefix", "ZAPUB_7Fq2xR9nKdW3mB6tYp1sVzAe"],
    ["too short", "zapub_7Fq2xR9nKdW3mB6tYp1sVzA"],
    ["too long", "zapub_7Fq2xR9nKdW3mB6tYp1sVzAeX"],
    ["a non-alphanumeric character", "zapub_7Fq2xR9nKdW3mB6tYp1sVz-e"],
    ["surrounding whitespace", ` ${PUBLISHER_ID}`],
    ["an empty value", ""],
  ])("rejects %s", (_description, value) => {
    expect(isValidPublisherId(value)).toBe(false)
  })

  test("rejects null and undefined", () => {
    expect(isValidPublisherId(null)).toBe(false)
    expect(isValidPublisherId(undefined)).toBe(false)
  })
})

describe("publisherIdsMatch", () => {
  test("matches two identical well-formed ids", () => {
    expect(publisherIdsMatch(PUBLISHER_ID, PUBLISHER_ID)).toBe(true)
  })

  test("is case-sensitive, since the id is used verbatim everywhere", () => {
    expect(publisherIdsMatch(PUBLISHER_ID, "zapub_7fq2xr9nkdw3mb6typ1svzae")).toBe(false)
  })

  test("never matches a malformed id, even to itself", () => {
    expect(publisherIdsMatch("zapub_short", "zapub_short")).toBe(false)
    expect(publisherIdsMatch(undefined, undefined)).toBe(false)
  })
})

describe("parsePublisherHeader", () => {
  test("returns the id, trimmed", () => {
    expect(parsePublisherHeader(`  ${PUBLISHER_ID}  `)).toBe(PUBLISHER_ID)
  })

  test("tolerates a legacy trailing parameter", () => {
    expect(parsePublisherHeader(`${PUBLISHER_ID}; v=1`)).toBe(PUBLISHER_ID)
  })

  test("returns undefined for an absent or unusable value", () => {
    expect(parsePublisherHeader(undefined)).toBeUndefined()
    expect(parsePublisherHeader("")).toBeUndefined()
    expect(parsePublisherHeader("not-an-id")).toBeUndefined()
  })
})
