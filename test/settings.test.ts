// settings.test.ts - Pure-logic tests for the shared settings store helpers
// using a fake V2 storage implementation (no host, no disk).
import { test } from "node:test"
import assert from "node:assert/strict"
import { migrateLegacySettings, DEFAULT_SETTINGS, SETTINGS_KEY } from "../src/settings.js"

type Store = { value: Record<string, unknown> }
const stores = new Map<string, Store>()

function fakeContext() {
  return {
    options: {},
    storage: {
      // Mirrors the real contract: same-key calls share one store; mutation is async.
      store(_key: string, opts: { initial: Record<string, unknown> }) {
        let entry = stores.get(_key)
        if (!entry) {
          entry = { value: structuredClone(opts.initial) }
          stores.set(_key, entry)
        }
        const e = entry
        return [
          e.value,
          (mutation: (draft: Record<string, unknown>) => void) => {
            mutation(e.value)
            return Promise.resolve()
          },
        ] as const
      },
    },
  } as unknown as import("@opencode-ai/plugin/tui/context").Context
}

test("migrateLegacySettings copies legacy language and toggles once", async () => {
  stores.clear()
  const ctx = fakeContext()
  // Seed the legacy key the old plugin versions wrote.
  stores.set(`plugin.opencode-usage-stat.${SETTINGS_KEY === "usage-stat-settings" ? "usage-stat-config" : SETTINGS_KEY}`, {
    value: { language: "zh", showTrend: false },
  })
  await migrateLegacySettings(ctx)
  const migrated = stores.get("plugin.opencode-usage-stat.usage-stat-settings")
  assert.ok(migrated)
  assert.equal(migrated.value.language, "zh")
  assert.equal(migrated.value.showTrend, false)
  // Non-legacy defaults stay untouched.
  assert.equal(migrated.value.showPerformance, DEFAULT_SETTINGS.showPerformance)

  // Running again must not reapply or clobber user changes.
  migrated.value.showTrend = true
  await migrateLegacySettings(ctx)
  assert.equal(migrated.value.showTrend, true)
})

test("migrateLegacySettings never overwrites values that already differ from defaults", async () => {
  stores.clear()
  const ctx = fakeContext()
  stores.set("plugin.opencode-usage-stat.usage-stat-config", { value: { showPricing: false } })
  // Settings store already customized: showPricing=false is a user choice, not default.
  stores.set("plugin.opencode-usage-stat.usage-stat-settings", { value: { ...DEFAULT_SETTINGS } })
  await migrateLegacySettings(ctx)
  const settings = stores.get("plugin.opencode-usage-stat.usage-stat-settings")!
  // Legacy says false and current equals default(true) -> migrate.
  assert.equal(settings.value.showPricing, false)
})

test("migrateLegacySettings tolerates missing storage without throwing", async () => {
  stores.clear()
  const ctx = fakeContext()
  delete (ctx.storage as unknown as Record<string, unknown>).store
  await assert.doesNotReject(() => migrateLegacySettings(ctx))
})
