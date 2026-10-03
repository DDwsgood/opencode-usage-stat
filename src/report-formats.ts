// report-formats.ts - Plain text / JSON report renderers and total-report data
// assembly shared by /usage. HTML rendering stays in total-usage-html.ts and
// session-usage-html.ts; this file only builds structured data and text/JSON
// summaries, reusing the existing queries/aggregation layer where possible.

import type { Context } from "@opencode-ai/plugin/tui/context"
import { getPeriodReport } from "./queries.js"
import type { PeriodReport, ProgressFn } from "./queries.js"
import type {
  UsageFilters,
  CombinedReportData,
  ApiCostAnalysis,
  ApiCostModelItem,
  HtmlReportMeta,
  SessionTokenData,
  ModelBreakdownItem,
  MessageRow,
  ErrorStats,
  OverheadStats,
  AgentBreakdownItem,
  SessionBreakdownItem,
  ReportSourceMeta,
} from "./formatter.js"
import { formatTokens, formatCost, formatFilters, getPresetRange, parseDaysFilter, totalInputTokens } from "./formatter.js"
import { estimateApiCost } from "./pricing.js"
import { readLogs } from "./perf-tracker.js"
import { readPersistedStats } from "./stats-store.js"

export type ReportFormat = "html" | "text" | "json"
export type ReportScopeKind = "session" | "5h" | "7d" | "30d" | "all" | "days"

export interface ReportScope {
  kind: ReportScopeKind
  label: string
  days?: number
}

export interface SessionReportView {
  sessionId: string
  sessionTitle: string
  subagentCount: number
  summary: SessionTokenData
  models: ModelBreakdownItem[]
  messages: MessageRow[]
  apiCost: ApiCostAnalysis
  errors: ErrorStats
  generatedAt: string
  sessionDurationMs: number
  firstMessageTime: number | null
  lastMessageTime: number | null
  /** Generation speed: Σ(output+reasoning) / Σ(completed−created) over completed requests. */
  tps: number
  costPerRequest: number
  p50Duration: number
  p90Duration: number
  maxDuration: number
  avgDuration: number
  peakTokens: number
  peakTokensIndex: number
  overhead?: OverheadStats
  agents?: AgentBreakdownItem[]
  childSessions?: SessionBreakdownItem[]
  source?: ReportSourceMeta
}

function nowString(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function toLocalDay(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Returns the date-range filter for non-session scopes. */
export function getDateRangeForScope(scope: ReportScope): UsageFilters {
  if (scope.kind === "7d") return getPresetRange("7d")
  if (scope.kind === "30d") return getPresetRange("30d")
  if (scope.kind === "days" && scope.days) return parseDaysFilter(String(scope.days))
  // "all" and any unknown scope: no date filter, full history.
  return {}
}

export function buildApiCost(models: ModelBreakdownItem[], reportedCost: number): ApiCostAnalysis {
  const byModel: ApiCostModelItem[] = models.map(m => {
    const est = estimateApiCost(
      m.provider, m.model, m.requests,
      m.inputTokens, m.outputTokens, m.reasoningTokens,
      m.cacheRead, m.cacheWrite,
    )
    return {
      provider: m.provider,
      model: m.model,
      requests: m.requests,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      reasoningTokens: m.reasoningTokens,
      cacheRead: m.cacheRead,
      cacheWrite: m.cacheWrite,
      reportedCost: m.totalCost,
      apiEquivCost: est.cost,
      estimated: est.estimated,
      pricingProvider: est.pricingProvider,
    }
  })
  const totalApiCost = byModel.reduce((sum, m) => sum + (m.apiEquivCost ?? 0), 0)
  return {
    totalApiCost: totalApiCost > 0 ? totalApiCost : null,
    reportedCost,
    byModel,
  }
}

function toCombined(report: PeriodReport, fallbackRange: { start: string; end: string }): CombinedReportData {
  const meta: HtmlReportMeta = {
    generatedAt: nowString(),
    dateRange: {
      start: report.daily.length > 0 ? report.daily[report.daily.length - 1].day : fallbackRange.start,
      end: report.daily.length > 0 ? report.daily[0].day : fallbackRange.end,
    },
    source: report.source,
  }
  const { source: _source, ...rest } = report
  return {
    ...rest,
    meta,
    apiCost: buildApiCost(report.models, report.summary.totalCost),
    perfLogs: readLogs(200),
    perfSummary: readPersistedStats(),
  }
}

/** Build the cumulative (total) report data for a date-range scope. */
export async function buildCombinedData(context: Context, filters: UsageFilters = {}, onProgress?: ProgressFn): Promise<CombinedReportData> {
  void context
  const report = await getPeriodReport(filters, undefined, onProgress)
  return toCombined(report, { start: "—", end: "—" })
}

/** Build a CombinedReportData covering the last N hours. */
export async function buildRecentHoursReportData(context: Context, hours: number, onProgress?: ProgressFn): Promise<CombinedReportData> {
  void context
  const now = Date.now()
  const sinceMs = now - Math.max(1, hours) * 3_600_000
  const filters: UsageFilters = { startDate: toLocalDay(sinceMs), endDate: toLocalDay(now) }
  const report = await getPeriodReport(filters, { sinceMs }, onProgress)
  return toCombined(report, { start: toLocalDay(sinceMs), end: toLocalDay(now) })
}

// ── Plain text renderers ──

function kpiLine(label: string, value: string): string {
  return `  ${label}: ${value}`
}

function separator(): string {
  return "-".repeat(72)
}

function errorLines(e: ErrorStats): string[] {
  const lines = [
    kpiLine("Error Rate", `${(e.errorRate * 100).toFixed(2)}% (${e.failedCount} failed / ${e.successCount + e.failedCount} total)`),
    kpiLine("Aborted", `${e.abortedCount ?? 0} (user interrupts, excluded from error rate)`),
  ]
  const types = (e.byType ?? []).filter(t => t.type !== "aborted")
  if (types.length > 0) lines.push(kpiLine("Error Types", types.map(t => `${t.type}=${t.count}`).join(", ")))
  return lines
}

function overheadLines(o: OverheadStats): string[] {
  if (o.sessions === 0) return [kpiLine("Overhead (title/compaction, est.)", "none")]
  return [kpiLine("Overhead (title/compaction, est.)", `${formatTokens(o.totalTokens)} tokens, ${formatCost(o.cost)} across ${o.sessions} sessions`)]
}

/** Plain-text summary for cumulative/date-range reports. */
export function renderPeriodTextReport(data: CombinedReportData): string {
  const s = data.summary
  const apiCostTotal = data.apiCost?.totalApiCost ?? null
  const filters = (data as CombinedReportData & { filters?: UsageFilters }).filters ?? {}
  const lines: string[] = []
  lines.push("Usage Stat - Cumulative Report")
  lines.push(`Generated: ${data.meta.generatedAt}`)
  lines.push(`Scope: ${formatFilters(filters)}`)
  if (data.meta.dateRange.start !== "—" && data.meta.dateRange.end !== "—") {
    lines.push(`Date range: ${data.meta.dateRange.start} .. ${data.meta.dateRange.end}`)
  }
  lines.push(separator())
  lines.push("KPI")
  lines.push(kpiLine("Total Tokens", formatTokens(s.totalTokens)))
  lines.push(kpiLine("Requests", String(s.requestCount)))
  lines.push(kpiLine("Sessions", String(data.totalSessions ?? s.modelsUsed.length)))
  // INPUT is displayed as raw uncached input + cacheWrite; cache read stays its own line.
  // JSON/data fields and the total below keep the original raw values.
  lines.push(kpiLine("Input Tokens", formatTokens(totalInputTokens(s.inputTokens, s.cacheWrite))))
  lines.push(kpiLine("Output Tokens", formatTokens(s.outputTokens)))
  lines.push(kpiLine("Reasoning Tokens", formatTokens(s.reasoningTokens)))
  lines.push(kpiLine("Cache Read", formatTokens(s.cacheRead)))
  lines.push(kpiLine("Cache Write", formatTokens(s.cacheWrite)))
  lines.push(kpiLine("Reported Cost", formatCost(s.totalCost)))
  if (apiCostTotal != null) lines.push(kpiLine("API Equiv Cost", formatCost(apiCostTotal)))
  if (data.meta.source) lines.push(kpiLine("Data Source", `${data.meta.source.source} (${data.meta.source.elapsedMs} ms)`))
  if (data.errors) lines.push(...errorLines(data.errors))
  if (data.overhead) lines.push(...overheadLines(data.overhead))
  const prev = data.comparison?.previous
  if (prev && data.comparison?.previousRange) {
    const r = data.comparison.previousRange
    lines.push(kpiLine("Previous Period", `${r.start} .. ${r.end}: ${formatTokens(prev.totalTokens)} tokens, ${prev.requestCount} req, ${formatCost(prev.totalCost)}`))
  }

  lines.push("")
  lines.push("Models")
  if (data.models.length === 0) {
    lines.push("  (no usage in this period)")
  } else {
    lines.push("  Provider                Model                            Req  Sessions  Tokens      Cost")
    for (const m of data.models) {
      const provider = m.provider.padEnd(24).slice(0, 24)
      const model = m.model.padEnd(29).slice(0, 29)
      lines.push(`  ${provider}  ${model}  ${String(m.requests).padStart(4)}  ${String(m.sessions).padStart(8)}  ${formatTokens(m.totalTokens).padStart(10)}  ${formatCost(m.totalCost).padStart(10)}`)
    }
  }

  lines.push("")
  lines.push("Providers")
  if (data.providers.length === 0) {
    lines.push("  (no usage in this period)")
  } else {
    lines.push("  Provider                Req  Sessions  Tokens      Cost")
    for (const p of data.providers) {
      const provider = p.provider.padEnd(24).slice(0, 24)
      lines.push(`  ${provider}  ${String(p.requests).padStart(4)}  ${String(p.sessions).padStart(8)}  ${formatTokens(p.totalTokens).padStart(10)}  ${formatCost(p.totalCost).padStart(10)}`)
    }
  }

  if (data.daily.length > 0) {
    lines.push("")
    lines.push("Daily")
    lines.push("  Date         Req  Sessions  Tokens      Cost")
    for (const d of data.daily) {
      lines.push(`  ${d.day.padEnd(10)}  ${String(d.requests).padStart(4)}  ${String(d.sessions).padStart(8)}  ${formatTokens(d.totalTokens).padStart(10)}  ${formatCost(d.totalCost).padStart(10)}`)
    }
  }

  lines.push("")
  lines.push(`Report file generated locally by opencode-usage-stat`)
  return lines.join("\n")
}

/** Plain-text summary for the current-session report. */
export function renderSessionTextReport(data: SessionReportView): string {
  const s = data.summary
  const lines: string[] = []
  lines.push(`Usage Stat - Session Report`)
  lines.push(`Session: ${data.sessionTitle}`)
  lines.push(`Session ID: ${data.sessionId}`)
  lines.push(`Subagents: ${data.subagentCount}`)
  lines.push(`Generated: ${data.generatedAt}`)
  lines.push(separator())
  lines.push("KPI")
  lines.push(kpiLine("Total Tokens", formatTokens(s.totalTokens)))
  lines.push(kpiLine("Requests", String(s.requestCount)))
  // INPUT display = raw uncached input + cacheWrite; Cache Read/Cache Write stay separate lines.
  lines.push(kpiLine("Input Tokens", formatTokens(totalInputTokens(s.inputTokens, s.cacheWrite))))
  lines.push(kpiLine("Output Tokens", formatTokens(s.outputTokens)))
  lines.push(kpiLine("Reasoning Tokens", formatTokens(s.reasoningTokens)))
  lines.push(kpiLine("Cache Read", formatTokens(s.cacheRead)))
  lines.push(kpiLine("Cache Write", formatTokens(s.cacheWrite)))
  lines.push(kpiLine("Reported Cost", formatCost(s.totalCost)))
  if (data.apiCost.totalApiCost != null) lines.push(kpiLine("API Equiv Cost", formatCost(data.apiCost.totalApiCost)))
  lines.push(kpiLine("Gen Tokens/s", data.tps > 0 ? (data.tps >= 100 ? Math.round(data.tps).toString() : data.tps.toFixed(1)) : "-"))
  lines.push(kpiLine("Cost/Request", formatCost(data.costPerRequest)))
  if (data.source) lines.push(kpiLine("Data Source", `${data.source.source} (${data.source.elapsedMs} ms)`))
  lines.push(...errorLines(data.errors))
  if (data.overhead) lines.push(...overheadLines(data.overhead))

  lines.push("")
  lines.push("Models")
  if (data.models.length === 0) {
    lines.push("  (no usage in this session)")
  } else {
    lines.push("  Provider                Model                            Req  Sessions  Tokens      Cost")
    for (const m of data.models) {
      const provider = m.provider.padEnd(24).slice(0, 24)
      const model = m.model.padEnd(29).slice(0, 29)
      lines.push(`  ${provider}  ${model}  ${String(m.requests).padStart(4)}  ${String(m.sessions).padStart(8)}  ${formatTokens(m.totalTokens).padStart(10)}  ${formatCost(m.totalCost).padStart(10)}`)
    }
  }

  lines.push("")
  lines.push(`Report file generated locally by opencode-usage-stat`)
  return lines.join("\n")
}

// ── JSON reporters ──

export function toPeriodJsonReport(data: CombinedReportData): CombinedReportData {
  return data
}

export function toSessionJsonReport(data: SessionReportView): SessionReportView {
  return data
}
