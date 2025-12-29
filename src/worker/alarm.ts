import { log } from "./logger";

export const schedule = {
  async recreate(name: string, options: chrome.alarms.AlarmCreateInfo) {
    await chrome.alarms.clear(name);
    await chrome.alarms.create(name, options);
    log("debug", `[alarm] ${name} is re-created:`, options);
  },

  async create(name: string, options: chrome.alarms.AlarmCreateInfo) {
    if (!(await this.has(name))) {
      await chrome.alarms.create(name, options);
      log("debug", `[alarm] ${name} is created:`, options);
    }
  },

  on(name: string | string[], callback: () => unknown | Promise<unknown>) {
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      log("debug", `[alarm] ${name} triggered`);
      const nameWhitelist = Array.isArray(name) ? name : [name];

      if (nameWhitelist.includes(alarm.name)) {
        return callback();
      }
    });

    return this;
  },

  async clear(name: string) {
    await chrome.alarms.clear(name);
  },

  async has(name: string) {
    return !!(await chrome.alarms.get(name));
  },
};
