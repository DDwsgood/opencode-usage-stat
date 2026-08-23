// queries.ts - V2 data aggregation layer.
//
// OpenCode V2 has no `opencode db` CLI. All session/message data comes from the
// V2 client (`@opencode-ai/client` OpenCodeClient, `context.client` in the TUI).
//   - client.session.list({ limit, cursor }) -> SessionsResponse { data, cursor }
//   - client.message.list({ sessionID, limit, order, cursor }) -> SessionMessagesResponse { data, cursor }
// The SessionMessageInfo projections (assistant/user...) are adapted into the
// report structures the HTML dashboards expect.
// Adapted from opencode-usage-stat (MIT) and opencode-tokenwatch (MIT, (c) TTWK).

import type { OpenCodeClient, SessionInfo, SessionMessageInfo, SessionMessageAssistant } from "@opencode-ai/client"
import type {
  DailyBreakdownItem,
  ErrorStats,
  HourlyHeatmapItem,
  MessageRow,
  ModelBreakdownItem,
  ProviderBreakdownItem,
  SessionBreakdownItem,
  SessionTokenData,
  UsageFilters,
  UsageReport,
} from "./formatter.js"

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

// ── Snapshot cache ──
// A full session+message scan used to run once per aggregate function (≈6x
// duplicated work per report). All aggregates now share one cached snapshot.
const SNAPSHOT_TTL_MS = 30_000
let snapshotPromise: Promise<Snapshot> | null = null
let snapshotAt = 0

interface Snapshot {
  sessions: SessionInfo[]
  messages: Map<string, SessionMessageInfo[]>
}

/** Invalidate the snapshot (called when the client is rebound or data changes materially). */
export function clearQueryCache(): void {
  snapshotPromise = null
  snapshotAt = 0
}

async function loadSnapshot(): Promise<Snapshot> {
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

  const messages = new Map<string, SessionMessageInfo[]>()
  const batchSize = 8
  for (let i = 0; i < all.length; i += batchSize) {
    const batch = all.slice(i, i + batchSize)
    const results = await Promise.all(batch.map(async s => {
      try {
        return await fetchAllMessages(s.id)
      } catch {
        return null // skip sessions we cannot read
      }
    }))
    for (let j = 0; j < batch.length; j++) {
      if (results[j]) messages.set(batch[j].id, results[j]!)
    }
  }
  return { sessions: all, messages }
}

function snapshot(): Promise<Snapshot> {
  if (snapshotPromise && snapshotAt && Date.now() - snapshotAt > SNAPSHOT_TTL_MS) {
    snapshotPromise = null
    snapshotAt = 0
  }
  if (!snapshotPromise) {
    const pending = loadSnapshot()
    void pending.then(
      result => { snapshotAt = Date.now() },
      () => { /* failure below clears the cache so the next call can retry */ },
    )
    void pending.catch(() => {
      if (snapshotPromise === pending) {
        snapshotPromise = null
        snapshotAt = 0
      }
    })
    snapshotPromise = pending
  }
  return snapshotPromise
}

/** Fetch all sessions (shared snapshot; cached briefly to avoid refetches). */
async function fetchAllSessions(): Promise<SessionInfo[]> {
  return (await snapshot()).sessions
}

/** Load raw assistant message data filtered by filters (excludes zero-token failures). */
async function loadAssistants(filters: UsageFilters = {}): Promise<RawAssistant[]> {
  const snap = await snapshot()
  const out: RawAssistant[] = []
  for (const [sessionID, msgs] of snap.messages) {
    for (const m of msgs) {
      const a = asAssistant(m, sessionID)
      if (!a) continue
      if (a.tokens.total <= 0) continue
      if (!matchesFilters(a, filters)) continue
      out.push(a)
    }
  }
  return out
}

/** Fetch all message projections for a session, with cursor pagination. */
async function fetchAllMessages(sessionID: string, limit = 1000): Promise<SessionMessageInfo[]> {
  const c = requireClient()
  const all: SessionMessageInfo[] = []
  let cursor: string | undefined
  for (;;) {
    const res = await c.message.list({ sessionID, limit, order: "asc", cursor })
    const page = res?.data
    if (!Array.isArray(page) || page.length === 0) break
    all.push(...page)
    const next = res?.cursor?.next
    if (!next) break
    cursor = next
  }
  return all
}

interface RawAssistant {
  sessionID: string
  providerID: string
  modelID: string
  messageID: string
  role: "assistant"
  created: number
  completed: number | undefined
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
  return {
    sessionID,
    providerID: a.model?.providerID ?? "unknown",
    modelID: a.model?.id ?? "unknown",
    messageID: a.id,
    role: "assistant",
    created: a.time?.created ?? 0,
    completed: a.time?.completed,
    cost: a.cost ?? 0,
    tokens: {
      input,
      output,
      reasoning,
      cacheRead,
      cacheWrite,
      total: input + output + reasoning + cacheRead + cacheWrite,
    },
  }
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function toLocalDay(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function matchesFilters(a: RawAssistant, filters: UsageFilters): boolean {
  if (filters.sessionIds && filters.sessionIds.length > 0 && !filters.sessionIds.includes(a.sessionID)) return false
  if (filters.sessionId && a.sessionID !== filters.sessionId) return false
  if (filters.provider && a.providerID !== filters.provider) return false
  if (filters.model && a.modelID !== filters.model) return false
  if (a.created != null) {
    const day = toLocalDay(a.created)
    if (filters.startDate && isValidDate(filters.startDate) && day < filters.startDate) return false
    if (filters.endDate && isValidDate(filters.endDate) && day > filters.endDate) return false
  }
  return true
}

function toSessionTokenData(assistants: RawAssistant[]): SessionTokenData {
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

export async function getSummary(filters: UsageFilters = {}): Promise<SessionTokenData> {
  return toSessionTokenData(await loadAssistants(filters))
}

export async function getModelBreakdown(filters: UsageFilters = {}): Promise<ModelBreakdownItem[]> {
  const assistants = await loadAssistants(filters)
  const map = new Map<string, ModelBreakdownItem>()
  const sessionSet = new Set<string>()
  for (const a of assistants) {
    const key = `${a.providerID ?? "unknown"}|${a.modelID ?? "unknown"}`
    const t = a.tokens
    let item = map.get(key)
    if (!item) {
      item = {
        provider: a.providerID ?? "unknown",
        model: a.modelID ?? "unknown",
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

export async function getProviderBreakdown(filters: UsageFilters = {}): Promise<ProviderBreakdownItem[]> {
  const assistants = await loadAssistants(filters)
  const map = new Map<string, ProviderBreakdownItem>()
  const sessionSet = new Set<string>()
  for (const a of assistants) {
    const key = a.providerID ?? "unknown"
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

export async function getDailyBreakdown(filters: UsageFilters = {}): Promise<DailyBreakdownItem[]> {
  const limit = filters.limit ?? 90
  const assistants = await loadAssistants(filters)
  const map = new Map<string, DailyBreakdownItem>()
  const sessionSet = new Set<string>()
  for (const a of assistants) {
    const day = a.created != null ? toLocalDay(a.created) : "unknown"
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
  return Array.from(map.values())
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .slice(0, Math.max(1, limit))
}

export async function getSessionBreakdown(filters: UsageFilters = {}): Promise<SessionBreakdownItem[]> {
  const limit = filters.limit ?? 15
  const sessions = await fetchAllSessions()
  const byId = new Map(sessions.map(s => [s.id, s]))
  const assistants = await loadAssistants(filters)
  const map = new Map<string, SessionBreakdownItem>()
  for (const a of assistants) {
    let item = map.get(a.sessionID)
    const t = a.tokens
    if (!item) {
      const s = byId.get(a.sessionID)
      const first = s?.model
      item = {
        sessionId: a.sessionID,
        title: s?.title ?? "(untitled)",
        provider: a.providerID ?? "unknown",
        model: a.modelID ?? first?.id ?? "unknown",
        requests: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheRead: 0,
        totalCost: 0,
        day: a.created != null ? toLocalDay(a.created) : "",
      }
      map.set(a.sessionID, item)
    }
    item.requests++
    item.totalTokens += t.total
    item.inputTokens += t.input
    item.outputTokens += t.output
    item.reasoningTokens += t.reasoning
    item.cacheRead += t.cacheRead
    item.totalCost += a.cost
    if (a.created != null) {
      const day = toLocalDay(a.created)
      if (day > item.day) item.day = day
    }
  }
  return Array.from(map.values())
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .slice(0, Math.max(1, limit))
}

/** Fetch child (forked/family) session IDs for a parent session recursively. */
export async function getChildSessionIds(parentSessionId: string): Promise<string[]> {
  try {
    const sessions = await fetchAllSessions()
    const direct = sessions.filter(s => s.parentID === parentSessionId).map(s => s.id)
    const out = [...direct]
    for (const id of direct) {
      try {
        out.push(...(await getChildSessionIds(id)))
      } catch { /* ignore */ }
    }
    return Array.from(new Set(out))
  } catch {
    return []
  }
}

/** Per-request message details for a session + its children (old dashboard contract). */
export async function getMessageDetails(sessionId: string): Promise<MessageRow[]> {
  const childIds = await getChildSessionIds(sessionId)
  const allIds = [sessionId, ...childIds]
  const filters: UsageFilters = { sessionIds: allIds }
  const assistants = await loadAssistants(filters)
  return assistants
    .sort((a, b) => a.created - b.created)
    .map(a => ({
      messageId: a.messageID,
      model: a.modelID ?? "unknown",
      provider: a.providerID ?? "unknown",
      inputTokens: a.tokens.input,
      outputTokens: a.tokens.output,
      reasoningTokens: a.tokens.reasoning,
      cacheRead: a.tokens.cacheRead,
      cacheWrite: a.tokens.cacheWrite,
      totalTokens: a.tokens.total,
      cost: a.cost,
      timeCreated: a.created,
      timeCompleted: a.completed ?? null,
    }))
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

/** 失败请求统计 (assistant with tokens all zero, or error finish) */
export async function getErrorStats(filters: UsageFilters = {}): Promise<ErrorStats> {
  const snap = await snapshot()
  let successCount = 0
  let failedCount = 0
  const byModelMap = new Map<string, { provider: string; model: string; failed: number; total: number }>()
  for (const [sessionID, msgs] of snap.messages) {
    for (const m of msgs) {
      if (m?.type !== "assistant") continue
      const a = asAssistant(m, sessionID)
      if (!a) continue
      if (!matchesFilters(a, filters)) continue
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
  }
  const byModel = Array.from(byModelMap.values()).sort((a, b) => b.failed - a.failed)
  const errorRate = successCount + failedCount > 0 ? failedCount / (successCount + failedCount) : 0
  return { successCount, failedCount, errorRate, byModel }
}

/** Hourly heatmap (dow 0-6, hour 0-23) for the total dashboard. */
export async function getHourlyHeatmap(filters: UsageFilters = {}): Promise<HourlyHeatmapItem[]> {
  const assistants = await loadAssistants(filters)
  const map = new Map<string, HourlyHeatmapItem>()
  for (const a of assistants) {
    const created = a.created
    if (created == null) continue
    const d = new Date(created)
    const dow = d.getDay()
    const hour = d.getHours()
    const key = `${dow}|${hour}`
    let item = map.get(key)
    if (!item) {
      item = { dow, hour, requests: 0, totalTokens: 0, totalCost: 0 }
      map.set(key, item)
    }
    item.requests++
    item.totalTokens += a.tokens.total
    item.totalCost += a.cost
  }
  return Array.from(map.values())
}

export async function getUsageReport(filters: UsageFilters = {}): Promise<UsageReport> {
  const [summary, models, providers, daily, sessions, errors, totalSessions] = await Promise.all([
    getSummary(filters),
    getModelBreakdown(filters),
    getProviderBreakdown(filters),
    getDailyBreakdown(filters),
    getSessionBreakdown(filters),
    getErrorStats(filters),
    getSessionCount(filters),
  ])
  return { filters, summary, models, providers, daily, sessions, totalSessions, errors }
}

/** Available model IDs across all sessions (used by filters / exports). */
export async function getAvailableModels(): Promise<string[]> {
  const list = new Set<string>()
  for (const a of await loadAssistants()) {
    list.add(a.modelID)
  }
  return Array.from(list).sort()
}

export async function getAvailableProviders(): Promise<string[]> {
  const list = new Set<string>()
  for (const a of await loadAssistants()) {
    list.add(a.providerID)
  }
  return Array.from(list).sort()
}

/**
 * Real session count for the given filters (untruncated). Report KPIs must use
 * this instead of the session table array, which is capped by `limit`.
 */
export async function getSessionCount(filters: UsageFilters = {}): Promise<number> {
  const assistants = await loadAssistants(filters)
  return new Set(assistants.map(a => a.sessionID)).size
}