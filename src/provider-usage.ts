// provider-usage.ts - Provider quota/usage checks: OpenCode Go, DeepSeek, Codex.
//
// Facts (verified against OpenChamber quota providers):
//   - OpenCode Go: GET https://opencode.ai/zen/go/v1/usage (Bearer API key),
//     payload.usage.rolling/weekly/monthly, each item has percent + resetsAt.
//     auth aliases: opencode-go / opencode / zen.
//   - DeepSeek: GET https://api.deepseek.com/user/balance (Bearer key),
//     balance_infos -> prefer USD, fall back to CNY.
//   - Codex: GET https://chatgpt.com/backend-api/wham/usage (Bearer access
//     token from the OpenCode V2 credential table, integration ids
//     openai/codex/chatgpt, optional ChatGPT-Account-Id), parse
//     rate_limit.primary_window/secondary_window + credits. No cookies required.
//
// Never logs/returns secrets. Results carry status only.

import {
  resolveCredential,
} from "./credentials.js"

export const PROVIDER_TIMEOUT_MS = 15_000

export interface UsageWindow {
  label: string
  percent: number | null
  resetsAt: string | null
  valueLabel: string | null
}

export interface ProviderUsageResult {
  providerId: "opencode-go" | "deepseek" | "codex"
  providerName: string
  configured: boolean
  ok: boolean
  /** Short human status line (no secrets). */
  status: string
  error?: string
  windows?: UsageWindow[]
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

function fetchWithTimeout(url: string, init: RequestInit, fetchImpl: FetchLike, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetchImpl(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

function parseError(body: string | null): string | null {
  if (!body) return null
  try {
    const data = JSON.parse(body)
    const msg = data?.error?.message ?? data?.message ?? data?.detail
    if (typeof msg === "string" && msg.trim()) return msg.slice(0, 200)
  } catch { /* non-JSON */ }
  return null
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0"
  return String(n)
}

// ── OpenCode Go ──

const OPENCODE_GO_ALIASES = ["opencode-go", "opencode", "zen"]
export const OPENCODE_GO_ENV_KEYS = ["OPENCODE_GO_API_KEY", "OPENCODE_API_KEY"]
export const OPENCODE_GO_URL = "https://opencode.ai/zen/go/v1/usage"

export interface OpenCodeGoPayload {
  usage?: Record<string, { percent?: number; resetsAt?: string }>
}

/** Parse the OpenCode Go usage API payload into usage windows. */
export function parseOpenCodeGoUsage(payload: unknown): UsageWindow[] {
  const usage = (payload && typeof payload === "object" ? (payload as OpenCodeGoPayload).usage : null) ?? null
  if (!usage || typeof usage !== "object") return []
  const out: UsageWindow[] = []
  const order: Array<[string, string]> = [
    ["rolling", "Rolling"],
    ["weekly", "Weekly"],
    ["monthly", "Monthly"],
  ]
  for (const [key, label] of order) {
    const entry = (usage as Record<string, { percent?: number; resetsAt?: string }>)[key]
    if (!entry || typeof entry !== "object") continue
    const percent = entry.percent
    if (typeof percent !== "number" || !Number.isFinite(percent)) continue
    const resetsAt = typeof entry.resetsAt === "string" ? entry.resetsAt : null
    if (resetsAt != null && !Number.isFinite(new Date(resetsAt).getTime())) continue
    out.push({
      label,
      percent: Math.min(100, Math.max(0, percent)),
      resetsAt,
      valueLabel: `${percent.toFixed(1)}% used`,
    })
  }
  return out
}

export async function fetchOpenCodeGoUsage(apiKey: string, fetchImpl: FetchLike = fetch): Promise<UsageWindow[]> {
  const response = await fetchWithTimeout(
    OPENCODE_GO_URL,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "opencode-usage-stat",
      },
    },
    fetchImpl,
  )
  if (response.status === 401 || response.status === 403) {
    throw new Error("OpenCode Go authentication failed")
  }
  if (!response.ok) {
    throw new Error(`OpenCode Go usage API returned HTTP ${response.status}`)
  }
  const windows = parseOpenCodeGoUsage(await response.json().catch(() => null))
  if (windows.length === 0) throw new Error("OpenCode Go usage data could not be parsed")
  return windows
}

// ── DeepSeek ──

export const DEEPSEEK_ALIASES = ["deepseek"]
export const DEEPSEEK_ENV_KEYS = ["DEEPSEEK_API_KEY"]
export const DEEPSEEK_URL = "https://api.deepseek.com/user/balance"

export interface DeepSeekPayload {
  balance_infos?: Array<{ currency?: string; total_balance?: string | number }>
  is_available?: boolean
}

/** Parse DeepSeek balance, preferring USD then CNY. */
export function parseDeepSeekBalance(payload: unknown): UsageWindow[] {
  const data = (payload && typeof payload === "object" ? payload as DeepSeekPayload : null)
  const infos = Array.isArray(data?.balance_infos) ? data!.balance_infos : []
  const pick = infos.find(i => i?.currency === "USD") ?? infos.find(i => i?.currency === "CNY") ?? null
  if (!pick) return []
  const raw = pick.total_balance
  const balance = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN
  if (!Number.isFinite(balance)) return []
  const isCny = pick.currency === "CNY"
  const symbol = isCny ? "¥" : "$"
  return [{
    label: "Balance",
    percent: null,
    resetsAt: null,
    valueLabel: `${symbol}${balance.toFixed(2)}${isCny ? " CNY" : ""}`,
  }]
}

export async function fetchDeepSeekBalance(apiKey: string, fetchImpl: FetchLike = fetch): Promise<UsageWindow[]> {
  const response = await fetchWithTimeout(
    DEEPSEEK_URL,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Accept-Encoding": "identity",
      },
    },
    fetchImpl,
  )
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    const parsed = parseError(body)
    if (response.status === 401 || response.status === 403) {
      throw new Error("DeepSeek session expired — re-authenticate")
    }
    throw new Error(parsed ?? `DeepSeek API error: ${response.status}`)
  }
  const windows = parseDeepSeekBalance(await response.json().catch(() => null))
  if (windows.length === 0) throw new Error("DeepSeek balance data could not be parsed")
  return windows
}

// ── Codex (OpenAI/ChatGPT) ──

export const CODEX_ALIASES = ["openai", "codex", "chatgpt"]
export const CODEX_ENV_KEYS: string[] = [] // Codex needs the OAuth access token from the credential DB
export const CODEX_URL = "https://chatgpt.com/backend-api/wham/usage"

export interface CodexPayload {
  rate_limit?: {
    primary_window?: { used_percent?: number; limit_window_seconds?: number; reset_at?: string | number }
    secondary_window?: { used_percent?: number; limit_window_seconds?: number; reset_at?: string | number }
  }
  credits?: { balance?: number; unlimited?: boolean }
  spend_control?: { individual_limit?: { used?: number; limit?: number; used_percent?: number } }
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value)
  return null
}

function windowLabelFromSeconds(seconds: number | null): string {
  if (seconds == null) return "Window"
  const hours = seconds / 3600
  if (hours >= 24 && hours % 24 === 0) return `${hours / 24}d`
  if (hours >= 1) return `${hours}h`
  return `${seconds}s`
}

function toResetTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value
    return new Date(milliseconds).toISOString()
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return toResetTimestamp(numeric)
    const milliseconds = Date.parse(value)
    if (Number.isFinite(milliseconds)) return new Date(milliseconds).toISOString()
  }
  return null
}

/** Parse the ChatGPT wham/usage payload. */
export function parseCodexUsage(payload: unknown): UsageWindow[] {
  const data = (payload && typeof payload === "object" ? payload as CodexPayload : null)
  if (!data) return []
  const out: UsageWindow[] = []
  const primary = data.rate_limit?.primary_window
  if (primary) {
    const percent = toNumber(primary.used_percent)
    const seconds = toNumber(primary.limit_window_seconds)
    out.push({
      label: windowLabelFromSeconds(seconds),
      percent: percent != null ? Math.min(100, Math.max(0, percent)) : null,
      resetsAt: toResetTimestamp(primary.reset_at),
      valueLabel: percent != null ? `${percent.toFixed(1)}% used` : null,
    })
  }
  const secondary = data.rate_limit?.secondary_window
  if (secondary) {
    const percent = toNumber(secondary.used_percent)
    const seconds = toNumber(secondary.limit_window_seconds)
    out.push({
      label: windowLabelFromSeconds(seconds),
      percent: percent != null ? Math.min(100, Math.max(0, percent)) : null,
      resetsAt: toResetTimestamp(secondary.reset_at),
      valueLabel: percent != null ? `${percent.toFixed(1)}% used` : null,
    })
  }
  if (data.credits) {
    const balance = toNumber(data.credits.balance)
    const unlimited = Boolean(data.credits.unlimited)
    out.push({
      label: "Credits",
      percent: null,
      resetsAt: null,
      valueLabel: unlimited ? "Unlimited" : balance != null ? `$${balance.toFixed(2)}` : null,
    })
  }
  if (data.spend_control?.individual_limit) {
    const sl = data.spend_control.individual_limit
    const used = toNumber(sl.used)
    const limit = toNumber(sl.limit)
    const percent = toNumber(sl.used_percent)
    out.push({
      label: "Spend Limit",
      percent: percent != null ? Math.min(100, Math.max(0, percent)) : null,
      resetsAt: null,
      valueLabel: used != null && limit != null ? `${fmtNum(used)} / ${fmtNum(limit)} used` : null,
    })
  }
  return out
}

export async function fetchCodexUsage(accessToken: string, accountId: string | null, fetchImpl: FetchLike = fetch): Promise<UsageWindow[]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  }
  if (accountId) headers["ChatGPT-Account-Id"] = accountId
  const response = await fetchWithTimeout(CODEX_URL, { method: "GET", headers }, fetchImpl)
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    const parsed = parseError(body)
    if (response.status === 401) {
      throw new Error("Codex session expired — re-authenticate with OpenAI")
    }
    throw new Error(parsed ?? `Codex API error: ${response.status}`)
  }
  const windows = parseCodexUsage(await response.json().catch(() => null))
  if (windows.length === 0) throw new Error("Codex usage data could not be parsed")
  return windows
}

// ── Orchestration ──

interface ProviderSpec {
  id: "opencode-go" | "deepseek" | "codex"
  name: string
  aliases: string[]
  envKeys: string[]
}

const PROVIDERS: ProviderSpec[] = [
  { id: "opencode-go", name: "OpenCode Go", aliases: OPENCODE_GO_ALIASES, envKeys: OPENCODE_GO_ENV_KEYS },
  { id: "deepseek", name: "DeepSeek", aliases: DEEPSEEK_ALIASES, envKeys: DEEPSEEK_ENV_KEYS },
  { id: "codex", name: "Codex", aliases: CODEX_ALIASES, envKeys: CODEX_ENV_KEYS },
]

export const USAGE_STAT_PROVIDER_IDS = PROVIDERS.map(p => p.id)

export interface CredentialResolver {
  (spec: { aliases: string[]; envKeys: string[] }): {
    value: string | null
    accountId: string | null
    source: "sqlite" | "env" | "dotenv" | null
  }
}

/** Default resolver: reads the OpenCode V2 credential DB / env / .env. */
export const defaultCredentialResolver: CredentialResolver = (spec) => resolveCredential(spec)

/**
 * Resolve secret (kept private) and fetch provider usage.
 * `getCredential` is injectable for tests (defaults to the real resolver).
 */
export async function checkProviderUsage(
  providerId: "opencode-go" | "deepseek" | "codex",
  fetchImpl: FetchLike = fetch,
  getCredential: CredentialResolver = defaultCredentialResolver,
): Promise<ProviderUsageResult> {
  const spec = PROVIDERS.find(p => p.id === providerId)
  if (!spec) return { providerId, providerName: providerId, configured: false, ok: false, status: "Unknown provider" }

  const resolved = getCredential({ aliases: spec.aliases, envKeys: spec.envKeys })
  const secret = resolved.value
  if (!secret) {
    return {
      providerId: spec.id,
      providerName: spec.name,
      configured: false,
      ok: false,
      status: `${spec.name} — not configured`,
      error: "Not configured",
    }
  }

  try {
    let windows: UsageWindow[]
    if (spec.id === "opencode-go") {
      windows = await fetchOpenCodeGoUsage(secret, fetchImpl)
    } else if (spec.id === "deepseek") {
      windows = await fetchDeepSeekBalance(secret, fetchImpl)
    } else {
      windows = await fetchCodexUsage(secret, resolved.accountId, fetchImpl)
    }
    return {
      providerId: spec.id,
      providerName: spec.name,
      configured: true,
      ok: true,
      status: summarize(spec.name, windows),
      windows,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed"
    return {
      providerId: spec.id,
      providerName: spec.name,
      configured: true,
      ok: false,
      status: `${spec.name} — ${message}`,
      error: message,
    }
  }
}

function summarize(name: string, windows: UsageWindow[]): string {
  const first = windows[0]
  if (!first) return `${name} — no data`
  if (first.valueLabel) {
    if (first.resetsAt) {
      return `${name} — ${first.valueLabel} · resets ${formatReset(first.resetsAt)}`
    }
    return `${name} — ${first.valueLabel}`
  }
  if (first.percent != null) {
    const suffix = first.resetsAt ? ` · resets ${formatReset(first.resetsAt)}` : ""
    return `${name} — ${first.percent.toFixed(0)}%${suffix}`
  }
  return name
}

function formatReset(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  const now = Date.now()
  const diff = d.getTime() - now
  if (diff <= 0) return "soon"
  const hours = diff / 3_600_000
  if (hours < 48 && hours > 24) return `${Math.round(hours / 24)}d`
  if (hours < 24) {
    const mins = Math.max(1, Math.round(diff / 60_000))
    if (mins < 60) return `${mins}m`
    return `${Math.round(hours)}h`
  }
  return `${Math.round(hours / 24)}d`
}

export type ProviderUsageConfig = Record<"opencode-go" | "deepseek" | "codex", boolean>

/** Provider polling is opt-in; omitted or non-boolean values remain disabled. */
export function resolveProviderUsageConfig(options: unknown): ProviderUsageConfig {
  const source = options && typeof options === "object"
    ? (options as Record<string, unknown>).providerUsage
    : null
  const value = source && typeof source === "object" ? source as Record<string, unknown> : {}
  return {
    "opencode-go": value["opencode-go"] === true,
    deepseek: value.deepseek === true,
    codex: value.codex === true,
  }
}
