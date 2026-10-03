import { test, before } from "node:test"
import assert from "node:assert/strict"
import {
  setV2Client,
  getSummary,
  getModelBreakdown,
  getProviderBreakdown,
  getDailyBreakdown,
  getSessionBreakdown,
  getChildSessionIds,
  getMessageDetails,
  getSessionTitle,
  getErrorStats,
  getHourlyHeatmap,
  getUsageReport,
  getPeriodReport,
  getSessionReportInput,
  clearQueryCache,
} from "../src/queries.js"
import { setUsageDbPathOverride } from "../src/sqlite-source.js"
import { setPricingCacheForTest } from "../src/pricing.js"
import type { UsageFilters } from "../src/formatter.js"

// Minimal structural types mirroring the V2 @opencode-ai/client projections.
interface CachedTokens { read: number; write: number }
interface Tokens {
  input: number
  output: number
  reasoning: number
  cache: CachedTokens
}
interface ModelRef { id: string; providerID: string; variant?: string }
type Msg = {
  id: string
  sessionID?: string
  type: "assistant" | "user"
  agent?: string
  model?: ModelRef
  cost?: number
  time: { created: number; completed?: number }
  tokens?: Tokens
  text?: string
  [k: string]: unknown
}
interface Sess {
  id: string
  parentID?: string
  title?: string
  model?: ModelRef
  tokens?: Tokens
  cost?: number
  [k: string]: unknown
}
interface SessionsResponse { data: Sess[]; cursor: { previous?: string | null; next?: string | null } }
interface SessionMessagesResponse { data: Msg[]; cursor: { previous?: string | null; next?: string | null } }

// ── Mock V2 client (offline; mirrors @opencode-ai/client shapes) ──

interface Client {
  session: {
    list(p: { limit?: number; cursor?: string }): Promise<SessionsResponse>
    get(p: { sessionID: string }): Promise<Sess>
  }
  message: {
    list(p: { sessionID: string; limit?: number; order?: "asc" | "desc"; cursor?: string }): Promise<SessionMessagesResponse>
  }
}

const messageListCalls: string[] = []

function makeClient(sessions: Sess[], messagesBySession: Record<string, Msg[]>): Client {
  const byId = new Map(sessions.map(s => [s.id, s]))
  return {
    session: {
      async list({ limit = 500, cursor }: { limit?: number; cursor?: string } = {}) {
        const start = cursor ? Number(cursor) : 0
        const page = sessions.slice(start, start + limit)
        return {
          data: page,
          cursor: {
            previous: start > 0 ? String(Math.max(0, start - limit)) : null,
            next: start + page.length < sessions.length ? String(start + page.length) : null,
          },
        }
      },
      async get({ sessionID }) {
        const s = byId.get(sessionID)
        if (!s) throw new Error("not found")
        return s
      },
    },
    message: {
      async list({ sessionID, limit = 1000, order = "asc", cursor }: { sessionID: string; limit?: number; order?: "asc" | "desc"; cursor?: string }) {
        messageListCalls.push(sessionID)
        let msgs = [...(messagesBySession[sessionID] ?? [])]
        if (order === "desc") msgs.reverse()
        let page = msgs
        if (cursor) {
          const idx = msgs.findIndex(m => m.id === cursor)
          page = idx >= 0 ? msgs.slice(idx + 1) : []
        }
        page = page.slice(0, limit)
        return {
          data: page,
          cursor: {
            previous: null,
            next: msgs.length > limit ? msgs[limit]?.id : null,
          },
        }
      },
    },
  }
}

type MsgOver = Partial<{ cost: number; timeCreated: number; timeCompleted: number; finish: string | null; errorType: string; agent: string }> & Partial<Tokens>

function assistantMsg(id: string, providerID: string, modelID: string, over: MsgOver = {}): Msg {
  const created = over.timeCreated ?? 1700000000000
  return {
    id,
    type: "assistant",
    agent: over.agent ?? "primary",
    model: { providerID, id: modelID },
    cost: over.cost ?? 0,
    time: { created, completed: over.finish === null ? undefined : over.timeCompleted ?? created + 1000 },
    ...(over.finish === null ? {} : { finish: over.finish ?? "stop" }),
    ...(over.errorType ? { error: { type: over.errorType, message: "x" } } : {}),
    tokens: {
      input: over.input ?? 40,
      output: over.output ?? 60,
      reasoning: over.reasoning ?? 0,
      cache: { read: over.cache?.read ?? 0, write: over.cache?.write ?? 0 },
    },
  } as Msg
}

function session(id: string, title: string, timeCreated: number, parentID?: string): Sess {
  const base: Sess = {
    id,
    slug: id,
    title,
    time: { created: timeCreated, updated: timeCreated },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  if (parentID) base.parentID = parentID
  return base
}

// ── Fixtures ──
// m2 is a failed/zero-token assistant (excluded from usage, counted as error).

const s1 = session("s1", "First Session", 1700000000000)
const s2 = session("s2", "Child Session", 1700000200000, "s1")
const messages: Record<string, Msg[]> = {
  s1: [
    assistantMsg("m1", "openai", "gpt-4o", { timeCreated: 1700000000000, input: 100, output: 200, cache: { read: 50, write: 10 }, cost: 0.01 }),
    assistantMsg("m2", "anthropic", "claude-sonnet", { timeCreated: 1700000005000, input: 0, output: 0, finish: "error", errorType: "provider.internal" }), // failed
    assistantMsg("m2a", "anthropic", "claude-sonnet", { timeCreated: 1700000006000, input: 0, output: 0, finish: "error", errorType: "aborted" }), // user abort
    assistantMsg("m2p", "anthropic", "claude-sonnet", { timeCreated: 1700000007000, input: 0, output: 0, finish: null }), // still running
    assistantMsg("m3", "anthropic", "claude-sonnet", { timeCreated: 1700000010000, input: 20, output: 80, cache: { read: 5, write: 2 }, cost: 0.02 }),
  ],
  s2: [
    assistantMsg("m4", "anthropic", "claude-sonnet", { timeCreated: 1700000200000, input: 10, output: 10, cache: { read: 0, write: 0 } }),
  ],
}

before(() => {
  // Keep these API-path tests away from the real ~/.local/share/opencode/opencode.db.
  setUsageDbPathOverride(null)
  setPricingCacheForTest({})
  setV2Client(makeClient([s1, s2], messages) as never)
})

test("getSummary aggregates token totals over assistant messages", async () => {
  const summary = await getSummary()
  // m1 (openai) + m3 + m4 (anthropic); m2 has zero tokens -> excluded
  assert.equal(summary.requestCount, 3)
  assert.equal(summary.inputTokens, 100 + 20 + 10)
  assert.equal(summary.outputTokens, 200 + 80 + 10)
  assert.equal(summary.cacheRead, 50 + 5)
  assert.equal(summary.totalCost, 0.01 + 0.02)
  assert.ok(summary.modelsUsed.includes("gpt-4o"))
  assert.ok(summary.modelsUsed.includes("claude-sonnet"))
})

test("getSummary filters by provider and session", async () => {
  const byProvider: UsageFilters = { provider: "anthropic" }
  const anth = await getSummary(byProvider)
  assert.equal(anth.requestCount, 2) // m3 + m4 (m2 failed)

  const bySession: UsageFilters = { sessionId: "s1" }
  const onlyS1 = await getSummary(bySession)
  assert.equal(onlyS1.requestCount, 2) // m1, m3
})

test("getModelBreakdown groups per provider/model with request counts", async () => {
  const models = await getModelBreakdown()
  const gpt = models.find(m => m.model === "gpt-4o")
  const claude = models.find(m => m.model === "claude-sonnet")
  assert.ok(gpt)
  assert.equal(gpt!.requests, 1)
  assert.equal(claude!.requests, 2) // m3 + m4
  assert.equal(claude!.totalTokens, 20 + 80 + 5 + 2 + 10 + 10)
})

test("getProviderBreakdown aggregates provider totals", async () => {
  const providers = await getProviderBreakdown()
  const anth = providers.find(p => p.provider === "anthropic")
  assert.ok(anth)
  assert.equal(anth!.requests, 2)
  assert.equal(anth!.sessions, 2) // s1 and s2
})

test("getDailyBreakdown keys by local day", async () => {
  const daily = await getDailyBreakdown({ limit: 10 })
  assert.ok(daily.length >= 1)
  assert.match(daily[0].day, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(daily[0].requests, 3)
})

test("getSessionBreakdown lists sessions with titles", async () => {
  const sessions = await getSessionBreakdown({ limit: 10 })
  assert.ok(sessions.length >= 2)
  const s1Row = sessions.find(s => s.sessionId === "s1")
  assert.equal(s1Row?.title, "First Session")
  assert.equal(s1Row?.requests, 2)
})

test("getChildSessionIds returns children via parentID scan", async () => {
  const children = await getChildSessionIds("s1")
  assert.deepEqual(children, ["s2"])
})

test("getMessageDetails returns per-request rows for session + children", async () => {
  const rows = await getMessageDetails("s1")
  assert.equal(rows.length, 3) // m1,m3,m4 (m2 zero-token excluded)
  assert.equal(rows[0].provider, "openai")
  assert.equal(rows[2].model, "claude-sonnet")
})

test("getErrorStats classifies by finish/error.type; aborted and in-progress are not errors", async () => {
  const errors = await getErrorStats({ sessionId: "s1" })
  assert.equal(errors.successCount, 2)
  assert.equal(errors.failedCount, 1) // m2
  assert.equal(errors.abortedCount, 1) // m2a
  assert.equal(errors.errorRate, 1 / 3)
  assert.deepEqual(errors.byType.map(t => t.type).sort(), ["aborted", "provider.internal"])
  const claude = errors.byModel.find(m => m.model === "claude-sonnet")!
  assert.deepEqual([claude.failed, claude.aborted, claude.total], [1, 1, 3]) // m2p pending excluded
  assert.equal(errors.finishReasons.find(f => f.reason === "error")?.count, 2)
})

test("API fallback: session report loads only the family and reports source=api", async () => {
  clearQueryCache()
  messageListCalls.length = 0
  const input = await getSessionReportInput("s2")
  assert.deepEqual([...new Set(messageListCalls)], ["s2"])
  assert.equal(input.source?.source, "api")
  assert.equal(input.subagentCount, 0)
  assert.equal(input.summary.requestCount, 1)
})

test("API fallback: per-session projections are reused while the session is unchanged", async () => {
  clearQueryCache()
  await getPeriodReport({})
  messageListCalls.length = 0
  // A different window misses the dataset cache but hits the per-session row cache.
  await getPeriodReport({}, { sinceMs: 1 })
  assert.equal(messageListCalls.length, 0)
})

test("API fallback: date ranges skip sessions last updated before the window", async () => {
  clearQueryCache()
  messageListCalls.length = 0
  // The previous (comparison) window starts at 1700000050000, still after s1's last update.
  const report = await getPeriodReport({}, { sinceMs: 1700000150000, untilMs: 1700000250000 })
  assert.deepEqual([...new Set(messageListCalls)], ["s2"])
  assert.equal(report.summary.requestCount, 1)
})

test("getHourlyHeatmap buckets by weekday+hour", async () => {
  const heat = await getHourlyHeatmap({})
  assert.ok(heat.length >= 1)
  assert.equal(heat.reduce((n, h) => n + h.requests, 0), 3)
})

test("getUsageReport assembles the full report", async () => {
  const report = await getUsageReport({})
  assert.ok(report.summary.requestCount > 0)
  assert.ok(report.models.length > 0)
  assert.ok(report.providers.length > 0)
  assert.ok(report.daily.length > 0)
  assert.ok(report.sessions.length > 0)
  assert.ok(report.errors)
})

test("getSessionTitle returns session title", async () => {
  assert.equal(await getSessionTitle("s2"), "Child Session")
})