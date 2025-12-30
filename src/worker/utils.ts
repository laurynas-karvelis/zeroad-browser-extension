import { ExtensionError } from "./error";

export const inDevMode = async () => {
  return (await chrome.management.getSelf()).installType === "development";
};

export function arraysEqual(a: unknown[], b: unknown[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  return a.every((v, i) => v === b[i]);
}

export function isValidUrl(url: string | undefined): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch (_err) {
    return "";
  }
}

export async function httpPost<T>(url: string, token: string, payload: object, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const contentType = "application/json";
    const response = await fetch(url, {
      headers: {
        "Content-Type": contentType,
        ...(token?.length && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(payload),
      method: "POST",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new ExtensionError(`Endpoint responded with ${response.status}`, await response.json());
    }

    if ((response.headers.get("content-type") || "").includes(contentType)) {
      return response.json();
    }

    throw new Error("Response is not JSON: " + url);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ExtensionError("Request timeout", { url, timeoutMs });
    }
    throw error;
  }
}
