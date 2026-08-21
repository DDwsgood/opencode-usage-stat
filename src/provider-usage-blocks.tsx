/**
 * provider-usage-blocks.tsx - "Provider Usage" collapsible blocks in the TUI
 * sidebar. Fixed providers: OpenCode Go, DeepSeek, Codex. Each provider is
 * opt-in via plugin config `providerUsage: { "opencode-go": boolean,
 * "deepseek": boolean, "codex": boolean }` (all default to false). Each enabled
 * provider appears collapsed immediately. Expanding shows quota
 * windows, balance, and reset times. Enabled providers refresh independently
 * every two minutes with a ~15s timeout.
 * Errors / unconfigured states never leak secrets.
 *
 * V2 API: Context from @opencode-ai/plugin/tui.
 */
import { createSignal, createEffect, onCleanup, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import type { Context } from "@opencode-ai/plugin/tui/context"
import { RGBA } from "@opentui/core"
import { checkProviderUsage, resolveProviderUsageConfig } from "./provider-usage.js"
import type { ProviderUsageResult } from "./provider-usage.js"
import { t } from "./i18n.js"
import { PROVIDER_IDS } from "./provider-collapse.js"
import type { ProviderId } from "./provider-collapse.js"
import { resolveThemeColors } from "./theme-map.js"

const PROVIDER_NAMES: Record<string, string> = {
  "opencode-go": "OpenCode Go",
  deepseek: "DeepSeek",
  codex: "Codex",
}
const REFRESH_MS = 2 * 60 * 1000 // every 2 minutes

const PROVIDER_COLORS: Record<string, RGBA> = {
  "opencode-go": RGBA.fromInts(80, 190, 255, 255),
  deepseek: RGBA.fromInts(78, 140, 255, 255),
  codex: RGBA.fromInts(205, 130, 255, 255),
}

export interface ProviderUsageBlocksProps {
  context: Context
}

interface ProviderState {
  id: string
  collapsed: boolean
  loading: boolean
  result: ProviderUsageResult | null
}

export function ProviderUsageBlocks(props: ProviderUsageBlocksProps): JSX.Element {
  const { context } = props
  // Manual opt-in only: providers are never auto-detected/enabled.
  const enabledIds = PROVIDER_IDS.filter(id => resolveProviderUsageConfig(context.options)[id])
  const colors = resolveThemeColors(context.theme)
  const primaryColor = (): RGBA => colors.primary
  const mutedColor = (): RGBA => colors.muted
  const dimColor = (): RGBA => colors.dim
  const greenColor = (): RGBA => colors.green
  const redColor = (): RGBA => colors.red
  const amberColor = (): RGBA => colors.amber
  const cyanColor = (): RGBA => colors.cyan

  const [states, setStates] = createSignal<ProviderState[]>(
    enabledIds.map(id => ({ id, collapsed: true, loading: false, result: null })),
  )

  async function refreshOne(id: string): Promise<void> {
    setStates(prev => prev.map(s => (s.id === id ? { ...s, loading: true } : s)))
    const result = await checkProviderUsage(id as ProviderId)
    setStates(prev => prev.map(state => {
      if (state.id !== id) return state
      return { ...state, loading: false, result }
    }))
  }

  function initialRefresh(): void {
    for (const id of enabledIds) {
      void refreshOne(id)
    }
  }

  createEffect(() => {
    if (enabledIds.length === 0) return
    initialRefresh()
    const timers: ReturnType<typeof setInterval>[] = []
    for (const id of enabledIds) {
      timers.push(setInterval(() => { void refreshOne(id) }, REFRESH_MS))
    }
    onCleanup(() => {
      for (const timer of timers) clearInterval(timer)
    })
  })

  function toggle(id: string): void {
    setStates(prev => prev.map(s => (s.id === id ? { ...s, collapsed: !s.collapsed } : s)))
  }

  function statusColor(s: ProviderState): RGBA {
    if (s.loading) return mutedColor()
    if (!s.result) return dimColor()
    if (!s.result.ok) return redColor()
    const first = s.result.windows?.[0]
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

  function formatReset(iso: string): string {
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return iso
    const diff = d.getTime() - Date.now()
    if (diff <= 0) return "now"
    const mins = Math.round(diff / 60000)
    if (mins < 60) return `${mins}m`
    const hours = Math.floor(mins / 60)
    if (hours < 48) return `${hours}h`
    return `${Math.round(hours / 24)}d`
  }

  return (
    <Show when={states().length > 0}>
      <box flexDirection="column" marginTop={1} paddingX={1}>
      <For each={states()}>
        {state => {
          const isOpen = () => !state.collapsed
          const color = () => statusColor(state)
          const dot = () => {
            if (state.loading) return "◌"
            if (!state.result) return "○"
            if (!state.result.ok) return "●"
            const first = state.result.windows?.[0]
            if (first == null) return "●"
            if (first.percent == null) return "◆"
            return "●"
          }
          const headerText = () => {
            if (state.loading) return `${t("providerRefreshing")}…`
            const first = state.result?.windows?.[0]
            if (state.result?.ok && first?.percent != null) return `${first.percent.toFixed(0)}% used`
            if (state.result?.ok && first?.valueLabel) return first.valueLabel
            const status = state.result?.status ?? t("providerNotConfigured")
            const prefix = `${PROVIDER_NAMES[state.id]} — `
            return status.startsWith(prefix) ? status.slice(prefix.length) : status
          }
          return (
            <box flexDirection="column">
              <box flexDirection="row" justifyContent="space-between" gap={1} onMouseDown={() => toggle(state.id)} paddingX={0}>
                <text fg={PROVIDER_COLORS[state.id] ?? cyanColor()}>
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
                    <text fg={redColor()}>{state.result!.status}</text>
                    <Show when={state.result !== null && !state.result.configured}>
                      <text fg={dimColor()}>enable via plugin config: providerUsage.&lt;id&gt; = true</text>
                    </Show>
                  </Show>

                  <Show when={state.result !== null && state.result.ok && state.result.windows}>
                    <For each={state.result!.windows}>
                      {win => {
                        const label = win.label ? win.label + ": " : ""
                        if (win.percent != null) {
                          return (
                            <text fg={mutedColor()}>
                              {label}
                              <span style={{ fg: statusColor(state) } as any}>
                                {percentBar(win.percent, 12)} {win.percent.toFixed(0)}%
                              </span>
                              {win.resetsAt ? (
                                <span style={{ fg: dimColor() } as any}> · {t("providerResets")} {formatReset(win.resetsAt)}</span>
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
