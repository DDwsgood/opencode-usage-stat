// droid-usage.ts - Droid (Factory subscription) provider block.
//
// Two independent sources, each degrading on its own:
//
//   1. Session-tracked FSC — the public "usage" RPC that opencode-droid-v2
//      registers on the OpenCode plugin host (see opencode-droid-v2/rpc.ts).
//      The bridge process records one cumulative record per OpenCode session;
//      `total.factoryCredits` is the Factory Standard Credits (FSC) observed
//      in that session so far. FSC is a credit unit, not USD — rendered
//      without a currency symbol; a missing `factoryCredits` field means
//      "unknown", never zero, and family sums missing member sessions are
//      marked as a lower bound (≥).
//   2. Account quota — the official app.factory.ai subscription-usage
//      endpoint (see the "Factory account quota" section below), shown only
//      when a saved web credential exists.
//
// Nothing here fabricates subscription data: absent sources read as
// unavailable/unknown rather than invented numbers.

import type { ProviderUsageResult, UsageWindow } from "./provider-usage.js"
import { PROVIDER_TIMEOUT_MS, toNumber } from "./provider-usage.js"
import { formatTokens } from "./formatter.js"
import { readSecureProviderJson } from "./credentials.js"
import { getFactoryKeyringCredential, jwtExpiresAtMs } from "./factory-keyring.js"

export const DROID_PLUGIN_ID = "opencode-droid-v2"
export const DROID_PROVIDER_NAME = "Droid (Factory)"
export const DROID_ALIASES = ["droid", "factory"]
export const DROID_ENV_KEYS: string[] = [] // session-tracked via plugin RPC; no credential exists here

/**
 * Portable RPC descriptor, structurally identical to `DroidUsageRpc` exported
 * by opencode-droid-v2/rpc.ts. Kept as a local literal so this plugin takes no
 * dependency on the droid plugin's internals or on @factory packages; the
 * host resolves the registered handler by `id`.
 */
export const DROID_USAGE_RPC = {
  id: DROID_PLUGIN_ID,
  events: {},
  methods: {
    usage: {
      input: { type: "object", properties: { sessionID: { type: "string" } }, additionalProperties: false },
      output: {
        type: "object",
        properties: { version: { const: 1 }, records: { type: "array", items: { type: "object" } } },
        required: ["version", "records"],
        additionalProperties: false,
      },
    },
  },
} as const

export interface DroidTokenUsage {
  inputTokens?: number
  outputTokens?: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
  thinkingTokens?: number
  /** Factory Standard Credits consumed. Absent means unknown, not zero. */
  factoryCredits?: number
}

/** One cumulative usage record per OpenCode session, as published by the RPC. */
export interface DroidUsageRecord {
  version: 1
  providerID: "droid"
  sessionID: string
  droidSessionID: string
  requestID: string
  modelID: string
  time: number
  usage: DroidTokenUsage
  /** In-process cumulative per-session totals. */
  total: DroidTokenUsage
}

/** Minimal shape of the method client returned by `client.rpc(DROID_USAGE_RPC)`. */
export interface DroidUsageQuery {
  usage(input: { sessionID?: string }, options?: { location?: { directory?: string } }): Promise<unknown>
}

/**
 * Account-quota result produced by a quota source (e.g. the official Factory
 * web endpoint). When no source is configured the UI reports account quota as
 * unavailable rather than inventing subscription numbers.
 */
export interface DroidAccountQuota {
  windows: UsageWindow[]
  planLabel?: string | null
}
export type DroidAccountQuotaSource = () => Promise<DroidAccountQuota | null>

// ── Factory account quota (official web endpoint + auto-rotated credential) ──
//
// The opencode-droid-v2 usage RPC only carries per-session tracked FSC; the
// account-level subscription windows come from the same endpoint the official
// app.factory.ai frontend calls ($Ge hook → GET /api/billing/limits
// on api.factory.ai, Authorization: Bearer <token> or Cookie + X-Factory-Org-Id).
//
// Credential resolution order:
//   1. Factory CLI keyring (~/.factory/auth.v2.keyring) — the AES-256-GCM file
//      the `droid` CLI keeps fresh. We decrypt it through the same keytar
//      module the CLI ships, use the access token while it is valid, and
//      rotate an expired one through WorkOS, writing the new pair back so the
//      CLI never sees a revoked refresh token (see factory-keyring.ts).
//      FACTORY_DISABLE_KEYRING opts this source out.
//   2. Saved web cookie/access token in the plugin's secure JSON store —
//      read-only fallback (the saved token is never refreshed or persisted;
//      a 24 h WorkOS JWT saved there expires within a day).

export const FACTORY_USAGE_URL = "https://api.factory.ai/api/billing/limits"

export interface FactoryUsageCredential {
  cookie: string | null
  accessToken: string | null
  organizationId: string | null
}

/**
 * Saved Factory web credential from the secure provider JSON
 * (~/.config/openchamber/quota/droid.json or ~/.config/opencode/usage-stat/droid.json):
 * `{ cookie?, accessToken?, organizationId? }`. null when neither secret exists.
 */
export function resolveFactoryUsageCredential(): FactoryUsageCredential | null {
  const data = readSecureProviderJson("droid")
  if (!data) return null
  const cookie = nonEmptyString(data.cookie ?? data.session)
  const accessToken = nonEmptyString(data.accessToken ?? data.access_token ?? data.token)
  const organizationId = nonEmptyString(data.organizationId ?? data.organization_id ?? data.orgId)
  if (!cookie && !accessToken) return null
  return { cookie, accessToken, organizationId }
}

const FACTORY_LIMIT_BUCKETS: ReadonlyArray<readonly [string, string, string]> = [
  ["standard", "fiveHour", "Standard · 5h"],
  ["standard", "weekly", "Standard · weekly"],
  ["standard", "monthly", "Standard · monthly"],
  ["core", "fiveHour", "Core · 5h"],
  ["core", "weekly", "Core · weekly"],
  ["core", "monthly", "Core · monthly"],
]

function clampPct(n: number): number {
  return Math.min(100, Math.max(0, n))
}

/** ISO string or epoch s/ms → ISO; null when absent or unparseable. */
function factoryWindowEnd(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value < 10_000_000_000 ? value * 1000 : value
    return new Date(ms).toISOString()
  }
  const text = nonEmptyString(value)
  if (!text) return null
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/**
 * One limit bucket { usedPercent, windowEnd, secondsRemaining }. Mirrors the
 * official uGe/$D semantics: secondsRemaining <= 0 or a missing windowEnd
 * means the window expired — the app shows 0% and no reset ("Use Droid to
 * start"), which we keep as percent 0 + resetsAt null. A missing usedPercent
 * on a live window stays null (unknown), never fabricated.
 */
function factoryBucketWindow(label: string, raw: unknown): UsageWindow | null {
  const obj = asObject(raw)
  if (!obj) return null
  const end = factoryWindowEnd(obj.windowEnd)
  const seconds = toNumber(obj.secondsRemaining)
  const expired = end == null || (seconds != null && seconds <= 0)
  if (expired) return { label, percent: 0, resetsAt: null, valueLabel: null }
  const percent = toNumber(obj.usedPercent)
  return {
    label,
    percent: percent == null ? null : clampPct(percent),
    resetsAt: end,
    valueLabel: percent == null ? "unknown" : null,
  }
}

/**
 * Parse GET /api/billing/limits into account-quota windows.
 * The live response is a bare `{ limits: { standard|core: {
 * fiveHour|weekly|monthly }, ... }, extraUsageBalanceCents, extraUsageAllowed }`.
 * Also accepts a caller's `data` wrapper. `extraUsageBalanceCents` is a USD
 * cash balance (NOT FSC); there is no absolute FSC cap in the payload, so
 * only real usedPercent shares are shown. No reliable plan field exists —
 * planLabel stays null.
 */
export function parseFactorySubscriptionUsage(payload: unknown): DroidAccountQuota | null {
  const root = asObject(payload)
  if (!root) return null
  const data = asObject(root.data) ?? root
  const windows: UsageWindow[] = []
  const limits = asObject(data.limits)
  if (limits) {
    for (const [section, key, label] of FACTORY_LIMIT_BUCKETS) {
      const window = factoryBucketWindow(label, asObject(limits[section])?.[key])
      if (window) windows.push(window)
    }
  }
  if (data.extraUsageAllowed === false) {
    windows.push({ label: "Extra usage", percent: null, resetsAt: null, valueLabel: "disabled" })
  } else {
    const cents = toNumber(data.extraUsageBalanceCents)
    if (cents != null) {
      windows.push({ label: "Extra usage", percent: null, resetsAt: null, valueLabel: `$${(cents / 100).toFixed(2)} cash balance` })
    }
  }
  if (windows.length === 0) return null
  return { windows, planLabel: null }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

function timedFetch(url: string, init: RequestInit, fetchImpl: FetchLike, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetchImpl(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

/**
 * Fetch the Factory billing-limits endpoint with a saved web credential.
 * The legacy subscription/usage endpoint does not contain these rate windows.
 * Authorization and Cookie are both sent when both are saved (matching the
 * official frontend). Fixed HTTPS host, redirect:manual (never follow a
 * redirect carrying auth),
 * 15s timeout. Error messages carry status only — the body may contain
 * account data and is never echoed.
 */
export async function fetchFactorySubscriptionUsage(
  credential: FactoryUsageCredential,
  fetchImpl: FetchLike = fetch,
): Promise<DroidAccountQuota> {
  const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "opencode-usage-stat" }
  // The official frontend can carry both; pass through whatever was saved.
  if (credential.accessToken) headers.Authorization = `Bearer ${credential.accessToken}`
  if (credential.cookie) headers.Cookie = credential.cookie
  if (credential.organizationId) headers["X-Factory-Org-Id"] = credential.organizationId
  const response = await timedFetch(FACTORY_USAGE_URL, { method: "GET", headers, redirect: "manual" }, fetchImpl)
  if (response.status === 401 || response.status === 403) {
    throw new Error("Factory session expired — update the saved web credential")
  }
  if (!response.ok) {
    throw new Error(`Factory usage API error: ${response.status}`)
  }
  const quota = parseFactorySubscriptionUsage(await response.json().catch(() => null))
  if (!quota) throw new Error("Factory usage data could not be parsed")
  return quota
}

/**
 * Account-quota source for checkDroidUsage: resolves a credential on every
 * call — the Factory CLI keyring first (self-refreshing, so a freshly expired
 * access token is rotated on the spot), then the secure JSON as fallback. A
 * keyring present but unrefreshable counts as a request failure; with no
 * credential at all the source returns null. Fetch failures propagate so the
 * caller can distinguish "not configured" from "failed".
 */
export function makeFactoryAccountQuotaSource(fetchImpl: FetchLike = fetch): DroidAccountQuotaSource {
  return async () => {
    let keyringError: unknown = null
    let credential: FactoryUsageCredential | null = null
    try {
      credential = await getFactoryKeyringCredential({ fetchImpl })
    } catch (error) {
      keyringError = error
    }
    if (!credential) {
      const saved = resolveFactoryUsageCredential()
      // A saved JWT access token is only useful while unexpired — sending a
      // provably dead one guarantees a 401, so treat it as absent. Cookies and
      // non-JWT tokens have no readable expiry and are tried as-is.
      if (saved && (saved.cookie || (saved.accessToken && (jwtExpiresAtMs(saved.accessToken) ?? Infinity) > Date.now()))) {
        credential = saved
      }
    }
    if (!credential) {
      if (keyringError) throw keyringError
      return null
    }
    return fetchFactorySubscriptionUsage(credential, fetchImpl)
  }
}

// ── Gate (same AND semantics as the Devin block) ──

/** An enabled model from the `droid` provider must exist at the location. */
export function hasEnabledDroidModel(models: ReadonlyArray<{ providerID?: string; enabled?: boolean }> | undefined | null): boolean {
  return Array.isArray(models) && models.some(m => m?.providerID === "droid" && m?.enabled === true)
}

/** Visible only when ALL three hold: config opt-in, plugin installed, enabled droid model. */
export function isDroidUsageVisible(opts: { configEnabled: boolean; pluginIds: readonly string[]; hasDroidModel: boolean }): boolean {
  return opts.configEnabled === true && opts.pluginIds.includes(DROID_PLUGIN_ID) && opts.hasDroidModel === true
}

// ── Payload parsing (pure; tolerate partial/malformed records) ──

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function tokenField(raw: Record<string, unknown>, key: keyof DroidTokenUsage): number | undefined {
  const n = toNumber(raw[key])
  return n != null && n >= 0 ? n : undefined
}

/** Token counters default to 0; factoryCredits stays undefined when absent/invalid. */
function parseTokenUsage(raw: unknown): DroidTokenUsage | null {
  const obj = asObject(raw)
  if (!obj) return null
  return {
    inputTokens: tokenField(obj, "inputTokens") ?? 0,
    outputTokens: tokenField(obj, "outputTokens") ?? 0,
    cacheCreationTokens: tokenField(obj, "cacheCreationTokens") ?? 0,
    cacheReadTokens: tokenField(obj, "cacheReadTokens") ?? 0,
    thinkingTokens: tokenField(obj, "thinkingTokens") ?? 0,
    ...(obj.factoryCredits === undefined ? {} : { factoryCredits: tokenField(obj, "factoryCredits") }),
  }
}

function parseDroidRecord(raw: unknown): DroidUsageRecord | null {
  const obj = asObject(raw)
  if (!obj || obj.providerID !== "droid") return null
  const sessionID = nonEmptyString(obj.sessionID)
  const usage = parseTokenUsage(obj.usage)
  const total = parseTokenUsage(obj.total)
  if (!sessionID || !usage || !total) return null
  return {
    version: 1,
    providerID: "droid",
    sessionID,
    droidSessionID: nonEmptyString(obj.droidSessionID) ?? "",
    requestID: nonEmptyString(obj.requestID) ?? "",
    modelID: nonEmptyString(obj.modelID) ?? "",
    time: toNumber(obj.time) ?? 0,
    usage,
    total,
  }
}

/**
 * Validate the `{ version: 1, records: [...] }` RPC output. Returns null when
 * the payload does not match the published shape; malformed entries are
 * dropped individually so one bad record cannot blank the block.
 */
export function parseDroidUsagePayload(payload: unknown): DroidUsageRecord[] | null {
  const obj = asObject(payload)
  if (!obj || obj.version !== 1 || !Array.isArray(obj.records)) return null
  const out: DroidUsageRecord[] = []
  for (const raw of obj.records) {
    const record = parseDroidRecord(raw)
    if (record) out.push(record)
  }
  return out
}

/**
 * Keep only records belonging to the given session family, deduplicated per
 * OpenCode sessionID (latest `time` wins). Other sessions in the process are
 * never summed into the displayed total.
 */
export function filterDroidRecords(records: readonly DroidUsageRecord[] | undefined | null, family: readonly string[]): DroidUsageRecord[] {
  const wanted = new Set(family)
  const bySession = new Map<string, DroidUsageRecord>()
  for (const record of records ?? []) {
    if (!wanted.has(record.sessionID)) continue
    const existing = bySession.get(record.sessionID)
    if (!existing || record.time >= existing.time) bySession.set(record.sessionID, record)
  }
  return [...bySession.values()]
}

export interface DroidUsageSummary {
  /** Sessions in the family with at least one record. */
  sessions: number
  /**
   * Sum of per-session cumulative FSC, or null when no record reports the
   * field at all (unknown, never fabricated as zero). A real 0 is kept.
   */
  fsc: number | null
  /** Some in-scope records report FSC and some do not — the sum is a lower bound. */
  partial: boolean
  inputTokens: number
  outputTokens: number
}

export function summarizeDroidRecords(records: readonly DroidUsageRecord[]): DroidUsageSummary {
  let fsc = 0
  let known = 0
  let missing = 0
  let inputTokens = 0
  let outputTokens = 0
  for (const record of records) {
    const credits = record.total.factoryCredits
    if (typeof credits === "number" && Number.isFinite(credits)) {
      fsc += credits
      known++
    } else {
      missing++
    }
    inputTokens += (record.total.inputTokens ?? 0) + (record.total.cacheReadTokens ?? 0) + (record.total.cacheCreationTokens ?? 0)
    outputTokens += (record.total.outputTokens ?? 0) + (record.total.thinkingTokens ?? 0)
  }
  return {
    sessions: records.length,
    fsc: known > 0 ? fsc : null,
    partial: known > 0 && missing > 0,
    inputTokens,
    outputTokens,
  }
}

/** Compact FSC amount: "0", "0.075", "12.5", "1,234". No currency symbol. */
export function formatFsc(value: number): string {
  if (!Number.isFinite(value)) return "0"
  if (value >= 1000) return Math.round(value).toLocaleString("en-US")
  return value.toFixed(3).replace(/\.?0+$/, "")
}

/**
 * Session-tracked windows for the block (FSC + optional token totals).
 * Percent is always null — tracked consumption has no quota to express a
 * share of. Account-level windows come from checkDroidUsage's quota source.
 */
export function droidUsageWindows(summary: DroidUsageSummary, hasRecords: boolean): UsageWindow[] {
  const windows: UsageWindow[] = [{
    label: "Session FSC",
    percent: null,
    resetsAt: null,
    valueLabel: summary.fsc == null
      ? (hasRecords ? "unknown" : "waiting")
      : `${summary.partial ? "≥" : ""}${formatFsc(summary.fsc)} FSC`,
  }]
  if (summary.inputTokens > 0 || summary.outputTokens > 0) {
    windows.push({
      label: "Session tokens",
      percent: null,
      resetsAt: null,
      valueLabel: `${formatTokens(summary.inputTokens)} in / ${formatTokens(summary.outputTokens)} out`,
    })
  }
  return windows
}

/**
 * Sanitized error text. The RPC layer may throw `{ type, message, data }`
 * objects whose `data`/`message` can carry server-side detail — never echoed.
 */
export function droidRpcErrorMessage(error: unknown): string {
  const type = typeof (error as { type?: unknown } | null)?.type === "string"
    ? (error as { type: string }).type
    : null
  switch (type) {
    case "rpc.unavailable": return "usage RPC unavailable — is opencode-droid-v2 enabled at this location?"
    case "rpc.method_not_found": return "opencode-droid-v2 does not expose the usage RPC — update the plugin"
    case "rpc.invalid_input": return "usage RPC rejected the request"
    case "rpc.invalid_output": return "usage RPC returned an unexpected payload"
    case "rpc.internal": return "usage RPC failed"
  }
  if (type !== null) return "usage RPC failed"
  if (error instanceof Error && error.message) return error.message.slice(0, 160)
  return "usage request failed"
}

export interface DroidCheckOptions {
  /** Location the RPC/plugin gate applies to (forwarded to client.rpc options). */
  location?: { directory?: string }
  /** Account-quota source (e.g. makeFactoryAccountQuotaSource()); optional. */
  accountQuota?: DroidAccountQuotaSource
}

/**
 * Fetch + reduce Droid usage: session-family tracked FSC via the plugin RPC
 * plus, when a credential exists, real account quota from the official Factory
 * endpoint. The two halves degrade independently — a failed/missing RPC keeps
 * account quota, and a failed/missing quota keeps tracking — but nothing is
 * ever presented as something it is not (no model consumption shown as
 * account totals, no fabricated subscription figures).
 *
 * `query` is the method client obtained via `context.client.rpc(DROID_USAGE_RPC)`
 * (null when the host predates plugin RPC support). A single all-sessions
 * snapshot is fetched and filtered to the family — other sessions in the
 * process are never summed.
 */
export async function checkDroidUsage(
  query: DroidUsageQuery | null | undefined,
  family: readonly string[],
  options: DroidCheckOptions = {},
): Promise<ProviderUsageResult> {
  const name = DROID_PROVIDER_NAME
  const fail = (configured: boolean, message: string): ProviderUsageResult => ({
    providerId: "droid",
    providerName: name,
    configured,
    ok: false,
    status: `${name} — ${message}`,
    error: message,
  })

  // ── Session-tracked FSC via the droid plugin RPC ──
  let summary: DroidUsageSummary | null = null
  let scopedCount = 0
  let trackedError: string | null = null
  if (query) {
    try {
      const payload = await query.usage({}, { location: options.location })
      const records = parseDroidUsagePayload(payload)
      if (!records) {
        trackedError = "usage RPC returned an unexpected payload"
      } else {
        const scoped = filterDroidRecords(records, family)
        scopedCount = scoped.length
        summary = summarizeDroidRecords(scoped)
        // Family members without any record can't be proven to have consumed
        // nothing (counters are process-local and bounded), so a family sum
        // covering fewer sessions than the family is a lower bound, marked
        // partial rather than presented as the complete total.
        if (summary.fsc != null && scopedCount < family.length) {
          summary = { ...summary, partial: true }
        }
      }
    } catch (error) {
      trackedError = droidRpcErrorMessage(error)
    }
  }

  // ── Account quota (optional; never fabricated) ──
  // "none": no source wired · "missing": source ran but no credential/data ·
  // "failed": the request itself errored.
  let quota: DroidAccountQuota | null = null
  let quotaState: "none" | "missing" | "ok" | "failed" = "none"
  if (options.accountQuota) {
    quotaState = "missing"
    try {
      const result = await options.accountQuota()
      if (result && Array.isArray(result.windows) && result.windows.length > 0) {
        quota = result
        quotaState = "ok"
      }
    } catch {
      quotaState = "failed"
    }
  }

  if (!summary && !quota) {
    if (!query && quotaState === "none") return fail(false, "usage RPC unavailable on this OpenCode host")
    const reasons: string[] = []
    if (trackedError) reasons.push(trackedError)
    else if (!query) reasons.push("usage RPC unavailable on this host")
    if (quotaState === "failed") reasons.push("account usage request failed")
    else if (quotaState === "missing") reasons.push("no Factory credential (no CLI keyring, no saved web credential)")
    return fail(query != null || quotaState !== "none", reasons.join(" · ") || "no usage data available")
  }

  const windows: UsageWindow[] = []
  if (summary) {
    windows.push(...droidUsageWindows(summary, scopedCount > 0))
  } else {
    windows.push({ label: "Session FSC", percent: null, resetsAt: null, valueLabel: "unknown" })
  }
  if (quota) {
    windows.push(...quota.windows)
  } else {
    windows.push({
      label: "Account quota",
      percent: null,
      resetsAt: null,
      valueLabel: quotaState === "failed"
        ? "unknown (request failed)"
        : quotaState === "missing"
          ? "unavailable — no CLI keyring or saved web credential"
          : "unavailable — session-tracked",
    })
  }

  const trackedPart = summary
    ? (summary.fsc == null
      ? (scopedCount > 0 ? "FSC unknown (session-tracked)" : "waiting for tracked usage")
      : `${summary.partial ? "≥" : ""}${formatFsc(summary.fsc)} FSC tracked`)
    : "session tracking unavailable"
  const quotaPart = quotaState === "failed" ? " · account quota unknown" : ""
  return {
    providerId: "droid",
    providerName: name,
    configured: true,
    ok: true,
    status: `${name} — ${trackedPart}${quotaPart}`,
    windows,
    planLabel: quota?.planLabel ?? null,
  }
}
