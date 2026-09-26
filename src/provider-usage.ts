// provider-usage.ts - Provider quota/usage checks.
//
// Providers (all opt-in via plugin config `providerUsage.<id> = true`):
//   - opencode-go   GET https://opencode.ai/zen/go/v1/usage (API key)
//   - deepseek      GET https://api.deepseek.com/user/balance (API key)
//   - codex         GET https://chatgpt.com/backend-api/wham/usage (OAuth token)
//   - claude        GET https://api.anthropic.com/api/oauth/usage (OAuth token,
//                   anthropic-beta: oauth-2025-04-20) -> 5h / 7d windows
//   - kimi-for-coding  GET https://api.kimi.com/coding/v1/usages (API key)
//   - zai-coding-plan  GET https://api.z.ai/api/monitor/usage/quota/limit (API key)
//   - zhipuai-coding-plan GET https://open.bigmodel.cn/api/monitor/usage/quota/limit (API key)
//   - minimax-coding-plan / minimax-cn-coding-plan coding_plan/remains endpoints
//   - openrouter    GET https://openrouter.ai/api/v1/credits (API key)
//   - ollama-cloud  session cookie + HTML scrape of https://ollama.com/settings
//                   (cookie from a secure local JSON file, never env/logs)
//   - github-copilot / github-copilot-addon  copilot_internal/user quota snapshots
//   - google        Gemini CLI / Antigravity OAuth refresh + cloudcode-pa
//                   v1internal quota RPCs (per-model remaining fractions)
//   - xai           grok.com gRPC-web billing RPC (hand-rolled protobuf scan)
//   - cursor        POST api2.cursor.sh GetCurrentPeriodUsage (access token file)
//   - command-code  Command Code CLI alpha usage endpoints (API key)
//   - devin         opencode-devin-v2 seat quota via Codeium GetUserStatus RPC
//                   (key from that plugin's credentials.json; shown only when
//                   the devin plugin is installed and a devin model exists)
//
// Credentials resolve via the OpenCode V2 credential DB, ~/.local/share/opencode/auth.json,
// env vars and .env files; ollama-cloud/cursor use secure JSON files. Secrets are
// never logged or returned — results carry status only.

import { resolveCredential, readSecureProviderJson, readDevinCredentials, authJsonEntry } from "./credentials.js"
import type { ResolvedCredential } from "./credentials.js"
import { existsSync, readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { homedir } from "node:os"
import { formatResetDuration } from "./formatter.js"

/** Relative reset formatting shared with the UI ("5m"/"3h"/"2d"/"now"). */
export { formatResetDuration as formatReset }

export const PROVIDER_TIMEOUT_MS = 15_000

export interface UsageWindow {
  label: string
  percent: number | null
  resetsAt: string | null
  valueLabel: string | null
}

export interface ProviderUsageResult {
  providerId: ProviderId
  providerName: string
  configured: boolean
  ok: boolean
  /** Short human status line (no secrets). */
  status: string
  error?: string
  windows?: UsageWindow[]
  planLabel?: string | null
}

/** How collapsed headers present usage percentages. */
export type UsageDisplayMode = "used" | "remaining"

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

async function errorFrom(response: Response, label: string, authMessage?: string): Promise<Error> {
  if ((response.status === 401 || response.status === 403) && authMessage) return new Error(authMessage)
  const body = await response.text().catch(() => "")
  const parsed = parseError(body)
  return new Error(parsed ?? `${label} API error: ${response.status}`)
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0"
  return String(n)
}

function clampPct(n: number): number {
  return Math.min(100, Math.max(0, n))
}

function pct(used: unknown, total: unknown): number | null {
  const u = toNumber(used)
  const t = toNumber(total)
  if (u == null || t == null || t <= 0) return null
  return clampPct((u / t) * 100)
}

function fmtMoney(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null
  return value.toFixed(2)
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value)
  return null
}
export { toNumber }

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/** Normalize epoch seconds/millis or ISO strings into an ISO timestamp string. */
function toResetTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value
    // Unrepresentable or absurd timestamps must not throw on toISOString().
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null
    const date = new Date(milliseconds)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return toResetTimestamp(numeric)
    const milliseconds = Date.parse(value)
    if (Number.isFinite(milliseconds)) return new Date(milliseconds).toISOString()
  }
  return null
}

function windowLabelFromSeconds(seconds: number | null): string {
  if (seconds == null) return "Window"
  const hours = seconds / 3600
  if (hours >= 24 && hours % 24 === 0) return `${hours / 24}d`
  if (hours >= 1) return `${hours}h`
  return `${seconds}s`
}

function windowLabel(duration: unknown, unit: unknown): string {
  const d = toNumber(duration)
  if (d == null) return "limit"
  if (unit === "TIME_UNIT_MINUTE") return `${d}m`
  if (unit === "TIME_UNIT_HOUR") return `${d}h`
  if (unit === "TIME_UNIT_DAY") return `${d}d`
  return "limit"
}

function windowSeconds(duration: unknown, unit: unknown): number | null {
  const d = toNumber(duration)
  if (d == null) return null
  if (unit === "TIME_UNIT_MINUTE") return d * 60
  if (unit === "TIME_UNIT_HOUR") return d * 3600
  if (unit === "TIME_UNIT_DAY") return d * 86400
  return null
}

function percentWindow(label: string, percent: unknown, resetMs: unknown, valueLabel: string | null = null): UsageWindow {
  const pctValue = toNumber(percent)
  return { label, percent: pctValue != null ? clampPct(pctValue) : null, resetsAt: toResetTimestamp(resetMs), valueLabel }
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
  const usage = asObject(asObject(payload)?.usage)
  if (!usage) return []
  const out: UsageWindow[] = []
  const order: Array<[string, string]> = [
    ["rolling", "Rolling"],
    ["weekly", "Weekly"],
    ["monthly", "Monthly"],
  ]
  for (const [key, label] of order) {
    const entry = asObject(usage[key])
    if (!entry) continue
    const percent = entry.percent
    if (typeof percent !== "number" || !Number.isFinite(percent)) continue
    const resetsAt = typeof entry.resetsAt === "string" ? entry.resetsAt : null
    if (resetsAt != null && !Number.isFinite(new Date(resetsAt).getTime())) continue
    out.push({
      label,
      percent: clampPct(percent),
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
  const infos = Array.isArray(asObject(payload)?.balance_infos) ? (payload as DeepSeekPayload).balance_infos! : []
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
    throw await errorFrom(response, "DeepSeek", "DeepSeek session expired — re-authenticate")
  }
  const windows = parseDeepSeekBalance(await response.json().catch(() => null))
  if (windows.length === 0) throw new Error("DeepSeek balance data could not be parsed")
  return windows
}

// ── Codex (OpenAI/ChatGPT) ──

export const CODEX_ALIASES = ["openai", "codex", "chatgpt"]
export const CODEX_ENV_KEYS: string[] = [] // Codex needs the OAuth access token from the credential store
export const CODEX_URL = "https://chatgpt.com/backend-api/wham/usage"

export interface CodexPayload {
  rate_limit?: {
    primary_window?: { used_percent?: number; limit_window_seconds?: number; reset_at?: string | number }
    secondary_window?: { used_percent?: number; limit_window_seconds?: number; reset_at?: string | number }
  }
  credits?: { balance?: number; unlimited?: boolean }
  spend_control?: { individual_limit?: { used?: number; limit?: number; used_percent?: number } }
}

/** Parse the ChatGPT wham/usage payload. */
export function parseCodexUsage(payload: unknown): UsageWindow[] {
  const data = asObject(payload) as CodexPayload | null
  if (!data) return []
  const out: UsageWindow[] = []
  const primary = data.rate_limit?.primary_window
  if (primary) {
    const percent = toNumber(primary.used_percent)
    const seconds = toNumber(primary.limit_window_seconds)
    out.push(percentWindow(windowLabelFromSeconds(seconds), percent, primary.reset_at,
      percent != null ? `${percent.toFixed(1)}% used` : null))
  }
  const secondary = data.rate_limit?.secondary_window
  if (secondary) {
    const percent = toNumber(secondary.used_percent)
    const seconds = toNumber(secondary.limit_window_seconds)
    out.push(percentWindow(windowLabelFromSeconds(seconds), percent, secondary.reset_at,
      percent != null ? `${percent.toFixed(1)}% used` : null))
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
    out.push(percentWindow("Spend Limit", sl.used_percent, null,
      used != null && limit != null ? `${fmtNum(used)} / ${fmtNum(limit)} used` : null))
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
    throw await errorFrom(response, "Codex", "Codex session expired — re-authenticate with OpenAI")
  }
  const windows = parseCodexUsage(await response.json().catch(() => null))
  if (windows.length === 0) throw new Error("Codex usage data could not be parsed")
  return windows
}

// ── Claude Pro / Max ──

export const CLAUDE_ALIASES = ["anthropic", "claude"]
export const CLAUDE_ENV_KEYS: string[] = [] // subscription quota needs the Claude Code OAuth access token
export const CLAUDE_URL = "https://api.anthropic.com/api/oauth/usage"

interface ClaudeLimit {
  kind?: string
  percent?: unknown
  resets_at?: unknown
  scope?: { model?: { display_name?: unknown } }
}

/**
 * Parse the Anthropic OAuth usage payload:
 *   limits[].kind = session -> 5h window, weekly_all -> 7d window,
 *   weekly_scoped -> per-model 7d rows; falls back to legacy five_hour/seven_day;
 *   spend (extra usage credits) becomes an "Extra Usage" row.
 */
export function parseClaudeUsage(payload: unknown): UsageWindow[] {
  const data = asObject(payload)
  if (!data) return []
  const out: UsageWindow[] = []
  const limits = Array.isArray(data.limits) ? data.limits as ClaudeLimit[] : []
  for (const limit of limits) {
    const item = asObject(limit) as ClaudeLimit | null
    if (!item) continue
    const percent = toNumber(item.percent)
    const resetAt = item.resets_at
    if (item.kind === "session") {
      out.push(percentWindow("5h", percent, resetAt))
    } else if (item.kind === "weekly_all") {
      out.push(percentWindow("7d", percent, resetAt))
    } else if (item.kind === "weekly_scoped") {
      const scopeModel = asObject(asObject(item.scope)?.model)
      const model = nonEmptyString(scopeModel?.display_name ?? item.scope)
      if (model) out.push(percentWindow(`7d · ${model}`, percent, resetAt))
    }
  }
  if (!limits.length) {
    const fiveHour = asObject(data.five_hour)
    const sevenDay = asObject(data.seven_day)
    if (fiveHour) out.push(percentWindow("5h", fiveHour.utilization, fiveHour.resets_at))
    if (sevenDay) out.push(percentWindow("7d", sevenDay.utilization, sevenDay.resets_at))
  }
  const spend = asObject(data.spend)
  if (spend?.enabled === true) {
    const usedMoney = asObject(spend.used)
    const limitMoney = asObject(spend.limit)
    const usedMinor = toNumber(usedMoney?.amount_minor)
    const limitMinor = toNumber(limitMoney?.amount_minor)
    const exponent = toNumber(usedMoney?.exponent) ?? 2
    const currency = nonEmptyString(usedMoney?.currency)
    const prefix = currency === "USD" || !currency ? "$" : `${currency} `
    const used = usedMinor === null ? null : usedMinor / 10 ** exponent
    const limit = limitMinor === null ? null : limitMinor / 10 ** (toNumber(limitMoney?.exponent) ?? 2)
    out.push(percentWindow("Extra Usage", spend.percent, null,
      used === null ? null : `${prefix}${fmtMoney(used)}${limit === null ? "" : ` / ${prefix}${fmtMoney(limit)}`}`))
  }
  // Drop per-model rows when they would duplicate the aggregate windows.
  return out.filter((w, i) => out.findIndex(o => o.label === w.label) === i)
}

export async function fetchClaudeUsage(accessToken: string, fetchImpl: FetchLike = fetch): Promise<UsageWindow[]> {
  const response = await fetchWithTimeout(CLAUDE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      Accept: "application/json",
    },
  }, fetchImpl)
  if (response.status === 429) throw new Error("Claude rate limited — retrying later")
  if (!response.ok) {
    throw await errorFrom(response, "Anthropic", "Claude session expired — re-authenticate with Claude Code")
  }
  const windows = parseClaudeUsage(await response.json().catch(() => null))
  if (windows.length === 0) throw new Error("Claude usage data could not be parsed")
  return windows
}

// ── Kimi for Coding ──

export const KIMI_ALIASES = ["kimi-for-coding", "kimi"]
export const KIMI_ENV_KEYS = ["KIMI_FOR_CODING_API_KEY", "KIMI_API_KEY"]
export const KIMI_URL = "https://api.kimi.com/coding/v1/usages"

/** Kimi blocks report either `used` or `remaining`; derive the percent from whichever exists. */
function computeKimiUsedPercent(total: unknown, used: unknown, remaining: unknown): number | null {
  const t = toNumber(total)
  if (t == null || t <= 0) return null
  const u = toNumber(used)
  if (u != null) return clampPct((u / t) * 100)
  const r = toNumber(remaining)
  if (r != null) return clampPct(100 - (r / t) * 100)
  return null
}

export function parseKimiUsage(payload: unknown): UsageWindow[] {
  const data = asObject(payload)
  if (!data) return []
  const out: UsageWindow[] = []
  const usage = asObject(data.usage)
  if (usage) {
    out.push(percentWindow("Weekly", computeKimiUsedPercent(usage.limit, usage.used, usage.remaining), usage.resetTime))
  }
  const limits = Array.isArray(data.limits) ? data.limits : []
  for (const raw of limits) {
    const limit = asObject(raw)
    if (!limit) continue
    const win = asObject(limit.window)
    const detail = asObject(limit.detail)
    const seconds = windowSeconds(win?.duration, win?.timeUnit)
    const rawLabel = windowLabel(win?.duration, win?.timeUnit)
    const label = seconds === 5 * 3600 ? `Rate Limit (${rawLabel})` : rawLabel
    out.push(percentWindow(label, computeKimiUsedPercent(detail?.limit, detail?.used, detail?.remaining), detail?.resetTime))
  }
  return out.filter(w => w.percent != null || w.resetsAt != null)
}

export async function fetchKimiUsage(apiKey: string, fetchImpl: FetchLike = fetch): Promise<UsageWindow[]> {
  const response = await fetchWithTimeout(KIMI_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  }, fetchImpl)
  if (!response.ok) {
    throw await errorFrom(response, "Kimi", "Kimi session expired — check your coding plan API key")
  }
  const windows = parseKimiUsage(await response.json().catch(() => null))
  if (windows.length === 0) throw new Error("Kimi usage data could not be parsed")
  return windows
}

// ── z.ai Coding Plan ──

export const ZAI_ALIASES = ["zai-coding-plan", "zai", "z.ai"]
export const ZAI_ENV_KEYS = ["ZAI_API_KEY", "Z_AI_API_KEY"]
export const ZAI_URL = "https://api.z.ai/api/monitor/usage/quota/limit"

const ZAI_TOKEN_WINDOW_SECONDS: Record<number, number> = {
  3: 3600,
  6: 7 * 86400,
}

function zaiWindowSeconds(limit: Record<string, unknown>): number | null {
  const number = toNumber(limit.number)
  const unitSeconds = ZAI_TOKEN_WINDOW_SECONDS[Number(limit.unit)]
  if (number == null || unitSeconds == null) return null
  return unitSeconds * number
}

function shortWindowLabel(seconds: number | null): string {
  if (!seconds) return "tokens"
  if (seconds % 86400 === 0) {
    const days = seconds / 86400
    return days === 7 ? "weekly" : `${days}d`
  }
  if (seconds % 3600 === 0) return `${seconds / 3600}h`
  return `${seconds}s`
}

function formatCreditAmount(value: number): string {
  if (value < 1000) return Math.round(value).toLocaleString("en-US")
  return `${Math.round(value / 100) / 10}k`
}

function zaiCreditValueLabel(limit: Record<string, unknown>): string | null {
  const used = toNumber(limit.currentValue)
  const total = toNumber(limit.usage)
  if (used == null || total == null) return null
  return `${formatCreditAmount(used)} / ${formatCreditAmount(total)} credits`
}

interface ZaiLimitsPayload {
  data?: { limits?: Array<Record<string, unknown>>; level?: string }
}

function parseZaiStyleUsage(payload: unknown, options: { tokensLabel: string }): { windows: UsageWindow[]; planLabel: string | null } {
  const data = (asObject(payload) as ZaiLimitsPayload | null)?.data
  const limits = Array.isArray(data?.limits) ? data!.limits! : []
  const windows: UsageWindow[] = []
  for (const limit of limits) {
    const type = limit?.type
    if (type !== "TOKENS_LIMIT" && type !== "CREDIT_LIMIT") continue
    const seconds = zaiWindowSeconds(limit)
    windows.push(percentWindow(shortWindowLabel(seconds), limit.percentage, limit.nextResetTime, zaiCreditValueLabel(limit)))
  }
  const mcp = limits.find(l => l?.type === "TIME_LIMIT")
  if (mcp) {
    windows.push(percentWindow("MCP Tools", mcp.percentage, mcp.nextResetTime))
  }
  void options
  return { windows, planLabel: nonEmptyString(data?.level) }
}

export function parseZaiUsage(payload: unknown): UsageWindow[] {
  return parseZaiStyleUsage(payload, { tokensLabel: "tokens" }).windows.filter(w => w.percent != null || w.valueLabel != null)
}

export async function fetchZaiUsage(apiKey: string, fetchImpl: FetchLike = fetch): Promise<{ windows: UsageWindow[]; planLabel: string | null }> {
  const response = await fetchWithTimeout(ZAI_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  }, fetchImpl)
  if (!response.ok) {
    throw await errorFrom(response, "z.ai", "z.ai session expired — check your coding plan API key")
  }
  const parsed = parseZaiStyleUsage(await response.json().catch(() => null), { tokensLabel: "tokens" })
  if (parsed.windows.length === 0) throw new Error("z.ai usage data could not be parsed")
  return parsed
}

// ── Zhipu (bigmodel.cn) Coding Plan ──

export const ZHIPUAI_ALIASES = ["zhipuai-coding-plan", "zhipu-coding-plan"]
export const ZHIPUAI_ENV_KEYS = ["ZHIPUAI_CODING_PLAN_API_KEY", "ZHIPU_API_KEY"]
export const ZHIPUAI_URL = "https://open.bigmodel.cn/api/monitor/usage/quota/limit"

export function parseZhipuaiUsage(payload: unknown): UsageWindow[] {
  const data = (asObject(payload) as ZaiLimitsPayload | null)?.data
  const limits = Array.isArray(data?.limits) ? data!.limits! : []
  const out: UsageWindow[] = []
  const tokens = limits.find(l => l?.type === "TOKENS_LIMIT")
  if (tokens) {
    out.push(percentWindow("Tokens", tokens.percentage, tokens.nextResetTime))
  }
  const mcp = limits.find(l => l?.type === "TIME_LIMIT")
  if (mcp) {
    out.push(percentWindow("MCP Tools", mcp.percentage, mcp.nextResetTime))
  }
  return out
}

export async function fetchZhipuaiUsage(apiKey: string, fetchImpl: FetchLike = fetch): Promise<UsageWindow[]> {
  const response = await fetchWithTimeout(ZHIPUAI_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  }, fetchImpl)
  if (!response.ok) {
    throw await errorFrom(response, "Zhipu", "Zhipu session expired — check your coding plan API key")
  }
  const windows = parseZhipuaiUsage(await response.json().catch(() => null))
  if (windows.length === 0) throw new Error("Zhipu usage data could not be parsed")
  return windows
}

// ── MiniMax Coding Plan (intl + cn) ──

export const MINIMAX_ALIASES = ["minimax-coding-plan", "minimax"]
export const MINIMAX_ENV_KEYS = ["MINIMAX_CODING_PLAN_API_KEY", "MINIMAX_API_KEY"]
export const MINIMAX_CN_ALIASES = ["minimax-cn-coding-plan"]
export const MINIMAX_CN_ENV_KEYS = ["MINIMAX_CN_CODING_PLAN_API_KEY", "MINIMAX_CN_API_KEY"]

export function parseMiniMaxUsage(payload: unknown, usageFieldsAreRemaining: boolean): UsageWindow[] {
  const data = asObject(payload)
  const baseResp = asObject(data?.base_resp)
  if (baseResp && toNumber(baseResp.status_code) !== 0) return []
  const remains = Array.isArray(data?.model_remains) ? data!.model_remains : []
  const model = asObject(remains[0])
  if (!model) return []
  let intervalTotal = toNumber(model.current_interval_total_count)
  let intervalValue = toNumber(model.current_interval_usage_count)
  let weeklyTotal = toNumber(model.current_weekly_total_count)
  let weeklyValue = toNumber(model.current_weekly_usage_count)
  if (usageFieldsAreRemaining) {
    intervalValue = intervalTotal != null && intervalValue != null ? intervalTotal - intervalValue : intervalValue
    weeklyValue = weeklyTotal != null && weeklyValue != null ? weeklyTotal - weeklyValue : weeklyValue
  }
  const out: UsageWindow[] = []
  const intervalPercent = pct(intervalValue, intervalTotal)
  const intervalStart = toNumber(model.start_time)
  const intervalEnd = toNumber(model.end_time)
  out.push(percentWindow("5h", intervalPercent, intervalEnd, intervalPercent != null ? `${intervalPercent.toFixed(0)}% used` : null))
  void intervalStart
  const weeklyPercent = pct(weeklyValue, weeklyTotal)
  out.push(percentWindow("weekly", weeklyPercent, model.weekly_end_time, weeklyPercent != null ? `${weeklyPercent.toFixed(0)}% used` : null))
  void weeklyTotal
  return out
}

function miniMaxFetcher(providerId: ProviderId, endpoint: string, usageFieldsAreRemaining: boolean) {
  return async (apiKey: string, fetchImpl: FetchLike = fetch): Promise<UsageWindow[]> => {
    const response = await fetchWithTimeout(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    }, fetchImpl)
    if (!response.ok) {
      throw await errorFrom(response, "MiniMax", "MiniMax session expired — check your coding plan API key")
    }
    const payload = await response.json().catch(() => null)
    const baseResp = asObject(asObject(payload)?.base_resp)
    if (baseResp && toNumber(baseResp.status_code) !== 0) {
      throw new Error(nonEmptyString(baseResp.status_msg) ?? `MiniMax API error: ${toNumber(baseResp.status_code)}`)
    }
    const windows = parseMiniMaxUsage(payload, usageFieldsAreRemaining)
    if (windows.every(w => w.percent == null)) throw new Error("MiniMax usage data could not be parsed")
    return windows
  }
}

// ── OpenRouter ──

export const OPENROUTER_ALIASES = ["openrouter"]
export const OPENROUTER_ENV_KEYS = ["OPENROUTER_API_KEY"]
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/credits"

export function parseOpenRouterCredits(payload: unknown): UsageWindow[] {
  const credits = asObject(asObject(payload)?.data)
  const totalCredits = toNumber(credits?.total_credits)
  const totalUsage = toNumber(credits?.total_usage)
  if (totalCredits == null && totalUsage == null) return []
  const remaining = totalCredits != null && totalUsage != null ? Math.max(0, totalCredits - totalUsage) : null
  const valueLabel = remaining != null && totalUsage != null
    ? `$${fmtMoney(remaining)} left · $${fmtMoney(totalUsage)} spent`
    : null
  return [{ label: "Credits", percent: null, resetsAt: null, valueLabel }]
}

export async function fetchOpenRouterCredits(apiKey: string, fetchImpl: FetchLike = fetch): Promise<UsageWindow[]> {
  const response = await fetchWithTimeout(OPENROUTER_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  }, fetchImpl)
  if (!response.ok) {
    throw await errorFrom(response, "OpenRouter", "OpenRouter authentication failed")
  }
  const windows = parseOpenRouterCredits(await response.json().catch(() => null))
  if (windows.length === 0) throw new Error("OpenRouter credit data could not be parsed")
  return windows
}

// ── Ollama Cloud (session cookie + settings page scrape) ──

export const OLLAMA_CLOUD_ALIASES = ["ollama-cloud", "ollama"]
export const OLLAMA_CLOUD_ENV_KEYS: string[] = [] // cookie comes from a secure local JSON file

export interface OllamaCloudCredential {
  cookie: string | null
}

/** Cookie from the plugin's own secure file or OpenChamber's shared one. */
export function resolveOllamaCloudCookie(): string | null {
  const data = readSecureProviderJson("ollama-cloud")
  const cookie = nonEmptyString(data?.cookie ?? data?.session)
  return cookie ?? null
}

/**
 * Parse https://ollama.com/settings HTML into usage windows. Fragile by design.
 * New billing (Sept 2026): "Monthly usage" meter, "$X of $Y used", reset via
 * data-time, plan badge after "Included usage", plus "Balance remaining".
 * Legacy billing: Session/Weekly percentages and "Premium requests N / M".
 */
export function parseOllamaSettingsHtml(html: string): UsageWindow[] {
  const out: UsageWindow[] = []
  // Plan badge: first "capitalize" chip following the "Included usage" heading.
  const planMatch = html.match(/Included\s+usage[\s\S]{0,300}?rounded-full[^>]*>\s*([A-Za-z0-9 ._-]+?)\s*</i)
  const planLabel = planMatch ? planMatch[1].trim() : null
  const monthly = html.match(/Monthly\s+usage[\s\S]{0,400}?\$\s*([0-9][0-9,.]*)\s*of\s*\$\s*([0-9][0-9,.]*)\s*used/i)
  if (monthly) {
    const used = Number(monthly[1].replace(/,/g, ""))
    const total = Number(monthly[2].replace(/,/g, ""))
    if (Number.isFinite(used) && Number.isFinite(total)) {
      const reset = html.match(/data-time="([^"]+)"[^>]*>\s*Resets in/i)
      const remaining = total - used
      out.push(percentWindow("Monthly", total > 0 ? clampPct((used / total) * 100) : null,
        reset ? reset[1] : null, `$${fmtMoney(remaining)} / $${fmtMoney(total)} left`))
    }
  }
  if (out.length === 0) {
    const sessionMatch = html.match(/Session\s+usage[^0-9]*([0-9.]+)%/i)
    if (sessionMatch) out.push(percentWindow("Session", toNumber(sessionMatch[1]), null))
    const weeklyMatch = html.match(/Weekly\s+usage[^0-9]*([0-9.]+)%/i)
    if (weeklyMatch) out.push(percentWindow("Weekly", toNumber(weeklyMatch[1]), null))
    const premiumMatch = html.match(/Premium[^0-9]*([0-9]+)\s*\/\s*([0-9]+)/i)
    if (premiumMatch) {
      const used = toNumber(premiumMatch[1]) ?? 0
      const total = toNumber(premiumMatch[2]) ?? 0
      out.push(percentWindow("Premium", total > 0 ? Math.min(100, (used / total) * 100) : null, null, `${used} / ${total}`))
    }
  }
  const balanceMatch = html.match(/Balance\s+remaining[\s\S]{0,200}?\$\s*([0-9][0-9,.]*)/i)
  if (balanceMatch) {
    const balance = Number(balanceMatch[1].replace(/,/g, ""))
    if (Number.isFinite(balance)) {
      out.push({ label: planLabel ? `Extra (${planLabel})` : "Extra", percent: null, resetsAt: null, valueLabel: `$${fmtMoney(balance)} left` })
    }
  }
  return out
}

export async function fetchOllamaCloudUsage(cookie: string, fetchImpl: FetchLike = fetch): Promise<UsageWindow[]> {
  const response = await fetchWithTimeout("https://ollama.com/settings", {
    method: "GET",
    headers: {
      Cookie: cookie,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept-Encoding": "identity",
    },
  }, fetchImpl)
  if (!response.ok) {
    throw await errorFrom(response, "Ollama Cloud", response.status === 403 || response.status === 401
      ? "Ollama Cloud cookie expired — update the saved session cookie"
      : undefined)
  }
  const windows = parseOllamaSettingsHtml(await response.text())
  if (windows.length === 0) throw new Error("Ollama Cloud usage data could not be parsed")
  return windows
}

// ── GitHub Copilot (+ Add-on) ──

export const COPILOT_ALIASES = ["github-copilot", "copilot", "github"]
export const COPILOT_ENV_KEYS: string[] = [] // needs the Copilot OAuth access token

interface QuotaSnapshot { entitlement?: unknown; remaining?: unknown }

export function buildCopilotWindows(payload: unknown): UsageWindow[] {
  const data = asObject(payload)
  const quota = asObject(data?.quota_snapshots)
  if (!quota) return []
  const resetAt = data?.quota_reset_date
  const add = (label: string, snapshotRaw: unknown): UsageWindow | null => {
    const snapshot = asObject(snapshotRaw) as QuotaSnapshot | null
    if (!snapshot) return null
    const entitlement = toNumber(snapshot.entitlement)
    const remaining = toNumber(snapshot.remaining)
    const percent = entitlement != null && entitlement > 0 && remaining != null
      ? clampPct(100 - (remaining / entitlement) * 100)
      : null
    return percentWindow(label, percent, resetAt,
      entitlement != null && remaining != null ? `${remaining.toFixed(0)} / ${entitlement.toFixed(0)} left` : null)
  }
  const windows = [
    add("chat", quota.chat),
    add("completions", quota.completions),
    add("premium", quota.premium_interactions),
  ].filter((w): w is UsageWindow => w !== null)
  return windows
}

export async function fetchCopilotUsage(accessToken: string, addonOnly: boolean, fetchImpl: FetchLike = fetch): Promise<UsageWindow[]> {
  const response = await fetchWithTimeout("https://api.github.com/copilot_internal/user", {
    method: "GET",
    headers: {
      Authorization: `token ${accessToken}`,
      Accept: "application/json",
      "Editor-Version": "vscode/1.96.2",
      "X-Github-Api-Version": "2025-04-01",
      "Accept-Encoding": "identity",
    },
  }, fetchImpl)
  if (!response.ok) {
    throw await errorFrom(response, "Copilot", "Copilot session expired — re-authenticate with GitHub")
  }
  let windows = buildCopilotWindows(await response.json().catch(() => null))
  // Add-on view: prefer the premium window, fall back to all snapshots when absent.
  if (addonOnly) {
    const premium = windows.filter(w => w.label === "premium")
    if (premium.length > 0) windows = premium
  }
  if (windows.length === 0) throw new Error("Copilot usage data could not be parsed")
  return windows
}

// ── Google Gemini / Antigravity ──

export const GOOGLE_ALIASES = ["google", "google.oauth"]
export const GOOGLE_ENV_KEYS: string[] = []

// Installed-application OAuth client for the token refresh flow. Not embedded:
// supply a Google installed-app client via env (GOOGLE_CLIENT_ID /
// GOOGLE_CLIENT_SECRET) to enable the Gemini/Antigravity quota provider.
const DEFAULT_PROJECT_ID = "rising-fact-p41fc"
const GOOGLE_PRIMARY_ENDPOINT = "https://cloudcode-pa.googleapis.com"
const GOOGLE_ENDPOINTS = [
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
  "https://autopush-cloudcode-pa.sandbox.googleapis.com",
  GOOGLE_PRIMARY_ENDPOINT,
]
const GOOGLE_HEADERS: Record<string, string> = {
  "User-Agent": "antigravity/1.11.5 windows/amd64",
  "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "Client-Metadata": '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}',
}

interface GoogleAuthSource {
  sourceLabel: string
  accessToken?: string
  expires?: number | null
  refreshToken?: string | null
  projectId?: string | null
}

function splitGoogleRefreshToken(raw: unknown): { refreshToken: string | null; projectId: string | null; managedProjectId: string | null } {
  const value = nonEmptyString(raw)
  if (!value) return { refreshToken: null, projectId: null, managedProjectId: null }
  const [token = "", project = "", managedProject = ""] = value.split("|")
  return {
    refreshToken: nonEmptyString(token),
    projectId: nonEmptyString(project),
    managedProjectId: nonEmptyString(managedProject),
  }
}

function readGoogleAuthSources(): GoogleAuthSource[] {
  const sources: GoogleAuthSource[] = []
  const entry = authJsonEntry(GOOGLE_ALIASES)
  if (entry) {
    const refreshParts = splitGoogleRefreshToken(entry.refresh)
    sources.push({
      sourceLabel: "Gemini",
      accessToken: entry.access ?? entry.token ?? undefined,
      expires: entry.expires ?? null,
      refreshToken: refreshParts.refreshToken,
      projectId: refreshParts.projectId ?? refreshParts.managedProjectId,
    })
  }
  // Antigravity accounts (~/.config/opencode or XDG data dir).
  const configDir = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config")
  const dataDir = process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share")
  for (const filePath of [
    join(configDir, "opencode", "antigravity-accounts.json"),
    join(dataDir, "opencode", "antigravity-accounts.json"),
  ]) {
    try {
      if (!existsSync(filePath)) continue
      const data = JSON.parse(readFileSync(filePath, "utf8"))
      const accounts = Array.isArray(data?.accounts) ? data.accounts : []
      if (accounts.length === 0) continue
      const index = typeof data.activeIndex === "number" ? data.activeIndex : 0
      const account = accounts[index] ?? accounts[0]
      if (!account?.refreshToken) continue
      const refreshParts = splitGoogleRefreshToken(account.refreshToken)
      sources.push({
        sourceLabel: "Antigravity",
        refreshToken: refreshParts.refreshToken,
        projectId: nonEmptyString(account.projectId) ?? nonEmptyString(account.managedProjectId)
          ?? refreshParts.projectId ?? refreshParts.managedProjectId,
      })
      break
    } catch { /* ignore */ }
  }
  return sources
}

/** Installed-app OAuth client from env; null when not configured. */
function resolveGoogleOAuthClient(): { clientId: string; clientSecret: string } | null {
  const clientId = nonEmptyString(process.env.GOOGLE_CLIENT_ID)
  const clientSecret = nonEmptyString(process.env.GOOGLE_CLIENT_SECRET)
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

async function refreshGoogleAccessToken(refreshToken: string, clientId: string, clientSecret: string, fetchImpl: FetchLike): Promise<string | null> {
  try {
    const response = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    })
    if (!response.ok) return null
    const data = await response.json().catch(() => null)
    return nonEmptyString(asObject(data)?.access_token)
  } catch {
    return null
  }
}

async function postGoogleRpc(url: string, accessToken: string, projectId: string | undefined, fetchImpl: FetchLike, extraHeaders: Record<string, string> = {}): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(projectId ? { project: projectId } : {}),
    }, fetchImpl)
    if (!response.ok) return null
    const payload = await response.json().catch(() => null)
    return asObject(payload)
  } catch {
    return null
  }
}

function googleWindowLabel(resetAtMs: number | null): string {
  if (resetAtMs != null) {
    const remainingHours = (resetAtMs - Date.now()) / 3_600_000
    if (remainingHours > 10) return "daily"
  }
  return "5h"
}

/** Fetch Gemini/Antigravity per-model quota. Reads its own auth sources; ignores the generic secret. */
export async function fetchGoogleUsage(fetchImpl: FetchLike = fetch): Promise<UsageWindow[]> {
  const sources = readGoogleAuthSources()
  if (sources.length === 0) throw new Error("Not configured")
  const windows: UsageWindow[] = []
  let lastError: string | null = null
  for (const source of sources) {
    const isGemini = source.sourceLabel === "Gemini"
    let accessToken = source.accessToken
    const expired = accessToken != null && typeof source.expires === "number" && source.expires <= Date.now()
    if (!accessToken || expired) {
      if (!source.refreshToken) {
        lastError = `${source.sourceLabel}: missing refresh token`
        continue
      }
      const oauthClient = resolveGoogleOAuthClient()
      if (!oauthClient) {
        lastError = `${source.sourceLabel}: Google OAuth client not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET`
        continue
      }
      accessToken = await refreshGoogleAccessToken(
        source.refreshToken,
        oauthClient.clientId,
        oauthClient.clientSecret,
        fetchImpl,
      ) ?? undefined
      if (!accessToken) {
        lastError = `${source.sourceLabel}: failed to refresh OAuth token`
        continue
      }
    }
    const projectId = source.projectId ?? DEFAULT_PROJECT_ID
    let merged = false

    if (isGemini) {
      const quotaPayload = await postGoogleRpc(`${GOOGLE_PRIMARY_ENDPOINT}/v1internal:retrieveUserQuota`, accessToken!, projectId, fetchImpl)
      const buckets = Array.isArray(quotaPayload?.buckets) ? quotaPayload!.buckets! as Array<Record<string, unknown>> : []
      for (const bucket of buckets) {
        const modelId = nonEmptyString(bucket.modelId)
        if (!modelId) continue
        const remainingFraction = toNumber(bucket.remainingFraction)
        const usedPercent = remainingFraction != null ? clampPct(100 - Math.round(remainingFraction * 100)) : null
        const resetIso = toResetTimestamp(bucket.resetTime)
        const resetMs = resetIso ? Date.parse(resetIso) : NaN
        windows.push(percentWindow(`${modelId} (${googleWindowLabel(Number.isFinite(resetMs) ? resetMs : null)})`, usedPercent, resetIso))
        merged = true
      }
    }

    for (const endpoint of GOOGLE_ENDPOINTS) {
      const payload = await postGoogleRpc(`${endpoint}/v1internal:fetchAvailableModels`, accessToken!, projectId, fetchImpl, GOOGLE_HEADERS)
      const models = asObject(payload?.models)
      if (!models) continue
      for (const [modelName, modelDataRaw] of Object.entries(models)) {
        const modelData = asObject(modelDataRaw)
        const quotaInfo = asObject(modelData?.quotaInfo)
        if (!quotaInfo) continue
        const remainingFraction = toNumber(quotaInfo.remainingFraction)
        const usedPercent = remainingFraction != null ? clampPct(100 - Math.round(remainingFraction * 100)) : null
        const resetIso = toResetTimestamp(quotaInfo.resetTime)
        const resetMs = resetIso ? Date.parse(resetIso) : NaN
        windows.push(percentWindow(`${modelName} (${googleWindowLabel(Number.isFinite(resetMs) ? resetMs : null)})`, usedPercent, resetIso))
        merged = true
      }
      if (merged) break
    }

    if (!merged) lastError = `${source.sourceLabel}: failed to fetch models`
  }
  if (windows.length === 0) throw new Error(lastError ?? "Google usage data could not be parsed")
  return windows
}

// ── xAI / Grok (gRPC-web billing RPC) ──

export const XAI_ALIASES = ["xai", "grok"]
export const XAI_ENV_KEYS: string[] = []
const XAI_USAGE_ENDPOINT = "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig"
const XAI_TOKEN_ENDPOINT = "https://auth.x.ai/oauth2/token"
const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
const XAI_REFRESH_SKEW_MS = 120_000
const XAI_DEFAULT_EXPIRES_IN_SECONDS = 3600

type XaiFixed32Field = { path: number[]; value: number; order: number }
type XaiVarintField = { path: number[]; value: bigint }
type XaiProtobufScan = { fixed32Fields: XaiFixed32Field[]; varintFields: XaiVarintField[]; nextOrder: number }

function readXaiVarint(bytes: Uint8Array, index: { value: number }): bigint | null {
  let result = 0n
  for (let shift = 0n; index.value < bytes.length && shift < 64n; shift += 7n) {
    const byte = bytes[index.value++]
    if (shift === 63n && (byte & 0x7e) !== 0) return null
    result |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return result
  }
  return null
}

function scanXaiProtobuf(bytes: Uint8Array, depth: number, pathPrefix: number[], scan: XaiProtobufScan): boolean {
  const index = { value: 0 }
  while (index.value < bytes.length) {
    const fieldKey = readXaiVarint(bytes, index)
    if (fieldKey === null || fieldKey === 0n) return false
    const fieldNumber = Number(fieldKey >> 3n)
    const wireType = Number(fieldKey & 0x07n)
    if (fieldNumber < 1 || fieldNumber > 0x1fffffff) return false
    const fieldPath = [...pathPrefix, fieldNumber]
    if (wireType === 0) {
      const value = readXaiVarint(bytes, index)
      if (value === null) return false
      scan.varintFields.push({ path: fieldPath, value })
      continue
    }
    if (wireType === 1) {
      if (index.value + 8 > bytes.length) return false
      index.value += 8
      continue
    }
    if (wireType === 2) {
      const length = readXaiVarint(bytes, index)
      if (length === null || length > BigInt(bytes.length - index.value)) return false
      const start = index.value
      index.value += Number(length)
      if (depth >= 4 && length !== 0n) return false
      if (depth < 4) {
        const nestedScan: XaiProtobufScan = { fixed32Fields: [], varintFields: [], nextOrder: scan.nextOrder }
        if (!scanXaiProtobuf(bytes.subarray(start, index.value), depth + 1, fieldPath, nestedScan)) return false
        scan.fixed32Fields.push(...nestedScan.fixed32Fields)
        scan.varintFields.push(...nestedScan.varintFields)
        scan.nextOrder = nestedScan.nextOrder
      }
      continue
    }
    if (wireType === 5) {
      if (index.value + 4 > bytes.length) return false
      const value = new DataView(bytes.buffer, bytes.byteOffset + index.value, 4).getFloat32(0, true)
      scan.fixed32Fields.push({ path: fieldPath, value, order: scan.nextOrder++ })
      index.value += 4
      continue
    }
    return false
  }
  return true
}

function samePath(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((v, i) => v === right[i])
}

function parseXaiGrpcTrailerStatus(frame: Uint8Array): number | null {
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(frame)
  } catch {
    return null
  }
  let status: number | null = null
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue
    const separator = line.indexOf(":")
    if (separator <= 0) return null
    const key = line.slice(0, separator).trim().toLowerCase()
    if (!key || key !== "grpc-status") continue
    if (status !== null) return null
    const rawStatus = line.slice(separator + 1).trim()
    if (!/^\d+$/.test(rawStatus)) return null
    status = Number(rawStatus)
    if (!Number.isSafeInteger(status)) return null
  }
  return status
}

/** gRPC-web framing: returns payloads+trailer statuses, null when not framed, false when malformed. */
function parseXaiGrpcFrames(bytes: Uint8Array): { payloads: Uint8Array[]; trailerStatuses: number[] } | null | false {
  if (bytes.length < 5 || (bytes[0] & 0x7f) !== 0) return null
  const payloads: Uint8Array[] = []
  const trailerStatuses: number[] = []
  let index = 0
  let sawTrailer = false
  while (index < bytes.length) {
    if (index + 5 > bytes.length) return false
    const flags = bytes[index++]
    if ((flags & 0x7f) !== 0) return false
    const length = (bytes[index++] * 0x1000000) + (bytes[index++] << 16) + (bytes[index++] << 8) + bytes[index++]
    if (length > bytes.length - index) return false
    const frame = bytes.subarray(index, index + length)
    index += length
    if (flags & 0x80) {
      sawTrailer = true
      const status = parseXaiGrpcTrailerStatus(frame)
      if (status === null) return false
      trailerStatuses.push(status)
    } else {
      if (sawTrailer) return false
      payloads.push(frame)
    }
  }
  return { payloads, trailerStatuses }
}

function looksLikeXaiProtobuf(bytes: Uint8Array): boolean {
  if (!bytes.length) return false
  const fieldNumber = Math.floor(bytes[0] / 8)
  const wireType = bytes[0] % 8
  return fieldNumber > 0 && [0, 1, 2, 5].includes(wireType)
}

/** Extract current-period usedPercent + reset from the billing protobuf response. */
export function parseXaiUsage(bytes: Uint8Array): { usedPercent: number; resetAt: number | null } {
  const frames = parseXaiGrpcFrames(bytes)
  if (frames === false) throw new Error("xAI returned malformed gRPC-web framing")
  const payloads = frames === null
    ? (looksLikeXaiProtobuf(bytes) ? [bytes] : [])
    : frames.payloads
  if (frames) {
    for (const status of frames.trailerStatuses) {
      if (status !== 0) throw new Error(`xAI billing RPC failed with status ${status}`)
    }
  }
  if (payloads.length === 0) throw new Error("xAI returned an empty protobuf response")

  const scan: XaiProtobufScan = { fixed32Fields: [], varintFields: [], nextOrder: 0 }
  for (const payload of payloads) {
    if (!scanXaiProtobuf(payload, 0, [], scan)) throw new Error("xAI returned malformed protobuf data")
  }

  const percentField = scan.fixed32Fields
    .filter(f => (samePath(f.path, [1]) || samePath(f.path, [1, 1])) && Number.isFinite(f.value) && f.value >= 0 && f.value <= 100)
    .sort((a, b) => a.path.length - b.path.length || a.order - b.order)[0]
  const resetCandidates = scan.varintFields
    .filter(f => f.value >= 1_700_000_000n && f.value <= 2_100_000_000n)
    .map(f => ({ path: f.path, timestamp: Number(f.value) * 1000 }))
    .filter(f => f.timestamp > Date.now())
    .sort((a, b) => a.timestamp - b.timestamp)
  const preferredReset = resetCandidates.find(f => samePath(f.path, [1, 5, 1])) ?? resetCandidates[0]
  const resetAt = preferredReset?.timestamp ?? null
  if (!percentField) {
    const hasUsagePeriod = scan.varintFields.some(f =>
      (f.path.length >= 2 && f.path[0] === 1 && f.path[1] === 6) ||
      (samePath(f.path, [1, 8, 1]) && (f.value === 1n || f.value === 2n)))
    if (hasUsagePeriod && scan.fixed32Fields.length === 0 && resetAt !== null) return { usedPercent: 0, resetAt }
    throw new Error("xAI billing response did not contain usable current-period data")
  }
  return { usedPercent: percentField.value, resetAt }
}

function jwtExpiryMilliseconds(accessToken: string): number | null {
  const payload = accessToken.split(".")[1]
  if (!payload) return null
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null
  } catch {
    return null
  }
}

interface XaiAuthMaterial { accessToken: string | null; refreshToken: string | null; expires: number | null }

async function resolveXaiAccessToken(material: XaiAuthMaterial, fetchImpl: FetchLike): Promise<string | null> {
  const deadline = Date.now() + XAI_REFRESH_SKEW_MS
  const needsRefresh = !material.accessToken ||
    (material.expires != null && material.expires <= deadline) ||
    (jwtExpiryMilliseconds(material.accessToken!) != null && jwtExpiryMilliseconds(material.accessToken!)! <= deadline)
  if (!needsRefresh) return material.accessToken!
  const refreshToken = material.refreshToken
  if (!refreshToken) return material.accessToken
  const response = await fetchImpl(XAI_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: XAI_CLIENT_ID, refresh_token: refreshToken, grant_type: "refresh_token" }),
  }).catch(() => null)
  if (!response || !response.ok) return material.accessToken
  const data = asObject(await response.json().catch(() => null))
  const access = nonEmptyString(data?.access_token)
  if (!access) return material.accessToken
  const expiresIn = toNumber(data?.expires_in) ?? XAI_DEFAULT_EXPIRES_IN_SECONDS
  void expiresIn // in-memory only; we re-derive expiry from the JWT each cycle
  return access
}

export async function fetchXaiUsage(material: XaiAuthMaterial, fetchImpl: FetchLike = fetch): Promise<UsageWindow[]> {
  const accessToken = await resolveXaiAccessToken(material, fetchImpl)
  if (!accessToken) throw new Error("Not configured")
  const response = await fetchWithTimeout(XAI_USAGE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Origin: "https://grok.com",
      Referer: "https://grok.com/?_s=usage",
      Accept: "*/*",
      "Content-Type": "application/grpc-web+proto",
      "x-grpc-web": "1",
      "x-user-agent": "connect-es/2.1.1",
      "User-Agent": "opencode-usage-stat",
    },
    body: new Uint8Array([0, 0, 0, 0, 0]),
  }, fetchImpl)
  const grpcStatus = response.headers.get("grpc-status")
  if (grpcStatus !== null && /^\d+$/.test(grpcStatus.trim()) && Number(grpcStatus.trim()) !== 0) {
    throw new Error(`xAI billing RPC failed with status ${Number(grpcStatus.trim())}`)
  }
  if (!response.ok) {
    throw await errorFrom(response, "xAI", "xAI session expired — re-authenticate with Grok")
  }
  const parsed = parseXaiUsage(new Uint8Array(await response.arrayBuffer()))
  return [percentWindow("Billing Cycle", parsed.usedPercent, parsed.resetAt)]
}

// ── Cursor ──

export const CURSOR_ALIASES = ["cursor"]
export const CURSOR_ENV_KEYS: string[] = []

export interface CursorCredential {
  accessToken: string | null
}

/** Access token from a secure local JSON file ({ accessToken }) or the credential DB. */
export function resolveCursorCredential(resolved: ResolvedCredential): string | null {
  const data = readSecureProviderJson("cursor")
  const token = nonEmptyString(data?.accessToken ?? data?.access_token ?? data?.token)
  return token ?? resolved.value
}

export function parseCursorUsage(payload: unknown): UsageWindow[] {
  const data = asObject(payload)
  const plan = asObject(data?.planUsage)
  if (!data || !plan) return []
  return [percentWindow("Billing Cycle", plan.totalPercentUsed, data.billingCycleEnd)]
}

export async function fetchCursorUsage(accessToken: string, fetchImpl: FetchLike = fetch): Promise<UsageWindow[]> {
  const response = await fetchWithTimeout("https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Connect-Protocol-Version": "1",
    },
    body: "{}",
  }, fetchImpl)
  if (!response.ok) {
    throw await errorFrom(response, "Cursor", response.status === 401 ? "Cursor session expired" : undefined)
  }
  const windows = parseCursorUsage(await response.json().catch(() => null))
  if (windows.length === 0) throw new Error("Cursor usage data could not be parsed")
  return windows
}

// ── Command Code (undocumented alpha endpoints used by the official CLI) ──

export const COMMAND_CODE_ALIASES = ["command-code", "commandcode"]
export const COMMAND_CODE_ENV_KEYS = ["COMMAND_CODE_API_KEY", "COMMANDCODE_API_KEY"]
export const COMMAND_CODE_API_BASE = "https://api.commandcode.ai"

const COMMAND_CODE_PLAN_NAMES: Record<string, string> = {
  "individual-go": "Go",
  "individual-goat": "GOAT",
  "individual-pro": "Pro",
  "individual-pro-v1": "Pro",
  "individual-provider": "Provider",
  "individual-max": "Max",
  "individual-ultra": "Ultra",
  "teams-pro": "Teams Pro",
}

export interface CommandCodeUsageData {
  credits?: unknown
  subscription?: unknown
  summary?: unknown
}

function commandCodeMoney(value: number): string {
  return `$${value.toFixed(2)}`
}

/** Parse the official Command Code CLI's alpha usage responses. */
export function parseCommandCodeUsage(data: CommandCodeUsageData): { windows: UsageWindow[]; planLabel: string | null } {
  const creditsResponse = asObject(data.credits)
  const balances = asObject(creditsResponse?.credits)
  const limits = asObject(creditsResponse?.windowLimits)
  const subscription = asObject(asObject(data.subscription)?.data)
  const summary = asObject(data.summary)
  const windows: UsageWindow[] = []

  if (limits?.limited !== false) {
    for (const [key, label] of [["fiveHour", "5h"], ["weekly", "7d"]] as const) {
      const limit = asObject(limits?.[key])
      const used = toNumber(limit?.used)
      const cap = toNumber(limit?.cap)
      if (used == null && cap == null) continue
      windows.push({
        label,
        percent: used != null && cap != null && cap > 0 ? clampPct((used / cap) * 100) : null,
        resetsAt: toResetTimestamp(limit?.resetAt),
        valueLabel: used != null && cap != null ? `${commandCodeMoney(used)} / ${commandCodeMoney(cap)}` : null,
      })
    }
  }

  const creditParts = [balances?.monthlyCredits, balances?.purchasedCredits, balances?.freeCredits]
    .map(toNumber)
    .filter((value): value is number => value !== null)
  const remaining = creditParts.length > 0 ? creditParts.reduce((sum, value) => sum + value, 0) : null
  const spent = toNumber(summary?.totalCost)
  if (spent != null && remaining != null) {
    const total = spent + remaining
    windows.push({
      label: "Monthly",
      percent: total > 0 ? clampPct((spent / total) * 100) : null,
      resetsAt: toResetTimestamp(subscription?.currentPeriodEnd),
      valueLabel: `${commandCodeMoney(spent)} / ${commandCodeMoney(total)}`,
    })
  }
  if (remaining != null) {
    windows.push({ label: "Credits", percent: null, resetsAt: null, valueLabel: `${commandCodeMoney(remaining)} left` })
  }

  const planId = nonEmptyString(subscription?.planId) ?? nonEmptyString(balances?.planId)
  return { windows, planLabel: planId ? COMMAND_CODE_PLAN_NAMES[planId] ?? planId : null }
}

/** Prefer the normal resolver, then reuse the official CLI's local auth file. */
export function resolveCommandCodeCredential(resolved: ResolvedCredential): string | null {
  if (resolved.value && resolved.source !== "dotenv") return resolved.value
  try {
    const authPath = join(homedir(), ".commandcode", "auth.json")
    if (existsSync(authPath)) {
      const apiKey = nonEmptyString(asObject(JSON.parse(readFileSync(authPath, "utf8")))?.apiKey)
      if (apiKey) return apiKey
    }
  } catch {
    // Fall through to the resolved .env value.
  }
  return resolved.value
}

async function fetchCommandCodeJson(path: string, apiKey: string, fetchImpl: FetchLike): Promise<unknown> {
  const response = await fetchWithTimeout(`${COMMAND_CODE_API_BASE}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "opencode-usage-stat",
    },
  }, fetchImpl)
  if (!response.ok) {
    throw await errorFrom(response, "Command Code", response.status === 401 || response.status === 403
      ? "Command Code session expired — re-authenticate with cmd auth login"
      : undefined)
  }
  return response.json().catch(() => null)
}

export async function fetchCommandCodeUsage(apiKey: string, fetchImpl: FetchLike = fetch): Promise<{ windows: UsageWindow[]; planLabel: string | null }> {
  const whoami = asObject(await fetchCommandCodeJson("/alpha/whoami", apiKey, fetchImpl))
  // User API keys may carry no organization (whoami.org is null). The alpha
  // billing/usage endpoints accept the same key without orgId in that case.
  const orgId = nonEmptyString(asObject(whoami?.org)?.id)
  const scoped = (path: string): string => (orgId ? `${path}?${new URLSearchParams({ orgId })}` : path)
  const [credits, subscription] = await Promise.all([
    fetchCommandCodeJson(scoped("/alpha/billing/credits"), apiKey, fetchImpl),
    fetchCommandCodeJson(scoped("/alpha/billing/subscriptions"), apiKey, fetchImpl),
  ])
  const currentPeriodStart = nonEmptyString(asObject(asObject(subscription)?.data)?.currentPeriodStart)
  const summaryParams = new URLSearchParams({ ...(orgId ? { orgId } : {}), ...(currentPeriodStart ? { since: currentPeriodStart } : {}) })
  const summaryQuery = summaryParams.toString()
  const summaryPath = summaryQuery ? `/alpha/usage/summary?${summaryQuery}` : "/alpha/usage/summary"
  const summary = await fetchCommandCodeJson(summaryPath, apiKey, fetchImpl)
  const parsed = parseCommandCodeUsage({ credits, subscription, summary })
  if (parsed.windows.length === 0) throw new Error("Command Code usage data could not be parsed")
  return parsed
}

// ── Devin (opencode-devin-v2 plugin seat quota) ──

export const DEVIN_ALIASES = ["devin"]
export const DEVIN_ENV_KEYS: string[] = [] // key comes from the devin plugin's own credentials.json
export const DEVIN_API_FALLBACK_URL = "https://server.codeium.com"
export const DEVIN_USER_STATUS_PATH = "/exa.seat_management_pb.SeatManagementService/GetUserStatus"

function devinApiBase(raw: unknown): string {
  const value = nonEmptyString(raw)
  if (!value) return DEVIN_API_FALLBACK_URL
  try {
    const url = new URL(value)
    // The API key rides in the request body; only plain HTTPS origins are safe.
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      return DEVIN_API_FALLBACK_URL
    }
    return url.origin
  } catch {
    return DEVIN_API_FALLBACK_URL
  }
}

/**
 * Parse the Devin GetUserStatus payload into daily/weekly quota windows.
 *
 * Response shape:
 *   { userStatus: { planStatus: { planInfo: { planName, isDevin,
 *     hideDailyQuota?, hideWeeklyQuota? }, dailyQuotaRemainingPercent?,
 *     weeklyQuotaRemainingPercent?, dailyQuotaResetAtUnix?,
 *     weeklyQuotaResetAtUnix? } }, planInfo: {...} }
 *
 * proto3 omits zero-valued scalar fields, so an omitted remaining percent
 * means 0% left (100% used) — but only when the response carries a real
 * quota structure. A missing/malformed planStatus returns null instead of
 * fabricating exhaustion. The nested planStatus.planInfo is authoritative
 * for the plan name; the top-level planInfo may disagree.
 */
export function parseDevinUsage(payload: unknown): { windows: UsageWindow[]; planLabel: string | null } | null {
  const userStatus = asObject(asObject(payload)?.userStatus)
  const planStatus = asObject(userStatus?.planStatus)
  if (!planStatus) return null
  const planInfo = asObject(planStatus.planInfo)
  const planLabel = nonEmptyString(planInfo?.planName)

  const quotaKeys = [
    "dailyQuotaRemainingPercent",
    "weeklyQuotaRemainingPercent",
    "dailyQuotaResetAtUnix",
    "weeklyQuotaResetAtUnix",
  ]
  const hasQuotaStructure = quotaKeys.some(key => key in planStatus)
    || planInfo?.hideDailyQuota === true
    || planInfo?.hideWeeklyQuota === true
  if (!hasQuotaStructure) return null

  const windows: UsageWindow[] = []
  // Returns false when a present field is malformed — the whole payload is
  // then rejected rather than fabricating a fully-exhausted window.
  const push = (label: "Daily" | "Weekly", hidden: unknown): boolean => {
    if (hidden === true) return true
    const field = label === "Daily" ? "dailyQuota" : "weeklyQuota"
    const remainingRaw = planStatus[`${field}RemainingPercent`]
    const resetRaw = planStatus[`${field}ResetAtUnix`]
    // A window with neither percent nor reset info tells the user nothing.
    if (remainingRaw === undefined && resetRaw === undefined) return true
    if (remainingRaw !== undefined) {
      const parsed = toNumber(remainingRaw)
      // Only proto3 omission defaults to 0 remaining; an explicit non-number
      // or out-of-range value invalidates the payload.
      if (parsed === null || parsed < 0 || parsed > 100) return false
      windows.push(percentWindow(label, clampPct(100 - parsed), resetRaw))
    } else {
      windows.push(percentWindow(label, 100, resetRaw)) // omitted == 0 remaining
    }
    return true
  }
  if (!push("Daily", planInfo?.hideDailyQuota)) return null
  if (!push("Weekly", planInfo?.hideWeeklyQuota)) return null
  return { windows, planLabel }
}

export async function fetchDevinUsage(credentials: { apiKey: string; apiServerUrl: string | null }, fetchImpl: FetchLike = fetch): Promise<{ windows: UsageWindow[]; planLabel: string | null }> {
  const response = await fetchWithTimeout(`${devinApiBase(credentials.apiServerUrl)}${DEVIN_USER_STATUS_PATH}`, {
    method: "POST",
    redirect: "manual", // never follow redirects carrying the api_key body
    headers: {
      "Content-Type": "application/json",
      "Connect-Protocol-Version": "1",
    },
    body: JSON.stringify({
      metadata: {
        api_key: credentials.apiKey,
        ide_name: "windsurf",
        extension_version: "2.0.0",
        ide_version: "2.0.0",
        extension_name: "windsurf",
        ide_type: "windsurf",
        locale: "en",
        os: "linux",
        request_id: String(Date.now()),
        session_id: randomUUID(),
        trigger_id: randomUUID(),
        plan_name: "Unset",
      },
    }),
  }, fetchImpl)
  if (response.status === 401 || response.status === 403) {
    throw new Error("Devin session expired — re-authenticate the Devin provider")
  }
  if (!response.ok) {
    // Never echo the body: error payloads may contain account data.
    throw new Error(`Devin API error: ${response.status}`)
  }
  const parsed = parseDevinUsage(await response.json().catch(() => null))
  if (!parsed) throw new Error("Devin usage data could not be parsed")
  return parsed
}

// Devin usage is shown only when ALL three hold (AND, not OR):
//   1. plugin option providerUsage.devin === true,
//   2. the opencode-devin-v2 plugin is installed at the current location,
//   3. the location exposes at least one enabled devin-provider model.
export const DEVIN_PLUGIN_ID = "opencode-devin-v2"

export function hasEnabledDevinModel(models: ReadonlyArray<{ providerID?: string; enabled?: boolean }> | undefined | null): boolean {
  return Array.isArray(models) && models.some(m => m?.providerID === "devin" && m?.enabled === true)
}

export function isDevinUsageVisible(opts: { configEnabled: boolean; pluginIds: readonly string[]; hasDevinModel: boolean }): boolean {
  return opts.configEnabled === true && opts.pluginIds.includes(DEVIN_PLUGIN_ID) && opts.hasDevinModel === true
}

/**
 * Stable key identifying the location a gate check belongs to, so an async
 * plugin-list response can be scoped to (and rejected for) the location that
 * was current when it was issued.
 */
export function devinLocationKey(location: { directory?: string; workspaceID?: string } | undefined | null): string {
  return `${location?.directory ?? ""}|${location?.workspaceID ?? ""}`
}

/**
 * Apply an async plugin-list result to the gate only when it still belongs to
 * the current location and is not superseded by a newer request. Otherwise
 * the previous state stands — a stale list must never qualify another
 * location (strict AND applies per location).
 */
export function devinGatePlugins(
  state: { key: string; seq: number; pluginIds: readonly string[] },
  currentKey: string,
  requestKey: string,
  seq: number,
  pluginIds: readonly string[],
): { key: string; seq: number; pluginIds: readonly string[] } {
  if (requestKey !== currentKey || seq <= state.seq) return state
  return { key: requestKey, seq, pluginIds }
}

// ── Registry & orchestration ──

export type ProviderId =
  | "opencode-go" | "deepseek" | "codex" | "claude" | "kimi-for-coding"
  | "zai-coding-plan" | "zhipuai-coding-plan" | "minimax-coding-plan" | "minimax-cn-coding-plan"
  | "openrouter" | "ollama-cloud" | "github-copilot" | "github-copilot-addon"
  | "google" | "xai" | "cursor" | "command-code" | "devin"

interface ProviderSpec {
  id: ProviderId
  name: string
  aliases: string[]
  envKeys: string[]
}

export const PROVIDERS: readonly ProviderSpec[] = [
  { id: "opencode-go", name: "OpenCode Go", aliases: OPENCODE_GO_ALIASES, envKeys: OPENCODE_GO_ENV_KEYS },
  { id: "deepseek", name: "DeepSeek", aliases: DEEPSEEK_ALIASES, envKeys: DEEPSEEK_ENV_KEYS },
  { id: "codex", name: "Codex", aliases: CODEX_ALIASES, envKeys: CODEX_ENV_KEYS },
  { id: "claude", name: "Claude", aliases: CLAUDE_ALIASES, envKeys: CLAUDE_ENV_KEYS },
  { id: "kimi-for-coding", name: "Kimi for Coding", aliases: KIMI_ALIASES, envKeys: KIMI_ENV_KEYS },
  { id: "zai-coding-plan", name: "z.ai", aliases: ZAI_ALIASES, envKeys: ZAI_ENV_KEYS },
  { id: "zhipuai-coding-plan", name: "Zhipu AI Coding Plan", aliases: ZHIPUAI_ALIASES, envKeys: ZHIPUAI_ENV_KEYS },
  { id: "minimax-coding-plan", name: "MiniMax Coding Plan", aliases: MINIMAX_ALIASES, envKeys: MINIMAX_ENV_KEYS },
  { id: "minimax-cn-coding-plan", name: "MiniMax Coding Plan (CN)", aliases: MINIMAX_CN_ALIASES, envKeys: MINIMAX_CN_ENV_KEYS },
  { id: "openrouter", name: "OpenRouter", aliases: OPENROUTER_ALIASES, envKeys: OPENROUTER_ENV_KEYS },
  { id: "ollama-cloud", name: "Ollama Cloud", aliases: OLLAMA_CLOUD_ALIASES, envKeys: OLLAMA_CLOUD_ENV_KEYS },
  { id: "github-copilot", name: "GitHub Copilot", aliases: COPILOT_ALIASES, envKeys: COPILOT_ENV_KEYS },
  { id: "github-copilot-addon", name: "Copilot Add-on", aliases: COPILOT_ALIASES, envKeys: COPILOT_ENV_KEYS },
  { id: "google", name: "Google Gemini", aliases: GOOGLE_ALIASES, envKeys: GOOGLE_ENV_KEYS },
  { id: "xai", name: "xAI", aliases: XAI_ALIASES, envKeys: XAI_ENV_KEYS },
  { id: "cursor", name: "Cursor", aliases: CURSOR_ALIASES, envKeys: CURSOR_ENV_KEYS },
  { id: "command-code", name: "Command Code", aliases: COMMAND_CODE_ALIASES, envKeys: COMMAND_CODE_ENV_KEYS },
  { id: "devin", name: "Devin", aliases: DEVIN_ALIASES, envKeys: DEVIN_ENV_KEYS },
]

export const USAGE_STAT_PROVIDER_IDS: readonly ProviderId[] = PROVIDERS.map(p => p.id)

export interface CredentialResolver {
  (spec: { aliases: string[]; envKeys: string[] }): ResolvedCredential
}

/** Default resolver: OpenCode credential DB → auth.json → env → .env. */
export const defaultCredentialResolver: CredentialResolver = (spec) => resolveCredential(spec)

/** Dollar-pool value label produced by the Ollama Cloud new-billing parser. */
export const DOLLAR_POOL_LABEL = /^\s*\$[\d,.]+\s*\/\s*\$[\d,.]+\s*left\s*$/

/** Remaining dollars from a dollar-pool value label, null when not one. */
export function dollarPoolRemaining(valueLabel: string | null): number | null {
  if (!valueLabel || !DOLLAR_POOL_LABEL.test(valueLabel)) return null
  return toNumber(valueLabel.match(/\$([\d,.]+)/)?.[1]?.replace(/,/g, ""))
}

/** Compact dollar amount without symbol: "60" / "47.5" / "12.34". */
export function shortDollars(value: number): string {
  return value.toFixed(2).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
}

/**
 * Highest used percent across all windows (== tightest remaining headroom),
 * ignoring null/NaN/Infinity. Returns null when no window reports a percent.
 * Display-mode independent: percent is always "used" in UsageWindow.
 */
export function worstUsagePercent(windows: UsageWindow[] | undefined | null): number | null {
  if (!windows) return null
  let worst: number | null = null
  for (const w of windows) {
    const p = w?.percent
    if (typeof p !== "number" || !Number.isFinite(p)) continue
    if (worst === null || p > worst) worst = p
  }
  return worst
}

/**
 * Collapsed-row summary: "n%/5h m%/7d" for the session and weekly windows.
 * Monthly/billing-cycle totals are intentionally
 * ignored in the collapsed state (they remain visible when expanded),
 * except dollar-pool windows (Ollama Cloud new billing) surface
 * "[percent]%/[credits]$". Returns null when nothing displayable
 * exists (caller falls back to status text).
 */
export function collapsedSummary(windows: UsageWindow[] | undefined, mode: UsageDisplayMode): string | null {
  if (!windows || windows.length === 0) return null
  const shown = (win: UsageWindow): number | null => {
    if (win.percent == null) return null
    return Math.round(mode === "remaining" ? 100 - win.percent : win.percent)
  }
  const isSessionWin = (label: string): boolean => /(^|\b)(5h|session|rolling)\b/i.test(label)
  const isWeeklyWin = (label: string): boolean => /(^|\b)(weekly|7d)\b/i.test(label)
  const session = windows.find(w => isSessionWin(w.label))
  const weekly = windows.find(w => isWeeklyWin(w.label))
  const n = session ? shown(session) : null
  const m = weekly ? shown(weekly) : null
  if (n != null && m != null) return `${n}%/5h ${m}%/7d`
  if (n != null) return `${n}%/5h`
  if (m != null) return `${m}%/7d`
  // Dollar-pool windows (Ollama Cloud new billing): "[percent]%/[credits]$" —
  // remaining mode shows credits left, used mode shows credits spent.
  const pool = windows.find(w => DOLLAR_POOL_LABEL.test(w.valueLabel ?? ""))
  if (pool) {
    const remaining = dollarPoolRemaining(pool.valueLabel)
    const total = toNumber((pool.valueLabel ?? "").match(/\/\s*\$([\d,.]+)/)?.[1]?.replace(/,/g, ""))
    const p = shown(pool)
    if (p != null && remaining != null && total != null) {
      const dollars = mode === "remaining" ? remaining : Math.max(0, total - remaining)
      return `${p}%/${shortDollars(dollars)}$`
    }
  }
  const firstPercent = windows.map(shown).find(v => v != null)
  if (firstPercent != null) return `${firstPercent}%`
  return windows.find(w => w.valueLabel)?.valueLabel ?? null
}

/**
 * Resolve secret (kept private) and fetch provider usage.
 * `getCredential` is injectable for tests (defaults to the real resolver).
 */
export async function checkProviderUsage(
  providerId: ProviderId,
  fetchImpl: FetchLike = fetch,
  getCredential: CredentialResolver = defaultCredentialResolver,
): Promise<ProviderUsageResult> {
  const spec = PROVIDERS.find(p => p.id === providerId)
  if (!spec) return { providerId, providerName: providerId, configured: false, ok: false, status: "Unknown provider" }

  const finishError = (configured: boolean, message: string): ProviderUsageResult => ({
    providerId: spec.id,
    providerName: spec.name,
    configured,
    ok: false,
    status: message.startsWith(spec.name) ? message : `${spec.name} — ${message}`,
    error: message,
  })

  // Providers that manage their own credentials outside the generic resolver.
  if (spec.id === "ollama-cloud") {
    const cookie = resolveOllamaCloudCookie()
    if (!cookie) return finishError(false, `${spec.name} — not configured (no saved cookie)`)
    try {
      const windows = await fetchOllamaCloudUsage(cookie, fetchImpl)
      return { providerId: spec.id, providerName: spec.name, configured: true, ok: true, status: summarize(spec.name, windows), windows }
    } catch (err) {
      return finishError(true, err instanceof Error ? err.message : "Request failed")
    }
  }
  if (spec.id === "google") {
    try {
      const windows = await fetchGoogleUsage(fetchImpl)
      return { providerId: spec.id, providerName: spec.name, configured: true, ok: true, status: summarize(spec.name, windows), windows }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed"
      return finishError(message !== "Not configured", message)
    }
  }
  if (spec.id === "devin") {
    const credentials = readDevinCredentials()
    if (!credentials?.apiKey) return finishError(false, `${spec.name} — not configured (no Devin credentials)`)
    try {
      const { windows, planLabel } = await fetchDevinUsage({ apiKey: credentials.apiKey, apiServerUrl: credentials.apiServerUrl }, fetchImpl)
      return { providerId: spec.id, providerName: spec.name, configured: true, ok: true, status: summarize(spec.name, windows), windows, planLabel }
    } catch (err) {
      return finishError(true, err instanceof Error ? err.message : "Request failed")
    }
  }

  const resolved = getCredential({ aliases: spec.aliases, envKeys: spec.envKeys })

  // xAI can start from a refresh token alone (the access token is refreshed in memory).
  if (spec.id === "xai") {
    const material = { accessToken: resolved.value, refreshToken: resolved.refresh, expires: resolved.expires }
    if (!material.accessToken && !material.refreshToken) {
      return finishError(false, "not configured")
    }
    try {
      const windows = await fetchXaiUsage(material, fetchImpl)
      return { providerId: spec.id, providerName: spec.name, configured: true, ok: true, status: summarize(spec.name, windows), windows }
    } catch (err) {
      return finishError(true, err instanceof Error ? err.message : "Request failed")
    }
  }

  const secret = spec.id === "command-code" ? resolveCommandCodeCredential(resolved) : resolved.value
  if (!secret) {
    return finishError(false, "not configured")
  }

  try {
    let windows: UsageWindow[]
    let planLabel: string | null = null
    switch (spec.id) {
      case "opencode-go":
        windows = await fetchOpenCodeGoUsage(secret, fetchImpl)
        break
      case "deepseek":
        windows = await fetchDeepSeekBalance(secret, fetchImpl)
        break
      case "codex":
        windows = await fetchCodexUsage(secret, resolved.accountId, fetchImpl)
        break
      case "claude":
        windows = await fetchClaudeUsage(secret, fetchImpl)
        break
      case "kimi-for-coding":
        windows = await fetchKimiUsage(secret, fetchImpl)
        break
      case "zai-coding-plan": {
        const parsed = await fetchZaiUsage(secret, fetchImpl)
        windows = parsed.windows
        planLabel = parsed.planLabel
        break
      }
      case "zhipuai-coding-plan":
        windows = await fetchZhipuaiUsage(secret, fetchImpl)
        break
      case "minimax-coding-plan":
        windows = await miniMaxFetcher(spec.id, "https://api.minimax.io/v1/api/openplatform/coding_plan/remains", false)(secret, fetchImpl)
        break
      case "minimax-cn-coding-plan":
        windows = await miniMaxFetcher(spec.id, "https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains", true)(secret, fetchImpl)
        break
      case "openrouter":
        windows = await fetchOpenRouterCredits(secret, fetchImpl)
        break
      case "github-copilot":
        windows = await fetchCopilotUsage(secret, false, fetchImpl)
        break
      case "github-copilot-addon":
        windows = await fetchCopilotUsage(secret, true, fetchImpl)
        break
      case "cursor": {
        const token = resolveCursorCredential(resolved)
        if (!token) return finishError(false, "Not configured (no saved access token)")
        windows = await fetchCursorUsage(token, fetchImpl)
        break
      }
      case "command-code": {
        const parsed = await fetchCommandCodeUsage(secret, fetchImpl)
        windows = parsed.windows
        planLabel = parsed.planLabel
        break
      }
    }
    return {
      providerId: spec.id,
      providerName: spec.name,
      configured: true,
      ok: true,
      status: summarize(spec.name, windows),
      windows,
      planLabel,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed"
    return finishError(true, message)
  }
}

function summarize(name: string, windows: UsageWindow[]): string {
  const first = windows[0]
  if (!first) return `${name} — no data`
  if (first.valueLabel) {
    if (first.resetsAt) return `${name} — ${first.valueLabel} · resets ${formatResetDuration(first.resetsAt)}`
    return `${name} — ${first.valueLabel}`
  }
  if (first.percent != null) {
    const suffix = first.resetsAt ? ` · resets ${formatResetDuration(first.resetsAt)}` : ""
    return `${name} — ${first.percent.toFixed(0)}%${suffix}`
  }
  return name
}



export type ProviderUsageConfig = Partial<Record<ProviderId, boolean>>

/** Provider polling is opt-in; omitted or non-boolean values remain disabled. */
export function resolveProviderUsageConfig(options: unknown): Record<ProviderId, boolean> {
  const source = options && typeof options === "object"
    ? (options as Record<string, unknown>).providerUsage
    : null
  const value = source && typeof source === "object" ? source as Record<string, unknown> : {}
  const out = {} as Record<ProviderId, boolean>
  for (const id of USAGE_STAT_PROVIDER_IDS) {
    out[id] = value[id] === true
  }
  return out
}
