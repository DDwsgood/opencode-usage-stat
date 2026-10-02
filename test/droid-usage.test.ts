import { test } from "node:test"
import assert from "node:assert/strict"
import {
  DROID_PLUGIN_ID,
  DROID_PROVIDER_NAME,
  DROID_USAGE_RPC,
  FACTORY_USAGE_URL,
  checkDroidUsage,
  droidRpcErrorMessage,
  droidUsageWindows,
  fetchFactorySubscriptionUsage,
  filterDroidRecords,
  formatFsc,
  hasEnabledDroidModel,
  isDroidUsageVisible,
  makeFactoryAccountQuotaSource,
  parseDroidUsagePayload,
  parseFactorySubscriptionUsage,
  resolveFactoryUsageCredential,
  summarizeDroidRecords,
} from "../src/droid-usage.js"
import type { DroidUsageRecord } from "../src/droid-usage.js"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  PROVIDERS,
  USAGE_STAT_PROVIDER_IDS,
  checkProviderUsage,
  collapsedSummary,
  resolveProviderUsageConfig,
  worstUsagePercent,
} from "../src/provider-usage.js"

function record(overrides: Partial<DroidUsageRecord> = {}): DroidUsageRecord {
  return {
    version: 1,
    providerID: "droid",
    sessionID: "ses_1",
    droidSessionID: "droid-1",
    requestID: "req-1",
    modelID: "claude-opus-4-1",
    time: 1000,
    usage: { inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0, thinkingTokens: 0, factoryCredits: 0.5 },
    total: { inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0, thinkingTokens: 0, factoryCredits: 0.5 },
    ...overrides,
  }
}

function fakeQuery(payload: unknown, seen?: { input?: unknown; options?: unknown }) {
  return {
    usage: async (input: { sessionID?: string }, options?: { location?: unknown }) => {
      if (seen) {
        seen.input = input
        seen.options = options
      }
      return payload
    },
  }
}

// ── Gate: strict AND of config + plugin + enabled model ──

test("isDroidUsageVisible requires all three conditions", () => {
  const all = { configEnabled: true, pluginIds: [DROID_PLUGIN_ID, "other"], hasDroidModel: true }
  assert.equal(isDroidUsageVisible(all), true)
  assert.equal(isDroidUsageVisible({ ...all, configEnabled: false }), false)
  assert.equal(isDroidUsageVisible({ ...all, pluginIds: [] }), false)
  assert.equal(isDroidUsageVisible({ ...all, pluginIds: ["other"] }), false)
  assert.equal(isDroidUsageVisible({ ...all, hasDroidModel: false }), false)
  // Installed plugin + model without opt-in is not enough.
  assert.equal(isDroidUsageVisible({ configEnabled: false, pluginIds: [DROID_PLUGIN_ID], hasDroidModel: true }), false)
})

test("hasEnabledDroidModel only counts enabled droid-provider models", () => {
  assert.equal(hasEnabledDroidModel([{ providerID: "droid", enabled: true }]), true)
  assert.equal(hasEnabledDroidModel([{ providerID: "droid", enabled: false }]), false)
  assert.equal(hasEnabledDroidModel([{ providerID: "devin", enabled: true }]), false)
  assert.equal(hasEnabledDroidModel([{ providerID: "droid" }]), false)
  assert.equal(hasEnabledDroidModel([]), false)
  assert.equal(hasEnabledDroidModel(undefined), false)
})

// ── Registry: opt-in default false, no credential path ──

test("droid registry entry is opt-in and has no env keys", () => {
  const spec = PROVIDERS.find(p => p.id === "droid")
  assert.ok(spec)
  assert.equal(spec.name, "Droid (Factory)")
  assert.deepEqual(spec.envKeys, [])
  assert.equal(resolveProviderUsageConfig({}).droid, false)
  assert.equal(resolveProviderUsageConfig({ providerUsage: { droid: true } }).droid, true)
  assert.equal(resolveProviderUsageConfig({ providerUsage: { droid: "yes" } }).droid, false)
  assert.ok(USAGE_STAT_PROVIDER_IDS.includes("droid"))
})

test("checkProviderUsage droid never touches the credential resolver or fetch", async () => {
  let resolverCalled = false
  let fetchCalled = false
  const result = await checkProviderUsage(
    "droid",
    (async () => { fetchCalled = true; throw new Error("must not fetch") }) as unknown as typeof fetch,
    () => { resolverCalled = true; return { value: "x", accountId: null, refresh: null, expires: null, source: "env" as const } },
  )
  assert.equal(result.ok, false)
  assert.equal(resolverCalled, false)
  assert.equal(fetchCalled, false)
})

// ── RPC descriptor shape ──

test("DROID_USAGE_RPC mirrors the opencode-droid-v2 portable descriptor", () => {
  assert.equal(DROID_USAGE_RPC.id, "opencode-droid-v2")
  assert.deepEqual(DROID_USAGE_RPC.events, {})
  const usage = DROID_USAGE_RPC.methods.usage
  assert.equal(usage.input.type, "object")
  assert.deepEqual(Object.keys(usage.input.properties ?? {}), ["sessionID"])
  assert.equal(usage.output.required?.includes("version"), true)
  assert.equal(usage.output.required?.includes("records"), true)
})

// ── Payload parsing ──

test("parseDroidUsagePayload validates version and records", () => {
  assert.equal(parseDroidUsagePayload(null), null)
  assert.equal(parseDroidUsagePayload({}), null)
  assert.equal(parseDroidUsagePayload({ version: 2, records: [] }), null)
  assert.equal(parseDroidUsagePayload({ version: 1 }), null)
  assert.deepEqual(parseDroidUsagePayload({ version: 1, records: [] }), [])
  // Malformed entries are dropped individually.
  const parsed = parseDroidUsagePayload({
    version: 1,
    records: [record(), { providerID: "other", sessionID: "ses_9" }, { providerID: "droid" }, "junk"],
  })
  assert.equal(parsed?.length, 1)
  assert.equal(parsed?.[0]?.sessionID, "ses_1")
})

test("parseDroidUsagePayload keeps missing factoryCredits undefined, not zero", () => {
  const rec = record()
  delete (rec.total as Record<string, unknown>).factoryCredits
  const parsed = parseDroidUsagePayload({ version: 1, records: [rec] })
  assert.equal(parsed?.[0]?.total.factoryCredits, undefined)
})

// ── Family filtering + per-session dedupe ──

test("filterDroidRecords scopes to the family and dedupes per session", () => {
  const records = [
    record({ sessionID: "ses_1", time: 1000, total: { factoryCredits: 1 } }),
    record({ sessionID: "ses_1", time: 2000, total: { factoryCredits: 2 } }), // newer wins
    record({ sessionID: "ses_2", total: { factoryCredits: 3 } }),
    record({ sessionID: "ses_other", total: { factoryCredits: 99 } }), // not in family
  ]
  const scoped = filterDroidRecords(records, ["ses_1", "ses_2"])
  assert.equal(scoped.length, 2)
  assert.equal(scoped.find(r => r.sessionID === "ses_1")?.total.factoryCredits, 2)
  assert.deepEqual(filterDroidRecords(records, ["ses_other"]).map(r => r.sessionID), ["ses_other"])
  assert.deepEqual(filterDroidRecords(records, []), [])
})

test("summarizeDroidRecords: 0 FSC is a real value, not unknown", () => {
  const summary = summarizeDroidRecords([record({ total: { factoryCredits: 0 } })])
  assert.equal(summary.fsc, 0)
  assert.equal(summary.partial, false)
  const windows = droidUsageWindows(summary, true)
  assert.equal(windows[0].valueLabel, "0 FSC")
})

test("summarizeDroidRecords: all-missing credits is unknown, never 0", () => {
  const noCredits = record({ total: { inputTokens: 5, outputTokens: 2 } })
  const summary = summarizeDroidRecords([noCredits])
  assert.equal(summary.fsc, null)
  assert.equal(summary.partial, false)
  const windows = droidUsageWindows(summary, true)
  assert.equal(windows[0].valueLabel, "unknown")
})

test("summarizeDroidRecords: partial credit coverage is a lower bound (>=)", () => {
  const summary = summarizeDroidRecords([
    record({ sessionID: "ses_1", total: { factoryCredits: 4 } }),
    record({ sessionID: "ses_2", total: { inputTokens: 1 } }),
  ])
  assert.equal(summary.fsc, 4)
  assert.equal(summary.partial, true)
  const windows = droidUsageWindows(summary, true)
  assert.equal(windows[0].valueLabel, "≥4 FSC")
})

test("droid windows never carry a percent or dollar sign", () => {
  const summary = summarizeDroidRecords([
    record({ sessionID: "ses_1", total: { factoryCredits: 12.5, inputTokens: 2000, outputTokens: 500 } }),
  ])
  const windows = droidUsageWindows(summary, true)
  assert.ok(windows.length >= 2)
  for (const w of windows) {
    assert.equal(w.percent, null)
    assert.equal(w.resetsAt, null)
    assert.equal((w.valueLabel ?? "").includes("$"), false)
  }
  assert.equal(worstUsagePercent(windows), null)
  // Collapsed header surfaces the tracked number.
  assert.equal(collapsedSummary(windows, "used"), "12.5 FSC")
})

test("formatFsc keeps small fractions and drops trailing zeros", () => {
  assert.equal(formatFsc(0), "0")
  assert.equal(formatFsc(0.075), "0.075")
  assert.equal(formatFsc(12.5), "12.5")
  assert.equal(formatFsc(1234), "1,234")
})

// ── checkDroidUsage orchestration ──

test("checkDroidUsage queries the all-session snapshot and filters to family", async () => {
  const seen: { input?: unknown; options?: unknown } = {}
  const query = fakeQuery({
    version: 1,
    records: [
      record({ sessionID: "ses_1", total: { factoryCredits: 1.5 } }),
      record({ sessionID: "ses_other", total: { factoryCredits: 50 } }),
    ],
  }, seen)
  const result = await checkDroidUsage(query, ["ses_1"], { location: { directory: "/proj" } })
  assert.deepEqual(seen.input, {}) // snapshot, not per-session probe
  assert.deepEqual(seen.options, { location: { directory: "/proj" } })
  assert.equal(result.ok, true)
  assert.equal(result.providerId, "droid")
  assert.equal(result.providerName, DROID_PROVIDER_NAME)
  // Only the in-family session contributes: 1.5, not 51.5.
  assert.equal(result.windows?.[0]?.valueLabel, "1.5 FSC")
  // Remaining is explicitly unavailable, never a fabricated subscription figure.
  const quota = result.windows?.find(w => w.label === "Account quota")
  assert.equal(quota?.percent, null)
  assert.ok(quota?.valueLabel?.includes("unavailable"))
})

test("checkDroidUsage without an RPC-capable client reports unavailable", async () => {
  const result = await checkDroidUsage(null, ["ses_1"])
  assert.equal(result.ok, false)
  assert.equal(result.configured, false)
  assert.match(result.status, /usage RPC unavailable/)
})

test("checkDroidUsage reports waiting when no records exist for the family", async () => {
  const result = await checkDroidUsage(fakeQuery({ version: 1, records: [] }), ["ses_1"])
  assert.equal(result.ok, true)
  assert.equal(result.windows?.[0]?.valueLabel, "waiting")
  assert.match(result.status, /waiting/)
})

test("checkDroidUsage sanitizes RPC error objects (no raw body/data leak)", async () => {
  const query = {
    usage: async () => {
      throw { type: "rpc.internal", message: "backend exploded with key sk-live-999", data: { secret: "sk-live-999" } }
    },
  }
  const result = await checkDroidUsage(query, ["ses_1"])
  assert.equal(result.ok, false)
  assert.doesNotMatch(result.status, /sk-live-999/)
  assert.doesNotMatch(result.error ?? "", /sk-live-999/)
})

test("checkDroidUsage rejects malformed payloads instead of fabricating", async () => {
  for (const bad of [null, {}, { version: 2, records: [] }, { records: "x" }]) {
    const result = await checkDroidUsage(fakeQuery(bad), ["ses_1"])
    assert.equal(result.ok, false)
    assert.match(result.status, /unexpected payload/)
  }
})

test("droidRpcErrorMessage maps typed failures without echoing data", () => {
  assert.match(droidRpcErrorMessage({ type: "rpc.method_not_found", message: "x", data: "secret" }), /update the plugin/)
  assert.match(droidRpcErrorMessage({ type: "rpc.unavailable" }), /unavailable/)
  assert.match(droidRpcErrorMessage(new Error("plain failure")), /plain failure/)
  assert.equal(droidRpcErrorMessage(42), "usage request failed")
})

// ── Reserved account-quota seam ──

test("checkDroidUsage accepts an optional account quota source", async () => {
  const result = await checkDroidUsage(
    fakeQuery({ version: 1, records: [record()] }),
    ["ses_1"],
    {
      accountQuota: async () => ({
        windows: [{ label: "Remaining", percent: 42, resetsAt: null, valueLabel: "58 left" }],
        planLabel: "Factory Pro",
      }),
    },
  )
  assert.equal(result.ok, true)
  assert.equal(result.planLabel, "Factory Pro")
  const remaining = result.windows?.find(w => w.label === "Remaining")
  assert.equal(remaining?.valueLabel, "58 left")
  // The unavailable placeholder is replaced, not duplicated.
  assert.equal(result.windows?.filter(w => w.label === "Account quota").length, 0)
})

test("checkDroidUsage keeps tracked FSC when the account quota source fails", async () => {
  const result = await checkDroidUsage(
    fakeQuery({ version: 1, records: [record()] }),
    ["ses_1"],
    { accountQuota: async () => { throw new Error("quota endpoint down") } },
  )
  assert.equal(result.ok, true)
  assert.equal(result.windows?.[0]?.valueLabel, "0.5 FSC")
  const quota = result.windows?.find(w => w.label === "Account quota")
  assert.ok(quota?.valueLabel?.includes("unknown"))
  assert.match(result.status, /account quota unknown/)
})

test("checkDroidUsage shows account quota even when the usage RPC is unavailable", async () => {
  const result = await checkDroidUsage(null, [], {
    accountQuota: async () => ({
      windows: [{ label: "Standard · 5h", percent: 20, resetsAt: null, valueLabel: null }],
    }),
  })
  assert.equal(result.ok, true)
  assert.equal(result.windows?.[0]?.label, "Session FSC")
  assert.equal(result.windows?.[0]?.valueLabel, "unknown")
  assert.equal(result.windows?.find(w => w.label === "Standard · 5h")?.percent, 20)
})

test("checkDroidUsage without credential reports quota unavailable, not failed", async () => {
  const result = await checkDroidUsage(
    fakeQuery({ version: 1, records: [record()] }),
    ["ses_1"],
    { accountQuota: async () => null },
  )
  assert.equal(result.ok, true)
  const quota = result.windows?.find(w => w.label === "Account quota")
  assert.match(quota?.valueLabel ?? "", /no saved web credential/)
})

test("checkDroidUsage marks family sums partial when member sessions lack records", async () => {
  // Root + one subagent child; only the root produced a droid record. The sum
  // is a lower bound (the bridge's counters are process-local and bounded),
  // so it is labeled partial, never presented as the complete family total.
  const result = await checkDroidUsage(
    fakeQuery({ version: 1, records: [record({ sessionID: "ses_root", total: { factoryCredits: 3 } })] }),
    ["ses_root", "ses_child"],
  )
  assert.equal(result.ok, true)
  assert.equal(result.windows?.[0]?.valueLabel, "≥3 FSC")
})

// ── Stale-session safety at the pure-helper level ──

test("records from a previous session never count toward the current family", () => {
  // Simulates an RPC snapshot that still holds the old session's record.
  const records = [
    record({ sessionID: "ses_old", total: { factoryCredits: 7 } }),
    record({ sessionID: "ses_new", total: { factoryCredits: 1 } }),
  ]
  const scoped = filterDroidRecords(records, ["ses_new"])
  assert.equal(scoped.length, 1)
  assert.equal(scoped[0].sessionID, "ses_new")
  assert.equal(summarizeDroidRecords(scoped).fsc, 1)
})

// ── Factory account quota parser (official app.factory.ai payload shape) ──

function factoryPayload() {
  return {
    data: {
      limits: {
        standard: {
          fiveHour: { usedPercent: 12, windowEnd: "2026-10-02T20:00:00Z", secondsRemaining: 7200 },
          weekly: { usedPercent: 40, windowEnd: "2026-10-09T00:00:00Z", secondsRemaining: 604800 },
          monthly: { usedPercent: 5, windowEnd: "2026-11-01T00:00:00Z", secondsRemaining: 2500000 },
        },
        core: {
          fiveHour: { usedPercent: 0, windowEnd: "2026-10-02T20:00:00Z", secondsRemaining: 7000 },
          weekly: { usedPercent: 1, windowEnd: "2026-10-09T00:00:00Z", secondsRemaining: 600000 },
        },
      },
      extraUsageBalanceCents: 0,
      extraUsageAllowed: true,
    },
  }
}

test("real billing-limits snapshot matches the screenshot with Bearer-only authentication", async () => {
  // Allowlisted quota fields from a real GET /api/billing/limits response.
  // No credentials, user IDs, organization IDs or account details are retained.
  const snapshot = {
    limits: {
      standard: {
        fiveHour: { usedPercent: 26, windowEnd: "2026-10-02T10:06:01.801Z", secondsRemaining: 10720 },
        weekly: { usedPercent: 38, windowEnd: "2026-10-08T17:18:03.833Z", secondsRemaining: 555042 },
        monthly: { usedPercent: 19, windowEnd: "2026-10-31T17:18:03.833Z", secondsRemaining: 2542242 },
      },
      core: {
        fiveHour: { usedPercent: 0, windowEnd: null, secondsRemaining: null },
        weekly: { usedPercent: 0, windowEnd: null, secondsRemaining: null },
        monthly: { usedPercent: 0, windowEnd: null, secondsRemaining: null },
      },
    },
    extraUsageBalanceCents: 0,
    extraUsageAllowed: true,
  }
  const seen: { url?: string; init?: RequestInit } = {}
  const quota = await fetchFactorySubscriptionUsage(
    { cookie: null, accessToken: "fixture-only", organizationId: null },
    factoryFetch(200, snapshot, seen),
  )
  assert.equal(seen.url, "https://api.factory.ai/api/billing/limits")
  const headers = seen.init!.headers as Record<string, string>
  assert.equal(headers.Authorization, "Bearer fixture-only")
  assert.equal(headers.Cookie, undefined)
  assert.equal(headers["X-Factory-Org-Id"], undefined)
  assert.deepEqual(quota.windows.slice(0, 3).map(window => ({
    label: window.label, used: window.percent, remaining: 100 - window.percent!, reset: window.resetsAt,
  })), [
    { label: "Standard · 5h", used: 26, remaining: 74, reset: "2026-10-02T10:06:01.801Z" },
    { label: "Standard · weekly", used: 38, remaining: 62, reset: "2026-10-08T17:18:03.833Z" },
    { label: "Standard · monthly", used: 19, remaining: 81, reset: "2026-10-31T17:18:03.833Z" },
  ])
  assert.deepEqual(quota.windows.slice(3, 6).map(window => [window.percent, window.resetsAt]), [[0, null], [0, null], [0, null]])
  assert.equal(quota.windows[6].valueLabel, "$0.00 cash balance")
})

test("legacy subscription usage ratios are not mistaken for billing limit windows", () => {
  assert.equal(parseFactorySubscriptionUsage({
    usage: { standard: { usedRatio: 0.19 }, premium: { usedRatio: 0 } },
    globalLimit: {}, userLimits: {},
  }), null)
})

test("parseFactorySubscriptionUsage parses a caller's response.data envelope", () => {
  const quota = parseFactorySubscriptionUsage(factoryPayload())
  assert.ok(quota)
  assert.equal(quota.planLabel, null) // no reliable plan field — never guessed
  const labels = quota.windows.map(w => w.label)
  assert.deepEqual(labels, [
    "Standard · 5h", "Standard · weekly", "Standard · monthly",
    "Core · 5h", "Core · weekly", "Extra usage",
  ])
  const fiveHour = quota.windows[0]
  assert.equal(fiveHour.percent, 12)
  assert.equal(fiveHour.resetsAt, "2026-10-02T20:00:00.000Z")
  // Real 0 values are legal, not "unknown".
  assert.equal(quota.windows[3].percent, 0)
  assert.equal(quota.windows[5].valueLabel, "$0.00 cash balance")
})

test("parseFactorySubscriptionUsage accepts a bare payload without the data wrapper", () => {
  const quota = parseFactorySubscriptionUsage(factoryPayload().data)
  assert.ok(quota)
  assert.equal(quota.windows[0].percent, 12)
})

test("parseFactorySubscriptionUsage applies official expired-window semantics", () => {
  const payload = factoryPayload()
  // secondsRemaining <= 0 => expired: official UI shows 0%, no reset.
  payload.data.limits.standard.fiveHour = { usedPercent: 77, windowEnd: "2026-10-02T20:00:00Z", secondsRemaining: 0 }
  // missing windowEnd => expired regardless of usedPercent.
  const weekly = payload.data.limits.standard.weekly as Record<string, unknown>
  delete weekly.windowEnd
  // Core section absent => its windows are omitted entirely (never fabricated).
  delete (payload.data.limits as Record<string, unknown>).core
  const quota = parseFactorySubscriptionUsage(payload)
  assert.ok(quota)
  assert.equal(quota.windows[0].percent, 0)
  assert.equal(quota.windows[0].resetsAt, null)
  assert.equal(quota.windows[1].percent, 0)
  assert.equal(quota.windows[1].resetsAt, null)
  assert.equal(quota.windows.some(w => w.label.startsWith("Core")), false)
})

test("parseFactorySubscriptionUsage keeps missing usedPercent unknown, not zero", () => {
  const payload = {
    data: {
      limits: {
        standard: { fiveHour: { windowEnd: "2030-01-01T00:00:00Z", secondsRemaining: 100 } },
      },
    },
  }
  const quota = parseFactorySubscriptionUsage(payload)
  assert.ok(quota)
  assert.equal(quota.windows[0].percent, null)
  assert.equal(quota.windows[0].valueLabel, "unknown")
  assert.equal(quota.windows[0].resetsAt, "2030-01-01T00:00:00.000Z")
})

test("parseFactorySubscriptionUsage: extraUsageAllowed false shows disabled, missing sections yield null", () => {
  const quota = parseFactorySubscriptionUsage({
    data: { limits: { standard: { fiveHour: { usedPercent: 10, windowEnd: "2030-01-01T00:00:00Z" } } }, extraUsageAllowed: false, extraUsageBalanceCents: 500 },
  })
  assert.ok(quota)
  const extra = quota.windows.find(w => w.label === "Extra usage")
  assert.equal(extra?.valueLabel, "disabled")
  assert.equal(parseFactorySubscriptionUsage(null), null)
  assert.equal(parseFactorySubscriptionUsage({}), null)
  assert.equal(parseFactorySubscriptionUsage({ data: {} }), null)
  assert.equal(parseFactorySubscriptionUsage({ data: { limits: {} } }), null)
})

// ── Factory fetcher (mocked fetch, offline) ──

function factoryFetch(status: number, body: unknown, seen?: { url?: string; init?: RequestInit }) {
  return (async (url: string, init?: RequestInit) => {
    if (seen) {
      seen.url = url
      seen.init = init
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response
  }) as unknown as typeof fetch
}

test("fetchFactorySubscriptionUsage hits the fixed endpoint with Bearer + org headers, manual redirects", async () => {
  const seen: { url?: string; init?: RequestInit } = {}
  const quota = await fetchFactorySubscriptionUsage(
    { cookie: null, accessToken: "tok-1", organizationId: "org-9" },
    factoryFetch(200, factoryPayload(), seen),
  )
  assert.equal(seen.url, FACTORY_USAGE_URL)
  assert.equal(seen.url, "https://api.factory.ai/api/billing/limits")
  const headers = seen.init!.headers as Record<string, string>
  assert.equal(headers.Authorization, "Bearer tok-1")
  assert.equal(headers["X-Factory-Org-Id"], "org-9")
  assert.equal(headers.Cookie, undefined)
  assert.equal((seen.init as { redirect?: string }).redirect, "manual")
  assert.equal(quota.windows[0].percent, 12)
})

test("fetchFactorySubscriptionUsage uses the Cookie header when only a cookie is saved", async () => {
  const seen: { url?: string; init?: RequestInit } = {}
  await fetchFactorySubscriptionUsage(
    { cookie: "session=abc", accessToken: null, organizationId: null },
    factoryFetch(200, factoryPayload(), seen),
  )
  const headers = seen.init!.headers as Record<string, string>
  assert.equal(headers.Cookie, "session=abc")
  assert.equal(headers.Authorization, undefined)
  assert.equal(headers["X-Factory-Org-Id"], undefined)
})

test("fetchFactorySubscriptionUsage sends both Bearer and Cookie when both are saved", async () => {
  const seen: { url?: string; init?: RequestInit } = {}
  await fetchFactorySubscriptionUsage(
    { cookie: "session=abc", accessToken: "tok-1", organizationId: "org-9" },
    factoryFetch(200, factoryPayload(), seen),
  )
  const headers = seen.init!.headers as Record<string, string>
  assert.equal(headers.Authorization, "Bearer tok-1")
  assert.equal(headers.Cookie, "session=abc")
  assert.equal(headers["X-Factory-Org-Id"], "org-9")
})

test("fetchFactorySubscriptionUsage never leaks the error body", async () => {
  const secretBody = "account alice@corp.io suspended, token tok-leak"
  const fetchImpl = (async () => ({
    ok: false, status: 401,
    json: async () => ({}), text: async () => secretBody,
  }) as Response) as unknown as typeof fetch
  await assert.rejects(
    fetchFactorySubscriptionUsage({ cookie: null, accessToken: "tok-leak", organizationId: null }, fetchImpl),
    (err: unknown) => {
      assert.match(String(err), /session expired/i)
      assert.doesNotMatch(String(err), /tok-leak|alice@corp\.io/)
      return true
    },
  )
  const fetch500 = (async () => ({
    ok: false, status: 500,
    json: async () => ({}), text: async () => "PII tok-leak",
  }) as Response) as unknown as typeof fetch
  await assert.rejects(
    fetchFactorySubscriptionUsage({ cookie: null, accessToken: "tok-leak", organizationId: null }, fetch500),
    (err: unknown) => {
      assert.match(String(err), /API error: 500/)
      assert.doesNotMatch(String(err), /tok-leak|PII/)
      return true
    },
  )
})

test("fetchFactorySubscriptionUsage rejects unparseable payloads", async () => {
  await assert.rejects(
    fetchFactorySubscriptionUsage({ cookie: "c", accessToken: null, organizationId: null }, factoryFetch(200, { hello: 1 })),
    /could not be parsed/,
  )
})

// ── Saved web credential (temp XDG dir, offline) ──

test("resolveFactoryUsageCredential reads the secure provider JSON only", () => {
  const previous = process.env.XDG_CONFIG_HOME
  const dir = mkdtempSync(join(tmpdir(), "droid-creds-"))
  try {
    process.env.XDG_CONFIG_HOME = dir
    // No file at all -> null.
    assert.equal(resolveFactoryUsageCredential(), null)
    // Empty object -> null (no usable secret).
    mkdirSync(join(dir, "opencode", "usage-stat"), { recursive: true })
    writeFileSync(join(dir, "opencode", "usage-stat", "droid.json"), "{}")
    assert.equal(resolveFactoryUsageCredential(), null)
    // Cookie variant.
    writeFileSync(
      join(dir, "opencode", "usage-stat", "droid.json"),
      JSON.stringify({ cookie: "session=x", organizationId: "org-1" }),
    )
    assert.deepEqual(resolveFactoryUsageCredential(), { cookie: "session=x", accessToken: null, organizationId: "org-1" })
    // The openchamber slot wins wholesale when both files exist (first hit, no merge).
    mkdirSync(join(dir, "openchamber", "quota"), { recursive: true })
    writeFileSync(join(dir, "openchamber", "quota", "droid.json"), JSON.stringify({ accessToken: "at-1" }))
    assert.deepEqual(resolveFactoryUsageCredential(), { cookie: null, accessToken: "at-1", organizationId: null })
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
  }
})

test("makeFactoryAccountQuotaSource returns null without a saved credential", async () => {
  const previous = process.env.XDG_CONFIG_HOME
  const dir = mkdtempSync(join(tmpdir(), "droid-nocred-"))
  try {
    process.env.XDG_CONFIG_HOME = dir
    const source = makeFactoryAccountQuotaSource(factoryFetch(200, factoryPayload()))
    assert.equal(await source(), null)
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
  }
})

test("makeFactoryAccountQuotaSource fetches with the saved credential", async () => {
  const previous = process.env.XDG_CONFIG_HOME
  const dir = mkdtempSync(join(tmpdir(), "droid-cred-"))
  mkdirSync(join(dir, "opencode", "usage-stat"), { recursive: true })
  writeFileSync(join(dir, "opencode", "usage-stat", "droid.json"), JSON.stringify({ accessToken: "at-9", organizationId: "o" }))
  const seen: { url?: string; init?: RequestInit } = {}
  try {
    process.env.XDG_CONFIG_HOME = dir
    const source = makeFactoryAccountQuotaSource(factoryFetch(200, factoryPayload(), seen))
    const quota = await source()
    assert.ok(quota)
    assert.equal((seen.init!.headers as Record<string, string>).Authorization, "Bearer at-9")
    assert.equal(quota.windows[0].percent, 12)
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
  }
})
