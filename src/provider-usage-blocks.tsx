/**
 * provider-usage-blocks.tsx - "Provider Usage" collapsible blocks in the TUI
 * sidebar. Providers are opt-in via plugin config `providerUsage: { <id>:
 * boolean }` (all default to false). Each enabled provider appears collapsed
 * immediately; the collapsed header labels the 5h/session and weekly windows
 * explicitly (monthly/billing totals only show when expanded). Expanding shows
 * all quota windows, balances and reset times. Collapse state is persisted
 * via V2 storage ("usage-stat-provider-collapse"); the used/remaining display
 * mode comes from the shared settings store. Enabled providers refresh
 * independently every two minutes with a ~15s timeout.
 * Errors / unconfigured states never leak secrets.
 *
 * V2 API: Context from @opencode-ai/plugin/tui.
 */
import { createSignal, onCleanup, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import type { Context } from "@opencode-ai/plugin/tui/context"
import { RGBA } from "@opentui/core"
import {
  checkProviderUsage,
  resolveProviderUsageConfig,
  PROVIDERS,
  USAGE_STAT_PROVIDER_IDS,
  collapsedSummary,
} from "./provider-usage.js"
import type { ProviderId, ProviderUsageResult, UsageDisplayMode } from "./provider-usage.js"
import { t } from "./i18n.js"
import { formatResetDuration } from "./formatter.js"
import { resolveThemeColors } from "./theme-map.js"
import { getSettingsStore } from "./settings.js"

const REFRESH_MS = 2 * 60 * 1000 // every 2 minutes

const PROVIDER_NAMES: Record<string, string> = Object.fromEntries(
  PROVIDERS.map(p => [p.id, p.name]),
)

const FALLBACK_COLOR = RGBA.fromInts(80, 190, 255, 255)
const PROVIDER_COLORS: Record<string, RGBA> = {
  "opencode-go": RGBA.fromInts(80, 190, 255, 255),
  deepseek: RGBA.fromInts(78, 140, 255, 255),
  codex: RGBA.fromInts(205, 130, 255, 255),
  claude: RGBA.fromInts(217, 119, 87, 255),
  "kimi-for-coding": RGBA.fromInts(125, 110, 255, 255),
  "zai-coding-plan": RGBA.fromInts(255, 190, 80, 255),
  "zhipuai-coding-plan": RGBA.fromInts(70, 130, 246, 255),
  "minimax-coding-plan": RGBA.fromInts(255, 100, 140, 255),
  "minimax-cn-coding-plan": RGBA.fromInts(230, 90, 130, 255),
  openrouter: RGBA.fromInts(150, 120, 255, 255),
  "ollama-cloud": RGBA.fromInts(160, 168, 178, 255),
  "github-copilot": RGBA.fromInts(110, 150, 235, 255),
  "github-copilot-addon": RGBA.fromInts(130, 165, 250, 255),
  google: RGBA.fromInts(120, 185, 95, 255),
  xai: RGBA.fromInts(225, 225, 235, 255),
  cursor: RGBA.fromInts(200, 200, 210, 255),
  "command-code": RGBA.fromInts(235, 190, 90, 255),
}

export interface ProviderUsageBlocksProps {
  context: Context
}

interface ProviderState {
  id: ProviderId
  loading: boolean
  result: ProviderUsageResult | null
}

export function ProviderUsageBlocks(props: ProviderUsageBlocksProps): JSX.Element {
  const { context } = props
  // Manual opt-in only: providers are never auto-detected/enabled.
  const enabledIds = USAGE_STAT_PROVIDER_IDS.filter(id => resolveProviderUsageConfig(context.options)[id])
  const colors = resolveThemeColors(context.theme)
  const primaryColor = (): RGBA => colors.primary
  const mutedColor = (): RGBA => colors.muted
  const dimColor = (): RGBA => colors.dim
  const greenColor = (): RGBA => colors.green
  const redColor = (): RGBA => colors.red
  const amberColor = (): RGBA => colors.amber

  // ── Persisted collapse state ──
  // Storage store is the source of truth when available; a local mirror keeps
  // rows toggleable when storage throws.
  let storedCollapse: { readonly [id: string]: boolean | undefined } | null = null
  let collapseMutate: ((mutation: (draft: Record<string, boolean>) => void) => Promise<void>) | null = null
  try {
    const [store, mutate] = context.storage.store<Record<string, boolean>>(
      "usage-stat-provider-collapse",
      { initial: {} },
    )
    storedCollapse = store as { readonly [id: string]: boolean | undefined }
    collapseMutate = mutate
  } catch (err) {
    console.warn("[opencode-usage-stat] storage unavailable, provider collapse will not persist:", err)
  }
  const [localCollapse, setLocalCollapse] = createSignal<Record<string, boolean>>({})

  // ── Shared settings store: used vs remaining display mode ──
  let settingsStore: { readonly providerUsageDisplay?: UsageDisplayMode } | null = null
  try {
    const [store] = getSettingsStore(context)
    settingsStore = store
  } catch { /* fall back to defaults */ }
  const displayMode = (): UsageDisplayMode =>
    settingsStore?.providerUsageDisplay === "remaining" ? "remaining" : "used"

  const isCollapsed = (id: ProviderId): boolean => {
    const override = localCollapse()[id]
    if (override !== undefined) return override
    return storedCollapse?.[id] !== false
  }

  const [states, setStates] = createSignal<ProviderState[]>(
    enabledIds.map(id => ({ id, loading: false, result: null })),
  )

  async function refreshOne(id: ProviderId): Promise<void> {
    setStates(prev => prev.map(s => (s.id === id ? { ...s, loading: true } : s)))
    const result = await checkProviderUsage(id)
    setStates(prev => prev.map(state => {
      if (state.id !== id) return state
      return { ...state, loading: false, result }
    }))
  }

  if (enabledIds.length > 0) {
    for (const id of enabledIds) {
      void refreshOne(id)
    }
    const timers: ReturnType<typeof setInterval>[] = []
    for (const id of enabledIds) {
      timers.push(setInterval(() => { void refreshOne(id) }, REFRESH_MS))
    }
    onCleanup(() => {
      for (const timer of timers) clearInterval(timer)
    })
  }

  function toggle(id: ProviderId): void {
    const next = !isCollapsed(id)
    setLocalCollapse(prev => ({ ...prev, [id]: next }))
    if (collapseMutate) void collapseMutate(draft => { draft[id] = next }).catch(() => { /* ignore */ })
  }

  function statusColor(s: ProviderState): RGBA {
    if (s.loading) return mutedColor()
    if (!s.result) return dimColor()
    if (!s.result.ok) return redColor()
    const first = s.result.windows?.find(w => w.percent != null)
    if (first?.percent != null) {
      if (first.percent >= 90) return redColor()
      if (first.percent >= 70) return amberColor()
      return greenColor()
    }
    return greenColor()
  }

  function percentBar(percent: number, width: number): string {
    const filled = Math.max(0, Math.min(width, Math.floor((percent / 100) * width)))
    return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled))
  }

  return (
    <Show when={states().length > 0}>
      <box flexDirection="column" marginTop={1} paddingX={1}>
      <For each={states()}>
        {state => {
          const isOpen = () => !isCollapsed(state.id)
          const color = () => statusColor(state)
          const dot = () => {
            if (state.loading && !state.result) return "◌"
            if (!state.result) return "○"
            if (!state.result.ok) return "●"
            if (state.result.windows?.[0]?.percent == null) return "◆"
            return "●"
          }
          const headerText = () => {
            if (state.loading && !state.result) return `${t("providerRefreshing")}…`
            const summary = collapsedSummary(state.result?.windows, displayMode())
            if (state.result?.ok && summary != null) {
              return displayMode() === "remaining" ? `${summary} ${t("left")}` : summary
            }
            const status = state.result?.status ?? t("providerNotConfigured")
            const prefix = `${PROVIDER_NAMES[state.id]} — `
            return status.startsWith(prefix) ? status.slice(prefix.length) : status
          }
          return (
            <box flexDirection="column">
              <box flexDirection="row" justifyContent="space-between" gap={1} onMouseDown={() => toggle(state.id)} paddingX={0}>
                <text fg={PROVIDER_COLORS[state.id] ?? FALLBACK_COLOR}>
                  <span style={{ fg: color() } as any}>{dot()}</span>{" "}
                  <span style={{ fg: primaryColor() } as any}>{PROVIDER_NAMES[state.id]}</span>
                  {isOpen() ? " ▾" : " ▸"}
                </text>
                <text fg={mutedColor()}>
                  {headerText().length > 32 ? headerText().slice(0, 31) + "…" : headerText()}
                </text>
              </box>

              <Show when={isOpen()}>
                <box flexDirection="column" paddingX={1} marginTop={0}>
                  <Show when={state.loading && !state.result}>
                    <text fg={mutedColor()}>{t("providerRefreshing")}…</text>
                  </Show>

                  <Show when={!state.loading && !state.result}>
                    <text fg={mutedColor()}>—</text>
                  </Show>

                  <Show when={state.result !== null && !state.result.ok}>
                    <text fg={redColor()}>{state.result?.status ?? ""}</text>
                    <Show when={state.result !== null && !state.result?.configured}>
                      <text fg={dimColor()}>{t("providerEnableHint")}</text>
                    </Show>
                  </Show>

                  <Show when={state.result !== null && state.result.ok && state.result.windows}>
                    <For each={state.result?.windows ?? []}>
                      {win => {
                        const label = win.label ? win.label + ": " : ""
                        if (win.percent != null) {
                          const shownPercent = () =>
                            displayMode() === "remaining" ? 100 - win.percent! : win.percent!
                          return (
                            <text fg={mutedColor()}>
                              {label}
                              <span style={{ fg: color() } as any}>
                                {percentBar(shownPercent(), 12)}{" "}{Math.round(shownPercent())}%
                                {displayMode() === "remaining" ? ` ${t("left")}` : ""}
                              </span>
                              {win.resetsAt ? (
                                <span style={{ fg: dimColor() } as any}> · {t("providerResets")} {formatResetDuration(win.resetsAt)}</span>
                              ) : null}
                            </text>
                          )
                        }
                        if (win.valueLabel) {
                          return (
                            <text fg={mutedColor()}>
                              {label}
                              <span style={{ fg: greenColor() } as any}>{win.valueLabel}</span>
                            </text>
                          )
                        }
                        return <text fg={mutedColor()}>{label}—</text>
                      }}
                    </For>
                  </Show>
                </box>
              </Show>
            </box>
          )
        }}
      </For>
      </box>
    </Show>
  )
}
