/**
 * A failed worker handler replies with this envelope instead of throwing: `messaging.ts` cannot
 * send an `Error` back, since one structured-clones to an empty object.
 */
type WorkerErrorResponse = { error: string }

function isErrorResponse(response: unknown): response is WorkerErrorResponse {
  return (
    typeof response === "object" && response !== null && typeof (response as WorkerErrorResponse).error === "string"
  )
}

export const worker = {
  sendCommand<T>(command: string): Promise<T> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ command }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || "The worker could not be reached"))
          return
        }

        // Without this an error envelope arrives as an ordinary reply, and every truthiness check
        // the popup makes on a command result reads a failure as a "yes".
        if (isErrorResponse(response)) {
          reject(new Error(response.error))
          return
        }

        resolve(response as T)
      })
    })
  },

  on<T>(event: string, callback: (data: T) => unknown) {
    chrome.runtime.onMessage.addListener((message) => {
      if ((message as { event?: string })?.event !== event) return false

      callback((message as { data?: unknown }).data as T)

      // Returning a value is how a listener asks Chrome to hold the reply channel open for a late
      // `sendResponse`. These are one-way notifications, so the callback's own return value - which
      // is `true` for anything chainable - must never become that answer.
      return false
    })

    return this
  },
}
