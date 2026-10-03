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
import { createSignal, createEffect, createMemo, onCleanup, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import type { Context } from "@opencode-ai/plugin/tui/context"
import { RGBA } from "@opentui/core"
import {
  checkProviderUsage,
  resolveProviderUsageConfig,
  PROVIDERS,
  USAGE_STAT_PROVIDER_IDS,
  collapsedSummary,
  worstUsagePercent,
  hasEnabledDevinModel,
  isDevinUsageVisible,
  devinLocationKey,
  devinGatePlugins,
  DOLLAR_POOL_LABEL,
  dollarPoolRemaining,
  shortDollars,
  toNumber,
} from "./provider-usage.js"
import type { ProviderId, ProviderUsageResult, UsageDisplayMode } from "./provider-usage.js"
import {
  DROID_USAGE_RPC,
  checkDroidUsage,
  hasEnabledDroidModel,
  isDroidUsageVisible,
  makeFactoryAccountQuotaSource,
} from "./droid-usage.js"
import type { DroidUsageQuery } from "./droid-usage.js"
import { t } from "./i18n.js"
import { formatResetDuration } from "./formatter.js"
import { resolveThemeColors } from "./theme-map.js"
import { getSettingsStore } from "./settings.js"
import { truncateToWidth, visualWidth } from "./text-width.js"
import { percentBar, providerHeaderFit, providerRowLayout, usageLevel } from "./tui-layout.js"
import type { UsageLevel } from "./tui-layout.js"

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
  devin: RGBA.fromInts(9, 180, 150, 255),
  droid: RGBA.fromInts(255, 150, 60, 255),
}

export interface ProviderUsageBlocksProps {
  context: Context
  /** Current session (slot input); required for Droid session-tracked FSC. */
  sessionID?: string
  /** Outer sidebar panel width (border included); rows are fitted to it. */
  panelWidth?: number
}

// Cells between the panel edge and row content: panel border + this block's
// paddingX, and the expanded body's own paddingX.
const HEADER_INSET = 4
const BODY_INSET = 6

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

  // ── Plugin gate (Devin + Droid): plugin list + enabled model, scoped to
  // the live location. Both providers share one plugin.list poll.
  const devinEnabled = enabledIds.includes("devin")
  const droidEnabled = enabledIds.includes("droid")
  const gateEnabled = devinEnabled || droidEnabled
  let disposed = false
  let pluginGateSeq = 0
  onCleanup(() => { disposed = true })

  const locationKey = () => {
    const location = context.location ?? context.data.location.default()
    return devinLocationKey(location)
  }
  // Gate state keyed by the location it was fetched for. `seq` drops async
  // results that resolve after a newer request was issued.
  const [pluginGate, setPluginGate] = createSignal<{ key: string; seq: number; pluginIds: readonly string[] }>(
    { key: "", seq: 0, pluginIds: [] },
  )

  async function refreshPluginGate(): Promise<void> {
    if (!gateEnabled || disposed) return
    const location = context.location ?? context.data.location.default()
    const key = devinLocationKey(location)
    // Immediately clear qualifications earned under another location.
    setPluginGate(prev => (prev.key === key ? prev : { key, seq: prev.seq, pluginIds: [] }))
    const seq = ++pluginGateSeq
    try {
      const listed = await context.client.plugin.list({ location })
      if (disposed || seq !== pluginGateSeq || key !== locationKey()) return
      const ids = Array.isArray(listed?.data) ? listed.data.map(p => p.id) : []
      setPluginGate(prev => devinGatePlugins(prev, locationKey(), key, seq, ids))
    } catch {
      // Keep the previous list on transient failures.
    }
    // Prime the reactive model cache; the render path reads list() below.
    if (!disposed && seq === pluginGateSeq && key === locationKey()) {
      void context.data.location.model.sync(location).catch(() => { /* cached list stays */ })
    }
  }

  // Re-check whenever the effective location changes (reactive on default()).
  createEffect(() => {
    locationKey()
    void refreshPluginGate()
  })

  const locationModels = () => {
    const location = context.location ?? context.data.location.default()
    try {
      return context.data.location.model.list(location)
    } catch {
      return undefined
    }
  }
  // Memoized booleans: downstream effects only re-run when eligibility
  // actually flips, not on every poll producing a fresh pluginIds array.
  const devinEligible = createMemo(() => isDevinUsageVisible({
    configEnabled: devinEnabled,
    pluginIds: pluginGate().key === locationKey() ? pluginGate().pluginIds : [],
    hasDevinModel: hasEnabledDevinModel(locationModels()),
  }))
  const droidEligible = createMemo(() => isDroidUsageVisible({
    configEnabled: droidEnabled,
    pluginIds: pluginGate().key === locationKey() ? pluginGate().pluginIds : [],
    hasDroidModel: hasEnabledDroidModel(locationModels()),
  }))

  const [states, setStates] = createSignal<ProviderState[]>(
    enabledIds.map(id => ({ id, loading: false, result: null })),
  )

  // ── Droid: session-family tracked FSC via the opencode-droid-v2 RPC ──

  /** Family scope: child sessions stand alone; root sessions include subagent children. */
  const droidFamily = (): string[] => {
    const sessionID = props.sessionID ?? ""
    if (!sessionID) return []
    const selected = context.data.session.get(sessionID)
    if (selected?.parentID) return [sessionID]
    try {
      const family = context.data.session.family(sessionID)
      return family.length > 0 ? [...family] : [sessionID]
    } catch {
      return [sessionID]
    }
  }

  function droidQuery(): DroidUsageQuery | null {
    // Capability boundary: the installed client typings predate client.rpc,
    // but OpenCode >= 2.0.18 exposes it at runtime. No HTTP fallback exists —
    // there is no unauthenticated usage endpoint and credentials are never read.
    const client = context.client as unknown as { rpc?: (definition: unknown) => unknown }
    if (typeof client.rpc !== "function") return null
    try {
      const rpc = client.rpc(DROID_USAGE_RPC) as { usage?: unknown } | null
      return rpc && typeof rpc.usage === "function" ? rpc as DroidUsageQuery : null
    } catch {
      return null
    }
  }

  // Real account-quota source (Factory CLI keyring first — self-refreshing —
  // then the saved web credential; credentials are re-resolved per call).
  const factoryQuotaSource = droidEnabled ? makeFactoryAccountQuotaSource() : undefined

  let droidSeq = 0
  let droidInflight = false
  let droidPending = false

  async function refreshDroid(): Promise<void> {
    if (!droidEnabled || !droidEligible()) return
    const sessionID = props.sessionID ?? ""
    // Merge overlapping triggers: one in-flight RPC, at most one queued rerun.
    if (droidInflight) {
      droidPending = true
      return
    }
    droidInflight = true
    const location = context.location ?? context.data.location.default()
    const key = devinLocationKey(location)
    const family = sessionID ? droidFamily() : []
    const seq = ++droidSeq
    setStates(prev => prev.map(s => (s.id === "droid" ? { ...s, loading: true } : s)))
    try {
      const result = await checkDroidUsage(droidQuery(), family, { location, accountQuota: factoryQuotaSource })
      // A stale response must never overwrite state belonging to a newer
      // location/session or a superseding request.
      const stale = disposed
        || seq !== droidSeq
        || key !== devinLocationKey(context.location ?? context.data.location.default())
        || sessionID !== (props.sessionID ?? "")
      setStates(prev => prev.map(s => (s.id === "droid" ? { ...s, loading: false, result: stale ? s.result : result } : s)))
    } finally {
      droidInflight = false
      if (droidPending && !disposed) {
        droidPending = false
        void refreshDroid()
      }
    }
  }

  // Session switch: drop the previous session's tracked numbers immediately
  // and invalidate any in-flight RPC that belonged to it.
  let lastDroidSession: string | null = null
  createEffect(() => {
    const sessionID = props.sessionID ?? ""
    if (!droidEnabled) return
    if (sessionID !== lastDroidSession) {
      lastDroidSession = sessionID
      droidSeq++
      setStates(prev => prev.map(s => (s.id === "droid" && (s.result || s.loading) ? { ...s, result: null, loading: false } : s)))
    }
    // Account quota is session-independent; refresh even without a session.
    if (droidEligible()) void refreshDroid()
  })

  async function refreshOne(id: ProviderId): Promise<void> {
    if (id === "droid") return refreshDroid()
    if (id === "devin" && !devinEligible()) return
    setStates(prev => prev.map(s => (s.id === id ? { ...s, loading: true } : s)))
    const result = await checkProviderUsage(id)
    if (disposed) return
    setStates(prev => prev.map(state => {
      if (state.id !== id) return state
      return { ...state, loading: false, result }
    }))
  }

  // Fetch Devin usage only when eligibility flips to true.
  createEffect(() => {
    if (devinEnabled && devinEligible()) void refreshOne("devin")
  })

  if (enabledIds.length > 0) {
    for (const id of enabledIds) {
      void refreshOne(id)
    }
    const timers: ReturnType<typeof setInterval>[] = []
    for (const id of enabledIds) {
      timers.push(setInterval(() => { void refreshOne(id) }, REFRESH_MS))
    }
    if (gateEnabled) {
      timers.push(setInterval(() => { void refreshPluginGate() }, REFRESH_MS))
    }
    onCleanup(() => {
      for (const timer of timers) clearInterval(timer)
    })
  }

  // Refresh tracked FSC when the host reports usage/step events for a session
  // in the current family. The inflight merge in refreshDroid keeps bursts
  // from overlapping.
  if (droidEnabled) {
    const onTrackedEvent = (event: { data?: { sessionID?: string } }) => {
      const sid = event?.data?.sessionID
      if (!sid || !droidEligible() || !droidFamily().includes(sid)) return
      void refreshDroid()
    }
    const unsubs = [
      context.data.on("session.usage.updated", onTrackedEvent),
      context.data.on("session.step.ended", onTrackedEvent),
    ]
    onCleanup(() => {
      for (const unsub of unsubs) unsub()
    })
  }

  const visibleStates = () => states().filter(s =>
    (s.id !== "devin" || devinEligible()) && (s.id !== "droid" || droidEligible()))

  function toggle(id: ProviderId): void {
    const next = !isCollapsed(id)
    setLocalCollapse(prev => ({ ...prev, [id]: next }))
    if (collapseMutate) void collapseMutate(draft => { draft[id] = next }).catch(() => { /* ignore */ })
  }

  function statusColor(s: ProviderState): RGBA {
    if (s.loading) return mutedColor()
    if (!s.result) return dimColor()
    if (!s.result.ok) return redColor()
    // Tightest window decides the dot color, independent of display mode.
    return levelColor(usageLevel(worstUsagePercent(s.result.windows)))
  }

  function levelColor(level: UsageLevel): RGBA {
    if (level === "critical") return redColor()
    if (level === "warn") return amberColor()
    return greenColor()
  }

  const panelWidth = (): number => props.panelWidth ?? 38

  /** Total dollars from a dollar-pool value label, 0 when not one. */
  function totalDollars(valueLabel: string | null): number {
    return toNumber(valueLabel?.match(/\/\s*\$([\d,.]+)/)?.[1]?.replace(/,/g, "")) ?? 0
  }

  return (
    <Show when={visibleStates().length > 0}>
      <box flexDirection="column" marginTop={1} paddingX={1}>
      <For each={visibleStates()}>
        {state => {
          const isOpen = () => !isCollapsed(state.id)
          const color = () => statusColor(state)
          const dot = () => {
            if (state.loading && !state.result) return "◌"
            if (!state.result) return "○"
            if (!state.result.ok) return "●"
            if (worstUsagePercent(state.result.windows) == null) return "◆"
            return "●"
          }
          const headerText = () => {
            if (state.loading && !state.result) return t("providerRefreshing")
            const summary = collapsedSummary(state.result?.windows, displayMode())
            if (state.result?.ok && summary != null) return summary
            const status = state.result?.status ?? t("providerNotConfigured")
            const prefix = `${PROVIDER_NAMES[state.id]} — `
            return status.startsWith(prefix) ? status.slice(prefix.length) : status
          }
          const header = () => providerHeaderFit(panelWidth() - HEADER_INSET, PROVIDER_NAMES[state.id] ?? state.id, headerText())
          return (
            <box flexDirection="column">
              <box flexDirection="row" justifyContent="space-between" gap={1} onMouseDown={() => toggle(state.id)} paddingX={0}>
                <text fg={PROVIDER_COLORS[state.id] ?? FALLBACK_COLOR}>
                  <span style={{ fg: color() } as any}>{dot()}</span>{" "}
                  <span style={{ fg: primaryColor() } as any}>{header().name}</span>
                  {isOpen() ? " ▾" : " ▸"}
                </text>
                <text fg={mutedColor()}>{header().right}</text>
              </box>

              <Show when={isOpen()}>
                <box flexDirection="column" paddingX={1} marginTop={0}>
                  <Show when={state.loading && !state.result}>
                    <text fg={mutedColor()}>{t("providerRefreshing")}</text>
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
                      {(win, index) => {
                        const droidGroup = state.id === "droid"
                          ? /^(Standard|Core) · (5h|weekly|monthly)$/.exec(win.label)
                          : null
                        const windowLabel = droidGroup
                          ? droidGroup[2].charAt(0).toUpperCase() + droidGroup[2].slice(1)
                          : win.label
                        const isDollarPool = DOLLAR_POOL_LABEL.test(win.valueLabel ?? "")
                        const label = windowLabel ? windowLabel + ": " : ""
                        // Droid group rows sit one extra cell to the right.
                        const contentWidth = () => panelWidth() - BODY_INSET - (droidGroup ? 1 : 0)
                        // Each bar is colored by its own used percent; the
                        // header dot keeps the worst window.
                        const winColor = () => levelColor(usageLevel(win.percent))

                        function renderWindow(): JSX.Element {
                          if (win.percent != null) {
                            const shownPercent = () =>
                              displayMode() === "remaining" ? 100 - win.percent! : win.percent!
                            const percentSuffix = () =>
                              ` ${Math.round(shownPercent())}%${displayMode() === "remaining" ? ` ${t("left")}` : ""}`
                            const layout = () => {
                              const reset = !isDollarPool && win.resetsAt ? formatResetDuration(win.resetsAt) : ""
                              return providerRowLayout(
                                contentWidth(),
                                label,
                                percentSuffix(),
                                reset ? ` · ${t("providerResets")} ${reset}` : "",
                                reset ? ` · ${reset}` : "",
                              )
                            }
                            // Dollar pools render "Monthly: [bar] N% left" plus a
                            // second line "[credits]$/[allowance]$"; other windows
                            // keep " · resets <duration>".
                            const poolCredits = isDollarPool
                              ? (displayMode() === "remaining"
                                ? dollarPoolRemaining(win.valueLabel)
                                : Math.max(0, totalDollars(win.valueLabel) - (dollarPoolRemaining(win.valueLabel) ?? 0)))
                              : null
                            const poolAllowance = isDollarPool ? totalDollars(win.valueLabel) : null
                            return (
                              <Show when={!isDollarPool} fallback={
                                <box flexDirection="column">
                                  <text fg={mutedColor()}>
                                    {label}
                                    <span style={{ fg: winColor() } as any}>
                                      {percentBar(shownPercent(), layout().barWidth)}{percentSuffix()}
                                    </span>
                                  </text>
                                  <text>
                                    <span style={{ fg: winColor() } as any}>
                                      {`${shortDollars(poolCredits ?? 0)}$/${shortDollars(poolAllowance ?? 0)}$`}
                                    </span>
                                  </text>
                                </box>
                              }>
                                <text fg={mutedColor()}>
                                  {label}
                                  <span style={{ fg: winColor() } as any}>
                                    {percentBar(shownPercent(), layout().barWidth)}{percentSuffix()}
                                  </span>
                                  {layout().reset ? (
                                    <span style={{ fg: dimColor() } as any}>{layout().reset}</span>
                                  ) : null}
                                </text>
                              </Show>
                            )
                          }
                          if (win.valueLabel) {
                            return (
                              <text fg={mutedColor()}>
                                {label}
                                <span style={{ fg: greenColor() } as any}>
                                  {truncateToWidth(win.valueLabel, Math.max(1, contentWidth() - visualWidth(label)))}
                                </span>
                              </text>
                            )
                          }
                          return <text fg={mutedColor()}>{label}—</text>
                        }

                        if (droidGroup) {
                          return (
                            <box flexDirection="column">
                              <Show when={!state.result?.windows?.[index() - 1]?.label.startsWith(`${droidGroup[1]} · `)}>
                                <text fg={mutedColor()}>{droidGroup[1]}:</text>
                              </Show>
                              <box flexDirection="column" paddingLeft={1}>
                                {renderWindow()}
                              </box>
                            </box>
                          )
                        }
                        return renderWindow()
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
