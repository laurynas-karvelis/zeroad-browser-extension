/* eslint-disable no-console */
type LogLevel = "error" | "warn" | "info" | "debug";

const levels: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

let currentLevel: LogLevel = "error";

export function setLogLevel(level: LogLevel): void {
  if (levels[level] !== undefined) {
    currentLevel = level;
  }
}

export function log(level: LogLevel, ...args: unknown[]): void {
  if (levels[level] <= levels[currentLevel]) {
    console.log(`[${level.toUpperCase()}]`, ...args);
  }
}
