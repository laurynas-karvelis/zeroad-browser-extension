import { ExtensionError } from "./error"

export const inDevMode = async () => {
  return (await chrome.management.getSelf()).installType === "development"
}

export function arraysEqual(a: unknown[], b: unknown[]) {
  if (a === b) return true
  if (a.length !== b.length) return false

  return a.every((v, i) => v === b[i])
}

export function isValidUrl(url: string | undefined): boolean {
  if (!url) return false

  try {
    const parsed = new URL(url)
    return ["http:", "https:"].includes(parsed.protocol)
  } catch {
    return false
  }
}

export function getHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch (_err) {
    return ""
  }
}

// A failed response's body is diagnostic only, so a non-JSON one must never mask the status code.
async function readErrorBody(response: Response) {
  try {
    return await response.json()
  } catch (_err) {
    return undefined
  }
}

export async function httpPost<T>(url: string, token: string, payload: object, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const contentType = "application/json"

  try {
    const response = await fetch(url, {
      headers: {
        "Content-Type": contentType,
        ...(token?.length && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(payload),
      method: "POST",
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new ExtensionError(`Endpoint responded with ${response.status}`, await readErrorBody(response))
    }

    if ((response.headers.get("content-type") || "").includes(contentType)) {
      return response.json()
    }

    throw new ExtensionError(`Response is not JSON: ${url}`, { status: response.status })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ExtensionError("Request timeout", { url, timeoutMs })
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}
