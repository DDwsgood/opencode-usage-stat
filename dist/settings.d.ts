import type { Context } from "@opencode-ai/plugin/tui/context";
export type UsageDisplayMode = "used" | "remaining";
export type LanguageSetting = "zh" | "en" | "auto";
export interface UsageStatSettings {
    showPerformance: boolean;
    showPricing: boolean;
    showTrend: boolean;
    /** Whether provider usage percentages show used or remaining quota. */
    providerUsageDisplay: UsageDisplayMode;
    language: LanguageSetting;
}
export declare const SETTINGS_KEY = "usage-stat-settings";
export declare const DEFAULT_SETTINGS: UsageStatSettings;
/** Seed values from plugin options (`sidebar.*`, `language`, `providerUsageDisplay`). */
export declare function optionsToSettings(options: unknown): Partial<UsageStatSettings>;
type SettingsStore = readonly [UsageStatSettings, (mutation: (draft: UsageStatSettings) => void) => Promise<void>];
/**
 * Get (or create) the shared reactive settings store. Throws when the host has
 * no storage — callers must fall back to defaults/options.
 */
export declare function getSettingsStore(context: Context): SettingsStore;
/**
 * One-shot migration from the legacy "usage-stat-config" key. Non-destructive:
 * legacy values are copied into the new store only when they differ from what
 * is already stored and still at defaults. Awaited by the settings dialog so
 * the first read sees migrated values; retried if storage was unavailable.
 */
export declare function migrateLegacySettings(context: Context): Promise<void>;
export {};
