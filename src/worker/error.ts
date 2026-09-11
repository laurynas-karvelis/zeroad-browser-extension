export class ExtensionError extends Error {
  cause: unknown
  /** The HTTP status of a failed platform call, so callers can tell a rejected token from an outage. */
  status?: number

  constructor(message: string, cause?: unknown, status?: number) {
    super(message)
    this.cause = cause
    this.status = status
  }
}
