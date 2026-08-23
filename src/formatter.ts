// formatter.ts - Types, formatting helpers, and perf types.
// Merged report/type layer adapted from opencode-usage-stat (MIT) and opencode-tokenwatch (MIT, (c) TTWK).

export interface UsageFilters {
  sessionId?: string
  sessionIds?: string[]
  model?: string
  provider?: string
  startDate?: string
  endDate?: string
  limit?: number
}

export interface SessionTokenData {
  model: string
  provider: string
  modelsUsed: string[]
  totalTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheRead: number
  cacheWrite: number
  totalCost: number
  requestCount: number
}

export interface ModelBreakdownItem {
  provider: string
  model: string
  requests: number
  sessions: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheRead: number
  cacheWrite: number
  totalCost: number
}

export interface ProviderBreakdownItem {
  provider: string
  requests: number
  sessions: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheRead: number
  totalCost: number
}

export interface DailyBreakdownItem {
  day: string
  requests: number
  sessions: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheRead: number
  totalCost: number
}

export interface SessionBreakdownItem {
  sessionId: string
  title: string
  provider: string
  model: string
  requests: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheRead: number
  totalCost: number
  day: string
}

export interface ErrorStats {
  successCount: number
  failedCount: number
  errorRate: number
  byModel: Array<{ provider: string; model: string; failed: number; total: number }>
}

export interface HourlyHeatmapItem {
  dow: number
  hour: number
  requests: number
  totalTokens: number
  totalCost: number
}

export interface UsageReport {
  filters: UsageFilters
  summary: SessionTokenData
  models: ModelBreakdownItem[]
  providers: ProviderBreakdownItem[]
  daily: DailyBreakdownItem[]
  sessions: SessionBreakdownItem[]
  /** Untruncated session count matching the filters (sessions[] is capped by limit). */
  totalSessions?: number
  errors?: ErrorStats
}

export interface ApiCostModelItem {
  provider: string
  model: string
  requests: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheRead: number
  cacheWrite: number
  reportedCost: number
  apiEquivCost: number | null
  estimated: boolean
  pricingProvider: string | null
}

export interface ApiCostAnalysis {
  totalApiCost: number | null
  reportedCost: number
  byModel: ApiCostModelItem[]
}

export interface HtmlReportMeta {
  generatedAt: string
  dateRange: { start: string; end: string }
}

export interface CombinedReportData {
  summary: SessionTokenData
  models: ModelBreakdownItem[]
  providers: ProviderBreakdownItem[]
  daily: DailyBreakdownItem[]
  sessions: SessionBreakdownItem[]
  /** Untruncated session count matching the filters. */
  totalSessions?: number
  meta: HtmlReportMeta
  apiCost?: ApiCostAnalysis
  errors?: ErrorStats
  hourlyHeatmap?: HourlyHeatmapItem[]
  perfLogs?: LogEntry[]
  perfSummary?: ModelPerfStats[]
}

/** Per-message row for detailed session breakdown */
export interface MessageRow {
  messageId: string
  model: string
  provider: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  cost: number
  timeCreated: number
  timeCompleted: number | null
}

/**
 * 判定某模型的缓存数据是否属于"上游不回传"（MISSING）。
 * 判定标准：请求数 >= 2 且 cacheRead 严格为 0。
 */
export function isMissingCache(requestCount: number, totalCacheRead: number): boolean {
  return requestCount >= 2 && totalCacheRead === 0
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function formatCost(n: number): string {
  if (n === 0) return "$0.00"
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—"
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}m ${s}s`
}

/**
 * Relative time until an ISO reset timestamp ("now"/"5m"/"3h"/"2d").
 * Single shared implementation (previously duplicated with diverging behavior
 * in provider-usage.ts and provider-usage-blocks.tsx).
 */
export function formatResetDuration(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  const diff = d.getTime() - Date.now()
  if (diff <= 0) return "now"
  const mins = Math.round(diff / 60000)
  if (mins < 1) return "now"
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

/** Linear-interpolation percentile over a sorted-ascending array. */
export function percentileSorted(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  if (sortedAsc.length === 1) return sortedAsc[0]
  const idx = Math.min(Math.max(p, 0), 1) * (sortedAsc.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedAsc[lo]
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo)
}

export function cacheHitRate(input: number, cacheRead: number): number {
  if (input + cacheRead === 0) return 0
  return cacheRead / (input + cacheRead)
}

export function getPresetRange(preset: "all" | "7d" | "30d" | "month"): Pick<UsageFilters, "startDate" | "endDate"> {
  if (preset === "all") return {}

  const end = new Date()
  const start = new Date(end)

  if (preset === "7d") start.setDate(end.getDate() - 6)
  if (preset === "30d") start.setDate(end.getDate() - 29)
  if (preset === "month") start.setDate(1)

  const format = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  return { startDate: format(start), endDate: format(end) }
}

function formatDateOnly(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Parse `/total-usage [days]` raw slash input into a date-range filter.
 * Accepts an integer 1..3650; anything else falls back to the all-time range.
 */
export function parseDaysFilter(input: string | undefined): Pick<UsageFilters, "startDate" | "endDate"> {
  const days = Math.floor(Number((input ?? "").trim().split(/\s+/)[0] ?? ""))
  if (!Number.isFinite(days) || days < 1 || days > 3650) return getPresetRange("all")
  const end = new Date()
  const start = new Date(end)
  start.setDate(end.getDate() - (days - 1))
  return { startDate: formatDateOnly(start), endDate: formatDateOnly(end) }
}

export function formatFilters(filters: UsageFilters): string {
  const parts: string[] = []
  if (filters.sessionId) parts.push(`session=${filters.sessionId}`)
  if (filters.provider) parts.push(`provider=${filters.provider}`)
  if (filters.model) parts.push(`model=${filters.model}`)
  if (filters.startDate || filters.endDate) {
    parts.push(`date=${filters.startDate ?? "..."}..${filters.endDate ?? "..."}`)
  }
  return parts.length ? parts.join(" | ") : "scope=all local sessions"
}

export function formatStatusBar(data: SessionTokenData): string {
  return `Tok:${formatTokens(data.totalTokens)} Req:${data.requestCount} Cost:${formatCost(data.totalCost)}`
}

// ── New types for v2 ──

export interface SessionPerfStats {
  models: Record<string, ModelPerfStats>
  totals: {
    totalInput: number
    totalOutput: number
    totalCacheRead: number
    totalCacheWrite: number
    totalRequests: number
    totalCost: number
    /** 全局加权缓存命中率（按请求数加权平均） */
    weightedCacheHitRate: number | null
  }
}

export interface ModelPerfStats {
  model: string
  providerID: string
  requestCount: number
  ttftCount: number    // 有效 TTFT 样本数（非 null）
  tpsCount: number     // 有效 TPS 样本数（非 null）
  latencyCount: number // 有效 latency 样本数
  totalInput: number
  totalOutput: number
  totalCacheRead: number
  totalCacheWrite: number
  totalCost: number
  avgTTFT: number | null
  maxTTFT: number | null
  minTTFT: number | null
  p50TTFT: number | null   // TTFT 中位数
  p95TTFT: number | null   // TTFT P95
  p99TTFT: number | null   // TTFT P99
  avgTPS: number | null
  maxTPS: number | null
  minTPS: number | null
  avgLatency: number | null
  maxLatency: number | null
  minLatency: number | null
  p50Latency: number | null  // 端到端延迟 P50
  p95Latency: number | null  // 端到端延迟 P95
  p99Latency: number | null  // 端到端延迟 P99
  /** 该模型加权缓存命中率：cacheRead / (cacheRead + input) */
  cacheHitRate: number | null
}

export interface TokenDistribution {
  system: number
  user: number
  agent: number
  toolCall: number
  toolResult: number
  output: number
  total: number
}

export interface LogEntry {
  ts: string
  model: string
  providerID: string
  modelID: string
  sessionID: string
  ttft_ms: number | null
  /** TTFT start clock; absent entries used the obsolete assistant-created clock. */
  ttft_source?: "inbox-enqueued"
  tps: number | null
  /** TPS uses visible + reasoning tokens over the first-to-last output window. */
  tps_source?: "all-output-window"
  latency_ms: number | null
  /** Latency uses prompt enqueue to the final reasoning/text output event. */
  latency_source?: "inbox-to-last-output"
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
}
