// sqlite-source.ts - Read-only fast path over the local OpenCode V2 database.
//
// The V2 client returns full message bodies (text, tool output), so a full
// report used to download >1 GB just to read tokens/cost/model/time. SQLite
// lets json_extract pull only those fields. Every failure (no sqlite runtime,
// missing file, unexpected schema, query error) returns null so callers fall
// back to the API path.
//
// The database is opened read-only and never written (no pragmas that write,
// no indexes, no VACUUM).

import { createRequire } from "node:module"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { credentialDatabasePath } from "./credentials.js"

/** Projected assistant message: only the fields reports need. */
export interface UsageRow {
  sessionID: string
  messageID: string
  providerID: string
  modelID: string
  agent: string
  created: number
  completed: number | null
  cost: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
  finish: string | null
  errorType: string | null
}

/** Projected session: identity, location, and the session-level usage totals. */
export interface SessionRow {
  id: string
  projectID: string
  parentID: string | null
  directory: string
  title: string
  timeCreated: number
  timeUpdated: number
  cost: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

export interface SqlDb {
  all(sql: string, params?: unknown[]): any[]
  close(): void
}

export interface LoadRange {
  sinceMs?: number
  untilMs?: number
  sessionIds?: string[]
}

export interface LoadResult {
  sessions: SessionRow[]
  rows: UsageRow[]
}

const REQUIRED_COLUMNS: Record<string, string[]> = {
  session_v2: [
    "id", "project_id", "parent_id", "directory", "title", "cost",
    "tokens_input", "tokens_output", "tokens_reasoning", "tokens_cache_read", "tokens_cache_write",
    "time_created", "time_updated",
  ],
  session_message: ["id", "session_id", "type", "time_created", "data"],
}

// undefined = default path, null = disabled (tests / opt-out), string = explicit path.
let pathOverride: string | null | undefined

/** Test hook: point the fast path at a fixture DB, or pass null to disable it. */
export function setUsageDbPathOverride(path: string | null | undefined): void {
  pathOverride = path
}

export function usageDbPath(): string | null {
  if (pathOverride === null) return null
  return pathOverride ?? credentialDatabasePath()
}

/** Open the database read-only through bun:sqlite (TUI) or node:sqlite (tests). */
export function openReadonlyDb(path: string): SqlDb | null {
  if (!existsSync(path)) return null
  try {
    const require = createRequire(join(homedir(), ".opencode", "usage-stat-require.cjs"))
    if (typeof (globalThis as any).Bun !== "undefined") {
      const { Database } = require("bun:sqlite")
      const db = new Database(path, { readonly: true })
      return {
        all: (sql, params = []) => db.query(sql).all(...(params as any[])),
        close: () => db.close(),
      }
    }
    const { DatabaseSync } = require("node:sqlite")
    const db = new DatabaseSync(path, { readOnly: true })
    const cache = new Map<string, any>()
    return {
      all: (sql, params = []) => {
        let stmt = cache.get(sql)
        if (!stmt) {
          stmt = db.prepare(sql)
          cache.set(sql, stmt)
        }
        return stmt.all(...(params as any[]))
      },
      close: () => db.close(),
    }
  } catch {
    return null
  }
}

export function hasUsageSchema(db: SqlDb): boolean {
  try {
    for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
      const names = new Set(db.all(`PRAGMA table_info(${table})`).map((r: any) => String(r.name)))
      if (!cols.every(c => names.has(c))) return false
    }
    const probe = db.all(`SELECT json_extract('{"a":{"b":1}}', '$.a.b') AS v`)
    return Number(probe[0]?.v) === 1
  } catch {
    return false
  }
}

const SESSION_COLUMNS = `id, project_id, parent_id, directory, title, time_created, time_updated, cost,
  tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write`

function toSessionRow(r: any): SessionRow {
  return {
    id: String(r.id),
    projectID: r.project_id == null ? "" : String(r.project_id),
    parentID: r.parent_id == null || r.parent_id === "" ? null : String(r.parent_id),
    directory: r.directory == null ? "" : String(r.directory),
    title: r.title == null || r.title === "" ? "(untitled)" : String(r.title),
    timeCreated: Number(r.time_created) || 0,
    timeUpdated: Number(r.time_updated) || 0,
    cost: Number(r.cost) || 0,
    input: Number(r.tokens_input) || 0,
    output: Number(r.tokens_output) || 0,
    reasoning: Number(r.tokens_reasoning) || 0,
    cacheRead: Number(r.tokens_cache_read) || 0,
    cacheWrite: Number(r.tokens_cache_write) || 0,
  }
}

const MESSAGE_COLUMNS = `m.rowid AS rid, m.session_id AS sid, m.id AS id, m.time_created AS created,
  json_extract(m.data, '$.time.completed') AS completed,
  json_extract(m.data, '$.agent') AS agent,
  json_extract(m.data, '$.model.providerID') AS provider,
  json_extract(m.data, '$.model.id') AS model,
  json_extract(m.data, '$.cost') AS cost,
  json_extract(m.data, '$.tokens.input') AS t_in,
  json_extract(m.data, '$.tokens.output') AS t_out,
  json_extract(m.data, '$.tokens.reasoning') AS t_rsn,
  json_extract(m.data, '$.tokens.cache.read') AS t_cr,
  json_extract(m.data, '$.tokens.cache.write') AS t_cw,
  json_extract(m.data, '$.finish') AS finish,
  json_extract(m.data, '$.error.type') AS etype`

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null
}

function toUsageRow(r: any): UsageRow {
  const input = num(r.t_in)
  const output = num(r.t_out)
  const reasoning = num(r.t_rsn)
  const cacheRead = num(r.t_cr)
  const cacheWrite = num(r.t_cw)
  const completed = r.completed == null ? null : num(r.completed) || null
  return {
    sessionID: String(r.sid),
    messageID: String(r.id),
    providerID: str(r.provider) ?? "unknown",
    modelID: str(r.model) ?? "unknown",
    agent: str(r.agent) ?? "unknown",
    created: num(r.created),
    completed,
    cost: num(r.cost),
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total: input + output + reasoning + cacheRead + cacheWrite,
    finish: str(r.finish),
    errorType: str(r.etype),
  }
}

const yieldToLoop = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/**
 * Synchronous queries are split into small keyset-paginated chunks with a
 * macrotask yield in between so the TUI keeps rendering. The chunk size adapts
 * to keep each blocking slice near CHUNK_TARGET_MS.
 */
const CHUNK_TARGET_MS = 25
const CHUNK_MIN = 100
// Row sizes vary widely (tool-heavy turns are much larger); a low cap keeps one
// unlucky chunk from blocking much longer than the target.
const CHUNK_MAX = 1_000
const SESSION_ID_CHUNK = 40

export interface SqliteLoadOptions extends LoadRange {
  /** Called after each chunk; used by benchmarks to record the longest blocking slice. */
  onChunk?: (rows: number, ms: number) => void
}

async function loadRows(db: SqlDb, opts: SqliteLoadOptions): Promise<UsageRow[]> {
  const out: UsageRow[] = []
  const report = (rows: number, ms: number) => opts.onChunk?.(rows, ms)
  if (opts.sessionIds) {
    const ids = Array.from(new Set(opts.sessionIds))
    for (let i = 0; i < ids.length; i += SESSION_ID_CHUNK) {
      const batch = ids.slice(i, i + SESSION_ID_CHUNK)
      const params: unknown[] = [...batch]
      let where = `m.session_id IN (${batch.map(() => "?").join(",")}) AND m.type = 'assistant'`
      if (opts.sinceMs != null) { where += " AND m.time_created >= ?"; params.push(opts.sinceMs) }
      if (opts.untilMs != null) { where += " AND m.time_created < ?"; params.push(opts.untilMs) }
      const t0 = performance.now()
      const rows = db.all(`SELECT ${MESSAGE_COLUMNS} FROM session_message m WHERE ${where}`, params)
      for (const r of rows) out.push(toUsageRow(r))
      report(rows.length, performance.now() - t0)
      await yieldToLoop()
    }
    return out
  }

  const until = opts.untilMs ?? Number.MAX_SAFE_INTEGER
  let lastTime = opts.sinceMs ?? 0
  let lastRowid = -1
  let limit = 500
  const sql = `SELECT ${MESSAGE_COLUMNS} FROM session_message m
    WHERE m.type = 'assistant' AND m.time_created >= ? AND (m.time_created > ? OR m.rowid > ?) AND m.time_created < ?
    ORDER BY m.time_created, m.rowid LIMIT ?`
  for (;;) {
    const t0 = performance.now()
    const rows = db.all(sql, [lastTime, lastTime, lastRowid, until, limit])
    const ms = performance.now() - t0
    for (const r of rows) out.push(toUsageRow(r))
    report(rows.length, ms)
    if (rows.length < limit) break
    const last = rows[rows.length - 1]
    lastTime = num(last.created)
    lastRowid = num(last.rid)
    limit = Math.round(Math.min(CHUNK_MAX, Math.max(CHUNK_MIN, limit * (CHUNK_TARGET_MS / Math.max(ms, 1)))))
    await yieldToLoop()
  }
  return out
}

function loadSessions(db: SqlDb, ids?: string[]): SessionRow[] {
  if (!ids) return db.all(`SELECT ${SESSION_COLUMNS} FROM session_v2`).map(toSessionRow)
  const out: SessionRow[] = []
  const unique = Array.from(new Set(ids))
  for (let i = 0; i < unique.length; i += 500) {
    const batch = unique.slice(i, i + 500)
    const rows = db.all(`SELECT ${SESSION_COLUMNS} FROM session_v2 WHERE id IN (${batch.map(() => "?").join(",")})`, batch)
    out.push(...rows.map(toSessionRow))
  }
  return out
}

/** Opened, schema-checked handle. Callers must close() it. */
export interface UsageSqliteSource {
  /** Session plus all descendants (root first); null when the session is not in this DB. */
  family(sessionID: string): string[] | null
  /** True when every id exists in session_v2 (guards against a TUI attached to a remote server). */
  hasSessions(ids: string[]): boolean
  load(opts: SqliteLoadOptions): Promise<LoadResult>
  close(): void
}

export function openUsageSqliteSource(db?: SqlDb | null): UsageSqliteSource | null {
  let handle = db ?? null
  if (!handle) {
    const path = usageDbPath()
    if (!path) return null
    handle = openReadonlyDb(path)
  }
  if (!handle) return null
  if (!hasUsageSchema(handle)) {
    try { handle.close() } catch { /* ignore */ }
    return null
  }
  const h = handle
  return {
    family(sessionID) {
      const rows = h.all(
        `WITH RECURSIVE fam(id, depth) AS (
           SELECT id, 0 FROM session_v2 WHERE id = ?
           UNION SELECT s.id, fam.depth + 1 FROM session_v2 s JOIN fam ON s.parent_id = fam.id WHERE fam.depth < 64
         ) SELECT id FROM fam ORDER BY depth`,
        [sessionID],
      )
      if (rows.length === 0) return null
      return Array.from(new Set(rows.map((r: any) => String(r.id))))
    },
    hasSessions(ids) {
      const unique = Array.from(new Set(ids))
      if (unique.length === 0) return true
      const rows = h.all(`SELECT count(*) AS n FROM session_v2 WHERE id IN (${unique.map(() => "?").join(",")})`, unique)
      return Number(rows[0]?.n) === unique.length
    },
    async load(opts) {
      const rows = await loadRows(h, opts)
      const sessions = loadSessions(h, opts.sessionIds)
      return { sessions, rows }
    },
    close() {
      try { h.close() } catch { /* ignore */ }
    },
  }
}
