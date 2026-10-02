// sidebar.tsx - Usage Stat TUI sidebar (V2 Context API).
// Real-time token/cache/performance stats for the current session + Provider
// Usage blocks. Adapted from opencode-tokenwatch (MIT, (c) TTWK).
import { createSignal, createMemo, createEffect, For, Show, onCleanup } from "solid-js"
import type { JSX } from "solid-js"
import type { Context } from "@opencode-ai/plugin/tui/context"
import { RGBA } from "@opentui/core"
import { formatTokens, formatCost, formatDuration, isMissingCache, totalInputTokens, cacheHitRate } from "./formatter.js"
import { t as baseT, setLanguage } from "./i18n.js"
import type { PerfTracker } from "./perf-tracker.js"
import type { TokenMessage } from "./token-messages.js"
import { ProviderUsageBlocks } from "./provider-usage-blocks.jsx"
import type { ThemeColorMap } from "./theme-map.js"
import { resolveThemeColors } from "./theme-map.js"
import { getSettingsStore, migrateLegacySettings } from "./settings.js"
import type { UsageStatSettings, LanguageSetting } from "./settings.js"

export interface SidebarConfig {
  sidebar: {
    showPerformance: boolean
    showPricing: boolean
    showTrend: boolean
  }
  language: "zh" | "en" | "auto"
}

const DEFAULT_CONFIG: SidebarConfig = {
  sidebar: { showPerformance: true, showPricing: true, showTrend: true },
  language: "auto",
}

export { formatTokens, formatCost }

function progressBarWidth(percent: number, width: number): number {
  if (percent >= 100) return width
  return Math.floor((percent / 100) * width)
}
function progressFilled(percent: number, width: number): string {
  return "█".repeat(Math.max(0, progressBarWidth(percent, width)))
}
function progressRemaining(percent: number, width: number): string {
  return "░".repeat(Math.max(0, width - progressBarWidth(percent, width)))
}

function getVisualWidth(str: string): number {
  let w = 0
  for (const c of str) {
    const code = c.codePointAt(0) ?? 0
    if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3040 && code <= 0x30FF) ||
      (code >= 0xAC00 && code <= 0xD7A3) || (code >= 0x1100 && code <= 0x11FF) ||
      (code >= 0x2E80 && code <= 0x2EFF)) {
      w += 2
    } else {
      w += 1
    }
  }
  return w
}

function centerAlign(text: string, width: number): string {
  const visualW = getVisualWidth(text)
  if (visualW >= width) return text
  const left = Math.floor((width - visualW) / 2)
  const right = width - visualW - left
  return " ".repeat(left) + text + " ".repeat(right)
}

function hitRateColor(rate: number): RGBA {
  if (rate >= 85) return RGBA.fromInts(76, 175, 80, 255)
  if (rate >= 70) return RGBA.fromInts(255, 193, 7, 255)
  return RGBA.fromInts(244, 67, 54, 255)
}

/**
 * V2 storage-backed collapse state. The storage store itself is the single
 * source of truth (tokenwatch pattern): no local signal copy, no createEffect
 * sync — mutations land reactively and survive TUI restarts.
 */
interface CollapseState {
  global: boolean
  models: Record<string, boolean>
}
const COLLAPSE_INITIAL: CollapseState = { global: false, models: {} }

export function loadConfig(context: Context): SidebarConfig {
  const base = { sidebar: { ...DEFAULT_CONFIG.sidebar }, language: DEFAULT_CONFIG.language } as SidebarConfig
  try {
    const pluginCfg = context.options as Record<string, any>
    if (pluginCfg?.sidebar) Object.assign(base.sidebar, pluginCfg.sidebar)
    if (pluginCfg?.language) base.language = pluginCfg.language
  } catch { /* defaults */ }
  return base
}

// ── Panel body ──

interface ModelAgg {
  providerID: string
  modelID: string
  totalInput: number
  totalOutput: number
  totalReasoning: number
  cacheRead: number
  cacheWrite: number
  totalCost: number
  requestCount: number
  lastMessageIndex: number
}

export interface UsageStatPanelProps {
  context: Context
  perfTracker: PerfTracker
  sessionID: string
  revision: () => number
  allTokenMessages: () => TokenMessage[]
}

export function UsageStatPanel(props: UsageStatPanelProps) {
  const { context, perfTracker } = props

  const optionConfig = loadConfig(context)

  // ── Shared persisted settings (single reactive store) ──
  // The store's initial value is seeded from plugin options on first creation,
  // so stored values are authoritative afterwards.
  let settings: UsageStatSettings | null = null
  try {
    const [store] = getSettingsStore(context)
    settings = store
    migrateLegacySettings(context)
  } catch (err) {
    console.warn("[opencode-usage-stat] storage unavailable, settings will not persist:", err)
  }
  const showPerformance = () => settings ? settings.showPerformance : optionConfig.sidebar.showPerformance
  const showPricing = () => settings ? settings.showPricing : optionConfig.sidebar.showPricing
  const showTrend = () => settings ? settings.showTrend : optionConfig.sidebar.showTrend

  // Sync language from persisted/native config
  setLanguage(settings ? settings.language : optionConfig.language)
  createEffect(() => setLanguage((settings ? settings.language : optionConfig.language) as LanguageSetting))

  const t = (key: string) => {
    void settings?.language
    return baseT(key)
  }
  const isEnglish = (str: string) => /^[a-zA-Z\s\.\/]+$/.test(str)

  // ── V2 storage-backed state ──
  // Storage store is the source of truth when available; a local mirror keeps
  // the panel interactive when storage throws (e.g. no persistable state).
  let storedCollapse: CollapseState | null = null
  let collapseMutate: ((mutation: (draft: CollapseState) => void) => Promise<void>) | null = null
  try {
    const [store, mutate] = context.storage.store<CollapseState>("usage-stat-collapse", { initial: COLLAPSE_INITIAL })
    storedCollapse = store as CollapseState
    collapseMutate = mutate
  } catch (err) {
    console.warn("[opencode-usage-stat] storage unavailable, collapse state will not persist:", err)
  }
  const [localCollapse, setLocalCollapse] = createSignal<{ global?: boolean; models?: Record<string, boolean> }>({})

  function toggleGlobal(): void {
    const next = !(localCollapse().global ?? storedCollapse?.global ?? false)
    setLocalCollapse(prev => ({ ...prev, global: next }))
    if (collapseMutate) void collapseMutate(draft => { draft.global = next }).catch(() => { /* ignore */ })
  }
  function toggleModel(key: string): void {
    const current = localCollapse().models?.[key] ?? storedCollapse?.models[key] ?? false
    const next = !current
    setLocalCollapse(prev => ({ ...prev, models: { ...prev.models, [key]: next } }))
    if (collapseMutate) void collapseMutate(draft => { draft.models[key] = next }).catch(() => { /* ignore */ })
  }
  const isPanelCollapsed = () => localCollapse().global ?? storedCollapse?.global ?? false
  const isModelCollapsed = (key: string) =>
    (localCollapse().models?.[key] ?? storedCollapse?.models[key] ?? false) === true

  const [panelWidth, setPanelWidth] = createSignal(38)
  let outerBoxRef: any = null
  const colors = resolveThemeColors(context.theme)
  const primaryColor = (): RGBA => colors.primary
  const mutedColor = (): RGBA => colors.muted
  const dimColor = (): RGBA => colors.dim
  const greenColor = (): RGBA => colors.green
  const borderColor = (): RGBA => colors.border
  const missingColor = (): RGBA => colors.purple

  // ── Data aggregation ──
  const modelStats = createMemo(() => {
    const map = new Map<string, ModelAgg>()
    const msgs = props.allTokenMessages()
    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i]
      const key = `${msg.providerID}/${msg.modelID}`
      let e = map.get(key)
      if (!e) {
        e = { providerID: msg.providerID, modelID: msg.modelID, totalInput: 0, totalOutput: 0, totalReasoning: 0, cacheRead: 0, cacheWrite: 0, totalCost: 0, requestCount: 0, lastMessageIndex: -1 }
        map.set(key, e)
      }
      e.totalInput += msg.inputTokens
      e.totalOutput += msg.outputTokens
      e.totalReasoning += msg.reasoningTokens
      e.cacheRead += msg.cacheRead
      e.cacheWrite += msg.cacheWrite
      e.totalCost += msg.cost
      e.requestCount++
      e.lastMessageIndex = i
    }
    return Array.from(map.entries())
      .filter(([, s]) => s.totalInput + s.totalOutput + s.totalReasoning + s.cacheRead + s.cacheWrite > 0)
      .sort((a, b) => b[1].lastMessageIndex - a[1].lastMessageIndex)
  })

  const messageTotals = createMemo(() => {
    let i = 0, o = 0, ir = 0, cr = 0, cw = 0, r = 0, c = 0
    for (const [, s] of modelStats()) {
      i += s.totalInput; o += s.totalOutput; ir += s.totalReasoning
      cr += s.cacheRead; cw += s.cacheWrite; r += s.requestCount; c += s.totalCost
    }
    return { totalInput: i, totalOutput: o, totalReasoning: ir, totalCacheRead: cr, totalCacheWrite: cw, totalRequests: r, totalCost: c, totalTokens: i + o + ir + cr + cw }
  })

  const sessionTotals = createMemo(() => {
    void props.revision()
    const selected = context.data.session.get(props.sessionID)
    if (!selected) return messageTotals()
    const family = selected.parentID
      ? [props.sessionID]
      : context.data.session.family(props.sessionID).length > 0
        ? context.data.session.family(props.sessionID)
        : [props.sessionID]
    let i = 0, o = 0, ir = 0, cr = 0, cw = 0, c = 0
    for (const sessionID of family) {
      const session = context.data.session.get(sessionID)
      if (!session) continue
      i += session.tokens.input
      o += session.tokens.output
      ir += session.tokens.reasoning
      cr += session.tokens.cache.read
      cw += session.tokens.cache.write
      c += session.cost
    }
    return {
      totalInput: i,
      totalOutput: o,
      totalReasoning: ir,
      totalCacheRead: cr,
      totalCacheWrite: cw,
      totalRequests: messageTotals().totalRequests,
      totalCost: c,
      totalTokens: i + o + ir + cr + cw,
    }
  })

  const globalHitRate = createMemo(() => {
    let i = 0, cr = 0
    for (const [, s] of modelStats()) {
      if (isMissingCache(s.requestCount, s.cacheRead, s.cacheWrite)) continue
      i += totalInputTokens(s.totalInput, s.cacheWrite)
      cr += s.cacheRead
    }
    const denom = i + cr
    return denom > 0 ? (cr / denom) * 100 : -1
  })

  const modelHitRate = createMemo(() => {
    return modelStats().map(([key, stat]) => {
      const denom = totalInputTokens(stat.totalInput, stat.cacheWrite) + stat.cacheRead
      if (denom === 0) return { key, rate: 0, msgs: [] as TokenMessage[] }
      const msgs: TokenMessage[] = []
      for (const msg of props.allTokenMessages()) {
        if (`${msg.providerID}/${msg.modelID}` !== key) continue
        msgs.push(msg)
      }
      return { key, rate: cacheHitRate(stat.totalInput, stat.cacheRead, stat.cacheWrite) * 100, msgs }
    })
  })

  const modelTrend = createMemo(() => {
    return modelHitRate().map(({ key, msgs }) => {
      if (msgs.length < 6) return { key, trend: null as number | null }
      const sumSlice = (start: number, end: number) => {
        let sumCache = 0, sumTotal = 0
        for (let i = start; i < end && i < msgs.length; i++) {
          sumCache += msgs[i].cacheRead
          sumTotal += totalInputTokens(msgs[i].inputTokens, msgs[i].cacheWrite) + msgs[i].cacheRead
        }
        return { sumCache, sumTotal }
      }
      const n = msgs.length
      const recent = sumSlice(n - 3, n)
      const prev = sumSlice(n - 6, n - 3)
      const rateRecent = recent.sumTotal > 0 ? (recent.sumCache / recent.sumTotal) * 100 : 0
      const ratePrev = prev.sumTotal > 0 ? (prev.sumCache / prev.sumTotal) * 100 : 0
      return { key, trend: rateRecent - ratePrev }
    })
  })

  const [partVersion, setPartVersion] = createSignal(0)
  const perfStats = createMemo(() => {
    void props.allTokenMessages()
    void partVersion()
    void props.revision()
    return perfTracker.getSessionStats()
  })

  onCleanup(() => { /* component disposal handled by host */ })

  // ── Layout ──
  const innerWidth = () => panelWidth() - 2
  const barWidth = () => Math.max(8, innerWidth() - 19)
  const divider = () => {
    const w = innerWidth()
    if (w <= 2) return "─".repeat(w)
    return " " + "─".repeat(w - 2) + " "
  }

  const toggle = {
    global: toggleGlobal,
    model: toggleModel,
  }

  return (
    <box
      ref={(el: any) => { outerBoxRef = el }}
      onSizeChange={() => {
        if (outerBoxRef) setPanelWidth((outerBoxRef as any).width as number)
      }}
      flexDirection="column"
      border={true}
      borderStyle="rounded"
      borderColor={borderColor()}
    >
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between" onMouseDown={toggle.global} paddingX={1}>
        <text fg={primaryColor()}>{isPanelCollapsed() ? "▶" : "▾"} {t("panelTitle")}</text>
        <text fg={mutedColor()}>
          {isPanelCollapsed() ? formatTokens(sessionTotals().totalTokens) : ""}
          {globalHitRate() >= 0 ? (
            <span style={{ fg: hitRateColor(globalHitRate()) } as any}>
              {isPanelCollapsed() ? ` (${globalHitRate().toFixed(1)}% hit)` : `${globalHitRate().toFixed(1)}% hit`}
            </span>
          ) : ""}
        </text>
      </box>

      {/* Provider Usage reveals collapsed after quota changes in this TUI session. */}
      <ProviderUsageBlocks context={context} sessionID={props.sessionID} />

      <Show when={!isPanelCollapsed()}>
        <text fg={borderColor()}>{divider()}</text>

        {/* Global stats */}
        <box flexDirection="row" paddingX={1}>
          <For each={[
            { val: formatTokens(sessionTotals().totalTokens), lbl: t("total") },
            { val: sessionTotals().totalRequests.toString(), lbl: t("requests") },
            { val: formatTokens(totalInputTokens(sessionTotals().totalInput, sessionTotals().totalCacheWrite)), lbl: t("input") },
            { val: formatTokens(sessionTotals().totalOutput), lbl: t("output") },
          ]}>
            {(item, idx) => {
              const colW = () => {
                const totalW = panelWidth() - 4
                const base = Math.floor(totalW / 4)
                return idx() === 3 ? totalW - base * 3 : base
              }
              return (
                <box width={colW()} flexDirection="column">
                  <text fg={primaryColor()}>{centerAlign(item.val, colW())}</text>
                  <text fg={dimColor()}>{centerAlign(isEnglish(item.lbl) ? item.lbl.toUpperCase() : item.lbl, colW())}</text>
                </box>
              )
            }}
          </For>
        </box>

        <Show when={showPricing() && sessionTotals().totalCost > 0}>
          <box flexDirection="row" justifyContent="center" marginTop={1}>
            <text fg={mutedColor()}>{t("cost")}: <span style={{ fg: greenColor() } as any}>{formatCost(sessionTotals().totalCost)}</span></text>
          </box>
        </Show>

        {/* Model blocks */}
        <For each={modelStats()}>
          {([key, stat]) => {
            const isExpanded = () => !isModelCollapsed(key)
            const hitRate = cacheHitRate(stat.totalInput, stat.cacheRead, stat.cacheWrite) * 100
            const isMissing = isMissingCache(stat.requestCount, stat.cacheRead, stat.cacheWrite)
            const modelTotalTokens = stat.totalInput + stat.totalOutput + stat.totalReasoning + stat.cacheRead + stat.cacheWrite

            const trendStr = () => {
              if (!showTrend()) return ""
              const td = modelTrend().find(h => h.key === key)
              if (!td?.trend || td.trend === 0) return ""
              return td.trend > 0 ? ` ${t("trendUp")}${td.trend.toFixed(1)}%` : ` ${t("trendDown")}${Math.abs(td.trend).toFixed(1)}%`
            }
            const trendColor = () => ((modelTrend().find(h => h.key === key)?.trend ?? 0) >= 0 ? RGBA.fromInts(63, 185, 80, 255) : RGBA.fromInts(244, 67, 54, 255))

            const MAX_PROVIDER_LEN = 12
            let providerDisplay = stat.providerID
            if (providerDisplay.length > MAX_PROVIDER_LEN) providerDisplay = providerDisplay.slice(0, MAX_PROVIDER_LEN - 1) + "…"
            let fullTitle = `${providerDisplay}/${stat.modelID}`
            if (fullTitle.length > 22) {
              const parts = fullTitle.split("/")
              if (parts.length >= 3) fullTitle = `${parts[0]}/${parts[parts.length - 1]}`
            }
            const maxNameLen = Math.max(8, innerWidth() - 12)
            const shortTitle = fullTitle.length > maxNameLen ? fullTitle.slice(0, maxNameLen - 1) + "…" : fullTitle

            const modelHeaderRight = () => isExpanded()
              ? `×${stat.requestCount} ▾`
              : `${formatTokens(modelTotalTokens)} ▶`

            const targetW = () => Math.max(getVisualWidth(`${t("cache")}:`), getVisualWidth(`${t("cost")}:`))
            const paddedCachePrefix = () => {
              const label = `${t("cache")}:`
              return label + " ".repeat(targetW() - getVisualWidth(label))
            }
            const paddedCostPrefix = () => {
              const label = `${t("cost")}:`
              return label + " ".repeat(targetW() - getVisualWidth(label))
            }
            // Reserve room for the trend suffix so narrow panels don't overflow (3.3).
            const trendBudget = () => showTrend() ? 7 : 0
            const modelBarWidth = () => Math.max(8, (panelWidth() - 4) - targetW() - 11 - trendBudget())

            return (
              <box flexDirection="column" marginTop={1}>
                <box flexDirection="row" justifyContent="space-between" onMouseDown={() => toggle.model(key)} paddingX={1}>
                  <text fg={mutedColor()}>
                    <span style={{ fg: isMissing ? missingColor() : hitRateColor(hitRate) } as any}>●</span>{" "}
                    <span style={{ fg: primaryColor() } as any}>{shortTitle}</span>
                  </text>
                  <text fg={mutedColor()}>{modelHeaderRight()}</text>
                </box>

                <Show when={isExpanded()}>
                  <box flexDirection="column" paddingX={1}>
                    <box flexDirection="column" border={true} borderStyle="rounded" borderColor={borderColor()}>
                      <box flexDirection="row">
                        <For each={[
                          { val: formatTokens(modelTotalTokens), lbl: t("total") },
                          { val: formatTokens(totalInputTokens(stat.totalInput, stat.cacheWrite)), lbl: t("input") },
                          { val: formatTokens(stat.totalOutput), lbl: t("output") },
                        ]}>
                          {(item, idx) => {
                            const colW = () => {
                              const totalW = panelWidth() - 6
                              const base = Math.floor(totalW / 3)
                              return idx() === 2 ? totalW - base * 2 : base
                            }
                            return (
                              <box width={colW()} flexDirection="column">
                                <text fg={primaryColor()}>{centerAlign(item.val, colW())}</text>
                                <text fg={dimColor()}>{centerAlign(isEnglish(item.lbl) ? item.lbl.toUpperCase() : item.lbl, colW())}</text>
                              </box>
                            )
                          }}
                        </For>
                      </box>
                    </box>

                    <text fg={mutedColor()}>
                      {paddedCachePrefix()}
                      {isMissing ? (
                        <span style={{ fg: missingColor() } as any}>{progressRemaining(0, modelBarWidth())}{" "}{t("missing")}</span>
                      ) : (
                        <span style={{ fg: hitRateColor(hitRate) } as any}>
                          {progressFilled(hitRate, modelBarWidth())}{progressRemaining(hitRate, modelBarWidth())}{" "}{hitRate.toFixed(1)}%
                        </span>
                      )}
                      {trendStr() ? <span style={{ fg: trendColor() } as any}>{trendStr()}</span> : null}
                    </text>

                    <Show when={showPerformance() && !!perfStats().models[key]}>
                      <text fg={mutedColor()} marginTop={1}>
                        {t("ttft")} <span style={{ fg: primaryColor() } as any}>{formatDuration(perfStats().models[key]?.avgTTFT ?? null)}</span>
                        {"  "}{t("tps")} <span style={{ fg: primaryColor() } as any}>{perfStats().models[key]?.avgTPS?.toFixed(1) ?? "—"}</span>
                        {"  "}{t("lat")} <span style={{ fg: primaryColor() } as any}>{formatDuration(perfStats().models[key]?.avgLatency ?? null)}</span>
                      </text>
                    </Show>

                    <Show when={showPricing() && stat.totalCost > 0}>
                      <text fg={mutedColor()}>{paddedCostPrefix()}{formatCost(stat.totalCost)}</text>
                    </Show>
                  </box>
                </Show>
              </box>
            )
          }}
        </For>
      </Show>
    </box>
  )
}
