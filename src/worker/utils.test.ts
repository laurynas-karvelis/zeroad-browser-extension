import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { ExtensionError } from "./error"
import { arraysEqual, getHostname, httpPost, isValidUrl } from "./utils"

describe("arraysEqual", () => {
  test("compares by identity, length and element order", () => {
    const same = [1, 2]
    expect(arraysEqual(same, same)).toBe(true)
    expect(arraysEqual(["a", "b"], ["a", "b"])).toBe(true)
    expect(arraysEqual(["a", "b"], ["b", "a"])).toBe(false)
    expect(arraysEqual(["a"], ["a", "b"])).toBe(false)
    expect(arraysEqual([], [])).toBe(true)
  })

  test("compares elements strictly, so it never treats look-alikes as equal", () => {
    expect(arraysEqual([1], ["1"])).toBe(false)
    expect(arraysEqual([{ a: 1 }], [{ a: 1 }])).toBe(false)
  })
})

describe("isValidUrl", () => {
  test("accepts http and https only", () => {
    expect(isValidUrl("https://example.com/a?b=c")).toBe(true)
    expect(isValidUrl("http://localhost:3000")).toBe(true)
  })

  test("rejects the non-web URLs a browser hands us for its own pages", () => {
    // The extension must never treat these as publisher-site candidates.
    expect(isValidUrl("chrome://extensions")).toBe(false)
    expect(isValidUrl("about:blank")).toBe(false)
    expect(isValidUrl("file:///etc/hosts")).toBe(false)
    expect(isValidUrl("chrome-extension://abc/popup.html")).toBe(false)
    expect(isValidUrl("javascript:alert(1)")).toBe(false)
    expect(isValidUrl("data:text/html,hi")).toBe(false)
  })

  test("rejects empty, missing and unparseable values", () => {
    expect(isValidUrl(undefined)).toBe(false)
    expect(isValidUrl("")).toBe(false)
    expect(isValidUrl("not a url")).toBe(false)
  })
})

describe("getHostname", () => {
  test("strips scheme, port, path and credentials", () => {
    expect(getHostname("https://example.com:8443/a/b?c=d#e")).toBe("example.com")
    expect(getHostname("https://user:pass@example.com/")).toBe("example.com")
  })

  test("keeps subdomains distinct, since telemetry is keyed by hostname", () => {
    expect(getHostname("https://blog.example.com/")).not.toBe(getHostname("https://example.com/"))
  })

  test("lowercases the host the way the URL parser does", () => {
    expect(getHostname("https://EXAMPLE.com/")).toBe("example.com")
  })

  test("returns an empty string for unparseable input instead of throwing", () => {
    expect(getHostname("not a url")).toBe("")
    expect(getHostname("")).toBe("")
  })
})

describe("httpPost", () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch")
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  test("posts JSON and returns the parsed body", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ payload: { ok: true } }))

    const result = await httpPost<{ payload: { ok: boolean } }>("https://api.test/x", "token-123", { a: 1 })

    expect(result).toEqual({ payload: { ok: true } })
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.test/x")
    expect(init.method).toBe("POST")
    expect(init.body).toBe('{"a":1}')
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-123")
  })

  test("omits the Authorization header when there is no token", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}))

    await httpPost("https://api.test/x", "", {})

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  test("throws an ExtensionError carrying the status and the parsed error body", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: "expired" }, 401))

    const error = (await httpPost("https://api.test/x", "t", {}).catch((e) => e)) as ExtensionError

    expect(error).toBeInstanceOf(ExtensionError)
    expect(error.message).toBe("Endpoint responded with 401")
    expect(error.cause).toEqual({ error: "expired" })
  })

  test("still reports the status when the error body is not JSON", async () => {
    // A gateway returning an HTML error page must not mask the status code.
    fetchSpy.mockResolvedValue(
      new Response("<html>502</html>", { status: 502, headers: { "content-type": "text/html" } })
    )

    const error = (await httpPost("https://api.test/x", "t", {}).catch((e) => e)) as ExtensionError

    expect(error).toBeInstanceOf(ExtensionError)
    expect(error.message).toBe("Endpoint responded with 502")
    expect(error.cause).toBeUndefined()
  })

  test("rejects a 200 response that is not JSON", async () => {
    fetchSpy.mockResolvedValue(new Response("hello", { status: 200, headers: { "content-type": "text/plain" } }))

    await expect(httpPost("https://api.test/x", "t", {})).rejects.toThrow("Response is not JSON: https://api.test/x")
  })

  test("accepts a JSON content-type that carries a charset", async () => {
    fetchSpy.mockResolvedValue(
      new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json; charset=utf-8" } })
    )

    await expect(httpPost("https://api.test/x", "t", {})).resolves.toEqual({ ok: true })
  })

  test("aborts and reports a timeout when the endpoint hangs", async () => {
    fetchSpy.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          ;(init as RequestInit).signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError"))
          )
        })
    )

    const error = (await httpPost("https://api.test/slow", "t", {}, 10).catch((e) => e)) as ExtensionError

    expect(error).toBeInstanceOf(ExtensionError)
    expect(error.message).toBe("Request timeout")
    expect(error.cause).toEqual({ url: "https://api.test/slow", timeoutMs: 10 })
  })

  test("propagates network failures untouched", async () => {
    fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"))

    await expect(httpPost("https://api.test/x", "t", {})).rejects.toThrow("Failed to fetch")
  })
})
