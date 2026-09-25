import { expect, mock, test } from "bun:test"
import { chromeMock } from "../../__fixtures__/chrome"
import { SUBSCRIPTION_PLAN_NAME } from "../types"

const access = {
  hostname: "publisher.test",
  visitorToken: "signed-test-token",
  planName: SUBSCRIPTION_PLAN_NAME.FREEDOM,
  expiresAt: Date.now() + 86400000,
}

chromeMock.storage.sync.seed({ user: { firstName: "Publisher", extensionToken: "owner-token" } })
chromeMock.storage.local.seed({ websiteTest: { extensionToken: "owner-token", access } })

const enableRenewal = mock(async (_when: number) => {})
mock.module("../credentials", () => ({ credentials: () => ({ enableRenewal, cancelRenewal: async () => {} }) }))
mock.module("../header-injection", () => ({ headerInjection: () => ({ reset: async () => {} }) }))
mock.module("../telemetry-sync", () => ({ telemetrySync: () => ({ push: async () => {} }) }))

const { extension } = await import("../extension")

test("a restarted worker restores test access and renewal without recording payable usage", async () => {
  await extension().ready

  expect(extension().getExtensionData().testAccess).toEqual(access)
  expect(extension().isSubscriptionActive()).toBe(true)
  expect(extension().canRecordUsage()).toBe(false)
  expect(enableRenewal).toHaveBeenCalledWith(access.expiresAt)
})
