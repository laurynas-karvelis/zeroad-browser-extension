import { ExtensionError } from "./error";

export const inDevMode = async () => {
  return (await chrome.management.getSelf()).installType === "development";
};

export function arraysEqual(a: unknown[], b: unknown[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  return a.every((v, i) => v === b[i]);
}

export function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch (_err) {
    return "";
  }
}

export async function httpPost<T>(url: string, token: string, payload: object): Promise<T> {
  const contentType = "application/json";
  const response = await fetch(url, {
    headers: { "Content-Type": contentType, ...(token?.length && { Authorization: token }) },
    body: JSON.stringify(payload),
    method: "POST",
  });

  if (!response.ok) {
    throw new ExtensionError(`Endpoint responded with ${response.status}`, await response.json());
  }

  if ((response.headers.get("content-type") || "").includes(contentType)) {
    return response.json();
  }

  throw new Error("Response is not JSON: " + url);
}
