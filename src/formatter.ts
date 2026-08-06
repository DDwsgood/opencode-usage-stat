// formatter.ts - Types and formatting helpers
// Adapted from opencode-tokenwatch (MIT, (c) TTWK)

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
  meta: HtmlReportMeta
  apiCost?: ApiCostAnalysis
  errors?: ErrorStats
  hourlyHeatmap?: HourlyHeatmapItem[]
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
  if (n < 0.01) return `$${n.toFixed(6)}`
  return `$${n.toFixed(2)}`
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
