export type ProviderId = "opencode-go" | "deepseek" | "codex";
export declare const PROVIDER_IDS: readonly ProviderId[];
/** Pure: default collapse state for the fixed provider set (all collapsed). */
export declare function defaultProviderCollapse(): Record<string, boolean>;
/** Pure: merge stored collapse overrides onto defaults. */
export declare function mergeProviderCollapse(stored: Record<string, boolean> | null | undefined): Record<string, boolean>;
