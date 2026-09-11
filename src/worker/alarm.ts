import { log } from "./logger"

export const schedule = {
  async recreate(name: string, options: chrome.alarms.AlarmCreateInfo) {
    await chrome.alarms.clear(name)
    await chrome.alarms.create(name, options)
    log("debug", `[alarm] ${name} is re-created:`, options)
  },

  /**
   * Creates the alarm unless one with the same period already exists. Re-creating it on every worker
   * start would restart its countdown each time, so a periodic alarm would never fire; but one left over
   * from an older version with a different period must be replaced, or it keeps the old cadence forever.
   */
  async create(name: string, options: chrome.alarms.AlarmCreateInfo) {
    const existing = await chrome.alarms.get(name)
    if (existing && existing.periodInMinutes === options.periodInMinutes) return

    await chrome.alarms.create(name, options)
    log("debug", `[alarm] ${name} is created:`, options)
  },

  on(name: string | string[], callback: () => unknown | Promise<unknown>) {
    const nameWhitelist = Array.isArray(name) ? name : [name]

    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (!nameWhitelist.includes(alarm.name)) return

      log("debug", `[alarm] ${alarm.name} triggered`)
      return callback()
    })

    return this
  },

  async clear(name: string) {
    await chrome.alarms.clear(name)
  },
}
