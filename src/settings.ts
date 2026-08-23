// settings.ts - Unified persisted settings for the Usage Stat panel.
//
// One storage key ("usage-stat-settings") holds every user preference:
// sidebar toggles, provider usage display mode and language. The panel,
// provider blocks and the /usage dialogs all share the same reactive store
// (V2 storage.store coalesces same-key stores), so toggles take effect
// immediately and survive TUI restarts. Plugin `options` seed the initial
// values only; after that the stored settings win.
//
// Legacy note: versions <=2.1.2 wrote "usage-stat-config" with two clashing
// shapes ({showPerformance...} and {language}); migrateLegacySettings copies
// whatever is still there into the new key exactly once.

import type { Context } from "@opencode-ai/plugin/tui/context"

export type UsageDisplayMode = "used" | "remaining"
export type LanguageSetting = "zh" | "en" | "auto"

export interface UsageStatSettings {
  showPerformance: boolean
  showPricing: boolean
  showTrend: boolean
  /** Whether provider usage percentages show used or remaining quota. */
  providerUsageDisplay: UsageDisplayMode
  language: LanguageSetting
}

export const SETTINGS_KEY = "usage-stat-settings"
const LEGACY_KEY = "usage-stat-config"

export const DEFAULT_SETTINGS: UsageStatSettings = {
  showPerformance: true,
  showPricing: true,
  showTrend: true,
  providerUsageDisplay: "used",
  language: "auto",
}

/** Seed values from plugin options (`sidebar.*`, `language`, `providerUsageDisplay`). */
export function optionsToSettings(options: unknown): Partial<UsageStatSettings> {
  const out: Partial<UsageStatSettings> = {}
  try {
    const cfg = options && typeof options === "object" ? options as Record<string, any> : {}
    if (cfg?.sidebar && typeof cfg.sidebar === "object") {
      if (typeof cfg.sidebar.showPerformance === "boolean") out.showPerformance = cfg.sidebar.showPerformance
      if (typeof cfg.sidebar.showPricing === "boolean") out.showPricing = cfg.sidebar.showPricing
      if (typeof cfg.sidebar.showTrend === "boolean") out.showTrend = cfg.sidebar.showTrend
    }
    if (cfg?.language === "zh" || cfg?.language === "en" || cfg?.language === "auto") out.language = cfg.language
    if (cfg?.providerUsageDisplay === "used" || cfg?.providerUsageDisplay === "remaining") {
      out.providerUsageDisplay = cfg.providerUsageDisplay
    }
  } catch { /* defaults */ }
  return out
}

type SettingsStore = readonly [UsageStatSettings, (mutation: (draft: UsageStatSettings) => void) => Promise<void>]

/**
 * Get (or create) the shared reactive settings store. Throws when the host has
 * no storage — callers must fall back to defaults/options.
 */
export function getSettingsStore(context: Context): SettingsStore {
  return context.storage.store<UsageStatSettings>(SETTINGS_KEY, {
    initial: { ...DEFAULT_SETTINGS, ...optionsToSettings(context.options) },
  }) as SettingsStore
}

let migrationDone = false

/**
 * One-shot migration from the legacy "usage-stat-config" key. Non-destructive:
 * legacy values are copied into the new store only when they differ from what
 * is already stored and still at defaults. Awaited by the settings dialog so
 * the first read sees migrated values; retried if storage was unavailable.
 */
export async function migrateLegacySettings(context: Context): Promise<void> {
  if (migrationDone) return
  try {
    const [settings, mutate] = getSettingsStore(context)
    const [legacy] = context.storage.store<Partial<UsageStatSettings>>(LEGACY_KEY, { initial: {} })
    const patch: Partial<UsageStatSettings> = {}
    for (const key of ["showPerformance", "showPricing", "showTrend", "providerUsageDisplay", "language"] as const) {
      const value = legacy?.[key]
      if (value !== undefined && value !== null && settings[key] !== value &&
        settings[key] === DEFAULT_SETTINGS[key]) {
        (patch as Record<string, unknown>)[key] = value
      }
    }
    if (Object.keys(patch).length > 0) {
      await mutate(draft => Object.assign(draft, patch))
    }
    migrationDone = true
  } catch { /* storage unavailable: allow a retry on the next call */ }
}
