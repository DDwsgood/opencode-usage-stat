// report-formats.ts - Plain text / JSON report renderers and total-report data
// assembly shared by /usage. HTML rendering stays in total-usage-html.ts and
// session-usage-html.ts; this file only builds structured data and text/JSON
// summaries, reusing the existing queries/aggregation layer where possible.

import type { Context } from "@opencode-ai/plugin/tui/context"
import type {
  OpenCodeClient,
  SessionInfo,
  SessionMessageInfo,
  SessionMessageAssistant,
} from "@opencode-ai/client"
import {
  getUsageReport,
  getHourlyHeatmap,
  getV2Client,
} from "./queries.js"
import type {
  UsageFilters,
  CombinedReportData,
  ApiCostAnalysis,
  ApiCostModelItem,
  HtmlReportMeta,
  SessionTokenData,
  ModelBreakdownItem,
  ProviderBreakdownItem,
  DailyBreakdownItem,
  SessionBreakdownItem,
  MessageRow,
  ErrorStats,
  HourlyHeatmapItem,
} from "./formatter.js"
import { formatTokens, formatCost, formatFilters, getPresetRange, parseDaysFilter } from "./formatter.js"
import { estimateApiCost } from "./pricing.js"
import { readLogs } from "./perf-tracker.js"
import { readPersistedStats } from "./stats-store.js"

export type ReportFormat = "html" | "text" | "json"
export type ReportScopeKind = "session" | "5h" | "7d" | "30d" | "days"

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
  tps: number
  costPerRequest: number
  p50Duration: number
  p90Duration: number
  maxDuration: number
  avgDuration: number
  peakTokens: number
  peakTokensIndex: number
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
  return {}
}

/** Build the cumulative (total) report data for a date-range scope. */
export async function buildCombinedData(context: Context, filters: UsageFilters = {}): Promise<CombinedReportData> {
  const report = await getUsageReport(filters)
  const hourlyHeatmap = await getHourlyHeatmap(filters)
  const logs = readLogs(200)
  const perfSummary = readPersistedStats()

  const meta: HtmlReportMeta = {
    generatedAt: nowString(),
    dateRange: {
      start: report.daily.length > 0 ? report.daily[report.daily.length - 1].day : "—",
      end: report.daily.length > 0 ? report.daily[0].day : "—",
    },
  }

  const apiCostByModel: ApiCostModelItem[] = report.models.map(m => {
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
  const apiTotal = apiCostByModel.reduce((sum, m) => sum + (m.apiEquivCost ?? 0), 0)
  const apiCost: ApiCostAnalysis = {
    totalApiCost: apiTotal > 0 ? apiTotal : null,
    reportedCost: report.summary.totalCost,
    byModel: apiCostByModel,
  }

  return {
    ...report,
    meta,
    apiCost,
    errors: report.errors,
    hourlyHeatmap,
    perfLogs: logs,
    perfSummary,
  }
}

// ── Last-N-hours data assembly ──
// query.ts only exposes day-granularity filters, so the 5h scope needs a small
// direct read from the same V2 client. It keeps the same report contract.

interface RawAssistant {
  sessionID: string
  providerID: string
  modelID: string
  messageID: string
  created: number
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
}

async function fetchAllSessions(client: OpenCodeClient): Promise<SessionInfo[]> {
  const all: SessionInfo[] = []
  let cursor: string | undefined
  for (;;) {
    const res = await client.session.list({ limit: 500, cursor })
    const page = res?.data
    if (!Array.isArray(page) || page.length === 0) break
    all.push(...page)
    const next = res?.cursor?.next
    if (!next) break
    cursor = next
  }
  return all
}

async function fetchAllMessages(client: OpenCodeClient, sessionID: string): Promise<SessionMessageInfo[]> {
  const all: SessionMessageInfo[] = []
  let cursor: string | undefined
  for (;;) {
    const res = await client.message.list({ sessionID, limit: 1000, order: "asc", cursor })
    const page = res?.data
    if (!Array.isArray(page) || page.length === 0) break
    all.push(...page)
    const next = res?.cursor?.next
    if (!next) break
    cursor = next
  }
  return all
}

function asAssistant(m: SessionMessageInfo | undefined, sessionID: string): RawAssistant | null {
  if (!m || typeof m !== "object" || m.type !== "assistant") return null
  const a = m as SessionMessageAssistant
  const tokens = a.tokens
  if (!tokens || typeof tokens !== "object") return null
  const input = tokens.input ?? 0
  const output = tokens.output ?? 0
  const reasoning = tokens.reasoning ?? 0
  const cacheRead = tokens.cache?.read ?? 0
  const cacheWrite = tokens.cache?.write ?? 0
  const total = input + output + reasoning + cacheRead + cacheWrite
  return {
    sessionID,
    providerID: a.model?.providerID ?? "unknown",
    modelID: a.model?.id ?? "unknown",
    messageID: a.id,
    created: a.time?.created ?? 0,
    cost: a.cost ?? 0,
    tokens: { input, output, reasoning, cacheRead, cacheWrite, total },
  }
}

async function loadAssistantsSince(sinceMs: number): Promise<{ assistants: RawAssistant[]; sessionsById: Map<string, SessionInfo> }> {
  const client = getV2Client()
  if (!client) throw new Error("Usage Stat client is not initialized (setV2Client not called)")

  const sessions = await fetchAllSessions(client)
  const sessionsById = new Map(sessions.map(s => [s.id, s]))
  const assistants: RawAssistant[] = []
  const batchSize = 8
  for (let i = 0; i < sessions.length; i += batchSize) {
    const batch = sessions.slice(i, i + batchSize)
    const results = await Promise.all(batch.map(async s => {
      try {
        return await fetchAllMessages(client, s.id)
      } catch {
        return null // skip sessions we cannot read
      }
    }))
    for (let j = 0; j < batch.length; j++) {
      const msgs = results[j]
      if (!msgs) continue
      for (const m of msgs) {
        const a = asAssistant(m, batch[j].id)
        if (!a || a.created < sinceMs) continue
        assistants.push(a)
      }
    }
  }
  return { assistants, sessionsById }
}

function summarize(assistants: RawAssistant[]): SessionTokenData {
  const models = new Set<string>()
  const providers = new Set<string>()
  let totalTokens = 0
  let inputTokens = 0
  let outputTokens = 0
  let reasoningTokens = 0
  let cacheRead = 0
  let cacheWrite = 0
  let totalCost = 0
  for (const a of assistants) {
    const t = a.tokens
    totalTokens += t.total
    inputTokens += t.input
    outputTokens += t.output
    reasoningTokens += t.reasoning
    cacheRead += t.cacheRead
    cacheWrite += t.cacheWrite
    totalCost += a.cost
    models.add(a.modelID)
    providers.add(a.providerID)
  }
  const modelsArray = Array.from(models)
  return {
    model: modelsArray.length === 1 ? modelsArray[0] : "",
    provider: providers.size === 1 ? Array.from(providers)[0] : "",
    modelsUsed: modelsArray,
    totalTokens,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheRead,
    cacheWrite,
    totalCost,
    requestCount: assistants.length,
  }
}

function buildModelBreakdown(assistants: RawAssistant[]): ModelBreakdownItem[] {
  const map = new Map<string, ModelBreakdownItem>()
  const sessionSet = new Set<string>()
  for (const a of assistants) {
    const key = `${a.providerID}|${a.modelID}`
    const t = a.tokens
    let item = map.get(key)
    if (!item) {
      item = {
        provider: a.providerID,
        model: a.modelID,
        requests: 0,
        sessions: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalCost: 0,
      }
      map.set(key, item)
    }
    item.requests++
    item.totalTokens += t.total
    item.inputTokens += t.input
    item.outputTokens += t.output
    item.reasoningTokens += t.reasoning
    item.cacheRead += t.cacheRead
    item.cacheWrite += t.cacheWrite
    item.totalCost += a.cost
    sessionSet.add(`${key}|${a.sessionID}`)
  }
  for (const s of sessionSet) {
    const [provider, model] = s.split("|")
    const item = map.get(`${provider}|${model}`)
    if (item) item.sessions++
  }
  return Array.from(map.values()).sort((a, b) => b.totalTokens - a.totalTokens)
}

function buildProviderBreakdown(assistants: RawAssistant[]): ProviderBreakdownItem[] {
  const map = new Map<string, ProviderBreakdownItem>()
  const sessionSet = new Set<string>()
  for (const a of assistants) {
    const key = a.providerID
    const t = a.tokens
    let item = map.get(key)
    if (!item) {
      item = {
        provider: key,
        requests: 0,
        sessions: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheRead: 0,
        totalCost: 0,
      }
      map.set(key, item)
    }
    item.requests++
    item.totalTokens += t.total
    item.inputTokens += t.input
    item.outputTokens += t.output
    item.reasoningTokens += t.reasoning
    item.cacheRead += t.cacheRead
    item.totalCost += a.cost
    sessionSet.add(`${key}|${a.sessionID}`)
  }
  for (const s of sessionSet) {
    const [provider] = s.split("|")
    const item = map.get(provider)
    if (item) item.sessions++
  }
  return Array.from(map.values()).sort((a, b) => b.totalTokens - a.totalTokens)
}

function buildDailyBreakdown(assistants: RawAssistant[]): DailyBreakdownItem[] {
  const map = new Map<string, DailyBreakdownItem>()
  const sessionSet = new Set<string>()
  for (const a of assistants) {
    const day = toLocalDay(a.created)
    const t = a.tokens
    let item = map.get(day)
    if (!item) {
      item = {
        day,
        requests: 0,
        sessions: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheRead: 0,
        totalCost: 0,
      }
      map.set(day, item)
    }
    item.requests++
    item.totalTokens += t.total
    item.inputTokens += t.input
    item.outputTokens += t.output
    item.reasoningTokens += t.reasoning
    item.cacheRead += t.cacheRead
    item.totalCost += a.cost
    sessionSet.add(`${day}|${a.sessionID}`)
  }
  for (const s of sessionSet) {
    const [day] = s.split("|")
    const item = map.get(day)
    if (item) item.sessions++
  }
  return Array.from(map.values()).sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 90)
}

function buildSessionBreakdown(assistants: RawAssistant[], sessionsById: Map<string, SessionInfo>): SessionBreakdownItem[] {
  const map = new Map<string, SessionBreakdownItem>()
  for (const a of assistants) {
    let item = map.get(a.sessionID)
    if (!item) {
      const s = sessionsById.get(a.sessionID)
      item = {
        sessionId: a.sessionID,
        title: s?.title ?? "(untitled)",
        provider: a.providerID,
        model: a.modelID,
        requests: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheRead: 0,
        totalCost: 0,
        day: toLocalDay(a.created),
      }
      map.set(a.sessionID, item)
    }
    const t = a.tokens
    item.requests++
    item.totalTokens += t.total
    item.inputTokens += t.input
    item.outputTokens += t.output
    item.reasoningTokens += t.reasoning
    item.cacheRead += t.cacheRead
    item.totalCost += a.cost
    const day = toLocalDay(a.created)
    if (day > item.day) item.day = day
  }
  return Array.from(map.values())
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .slice(0, 15)
}

function buildErrorStats(assistants: RawAssistant[]): ErrorStats {
  let successCount = 0
  let failedCount = 0
  const byModelMap = new Map<string, { provider: string; model: string; failed: number; total: number }>()
  for (const a of assistants) {
    const key = `${a.providerID}|${a.modelID}`
    let row = byModelMap.get(key)
    if (!row) {
      row = { provider: a.providerID, model: a.modelID, failed: 0, total: 0 }
      byModelMap.set(key, row)
    }
    row.total++
    if (a.tokens.total === 0) {
      row.failed++
      failedCount++
    } else {
      successCount++
    }
  }
  const byModel = Array.from(byModelMap.values()).sort((a, b) => b.failed - a.failed)
  const errorRate = successCount + failedCount > 0 ? failedCount / (successCount + failedCount) : 0
  return { successCount, failedCount, errorRate, byModel }
}

function buildHourlyHeatmap(assistants: RawAssistant[]): HourlyHeatmapItem[] {
  const map = new Map<string, HourlyHeatmapItem>()
  for (const a of assistants) {
    const d = new Date(a.created)
    const key = `${d.getDay()}|${d.getHours()}`
    let item = map.get(key)
    if (!item) {
      item = { dow: d.getDay(), hour: d.getHours(), requests: 0, totalTokens: 0, totalCost: 0 }
      map.set(key, item)
    }
    item.requests++
    item.totalTokens += a.tokens.total
    item.totalCost += a.cost
  }
  return Array.from(map.values())
}

function buildApiCost(models: ModelBreakdownItem[], reportedCost: number): ApiCostAnalysis {
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

/** Build a CombinedReportData covering the last N hours. */
export async function buildRecentHoursReportData(context: Context, hours: number): Promise<CombinedReportData> {
  const sinceMs = Date.now() - Math.max(1, hours) * 3_600_000
  const { assistants, sessionsById } = await loadAssistantsSince(sinceMs)
  const successful = assistants.filter(a => a.tokens.total > 0)

  const summary = summarize(successful)
  const models = buildModelBreakdown(successful)
  const providers = buildProviderBreakdown(successful)
  const daily = buildDailyBreakdown(successful)
  const sessions = buildSessionBreakdown(successful, sessionsById)
  const totalSessions = new Set(successful.map(a => a.sessionID)).size
  const errors = buildErrorStats(assistants)
  const hourlyHeatmap = buildHourlyHeatmap(successful)
  const apiCost = buildApiCost(models, summary.totalCost)

  const meta: HtmlReportMeta = {
    generatedAt: nowString(),
    dateRange: {
      start: daily.length > 0 ? daily[daily.length - 1].day : toLocalDay(sinceMs),
      end: daily.length > 0 ? daily[0].day : toLocalDay(Date.now()),
    },
  }

  return {
    summary,
    models,
    providers,
    daily,
    sessions,
    totalSessions,
    errors,
    meta,
    apiCost,
    hourlyHeatmap,
    perfLogs: readLogs(200),
    perfSummary: readPersistedStats(),
    filters: { startDate: toLocalDay(sinceMs), endDate: toLocalDay(Date.now()) },
  } as CombinedReportData
}

// ── Plain text renderers ──

function kpiLine(label: string, value: string): string {
  return `  ${label}: ${value}`
}

function separator(): string {
  return "-".repeat(72)
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
  lines.push(kpiLine("Input Tokens", formatTokens(s.inputTokens)))
  lines.push(kpiLine("Output Tokens", formatTokens(s.outputTokens)))
  lines.push(kpiLine("Reasoning Tokens", formatTokens(s.reasoningTokens)))
  lines.push(kpiLine("Cache Read", formatTokens(s.cacheRead)))
  lines.push(kpiLine("Cache Write", formatTokens(s.cacheWrite)))
  lines.push(kpiLine("Reported Cost", formatCost(s.totalCost)))
  if (apiCostTotal != null) lines.push(kpiLine("API Equiv Cost", formatCost(apiCostTotal)))
  if (data.errors) {
    const e = data.errors
    lines.push(kpiLine("Error Rate", `${(e.errorRate * 100).toFixed(2)}% (${e.failedCount} failed / ${e.successCount + e.failedCount} total)`))
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
  lines.push(kpiLine("Input Tokens", formatTokens(s.inputTokens)))
  lines.push(kpiLine("Output Tokens", formatTokens(s.outputTokens)))
  lines.push(kpiLine("Reasoning Tokens", formatTokens(s.reasoningTokens)))
  lines.push(kpiLine("Cache Read", formatTokens(s.cacheRead)))
  lines.push(kpiLine("Cache Write", formatTokens(s.cacheWrite)))
  lines.push(kpiLine("Reported Cost", formatCost(s.totalCost)))
  if (data.apiCost.totalApiCost != null) lines.push(kpiLine("API Equiv Cost", formatCost(data.apiCost.totalApiCost)))
  lines.push(kpiLine("Tokens/s", data.tps > 0 ? (data.tps >= 100 ? Math.round(data.tps).toString() : data.tps.toFixed(1)) : "-"))
  lines.push(kpiLine("Cost/Request", formatCost(data.costPerRequest)))
  lines.push(kpiLine("Error Rate", `${(data.errors.errorRate * 100).toFixed(2)}% (${data.errors.failedCount} failed / ${data.errors.successCount + data.errors.failedCount} total)`))

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
