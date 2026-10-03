import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { openUsageSqliteSource, setUsageDbPathOverride } from "../src/sqlite-source.js"
import {
  clearQueryCache,
  getPeriodReport,
  getSessionReportInput,
  previousRange,
  setV2Client,
} from "../src/queries.js"
import { setPricingCacheForTest } from "../src/pricing.js"

const dir = mkdtempSync(join(tmpdir(), "usage-stat-sqlite-"))
const DAY = 86_400_000

function localMidnight(daysAgo: number): number {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo).getTime()
}

const today = localMidnight(0)

function day(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

interface MsgSpec {
  id: string
  session: string
  created: number
  completed?: number | null
  provider?: string
  model?: string
  agent?: string
  input?: number
  output?: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
  cost?: number
  finish?: string | null
  errorType?: string
}

interface SessSpec {
  id: string
  parent?: string
  directory?: string
  created: number
  updated: number
  cost?: number
  input?: number
  output?: number
}

function createDb(file: string, sessions: SessSpec[], messages: MsgSpec[], opts: { dropColumn?: boolean; noMessageTable?: boolean } = {}): string {
  const path = join(dir, file)
  const db = new DatabaseSync(path)
  db.exec(`CREATE TABLE session_v2 (
    id text PRIMARY KEY, project_id text NOT NULL, parent_id text, directory text NOT NULL, title text,
    cost real DEFAULT 0 NOT NULL, tokens_input integer DEFAULT 0 NOT NULL, tokens_output integer DEFAULT 0 NOT NULL,
    tokens_reasoning integer DEFAULT 0 NOT NULL, tokens_cache_read integer DEFAULT 0 NOT NULL,
    ${opts.dropColumn ? "" : "tokens_cache_write integer DEFAULT 0 NOT NULL,"}
    agent text, time_created integer NOT NULL, time_updated integer NOT NULL)`)
  if (!opts.noMessageTable) {
    db.exec(`CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, seq integer NOT NULL,
      time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)`)
    db.exec(`CREATE INDEX session_message_time_created_idx ON session_message (time_created)`)
    db.exec(`CREATE INDEX session_message_session_type_seq_idx ON session_message (session_id, type, seq)`)
  }
  const insS = db.prepare(`INSERT INTO session_v2 (id, project_id, parent_id, directory, title, cost, tokens_input, tokens_output, time_created, time_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  for (const s of sessions) {
    insS.run(s.id, "proj-" + (s.directory ?? "a"), s.parent ?? null, s.directory ?? "/work/a", `Title ${s.id}`, s.cost ?? 0, s.input ?? 0, s.output ?? 0, s.created, s.updated)
  }
  if (!opts.noMessageTable) {
    const insM = db.prepare(`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    let seq = 0
    for (const m of messages) {
      const data: Record<string, unknown> = {
        id: m.id,
        type: "assistant",
        agent: m.agent ?? "build",
        model: { providerID: m.provider ?? "openai", id: m.model ?? "gpt-x" },
        time: m.completed === null ? { created: m.created } : { created: m.created, completed: m.completed ?? m.created + 2000 },
        cost: m.cost ?? 0,
        tokens: { input: m.input ?? 0, output: m.output ?? 0, reasoning: m.reasoning ?? 0, cache: { read: m.cacheRead ?? 0, write: m.cacheWrite ?? 0 } },
        content: [{ type: "text", text: "body that must never be needed".repeat(10) }],
      }
      if (m.finish !== null) data.finish = m.finish ?? "stop"
      if (m.errorType) data.error = { type: m.errorType, message: "boom" }
      insM.run(m.id, m.session, "assistant", seq++, m.created, m.created, JSON.stringify(data))
      // Non-assistant rows must be ignored.
      insM.run(m.id + "-u", m.session, "user", seq++, m.created, m.created, JSON.stringify({ text: "hi" }))
    }
  }
  db.close()
  return path
}

// root (today) -> child; "old" session lives 10 days ago; "prev" sits in the previous 7-day window.
const sessions: SessSpec[] = [
  { id: "root", created: today + 1000, updated: today + 60_000, cost: 0.5, input: 1200, output: 300, directory: "/work/a" },
  { id: "child", parent: "root", created: today + 5000, updated: today + 50_000, cost: 0.1, input: 100, output: 50, directory: "/work/a" },
  { id: "old", created: today - 10 * DAY, updated: today - 10 * DAY + 5000, cost: 0.2, input: 200, output: 20, directory: "/work/b" },
]
const messages: MsgSpec[] = [
  { id: "r1", session: "root", created: today + 2000, input: 1000, output: 200, cacheRead: 500, cost: 0.4 },
  { id: "r2", session: "root", created: today + 3000, finish: "error", errorType: "provider.rate-limit" },
  { id: "r3", session: "root", created: today + 4000, input: 50, output: 5, finish: "error", errorType: "aborted", cost: 0.01 },
  { id: "r4", session: "root", created: today + 4500, finish: null, completed: null },
  { id: "c1", session: "child", created: today + 6000, input: 100, output: 50, cost: 0.1, agent: "explore", model: "gpt-y" },
  { id: "o1", session: "old", created: today - 10 * DAY + 1000, input: 200, output: 20, cost: 0.2 },
]

let goodDb = ""

function mockClient(ids: string[]) {
  return {
    session: {
      async list() { return { data: ids.map(id => ({ id })), cursor: { next: null } } },
      async get({ sessionID }: { sessionID: string }) { return { id: sessionID, title: "api title" } },
    },
    message: {
      async list() { throw new Error("API must not be used when SQLite is valid") },
    },
  }
}

before(() => {
  setPricingCacheForTest({ "openai/gpt-x": { input: 2, output: 8, cache_read: 0.5 } })
  goodDb = createDb("good.db", sessions, messages)
})

after(() => {
  setUsageDbPathOverride(undefined)
  rmSync(dir, { recursive: true, force: true })
})

test("schema detection rejects missing file, missing table, and missing column", () => {
  setUsageDbPathOverride(join(dir, "missing.db"))
  assert.equal(openUsageSqliteSource(), null)
  setUsageDbPathOverride(createDb("no-msg.db", sessions, [], { noMessageTable: true }))
  assert.equal(openUsageSqliteSource(), null)
  setUsageDbPathOverride(createDb("no-col.db", sessions, messages, { dropColumn: true }))
  assert.equal(openUsageSqliteSource(), null)
  setUsageDbPathOverride(goodDb)
  const src = openUsageSqliteSource()
  assert.ok(src)
  src!.close()
})

test("broken schema falls back to the API path", async () => {
  setUsageDbPathOverride(join(dir, "no-col.db"))
  clearQueryCache()
  const calls: string[] = []
  setV2Client({
    session: {
      async list() { return { data: [{ id: "x", time: { created: today, updated: today + 10 }, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0 }], cursor: { next: null } } },
      async get() { return null },
    },
    message: {
      async list({ sessionID }: { sessionID: string }) {
        calls.push(sessionID)
        return { data: [{ id: "m", type: "assistant", agent: "build", model: { providerID: "p", id: "m" }, time: { created: today + 5, completed: today + 9 }, finish: "stop", cost: 0, tokens: { input: 3, output: 4, reasoning: 0, cache: { read: 0, write: 0 } } }], cursor: { next: null } }
      },
    },
  } as never)
  const report = await getPeriodReport({})
  assert.equal(report.source.source, "api")
  assert.deepEqual(calls, ["x"])
  assert.equal(report.summary.totalTokens, 7)
})

test("a local DB that does not contain the client's sessions is not trusted", async () => {
  setUsageDbPathOverride(goodDb)
  clearQueryCache()
  setV2Client({
    session: {
      async list() { return { data: [{ id: "remote-only", time: { created: 0, updated: 0 }, cost: 0 }], cursor: { next: null } } },
      async get() { return null },
    },
    message: { async list() { return { data: [], cursor: { next: null } } } },
  } as never)
  const report = await getPeriodReport({})
  assert.equal(report.source.source, "api")
})

test("SQLite path: date filtering, error classification, and source meta", async () => {
  setUsageDbPathOverride(goodDb)
  clearQueryCache()
  setV2Client(mockClient(["root", "child", "old"]) as never)

  const all = await getPeriodReport({})
  assert.equal(all.source.source, "sqlite")
  assert.equal(all.summary.requestCount, 4) // r1, r3 (aborted but token-bearing), c1, o1
  assert.equal(all.totalSessions, 3)
  assert.equal(all.comparison.previous, null)
  assert.equal(all.comparison.previousRange, null)

  const e = all.errors
  assert.equal(e.successCount, 3) // r1, c1, o1
  assert.equal(e.failedCount, 1) // r2
  assert.equal(e.abortedCount, 1) // r3
  assert.equal(e.errorRate, 1 / 4)
  assert.deepEqual(e.byType.map(t => `${t.type}=${t.count}`).sort(), ["aborted=1", "provider.rate-limit=1"])
  assert.equal(e.finishReasons.find(f => f.reason === "stop")?.count, 3)
  assert.ok(!e.finishReasons.some(f => f.reason === "none")) // r4 is in progress

  const todayStr = day(today)
  const recent = await getPeriodReport({ startDate: todayStr, endDate: todayStr })
  assert.equal(recent.summary.requestCount, 3)
  assert.ok(!recent.sessions.some(s => s.sessionId === "old"))
  assert.equal(recent.sessionKinds.child.sessions, 1)
  assert.equal(recent.sessionKinds.root.requests, 2)
  assert.deepEqual(recent.agents.map(a => a.agent).sort(), ["build", "explore"])
  assert.equal(recent.projects[0].directory, "/work/a")
  assert.equal(recent.modelLatency.find(m => m.model === "gpt-x")?.p50Ms, 2000)
  // 500 cache-read tokens × ($2 − $0.5) per 1M
  assert.ok(Math.abs((recent.cacheSavings.estimatedSavedCost ?? 0) - 0.00075) < 1e-12)
})

test("overhead = session totals minus assistant sums, floored at 0, only for sessions inside the window", async () => {
  setUsageDbPathOverride(goodDb)
  clearQueryCache()
  setV2Client(mockClient(["root"]) as never)
  const all = await getPeriodReport({})
  // root: input 1200-1050=150, output 300-205=95, cost 0.5-0.41=0.09; child/old match exactly.
  assert.equal(all.overhead!.inputTokens, 150)
  assert.equal(all.overhead!.outputTokens, 95)
  assert.ok(Math.abs(all.overhead!.cost - 0.09) < 1e-9)
  assert.equal(all.overhead!.sessions, 1)

  const session = await getSessionReportInput("root")
  assert.equal(session.source?.source, "sqlite")
  assert.equal(session.subagentCount, 1)
  assert.equal(session.childSessions?.[0].sessionId, "child")
  assert.equal(session.overhead?.totalTokens, 150 + 95)
  assert.equal(session.messages.length, 3)
  assert.equal(session.messages.find(m => m.messageId === "c1")?.isChild, true)
  assert.equal(session.messages.find(m => m.messageId === "r3")?.errorType, "aborted")
  assert.equal(session.sessionTitle, "Title root")
})

test("comparison covers the previous window of equal length", async () => {
  setUsageDbPathOverride(goodDb)
  clearQueryCache()
  setV2Client(mockClient(["root"]) as never)
  const start = day(localMidnight(6))
  const end = day(today)
  const report = await getPeriodReport({ startDate: start, endDate: end })
  assert.deepEqual(report.comparison.previousRange, {
    start: day(localMidnight(13)),
    end: day(localMidnight(7)),
  })
  assert.equal(report.comparison.previous?.requestCount, 1) // o1, 10 days ago
  assert.equal(report.comparison.previous?.sessions, 1)
  assert.equal(report.summary.requestCount, 3)

  const fiveHours = previousRange({ sinceMs: 1_000_000_000, untilMs: 1_000_000_000 + 5 * 3_600_000 })
  assert.equal(fiveHours?.sinceMs, 1_000_000_000 - 5 * 3_600_000)
  assert.equal(fiveHours?.untilMs, 1_000_000_000)
  assert.equal(previousRange({}), null)
})

test("keyset chunking returns every row exactly once, including timestamp ties", async () => {
  const many: MsgSpec[] = []
  for (let i = 0; i < 2600; i++) many.push({ id: `k${String(i).padStart(5, "0")}`, session: "root", created: today + Math.floor(i / 7), input: 1 })
  setUsageDbPathOverride(createDb("many.db", sessions.slice(0, 1), many))
  const src = openUsageSqliteSource()!
  let chunks = 0
  const res = await src.load({ onChunk: () => { chunks++ } })
  src.close()
  assert.ok(chunks > 1)
  assert.equal(res.rows.length, 2600)
  assert.equal(new Set(res.rows.map(r => r.messageID)).size, 2600)
  const windowed = openUsageSqliteSource()!
  const part = await windowed.load({ sinceMs: today + 100, untilMs: today + 200 })
  windowed.close()
  assert.equal(part.rows.length, 700)
})
