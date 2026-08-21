// provider-collapse.ts - Pure helpers for the Provider Usage collapse state.
// Kept out of the JSX component so they are unit-testable without a renderer.

export type ProviderId = "opencode-go" | "deepseek" | "codex"

export const PROVIDER_IDS: readonly ProviderId[] = ["opencode-go", "deepseek", "codex"] as const

/** Pure: default collapse state for the fixed provider set (all collapsed). */
export function defaultProviderCollapse(): Record<string, boolean> {
  return { "opencode-go": true, deepseek: true, codex: true }
}

/** Pure: merge stored collapse overrides onto defaults. */
export function mergeProviderCollapse(stored: Record<string, boolean> | null | undefined): Record<string, boolean> {
  const base = defaultProviderCollapse()
  if (stored && typeof stored === "object") {
    for (const id of PROVIDER_IDS) {
      if (typeof stored[id] === "boolean") base[id] = stored[id]
    }
  }
  return base
}