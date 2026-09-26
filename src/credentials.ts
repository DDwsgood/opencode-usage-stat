// credentials.ts - Secure credential resolution for provider usage checks.
//
// Resolution order:
//   1. OpenCode V2 credential table (~/.local/share/opencode/opencode.db)
//   2. OpenCode OAuth auth file (~/.local/share/opencode/auth.json)
//   3. process.env (DEEPSEEK_API_KEY, OPENCODE_GO_API_KEY / OPENCODE_API_KEY, ...)
//   4. Safe .env parse: homedir/.env, then each ancestor of cwd, then an inferred
//      WSL Windows home .env (never a hardcoded user path).
//
// NEVER log, print, copy, or write out secret values. Only booleans/status are
// surfaced to callers.

import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, parse as parsePath } from "node:path"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"

export interface AuthEntry {
  type?: string
  key?: string
  token?: string
  access?: string
  refresh?: string
  expires?: number
  accountId?: string | null
}

function getDataHome(): string {
  const xdg = process.env.XDG_DATA_HOME
  if (xdg && xdg.trim()) return xdg.trim()
  return join(homedir(), ".local", "share")
}

function getConfigHome(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg && xdg.trim()) return xdg.trim()
  return join(homedir(), ".config")
}

export function credentialDatabasePath(): string {
  const configured = process.env.OPENCODE_DB?.trim()
  if (configured && isAbsolute(configured)) return configured
  return join(getDataHome(), "opencode", configured || "opencode.db")
}

export function parseCredentialValue(raw: unknown): AuthEntry | null {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw
    if (!value || typeof value !== "object") return null
    const entry = value as Record<string, unknown>
    const metadata = entry.metadata && typeof entry.metadata === "object"
      ? entry.metadata as Record<string, unknown>
      : null
    const text = (candidate: unknown) => typeof candidate === "string" && candidate.trim() ? candidate : undefined

    // Common accountId shapes across OpenCode/OpenAI OAuth records. Only plain
    // string ids are accepted — never part of the secret itself.
    const accountId = text(entry.accountId)
      ?? text(entry.accountID)
      ?? text(entry.account_id)
      ?? text(entry["account-id"])
      ?? text(metadata?.accountId)
      ?? text(metadata?.accountID)
      ?? text(metadata?.account_id)
      ?? (entry.account && typeof entry.account === "object"
        ? text((entry.account as Record<string, unknown>).id)
            ?? text((entry.account as Record<string, unknown>).accountId)
            ?? text((entry.account as Record<string, unknown>).account_id)
        : undefined)

    const expiresRaw = entry.expires
    let expires: number | undefined
    if (typeof expiresRaw === "number" && Number.isFinite(expiresRaw)) {
      expires = expiresRaw
    } else if (typeof expiresRaw === "string" && expiresRaw.trim() !== "" && Number.isFinite(Number(expiresRaw))) {
      expires = Number(expiresRaw)
    }
    // Normalize epoch seconds to milliseconds (ResolvedCredential.expires is ms).
    if (expires != null && expires > 0 && expires < 1e12) {
      expires *= 1000
    }

    return {
      type: text(entry.type),
      key: text(entry.key),
      token: text(entry.token),
      access: text(entry.access),
      refresh: text(entry.refresh) as string | undefined,
      expires,
      accountId: accountId ?? null,
    }
  } catch {
    return null
  }
}

// ── auth.json (~/.local/share/opencode/auth.json) ──

export function authJsonPath(): string {
  return join(getDataHome(), "opencode", "auth.json")
}

/** Read the OpenCode OAuth auth file. Returns {} on any failure; never throws. */
export function readAuthJson(): Record<string, unknown> {
  try {
    const file = authJsonPath()
    if (!existsSync(file)) return {}
    const content = readFileSync(file, "utf8").trim()
    if (!content) return {}
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== "object") return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

function normalizeAuthEntry(entry: unknown): AuthEntry | null {
  if (!entry) return null
  if (typeof entry === "string") return parseCredentialValue(JSON.stringify({ token: entry }))
  if (typeof entry === "object") {
    if ((entry as Record<string, unknown>).oauth && typeof (entry as Record<string, unknown>).oauth === "object") {
      return parseCredentialValue((entry as Record<string, unknown>).oauth)
    }
    return parseCredentialValue(entry)
  }
  return null
}

/** First matching, non-empty auth.json entry for `aliases` (in order). */
export function authJsonEntry(aliases: string[]): AuthEntry | null {
  if (aliases.length === 0) return null
  const auth = readAuthJson()
  for (const alias of aliases) {
    const raw = auth[alias]
    const entry = raw ? normalizeAuthEntry(raw) : null
    if (entry && isNonEmpty(entry.key ?? entry.token ?? entry.access ?? entry.refresh)) return entry
  }
  return null
}

/**
 * Secure per-provider credential JSON (cookies / refresh tokens that never go
 * through env). Checked in order:
 *   1. ~/.config/openchamber/quota/<id>.json   (reuse OpenChamber credentials)
 *   2. ~/.config/opencode/usage-stat/<id>.json (this plugin's own store, 0600)
 */
export function readSecureProviderJson(providerId: string): Record<string, unknown> | null {
  const candidates = [
    join(getConfigHome(), "openchamber", "quota", `${providerId}.json`),
    join(getConfigHome(), "opencode", "usage-stat", `${providerId}.json`),
  ]
  for (const file of candidates) {
    try {
      if (!existsSync(file)) continue
      const content = readFileSync(file, "utf8").trim()
      if (!content) continue
      const parsed = JSON.parse(content)
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>
    } catch { /* ignore */ }
  }
  return null
}

export interface DevinCredentials {
  apiKey: string | null
  apiServerUrl: string | null
}

/**
 * Devin (opencode-devin-v2 plugin) credentials, read only from that plugin's
 * own store: <XDG_CONFIG_HOME>/opencode-devin-v2/credentials.json with
 * `{ "apiKey": "...", "apiServerUrl": "https://..." }`. Never logged.
 */
export function readDevinCredentials(): DevinCredentials | null {
  try {
    const file = join(getConfigHome(), "opencode-devin-v2", "credentials.json")
    if (!existsSync(file)) return null
    const content = readFileSync(file, "utf8").trim()
    if (!content) return null
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== "object") return null
    const data = parsed as Record<string, unknown>
    const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
    return { apiKey: text(data.apiKey), apiServerUrl: text(data.apiServerUrl) }
  } catch {
    return null
  }
}

interface CredentialRow {
  integration_id: string
  value: string
  time_updated: number
}

function sqliteCredential(aliases: string[]): AuthEntry | null {
  if (aliases.length === 0) return null
  const path = credentialDatabasePath()
  if (!existsSync(path)) return null
  const placeholders = aliases.map(() => "?").join(",")
  const sql = `SELECT integration_id, value, time_updated FROM credential WHERE integration_id IN (${placeholders})`
  let database: any
  try {
    const require = createRequire(join(homedir(), ".opencode", "usage-stat-require.cjs"))
    let rows: CredentialRow[]
    if (typeof (globalThis as any).Bun !== "undefined") {
      const { Database } = require("bun:sqlite")
      database = new Database(path, { readonly: true })
      rows = database.query(sql).all(...aliases) as CredentialRow[]
    } else {
      const { DatabaseSync } = require("node:sqlite")
      database = new DatabaseSync(path, { readOnly: true })
      rows = database.prepare(sql).all(...aliases) as CredentialRow[]
    }
    rows.sort((a, b) => aliases.indexOf(a.integration_id) - aliases.indexOf(b.integration_id) || (b.time_updated ?? 0) - (a.time_updated ?? 0))
    for (const row of rows) {
      const entry = parseCredentialValue(row.value)
      if (entry && isNonEmpty(entry.key ?? entry.token ?? entry.access)) return entry
    }
  } catch {
    return null
  } finally {
    try { database?.close() } catch { /* ignore */ }
  }
  return null
}

// ── .env parsing (safe, minimal, no shell evaluation) ──

export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    // Strip matching surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) out[key] = value
  }
  return out
}

function candidateEnvDirs(): string[] {
  const dirs: string[] = []
  const home = homedir()
  if (home && !dirs.includes(home)) dirs.push(home)
  // cwd ancestors
  try {
    let dir = process.cwd()
    for (let i = 0; i < 10 && dir; i++) {
      if (!dirs.includes(dir)) dirs.push(dir)
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch { /* ignore */ }
  // WSL: infer Windows home .env without hardcoding a user path.
  // Use %USERPROFILE% if exported, else parse /etc/passwd style via USER env.
  try {
    const winHome = process.env.USERPROFILE
    if (winHome && winHome.includes(":\\")) {
      const wslHome = inferWslHome(winHome)
      if (wslHome && !dirs.includes(wslHome)) dirs.push(wslHome)
    }
  } catch { /* ignore */ }
  return dirs
}

/**
 * Convert a Windows path like C:\Users\foo to a WSL path if possible.
 * Uses `wslpath` when available; otherwise falls back to /mnt/c/... .
 */
function inferWslHome(winPath: string): string | null {
  const drive = /^([A-Za-z]):\\(.*)$/.exec(winPath)
  if (!drive) return null
  const [, letter, rest] = drive
  const unixRest = rest.replace(/\\/g, "/")
  try {
    const out = execFileSync("wslpath", ["-u", winPath], { encoding: "utf8", timeout: 3000 }).trim()
    if (out.startsWith("/")) return out
  } catch { /* wslpath unavailable */ }
  return `/mnt/${letter.toLowerCase()}/${unixRest}`
}

/** Load merged .env values from candidate dirs (first found wins per key). */
function loadDotEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const dir of candidateEnvDirs()) {
    const file = join(dir, ".env")
    try {
      if (!existsSync(file)) continue
      const parsed = parseEnvFile(readFileSync(file, "utf8"))
      for (const [k, v] of Object.entries(parsed)) {
        if (!(k in out)) out[k] = v
      }
    } catch { /* ignore */ }
  }
  return out
}

/** True when running under WSL (Microsoft kernel). */
export function isWsl(): boolean {
  try {
    const release = readFileSync("/proc/version", "utf8").toLowerCase()
    return release.includes("microsoft") || release.includes("wsl")
  } catch {
    return false
  }
}

/**
 * Windows username inference for generic WSL .env discovery.
 * Uses env only — never a hardcoded absolute user path.
 */
export function windowsUsername(): string | null {
  const userprofile = process.env.USERPROFILE
  if (userprofile) {
    try {
      const { name } = parsePath(userprofile)
      if (name) return name
    } catch { /* ignore */ }
  }
  const u = process.env.USER || process.env.USERNAME
  return u || null
}

// ── Public resolution API ──

export interface ResolvedCredential {
  /** Primary secret, if available. Stays in memory; never logged. */
  value: string | null
  /** accountId for Codex/OpenAI style entries. */
  accountId: string | null
  /** OAuth refresh token when the source entry carries one (auth.json only). */
  refresh: string | null
  /** Access-token expiry (epoch ms) when known. */
  expires: number | null
  /** Which source the secret came from (used only to surface "configured" status). */
  source: "sqlite" | "auth" | "env" | "dotenv" | null
}

function isNonEmpty(s: string | null | undefined): s is string {
  return typeof s === "string" && s.trim().length > 0
}

/**
 * Resolve a credential for `aliases` (SQLite integration IDs, ordered by priority).
 * Falls back to env vars and then safe .env files.
 */
export function resolveCredential(opts: {
  aliases: string[]
  envKeys: string[]
}): ResolvedCredential {
  // 1. OpenCode V2 SQLite credential store
  const entry = sqliteCredential(opts.aliases)
  if (entry) {
    const value = entry.key ?? entry.token ?? entry.access ?? null
    if (isNonEmpty(value)) {
      return {
        value,
        accountId: isNonEmpty(entry.accountId) ? entry.accountId : null,
        refresh: isNonEmpty(entry.refresh) ? entry.refresh : null,
        expires: typeof entry.expires === "number" ? entry.expires : null,
        source: "sqlite",
      }
    }
  }
  // 2. OpenCode OAuth auth.json (~/.local/share/opencode/auth.json)
  const authEntry = authJsonEntry(opts.aliases)
  if (authEntry) {
    const value = authEntry.key ?? authEntry.token ?? authEntry.access ?? null
    if (isNonEmpty(value)) {
      return {
        value,
        accountId: isNonEmpty(authEntry.accountId) ? authEntry.accountId : null,
        refresh: isNonEmpty(authEntry.refresh) ? authEntry.refresh : null,
        expires: typeof authEntry.expires === "number" ? authEntry.expires : null,
        source: "auth",
      }
    }
  }
  // 3. process.env
  for (const key of opts.envKeys) {
    const v = process.env[key]
    if (isNonEmpty(v)) {
      return { value: v, accountId: null, refresh: null, expires: null, source: "env" }
    }
  }
  // 4. .env (homedir + cwd ancestors + inferred WSL Windows home)
  const dot = loadDotEnv()
  for (const key of opts.envKeys) {
    const v = dot[key]
    if (isNonEmpty(v)) {
      return { value: v, accountId: null, refresh: null, expires: null, source: "dotenv" }
    }
  }
  return { value: null, accountId: null, refresh: null, expires: null, source: null }
}

/** Whether this credential is configured without exposing the secret. */
export function isConfigured(opts: { aliases: string[]; envKeys: string[] }): boolean {
  return resolveCredential(opts).value !== null
}
