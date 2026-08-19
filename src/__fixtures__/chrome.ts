// A minimal in-memory stand-in for the subset of the `chrome.*` extension APIs the
// background worker touches. Importing this module installs `globalThis.chrome`,
// so it must be imported (statically) before any worker module, since those build
// their singletons and register their listeners at import time.

type Listener = (...args: never[]) => unknown

export type MockEvent<TArgs extends unknown[]> = {
  addListener(listener: (...args: TArgs) => unknown): void
  removeListener(listener: (...args: TArgs) => unknown): void
  hasListener(listener: (...args: TArgs) => unknown): boolean
  listenerCount(): number
  /** Invokes every registered listener and awaits each one, so tests can assert on the fallout. */
  dispatch(...args: TArgs): Promise<unknown[]>
}

function createEvent<TArgs extends unknown[]>(): MockEvent<TArgs> {
  const listeners: Listener[] = []

  return {
    addListener: (listener) => void listeners.push(listener as Listener),
    removeListener(listener) {
      const index = listeners.indexOf(listener as Listener)
      if (index >= 0) listeners.splice(index, 1)
    },
    hasListener: (listener) => listeners.includes(listener as Listener),
    listenerCount: () => listeners.length,
    async dispatch(...args) {
      const results: unknown[] = []
      for (const listener of [...listeners]) {
        results.push(await (listener as (...a: TArgs) => unknown)(...args))
      }
      return results
    },
  }
}

type StorageRecord = Record<string, unknown>

function createStorageArea() {
  let store: StorageRecord = {}

  return {
    /** Direct access for arranging/asserting state without going through the promise API. */
    peek: () => structuredClone(store),
    seed(values: StorageRecord) {
      store = { ...store, ...structuredClone(values) }
    },
    async get(keys?: string | string[] | null) {
      const wanted = keys === undefined || keys === null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys]
      const result: StorageRecord = {}
      for (const key of wanted) {
        if (key in store) result[key] = structuredClone(store[key])
      }
      return result
    },
    async set(values: StorageRecord) {
      // Chrome serializes on write, so callers never share references with the store.
      store = { ...store, ...structuredClone(values) }
    },
    async remove(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key]
    },
    async clear() {
      store = {}
    },
  }
}

type Alarm = { name: string; scheduledTime: number; periodInMinutes?: number }

function createAlarms(onAlarm: MockEvent<[Alarm]>) {
  const alarms = new Map<string, Alarm>()

  return {
    onAlarm,
    peek: () => new Map(alarms),
    async create(name: string, options: { when?: number; periodInMinutes?: number; delayInMinutes?: number }) {
      alarms.set(name, {
        name,
        scheduledTime: options.when ?? Date.now(),
        periodInMinutes: options.periodInMinutes,
      })
    },
    async get(name: string) {
      return alarms.get(name)
    },
    async clear(name: string) {
      return alarms.delete(name)
    },
    async clearAll() {
      alarms.clear()
      return true
    },
    /** Fires an alarm the way Chrome would, whether or not it was ever created. */
    fire(name: string) {
      return onAlarm.dispatch({ name, scheduledTime: Date.now() })
    },
  }
}

export function createChromeMock() {
  const onAlarm = createEvent<[Alarm]>()

  const mock = {
    runtime: {
      id: "test-extension-id",
      lastError: undefined as { message: string } | undefined,
      manifestVersion: "9.9.9",
      uninstallUrl: undefined as string | undefined,
      getManifest: () => ({ version: mock.runtime.manifestVersion }),
      getURL: (path: string) => `chrome-extension://test-extension-id/${path.replace(/^\.?\//, "")}`,
      setUninstallURL: (url: string) => {
        mock.runtime.uninstallUrl = url
      },
      OnInstalledReason: { INSTALL: "install", UPDATE: "update" },
      onInstalled: createEvent<[{ reason: string }]>(),
      onMessage: createEvent<[unknown, unknown, (response: unknown) => void]>(),
      onMessageExternal: createEvent<[unknown, unknown, (response: unknown) => void]>(),
      sentMessages: [] as unknown[],
      /** What the next `sendMessage` callback receives. Set per test to script the worker's reply. */
      sendMessageResponse: undefined as unknown,
      sendMessage(message: unknown, callback?: (response: unknown) => void) {
        mock.runtime.sentMessages.push(message)
        callback?.(mock.runtime.sendMessageResponse)
      },
    },

    management: {
      installType: "normal" as "normal" | "development",
      async getSelf() {
        return { installType: mock.management.installType }
      },
    },

    storage: { local: createStorageArea(), sync: createStorageArea() },

    alarms: createAlarms(onAlarm),

    action: {
      badgeText: "",
      icons: [] as { tabId?: number; path: string }[],
      async setBadgeText({ text }: { text: string }) {
        mock.action.badgeText = text
      },
      async setIcon({ tabId, path }: { tabId?: number; path: string }) {
        mock.action.icons.push({ tabId, path })
      },
    },

    declarativeNetRequest: {
      sessionRules: [] as { id: number }[],
      updateSessionRuleCalls: [] as { addRules?: { id: number }[]; removeRuleIds?: number[] }[],
      async updateSessionRules(options: { addRules?: { id: number }[]; removeRuleIds?: number[] }) {
        mock.declarativeNetRequest.updateSessionRuleCalls.push(structuredClone(options))
        // Chrome removes before it adds, which is what makes "replace rule N" a single call.
        for (const ruleId of options.removeRuleIds || []) {
          mock.declarativeNetRequest.sessionRules = mock.declarativeNetRequest.sessionRules.filter(
            (rule) => rule.id !== ruleId
          )
        }
        mock.declarativeNetRequest.sessionRules.push(...(options.addRules || []))
      },
    },

    tabs: {
      byId: new Map<number, Record<string, unknown>>(),
      created: [] as { url: string }[],
      onActivated: createEvent<[{ tabId: number; windowId?: number }]>(),
      onUpdated: createEvent<[number, { status?: string }, Record<string, unknown>]>(),
      onRemoved: createEvent<[number]>(),
      async get(tabId: number) {
        const tab = mock.tabs.byId.get(tabId)
        if (!tab) throw new Error(`No tab with id: ${tabId}`)
        return tab
      },
      async query(info: { active?: boolean; currentWindow?: boolean }) {
        return [...mock.tabs.byId.values()].filter((tab) => info.active === undefined || tab.active === info.active)
      },
      async create(options: { url: string }) {
        mock.tabs.created.push(options)
        return { id: mock.tabs.byId.size + 1, ...options }
      },
    },

    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: createEvent<[number]>(),
      onRemoved: createEvent<[number]>(),
    },

    webRequest: {
      onCompleted: createEvent<[{ url: string; responseHeaders?: { name: string; value?: string }[] }]>(),
    },

    scripting: {
      /** Overwrite in a test to control what the injected meta-tag reader "finds". */
      executeScriptResult: [{ result: undefined as string | undefined }],
      executeScriptCalls: [] as unknown[],
      async executeScript(injection: unknown) {
        mock.scripting.executeScriptCalls.push(injection)
        return mock.scripting.executeScriptResult
      },
    },
  }

  return mock
}

export type ChromeMock = ReturnType<typeof createChromeMock>

export const chromeMock = createChromeMock()

// biome-ignore lint/suspicious/noExplicitAny: the mock only covers the surface the worker uses
;(globalThis as any).chrome = chromeMock
