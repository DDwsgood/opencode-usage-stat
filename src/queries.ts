// queries.ts - V2 data aggregation layer.
//
// Data comes from one of two sources, both projected to the same small rows
// (UsageRow / SessionRow in sqlite-source.ts):
//   1. Read-only SQLite over the local opencode.db (fast path, json_extract of
//      the few fields reports need).
//   2. The V2 client (`context.client`) when SQLite is unavailable:
//      - client.session.list({ limit, cursor, parentID }) -> { data, cursor }
//      - client.message.list({ sessionID, limit, order, cursor }) -> { data, cursor }
//      Message bodies are dropped right after projection.
// All aggregates below are pure functions over those rows.
// Adapted from opencode-usage-stat (MIT) and opencode-tokenwatch (MIT, (c) TTWK).

import type { OpenCodeClient, SessionInfo, SessionMessageInfo, SessionMessageAssistant } from "@opencode-ai/client"
import type {
  AgentBreakdownItem,
  CacheSavings,
  DailyBreakdownItem,
  ErrorStats,
  HourlyHeatmapItem,
  MessageRow,
  ModelBreakdownItem,
  ModelLatencyItem,
  OverheadStats,
  PeriodComparison,
  PeriodSnapshot,
  ProjectBreakdownItem,
  ProviderBreakdownItem,
  ReportSourceMeta,
  SessionBreakdownItem,
  SessionKindSplit,
  SessionKindTotals,
  SessionReportInput,
  SessionTokenData,
  UsageFilters,
  UsageReport,
} from "./formatter.js"
import { cacheHitRate, percentileSorted } from "./formatter.js"
import { lookupPricing } from "./pricing.js"
import { openUsageSqliteSource } from "./sqlite-source.js"
import type { LoadRange, SessionRow, UsageRow } from "./sqlite-source.js"

export type { UsageRow, SessionRow } from "./sqlite-source.js"

let client: OpenCodeClient | null = null

/** Bind the TUI plugin's V2 client. Must be called before any query. */
export function setV2Client(c: OpenCodeClient): void {
  client = c
  clearQueryCache()
}

export function getV2Client(): OpenCodeClient | null {
  return client
}

function requireClient(): OpenCodeClient {
  if (!client) throw new Error("Usage Stat client is not initialized (setV2Client not called)")
  return client
}

export type ProgressFn = (done: number, total: number) => void

export interface Dataset {
  sessions: Map<string, SessionRow>
  rows: UsageRow[]
  source: ReportSourceMeta
  /** Sessions whose messages could not be read (API path); excluded from overhead. */
  failedSessions: Set<string>
}

export interface LoadOptions extends LoadRange {
  onProgress?: ProgressFn
}

// ── Caches ──
// A report used to trigger several identical loads; datasets are shared for a
// short TTL. The API path additionally keeps per-session projections keyed by
// the session's update stamp, so unchanged sessions are never re-downloaded.
const DATASET_TTL_MS = 30_000
// SQLite loads are cheap; a short TTL only dedupes concurrent callers and keeps reports fresh.
const SQLITE_DATASET_TTL_MS = 2_000
const SESSION_LIST_TTL_MS = 30_000
const API_CONCURRENCY = 16

const datasetCache = new Map<string, { at: number; ttl: number; promise: Promise<Dataset> }>()
let sessionListCache: { at: number; promise: Promise<SessionInfo[]> } | null = null
const apiRowCache = new Map<string, { stamp: string; rows: UsageRow[] }>()

/** Invalidate cached data (called when the client is rebound or data changes materially). */
export function clearQueryCache(): void {
  datasetCache.clear()
  sessionListCache = null
  apiRowCache.clear()
}

function datasetKey(opts: LoadRange): string {
  return JSON.stringify([opts.sinceMs ?? null, opts.untilMs ?? null, opts.sessionIds ? [...opts.sessionIds].sort() : null])
}

/** Load projected rows for the range, SQLite first, API as fallback. */
export function loadDataset(opts: LoadOptions = {}): Promise<Dataset> {
  const key = datasetKey(opts)
  const now = Date.now()
  // Sliding windows (5h) produce a new key per call; drop expired entries.
  for (const [k, v] of datasetCache) if (now - v.at > v.ttl) datasetCache.delete(k)
  const hit = datasetCache.get(key)
  if (hit) return hit.promise
  const promise = loadDatasetUncached(opts)
  const entry = { at: now, ttl: DATASET_TTL_MS, promise }
  datasetCache.set(key, entry)
  promise.then(
    ds => {
      if (ds.source.source === "sqlite") {
        entry.at = Date.now()
        entry.ttl = SQLITE_DATASET_TTL_MS
      }
    },
    () => {
      if (datasetCache.get(key)?.promise === promise) datasetCache.delete(key)
    },
  )
  return promise
}

async function loadDatasetUncached(opts: LoadOptions): Promise<Dataset> {
  const t0 = Date.now()
  const viaSqlite = await loadViaSqlite(opts)
  if (viaSqlite) {
    return { ...viaSqlite, failedSessions: new Set(), source: { source: "sqlite", elapsedMs: Date.now() - t0 } }
  }
  const viaApi = await loadViaApi(opts)
  return { ...viaApi, source: { source: "api", elapsedMs: Date.now() - t0 } }
}

async function loadViaSqlite(opts: LoadRange): Promise<{ sessions: Map<string, SessionRow>; rows: UsageRow[] } | null> {
  let src: ReturnType<typeof openUsageSqliteSource> = null
  try {
    src = openUsageSqliteSource()
    if (!src) return null
    // A TUI attached to a remote server would read a stale/unrelated local DB.
    if (!(await sqliteMatchesClient(src, opts))) return null
    const { sessions, rows } = await src.load(opts)
    return { sessions: new Map(sessions.map(s => [s.id, s])), rows }
  } catch {
    return null
  } finally {
    src?.close()
  }
}

async function sqliteMatchesClient(src: NonNullable<ReturnType<typeof openUsageSqliteSource>>, opts: LoadRange): Promise<boolean> {
  if (opts.sessionIds) return src.hasSessions(opts.sessionIds)
  if (!client) return true
  try {
    const res = await client.session.list({ limit: 10 })
    const ids = Array.isArray(res?.data) ? res.data.map(s => s.id) : []
    return src.hasSessions(ids)
  } catch {
    return true
  }
}

function sessionInfoToRow(s: SessionInfo): SessionRow {
  const t = s.tokens
  return {
    id: s.id,
    projectID: s.projectID ?? "",
    parentID: s.parentID ?? null,
    directory: s.location?.directory ?? "",
    title: s.title || "(untitled)",
    timeCreated: s.time?.created ?? 0,
    timeUpdated: s.time?.updated ?? 0,
    cost: s.cost ?? 0,
    input: t?.input ?? 0,
    output: t?.output ?? 0,
    reasoning: t?.reasoning ?? 0,
    cacheRead: t?.cache?.read ?? 0,
    cacheWrite: t?.cache?.write ?? 0,
  }
}

function listAllSessions(): Promise<SessionInfo[]> {
  if (sessionListCache && Date.now() - sessionListCache.at <= SESSION_LIST_TTL_MS) return sessionListCache.promise
  const promise = (async () => {
    const c = requireClient()
    const all: SessionInfo[] = []
    let cursor: string | undefined
    for (;;) {
      const res = await c.session.list({ limit: 500, cursor })
      const page = res?.data
      if (!Array.isArray(page) || page.length === 0) break
      all.push(...page)
      const next = res?.cursor?.next
      if (!next) break
      cursor = next
    }
    return all
  })()
  sessionListCache = { at: Date.now(), promise }
  promise.catch(() => { if (sessionListCache?.promise === promise) sessionListCache = null })
  return promise
}

async function listChildren(parentID: string): Promise<SessionInfo[]> {
  const c = requireClient()
  const all: SessionInfo[] = []
  let cursor: string | undefined
  for (;;) {
    const res = await c.session.list({ parentID, limit: 500, cursor })
    const page = res?.data
    if (!Array.isArray(page) || page.length === 0) break
    // Guard against servers that ignore the parentID filter.
    all.push(...page.filter(s => s.parentID === parentID))
    const next = res?.cursor?.next
    if (!next) break
    cursor = next
  }
  return all
}

/** Session + descendants through the API, without listing every session. */
async function apiFamily(rootID: string): Promise<SessionInfo[]> {
  const c = requireClient()
  const out: SessionInfo[] = []
  try {
    const root = await c.session.get({ sessionID: rootID })
    if (root) out.push(root)
  } catch { /* the root may be unreadable; children can still be listed */ }
  const seen = new Set<string>([rootID])
  let frontier = [rootID]
  while (frontier.length > 0) {
    const next: string[] = []
    const results = await Promise.all(frontier.map(id => listChildren(id).catch(() => [] as SessionInfo[])))
    for (const children of results) {
      for (const s of children) {
        if (seen.has(s.id)) continue
        seen.add(s.id)
        out.push(s)
        next.push(s.id)
      }
    }
    frontier = next
  }
  return out
}

async function fetchMessageRows(sessionID: string): Promise<UsageRow[]> {
  const c = requireClient()
  const rows: UsageRow[] = []
  let cursor: string | undefined
  for (;;) {
    // The server caps `limit` at 200 per page. The message cursor encodes its
    // own order; combining cursor with order is rejected by the server.
    const res = await c.message.list({ sessionID, limit: 200, order: cursor ? undefined : "asc", cursor })
    const page = res?.data
    if (!Array.isArray(page) || page.length === 0) break
    for (const m of page) {
      const row = projectAssistant(m, sessionID)
      if (row) rows.push(row)
    }
    const next = res?.cursor?.next
    if (!next) break
    cursor = next
  }
  return rows
}

/** Project a V2 assistant message to the report row (exported for tests). */
export function projectAssistant(m: SessionMessageInfo | undefined, sessionID: string): UsageRow | null {
  if (!m || typeof m !== "object" || m.type !== "assistant") return null
  const a = m as SessionMessageAssistant
  const tokens = a.tokens
  const input = tokens?.input ?? 0
  const output = tokens?.output ?? 0
  const reasoning = tokens?.reasoning ?? 0
  const cacheRead = tokens?.cache?.read ?? 0
  const cacheWrite = tokens?.cache?.write ?? 0
  return {
    sessionID,
    messageID: a.id,
    providerID: a.model?.providerID || "unknown",
    modelID: a.model?.id || "unknown",
    agent: a.agent || "unknown",
    created: a.time?.created ?? 0,
    completed: a.time?.completed ?? null,
    cost: a.cost ?? 0,
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total: input + output + reasoning + cacheRead + cacheWrite,
    finish: a.finish ?? null,
    errorType: a.error?.type ?? null,
  }
}

function sessionStamp(s: SessionInfo): string {
  return `${s.time?.updated ?? 0}|${s.cost ?? 0}|${s.tokens?.output ?? 0}`
}

async function loadViaApi(opts: LoadOptions): Promise<Omit<Dataset, "source">> {
  const infos = opts.sessionIds
    ? (await Promise.all(opts.sessionIds.map(id => requireClient().session.get({ sessionID: id }).catch(() => null))))
        .filter((s): s is SessionInfo => !!s)
    : await listAllSessions()
  const sessions = new Map(infos.map(s => [s.id, sessionInfoToRow(s)]))
  // A session last updated before the window cannot contain messages inside it.
  const targets = opts.sinceMs != null ? infos.filter(s => (s.time?.updated ?? Infinity) >= opts.sinceMs!) : infos

  const rows: UsageRow[] = []
  const failedSessions = new Set<string>()
  let done = 0
  let index = 0
  const worker = async () => {
    while (index < targets.length) {
      const s = targets[index++]
      const stamp = sessionStamp(s)
      let projected = apiRowCache.get(s.id)?.stamp === stamp ? apiRowCache.get(s.id)!.rows : null
      if (!projected) {
        try {
          projected = await fetchMessageRows(s.id)
          apiRowCache.set(s.id, { stamp, rows: projected })
        } catch (err) {
          // A silent drop here turns pagination failures into all-zero reports.
          console.warn(`[opencode-usage-stat] failed to read messages for ${s.id}:`, err)
          failedSessions.add(s.id)
        }
      }
      if (projected) {
        for (const r of projected) {
          if (opts.sinceMs != null && r.created < opts.sinceMs) continue
          if (opts.untilMs != null && r.created >= opts.untilMs) continue
          rows.push(r)
        }
      }
      done++
      opts.onProgress?.(done, targets.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(API_CONCURRENCY, targets.length) }, worker))
  return { sessions, rows, failedSessions }
}

// ── Filters / ranges ──

function isValidDate(s: string | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function toLocalDay(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function localMidnight(day: string): number {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(y, m - 1, d).getTime()
}

function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number)
  return toLocalDay(new Date(y, m - 1, d + delta).getTime())
}

/** Convert day-granularity filters to a [since, until) millisecond window in local time. */
export function filtersToRange(filters: UsageFilters): LoadRange {
  const range: LoadRange = {}
  if (isValidDate(filters.startDate)) range.sinceMs = localMidnight(filters.startDate)
  if (isValidDate(filters.endDate)) range.untilMs = localMidnight(addDays(filters.endDate, 1))
  const ids = filters.sessionIds && filters.sessionIds.length > 0
    ? filters.sessionIds
    : filters.sessionId ? [filters.sessionId] : undefined
  if (ids) range.sessionIds = ids
  return range
}

function matchesRow(r: UsageRow, filters: UsageFilters, range: LoadRange): boolean {
  if (range.sessionIds && !range.sessionIds.includes(r.sessionID)) return false
  if (filters.provider && r.providerID !== filters.provider) return false
  if (filters.model && r.modelID !== filters.model) return false
  if (range.sinceMs != null && r.created < range.sinceMs) return false
  if (range.untilMs != null && r.created >= range.untilMs) return false
  return true
}

/** Rows counted as usage (token-bearing). */
function usageRows(rows: UsageRow[]): UsageRow[] {
  return rows.filter(r => r.total > 0)
}

// ── Pure aggregates ──

export function summarizeRows(rows: UsageRow[]): SessionTokenData {
  const models = new Set<string>()
  const providers = new Set<string>()
  const out = { totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheRead: 0, cacheWrite: 0, totalCost: 0 }
  for (const r of rows) {
    out.totalTokens += r.total
    out.inputTokens += r.input
    out.outputTokens += r.output
    out.reasoningTokens += r.reasoning
    out.cacheRead += r.cacheRead
    out.cacheWrite += r.cacheWrite
    out.totalCost += r.cost
    models.add(r.modelID)
    providers.add(r.providerID)
  }
  const modelsArray = Array.from(models)
  return {
    model: modelsArray.length === 1 ? modelsArray[0] : "",
    provider: providers.size === 1 ? Array.from(providers)[0] : "",
    modelsUsed: modelsArray,
    ...out,
    requestCount: rows.length,
  }
}

export function modelBreakdownRows(rows: UsageRow[]): ModelBreakdownItem[] {
  const map = new Map<string, ModelBreakdownItem & { ids: Set<string> }>()
  for (const r of rows) {
    const key = `${r.providerID}|${r.modelID}`
    let item = map.get(key)
    if (!item) {
      item = {
        provider: r.providerID, model: r.modelID, requests: 0, sessions: 0, totalTokens: 0, inputTokens: 0,
        outputTokens: 0, reasoningTokens: 0, cacheRead: 0, cacheWrite: 0, totalCost: 0, ids: new Set(),
      }
      map.set(key, item)
    }
    item.requests++
    item.totalTokens += r.total
    item.inputTokens += r.input
    item.outputTokens += r.output
    item.reasoningTokens += r.reasoning
    item.cacheRead += r.cacheRead
    item.cacheWrite += r.cacheWrite
    item.totalCost += r.cost
    item.ids.add(r.sessionID)
  }
  return Array.from(map.values())
    .map(({ ids, ...item }) => ({ ...item, sessions: ids.size }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
}

export function providerBreakdownRows(rows: UsageRow[]): ProviderBreakdownItem[] {
  const map = new Map<string, ProviderBreakdownItem & { ids: Set<string> }>()
  for (const r of rows) {
    let item = map.get(r.providerID)
    if (!item) {
      item = {
        provider: r.providerID, requests: 0, sessions: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0,
        reasoningTokens: 0, cacheRead: 0, totalCost: 0, ids: new Set(),
      }
      map.set(r.providerID, item)
    }
    item.requests++
    item.totalTokens += r.total
    item.inputTokens += r.input
    item.outputTokens += r.output
    item.reasoningTokens += r.reasoning
    item.cacheRead += r.cacheRead
    item.totalCost += r.cost
    item.ids.add(r.sessionID)
  }
  return Array.from(map.values())
    .map(({ ids, ...item }) => ({ ...item, sessions: ids.size }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
}

export function dailyBreakdownRows(rows: UsageRow[], limit = 90): DailyBreakdownItem[] {
  const map = new Map<string, DailyBreakdownItem & { ids: Set<string> }>()
  for (const r of rows) {
    const day = toLocalDay(r.created)
    let item = map.get(day)
    if (!item) {
      item = {
        day, requests: 0, sessions: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0,
        reasoningTokens: 0, cacheRead: 0, totalCost: 0, ids: new Set(),
      }
      map.set(day, item)
    }
    item.requests++
    item.totalTokens += r.total
    item.inputTokens += r.input
    item.outputTokens += r.output
    item.reasoningTokens += r.reasoning
    item.cacheRead += r.cacheRead
    item.totalCost += r.cost
    item.ids.add(r.sessionID)
  }
  return Array.from(map.values())
    .map(({ ids, ...item }) => ({ ...item, sessions: ids.size }))
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .slice(0, Math.max(1, limit))
}

export function sessionBreakdownRows(rows: UsageRow[], sessions: Map<string, SessionRow>, limit = 15): SessionBreakdownItem[] {
  const map = new Map<string, SessionBreakdownItem>()
  for (const r of rows) {
    let item = map.get(r.sessionID)
    const day = toLocalDay(r.created)
    if (!item) {
      item = {
        sessionId: r.sessionID,
        title: sessions.get(r.sessionID)?.title ?? "(untitled)",
        provider: r.providerID,
        model: r.modelID,
        requests: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheRead: 0, totalCost: 0,
        day,
      }
      map.set(r.sessionID, item)
    }
    item.requests++
    item.totalTokens += r.total
    item.inputTokens += r.input
    item.outputTokens += r.output
    item.reasoningTokens += r.reasoning
    item.cacheRead += r.cacheRead
    item.totalCost += r.cost
    if (day > item.day) item.day = day
  }
  return Array.from(map.values())
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .slice(0, Math.max(1, limit))
}

export type RequestOutcome = "success" | "failed" | "aborted" | "pending"

/** Outcome classification shared by every report (see ErrorStats). */
export function classifyRow(r: Pick<UsageRow, "finish" | "errorType" | "completed">): RequestOutcome {
  if (r.errorType === "aborted") return "aborted"
  if (r.finish === "error") return "failed"
  if (r.finish == null && r.completed == null) return "pending"
  return "success"
}

export function errorStatsRows(rows: UsageRow[]): ErrorStats {
  let successCount = 0
  let failedCount = 0
  let abortedCount = 0
  const byModel = new Map<string, { provider: string; model: string; failed: number; aborted: number; total: number }>()
  const byType = new Map<string, number>()
  const finishes = new Map<string, number>()
  for (const r of rows) {
    const outcome = classifyRow(r)
    if (outcome === "pending") continue
    const key = `${r.providerID}|${r.modelID}`
    let m = byModel.get(key)
    if (!m) {
      m = { provider: r.providerID, model: r.modelID, failed: 0, aborted: 0, total: 0 }
      byModel.set(key, m)
    }
    m.total++
    const reason = r.finish ?? "none"
    finishes.set(reason, (finishes.get(reason) ?? 0) + 1)
    if (outcome === "success") {
      successCount++
      continue
    }
    if (outcome === "aborted") {
      abortedCount++
      m.aborted++
    } else {
      failedCount++
      m.failed++
    }
    const type = r.errorType ?? "unknown"
    byType.set(type, (byType.get(type) ?? 0) + 1)
  }
  const denom = successCount + failedCount
  return {
    successCount,
    failedCount,
    abortedCount,
    errorRate: denom > 0 ? failedCount / denom : 0,
    byModel: Array.from(byModel.values()).sort((a, b) => b.failed - a.failed || b.aborted - a.aborted || b.total - a.total),
    byType: Array.from(byType, ([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    finishReasons: Array.from(finishes, ([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  }
}

export function heatmapRows(rows: UsageRow[]): HourlyHeatmapItem[] {
  const map = new Map<string, HourlyHeatmapItem>()
  for (const r of rows) {
    const d = new Date(r.created)
    const dow = d.getDay()
    const hour = d.getHours()
    const key = `${dow}|${hour}`
    let item = map.get(key)
    if (!item) {
      item = { dow, hour, requests: 0, totalTokens: 0, totalCost: 0 }
      map.set(key, item)
    }
    item.requests++
    item.totalTokens += r.total
    item.totalCost += r.cost
  }
  return Array.from(map.values())
}

const COST_EPSILON = 1e-9

/**
 * Overhead for sessions whose whole lifetime lies inside the window (so each
 * session is counted once across adjacent periods): session totals minus the
 * Σ of that session's assistant rows, floored at 0 per field.
 */
export function overheadStatsRows(
  rows: UsageRow[],
  sessions: Map<string, SessionRow>,
  range: LoadRange = {},
  exclude: Set<string> = new Set(),
): OverheadStats {
  const sums = new Map<string, { cost: number; input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }>()
  for (const r of rows) {
    let s = sums.get(r.sessionID)
    if (!s) {
      s = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
      sums.set(r.sessionID, s)
    }
    s.cost += r.cost
    s.input += r.input
    s.output += r.output
    s.reasoning += r.reasoning
    s.cacheRead += r.cacheRead
    s.cacheWrite += r.cacheWrite
  }
  const out: OverheadStats = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0, sessions: 0 }
  const ids = range.sessionIds ?? Array.from(sessions.keys())
  for (const id of ids) {
    const s = sessions.get(id)
    if (!s || exclude.has(id)) continue
    if (range.sinceMs != null && s.timeCreated < range.sinceMs) continue
    if (range.untilMs != null && s.timeUpdated >= range.untilMs) continue
    const a = sums.get(id) ?? { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
    const input = Math.max(0, s.input - a.input)
    const output = Math.max(0, s.output - a.output)
    const reasoning = Math.max(0, s.reasoning - a.reasoning)
    const cacheRead = Math.max(0, s.cacheRead - a.cacheRead)
    const cacheWrite = Math.max(0, s.cacheWrite - a.cacheWrite)
    const cost = s.cost - a.cost > COST_EPSILON ? s.cost - a.cost : 0
    const total = input + output + reasoning + cacheRead + cacheWrite
    if (total === 0 && cost === 0) continue
    out.inputTokens += input
    out.outputTokens += output
    out.reasoningTokens += reasoning
    out.cacheRead += cacheRead
    out.cacheWrite += cacheWrite
    out.totalTokens += total
    out.cost += cost
    out.sessions++
  }
  return out
}

export function projectBreakdownRows(rows: UsageRow[], sessions: Map<string, SessionRow>, limit = 20): ProjectBreakdownItem[] {
  const map = new Map<string, ProjectBreakdownItem & { ids: Set<string> }>()
  for (const r of rows) {
    const s = sessions.get(r.sessionID)
    const directory = s?.directory || "(unknown)"
    let item = map.get(directory)
    if (!item) {
      item = { directory, projectId: s?.projectID ?? "", sessions: 0, requests: 0, totalTokens: 0, totalCost: 0, ids: new Set() }
      map.set(directory, item)
    }
    item.requests++
    item.totalTokens += r.total
    item.totalCost += r.cost
    item.ids.add(r.sessionID)
  }
  return Array.from(map.values())
    .map(({ ids, ...item }) => ({ ...item, sessions: ids.size }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, limit)
}

export function agentBreakdownRows(rows: UsageRow[]): AgentBreakdownItem[] {
  const map = new Map<string, AgentBreakdownItem & { ids: Set<string> }>()
  for (const r of rows) {
    let item = map.get(r.agent)
    if (!item) {
      item = { agent: r.agent, sessions: 0, requests: 0, totalTokens: 0, totalCost: 0, ids: new Set() }
      map.set(r.agent, item)
    }
    item.requests++
    item.totalTokens += r.total
    item.totalCost += r.cost
    item.ids.add(r.sessionID)
  }
  return Array.from(map.values())
    .map(({ ids, ...item }) => ({ ...item, sessions: ids.size }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
}

export function sessionKindRows(rows: UsageRow[], sessions: Map<string, SessionRow>): SessionKindSplit {
  const make = () => ({ sessions: 0, requests: 0, totalTokens: 0, totalCost: 0, ids: new Set<string>() })
  const root = make()
  const child = make()
  for (const r of rows) {
    const bucket = sessions.get(r.sessionID)?.parentID ? child : root
    bucket.requests++
    bucket.totalTokens += r.total
    bucket.totalCost += r.cost
    bucket.ids.add(r.sessionID)
  }
  const fin = ({ ids, ...b }: ReturnType<typeof make>): SessionKindTotals => ({ ...b, sessions: ids.size })
  return { root: fin(root), child: fin(child) }
}

/** completed − created for successful requests, per model. */
export function modelLatencyRows(rows: UsageRow[]): ModelLatencyItem[] {
  const map = new Map<string, { provider: string; model: string; samples: number[] }>()
  for (const r of rows) {
    if (r.completed == null || r.completed <= r.created) continue
    if (classifyRow(r) !== "success") continue
    const key = `${r.providerID}|${r.modelID}`
    let item = map.get(key)
    if (!item) {
      item = { provider: r.providerID, model: r.modelID, samples: [] }
      map.set(key, item)
    }
    item.samples.push(r.completed - r.created)
  }
  return Array.from(map.values())
    .map(({ provider, model, samples }) => {
      samples.sort((a, b) => a - b)
      return {
        provider,
        model,
        samples: samples.length,
        p50Ms: percentileSorted(samples, 0.5),
        p90Ms: percentileSorted(samples, 0.9),
        avgMs: samples.reduce((a, b) => a + b, 0) / samples.length,
      }
    })
    .sort((a, b) => b.samples - a.samples)
}

export function cacheSavingsFromModels(models: ModelBreakdownItem[]): CacheSavings {
  let total = 0
  let any = false
  const byModel = models
    .filter(m => m.cacheRead > 0)
    .map(m => {
      let saved: number | null = null
      try {
        const p = lookupPricing(m.provider, m.model)
        if (p && p.input != null) {
          saved = (m.cacheRead / 1e6) * Math.max(0, p.input - (p.cache_read ?? 0))
          total += saved
          any = true
        }
      } catch { /* pricing unavailable */ }
      return { provider: m.provider, model: m.model, cacheRead: m.cacheRead, saved }
    })
  return { estimatedSavedCost: any ? total : null, byModel }
}

export function periodSnapshotRows(rows: UsageRow[]): PeriodSnapshot {
  const used = usageRows(rows)
  const s = summarizeRows(used)
  return {
    totalTokens: s.totalTokens,
    totalCost: s.totalCost,
    requestCount: s.requestCount,
    sessions: new Set(used.map(r => r.sessionID)).size,
    cacheHitRate: used.length > 0 ? cacheHitRate(s.inputTokens, s.cacheRead, s.cacheWrite) : null,
    errorRate: errorStatsRows(rows).errorRate,
  }
}

function formatLocalMinute(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${toLocalDay(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Previous window of the same length. Day-aligned windows report day labels;
 * sub-day windows (5h) report minute labels. Unbounded ranges have no previous.
 */
export function previousRange(range: LoadRange): { sinceMs: number; untilMs: number; label: { start: string; end: string } } | null {
  if (range.sinceMs == null) return null
  const until = range.untilMs ?? Date.now()
  const span = until - range.sinceMs
  if (span <= 0) return null
  const sinceDay = toLocalDay(range.sinceMs)
  const dayAligned = localMidnight(sinceDay) === range.sinceMs && localMidnight(toLocalDay(until)) === until
  if (dayAligned) {
    const days = Math.round(span / 86_400_000)
    const start = addDays(sinceDay, -days)
    return {
      sinceMs: localMidnight(start),
      untilMs: range.sinceMs,
      label: { start, end: addDays(sinceDay, -1) },
    }
  }
  return {
    sinceMs: range.sinceMs - span,
    untilMs: range.sinceMs,
    label: { start: formatLocalMinute(range.sinceMs - span), end: formatLocalMinute(range.sinceMs) },
  }
}

// ── Report assembly ──

export interface PeriodReport extends UsageReport {
  hourlyHeatmap: HourlyHeatmapItem[]
  errors: ErrorStats
  overhead?: OverheadStats
  projects: ProjectBreakdownItem[]
  agents: AgentBreakdownItem[]
  sessionKinds: SessionKindSplit
  modelLatency: ModelLatencyItem[]
  cacheSavings: CacheSavings
  comparison: PeriodComparison
  source: ReportSourceMeta
}

/** Every period aggregate from a single load (plus the previous window for comparison). */
export async function getPeriodReport(
  filters: UsageFilters = {},
  window: LoadRange = filtersToRange(filters),
  onProgress?: ProgressFn,
): Promise<PeriodReport> {
  const prev = previousRange(window)
  const loadRange: LoadRange = { ...window, sinceMs: prev ? prev.sinceMs : window.sinceMs }
  const ds = await loadDataset({ ...loadRange, onProgress })
  const current = ds.rows.filter(r => matchesRow(r, filters, window))
  const used = usageRows(current)
  const models = modelBreakdownRows(used)
  const filteredByModel = !!(filters.provider || filters.model)

  let comparison: PeriodComparison = { previous: null, previousRange: null }
  if (prev) {
    const prevWindow: LoadRange = { ...window, sinceMs: prev.sinceMs, untilMs: prev.untilMs }
    comparison = {
      previous: periodSnapshotRows(ds.rows.filter(r => matchesRow(r, filters, prevWindow))),
      previousRange: prev.label,
    }
  }

  return {
    filters,
    summary: summarizeRows(used),
    models,
    providers: providerBreakdownRows(used),
    daily: dailyBreakdownRows(used, filters.limit ?? 90),
    sessions: sessionBreakdownRows(used, ds.sessions, filters.limit ?? 15),
    totalSessions: new Set(used.map(r => r.sessionID)).size,
    errors: errorStatsRows(current),
    hourlyHeatmap: heatmapRows(used),
    overhead: filteredByModel ? undefined : overheadStatsRows(ds.rows, ds.sessions, window, ds.failedSessions),
    projects: projectBreakdownRows(used, ds.sessions),
    agents: agentBreakdownRows(used),
    sessionKinds: sessionKindRows(used, ds.sessions),
    modelLatency: modelLatencyRows(current),
    cacheSavings: cacheSavingsFromModels(models),
    comparison,
    source: ds.source,
  }
}

/** Session + descendants (root first). SQLite first, API fallback. */
export async function getSessionFamily(sessionId: string): Promise<string[]> {
  try {
    const src = openUsageSqliteSource()
    if (src) {
      try {
        const fam = src.family(sessionId)
        if (fam) return fam
      } finally {
        src.close()
      }
    }
  } catch { /* fall back to the API */ }
  if (!client) return [sessionId]
  const infos = await apiFamily(sessionId)
  const ids = infos.map(s => s.id)
  return ids.includes(sessionId) ? [sessionId, ...ids.filter(id => id !== sessionId)] : [sessionId, ...ids]
}

/** Fetch child (forked/family) session IDs for a parent session recursively. */
export async function getChildSessionIds(parentSessionId: string): Promise<string[]> {
  try {
    return (await getSessionFamily(parentSessionId)).filter(id => id !== parentSessionId)
  } catch {
    return []
  }
}

function toMessageRow(r: UsageRow, sessions: Map<string, SessionRow>): MessageRow {
  return {
    messageId: r.messageID,
    model: r.modelID,
    provider: r.providerID,
    inputTokens: r.input,
    outputTokens: r.output,
    reasoningTokens: r.reasoning,
    cacheRead: r.cacheRead,
    cacheWrite: r.cacheWrite,
    totalTokens: r.total,
    cost: r.cost,
    timeCreated: r.created,
    timeCompleted: r.completed,
    sessionId: r.sessionID,
    agent: r.agent,
    finish: r.finish,
    errorType: r.errorType,
    isChild: !!sessions.get(r.sessionID)?.parentID,
  }
}

/** All data the session report needs, from one family-scoped load. */
export async function getSessionReportInput(sessionId: string, onProgress?: ProgressFn): Promise<SessionReportInput> {
  const family = await getSessionFamily(sessionId)
  const ds = await loadDataset({ sessionIds: family, onProgress })
  const used = usageRows(ds.rows).sort((a, b) => a.created - b.created)
  const childIds = new Set(family.filter(id => id !== sessionId))
  let title = ds.sessions.get(sessionId)?.title
  if (!title) title = client ? await getSessionTitle(sessionId) : "(untitled)"
  return {
    sessionId,
    sessionTitle: title,
    subagentCount: childIds.size,
    summary: summarizeRows(used),
    models: modelBreakdownRows(used),
    messages: used.map(r => toMessageRow(r, ds.sessions)),
    errors: errorStatsRows(ds.rows),
    overhead: overheadStatsRows(ds.rows, ds.sessions, { sessionIds: family }, ds.failedSessions),
    agents: agentBreakdownRows(used),
    childSessions: sessionBreakdownRows(used.filter(r => childIds.has(r.sessionID)), ds.sessions, Number.MAX_SAFE_INTEGER),
    source: ds.source,
  }
}

// ── Legacy per-aggregate API (kept for callers/tests; all share the cached dataset) ──

async function loadRows(filters: UsageFilters): Promise<{ ds: Dataset; rows: UsageRow[] }> {
  const range = filtersToRange(filters)
  const ds = await loadDataset(range)
  return { ds, rows: ds.rows.filter(r => matchesRow(r, filters, range)) }
}

export async function getSummary(filters: UsageFilters = {}): Promise<SessionTokenData> {
  return summarizeRows(usageRows((await loadRows(filters)).rows))
}

export async function getModelBreakdown(filters: UsageFilters = {}): Promise<ModelBreakdownItem[]> {
  return modelBreakdownRows(usageRows((await loadRows(filters)).rows))
}

export async function getProviderBreakdown(filters: UsageFilters = {}): Promise<ProviderBreakdownItem[]> {
  return providerBreakdownRows(usageRows((await loadRows(filters)).rows))
}

export async function getDailyBreakdown(filters: UsageFilters = {}): Promise<DailyBreakdownItem[]> {
  return dailyBreakdownRows(usageRows((await loadRows(filters)).rows), filters.limit ?? 90)
}

export async function getSessionBreakdown(filters: UsageFilters = {}): Promise<SessionBreakdownItem[]> {
  const { ds, rows } = await loadRows(filters)
  return sessionBreakdownRows(usageRows(rows), ds.sessions, filters.limit ?? 15)
}

/** Per-request message details for a session + its children (old dashboard contract). */
export async function getMessageDetails(sessionId: string): Promise<MessageRow[]> {
  const family = await getSessionFamily(sessionId)
  const ds = await loadDataset({ sessionIds: family })
  return usageRows(ds.rows)
    .sort((a, b) => a.created - b.created)
    .map(r => toMessageRow(r, ds.sessions))
}

export async function getSessionTitle(sessionId: string): Promise<string> {
  const c = requireClient()
  try {
    const s = await c.session.get({ sessionID: sessionId })
    return s?.title ?? "(untitled)"
  } catch {
    return "(untitled)"
  }
}

/** Request outcome stats (finish / error.type based; see ErrorStats). */
export async function getErrorStats(filters: UsageFilters = {}): Promise<ErrorStats> {
  return errorStatsRows((await loadRows(filters)).rows)
}

/** Hourly heatmap (dow 0-6, hour 0-23) for the total dashboard. */
export async function getHourlyHeatmap(filters: UsageFilters = {}): Promise<HourlyHeatmapItem[]> {
  return heatmapRows(usageRows((await loadRows(filters)).rows))
}

export async function getUsageReport(filters: UsageFilters = {}): Promise<UsageReport> {
  const { ds, rows } = await loadRows(filters)
  const used = usageRows(rows)
  return {
    filters,
    summary: summarizeRows(used),
    models: modelBreakdownRows(used),
    providers: providerBreakdownRows(used),
    daily: dailyBreakdownRows(used, filters.limit ?? 90),
    sessions: sessionBreakdownRows(used, ds.sessions, filters.limit ?? 15),
    totalSessions: new Set(used.map(r => r.sessionID)).size,
    errors: errorStatsRows(rows),
  }
}

/** Available model IDs across all sessions (used by filters / exports). */
export async function getAvailableModels(): Promise<string[]> {
  return Array.from(new Set(usageRows((await loadRows({})).rows).map(r => r.modelID))).sort()
}

export async function getAvailableProviders(): Promise<string[]> {
  return Array.from(new Set(usageRows((await loadRows({})).rows).map(r => r.providerID))).sort()
}

/**
 * Real session count for the given filters (untruncated). Report KPIs must use
 * this instead of the session table array, which is capped by `limit`.
 */
export async function getSessionCount(filters: UsageFilters = {}): Promise<number> {
  return new Set(usageRows((await loadRows(filters)).rows).map(r => r.sessionID)).size
}
