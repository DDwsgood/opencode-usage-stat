import { test } from "node:test"
import assert from "node:assert/strict"
import {
  parseOpenCodeGoUsage,
  parseDeepSeekBalance,
  parseCodexUsage,
  parseClaudeUsage,
  parseKimiUsage,
  parseZaiUsage,
  parseZhipuaiUsage,
  parseMiniMaxUsage,
  parseOpenRouterCredits,
  parseOllamaSettingsHtml,
  buildCopilotWindows,
  parseCursorUsage,
  parseXaiUsage,
  parseCommandCodeUsage,
  parseDevinUsage,
  fetchDevinUsage,
  worstUsagePercent,
  hasEnabledDevinModel,
  isDevinUsageVisible,
  devinLocationKey,
  devinGatePlugins,
  DEVIN_PLUGIN_ID,
  DEVIN_API_FALLBACK_URL,
  collapsedSummary,
  fetchOpenCodeGoUsage,
  fetchDeepSeekBalance,
  fetchCodexUsage,
  fetchCommandCodeUsage,
  checkProviderUsage,
  resolveProviderUsageConfig,
  USAGE_STAT_PROVIDER_IDS,
} from "../src/provider-usage.js"
import { readDevinCredentials } from "../src/credentials.js"
// The default "solid-js" import resolves to the non-reactive server build in
// node tests; the dist client build gives real memo/effect semantics here.
// @ts-ignore -- no bundled types for the dist subpath
import { createRoot, createSignal, createMemo, createComputed } from "solid-js/dist/solid.js"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// ── Pure parsers ──

test("parseOpenCodeGoUsage extracts rolling/weekly/monthly windows", () => {
  const windows = parseOpenCodeGoUsage({
    usage: {
      rolling: { percent: 42.5, resetsAt: "2026-08-21T12:00:00.000Z" },
      weekly: { percent: 12, resetsAt: "2026-08-24T00:00:00.000Z" },
      monthly: { percent: 7, resetsAt: "2026-09-01T00:00:00.000Z" },
    },
  })
  assert.equal(windows.length, 3)
  assert.equal(windows[0].label, "Rolling")
  assert.equal(windows[0].percent, 42.5)
  assert.equal(windows[1].label, "Weekly")
  assert.equal(windows[2].label, "Monthly")
})

test("parseOpenCodeGoUsage skips invalid entries and clamps percent", () => {
  const windows = parseOpenCodeGoUsage({
    usage: {
      rolling: { percent: 150, resetsAt: "2026-08-21T12:00:00.000Z" },
      weekly: { percent: "nope" },
      monthly: { percent: -5, resetsAt: "bad-date" },
    },
  })
  assert.equal(windows[0].percent, 100)
  assert.equal(windows.length, 1)
})

test("parseOpenCodeGoUsage returns [] for empty/malformed payload", () => {
  assert.deepEqual(parseOpenCodeGoUsage(null), [])
  assert.deepEqual(parseOpenCodeGoUsage({}), [])
  assert.deepEqual(parseOpenCodeGoUsage({ usage: null }), [])
})

test("parseDeepSeekBalance prefers USD over CNY", () => {
  const windows = parseDeepSeekBalance({
    is_available: true,
    balance_infos: [
      { currency: "CNY", total_balance: "100.00" },
      { currency: "USD", total_balance: "5.25" },
    ],
  })
  assert.equal(windows.length, 1)
  assert.equal(windows[0].label, "Balance")
  assert.equal(windows[0].valueLabel, "$5.25")
  assert.equal(windows[0].percent, null)
})

test("parseDeepSeekBalance falls back to CNY", () => {
  const windows = parseDeepSeekBalance({
    balance_infos: [{ currency: "CNY", total_balance: "88.4" }],
  })
  assert.equal(windows[0].valueLabel, "¥88.40 CNY")
})

test("parseDeepSeekBalance returns [] when balance missing", () => {
  assert.deepEqual(parseDeepSeekBalance({ balance_infos: [] }), [])
  assert.deepEqual(parseDeepSeekBalance({}), [])
  assert.deepEqual(parseDeepSeekBalance(null), [])
})

test("parseCodexUsage parses primary/secondary windows and credits", () => {
  const windows = parseCodexUsage({
    rate_limit: {
      primary_window: { used_percent: 33.3, limit_window_seconds: 3600, reset_at: "2026-08-21T12:00:00.000Z" },
      secondary_window: { used_percent: 80, limit_window_seconds: 21600, reset_at: "2026-08-21T12:00:00.000Z" },
    },
    credits: { balance: 1.5, unlimited: false },
  })
  assert.equal(windows.length, 3)
  assert.equal(windows[0].label, "1h")
  assert.equal(windows[0].percent, 33.3)
  assert.equal(windows[1].label, "6h")
  assert.equal(windows[1].percent, 80)
  assert.equal(windows[2].label, "Credits")
  assert.equal(windows[2].valueLabel, "$1.50")
})

test("parseCodexUsage accepts Unix-second reset timestamps", () => {
  const windows = parseCodexUsage({
    rate_limit: {
      primary_window: { used_percent: 25, limit_window_seconds: 18_000, reset_at: 1_800_000_000 },
    },
  })
  assert.equal(windows[0].resetsAt, "2027-01-15T08:00:00.000Z")
})

test("parseCodexUsage handles spend control and unlimited credits", () => {
  const windows = parseCodexUsage({
    credits: { balance: 0, unlimited: true },
    spend_control: { individual_limit: { used: 12, limit: 50, used_percent: 24 } },
  })
  assert.equal(windows.length, 2)
  assert.equal(windows[0].valueLabel, "Unlimited")
  assert.equal(windows[1].label, "Spend Limit")
  assert.equal(windows[1].percent, 24)
})

// ── Fetchers with mocked fetch (no network) ──

function mockFetch(status: number, body: unknown): typeof fetch {
  return (async () => {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response
  }) as unknown as typeof fetch
}

test("fetchOpenCodeGoUsage uses Bearer header and parses", async () => {
  let seenAuth = ""
  const calledWith = (init?: RequestInit) => {
    seenAuth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "")
  }
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    calledWith(init)
    return {
      ok: true,
      status: 200,
      json: async () => ({ usage: { rolling: { percent: 10, resetsAt: "2026-08-21T12:00:00.000Z" } } }),
      text: async () => "{}",
    } as Response
  }) as unknown as typeof fetch

  const windows = await fetchOpenCodeGoUsage("test-secret", fetchImpl)
  assert.equal(windows.length, 1)
  assert.equal(seenAuth, "Bearer test-secret")
})

test("fetchOpenCodeGoUsage throws on 401 without leaking the key", async () => {
  const fetchImpl = (async () => ({ ok: false, status: 401, text: async () => "{}", json: async () => ({}) }) as Response) as unknown as typeof fetch
  await assert.rejects(fetchOpenCodeGoUsage("secret", fetchImpl), /authentication failed/)
})

test("fetchDeepSeekBalance parses USD", async () => {
  const fetchImpl = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ balance_infos: [{ currency: "USD", total_balance: "9.99" }] }),
    text: async () => "{}",
  }) as Response) as unknown as typeof fetch
  const windows = await fetchDeepSeekBalance("ds-secret", fetchImpl)
  assert.equal(windows[0].valueLabel, "$9.99")
})

test("fetchCodexUsage sends ChatGPT-Account-Id when account present", async () => {
  let accountHeader = ""
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    accountHeader = String((init?.headers as Record<string, string> | undefined)?.["ChatGPT-Account-Id"] ?? "")
    return {
      ok: true,
      status: 200,
      json: async () => ({ credits: { balance: 2, unlimited: false } }),
      text: async () => "{}",
    } as Response
  }) as unknown as typeof fetch
  const windows = await fetchCodexUsage("codex-secret", "acct-123", fetchImpl)
  assert.equal(accountHeader, "acct-123")
  assert.equal(windows[0].valueLabel, "$2.00")
})

test("parseCommandCodeUsage maps 5h, weekly, monthly, and plan data", () => {
  const parsed = parseCommandCodeUsage({
    credits: {
      credits: { monthlyCredits: 38, purchasedCredits: 5, freeCredits: 2, planId: "individual-pro-v1" },
      windowLimits: {
        limited: true,
        fiveHour: { used: 5.6, cap: 16, resetAt: 1785487200000 },
        weekly: { used: 12.4, cap: 40, resetAt: 1785600000000 },
      },
    },
    subscription: {
      data: {
        planId: "individual-pro-v1",
        currentPeriodEnd: "2026-09-01T00:00:00.000Z",
      },
    },
    summary: { totalCost: 37.5 },
  })
  assert.equal(parsed.planLabel, "Pro")
  assert.deepEqual(parsed.windows.map(window => window.label), ["5h", "7d", "Monthly", "Credits"])
  assert.equal(parsed.windows[0].percent, 35)
  assert.equal(parsed.windows[1].percent, 31)
  assert.ok(Math.abs((parsed.windows[2].percent ?? 0) - (37.5 / 82.5) * 100) < 1e-9)
  assert.equal(parsed.windows[2].resetsAt, "2026-09-01T00:00:00.000Z")
  assert.equal(parsed.windows[3].valueLabel, "$45.00 left")
})

test("parseCommandCodeUsage omits rolling windows for unlimited plans", () => {
  const parsed = parseCommandCodeUsage({
    credits: {
      credits: { purchasedCredits: 20, planId: "individual-provider" },
      windowLimits: { limited: false },
    },
    subscription: { data: { currentPeriodEnd: "2026-09-01T00:00:00Z" } },
    summary: { totalCost: 5 },
  })
  assert.deepEqual(parsed.windows.map(window => window.label), ["Monthly", "Credits"])
  assert.equal(parsed.planLabel, "Provider")
})

test("fetchCommandCodeUsage follows the official CLI alpha endpoint sequence", async () => {
  const paths: string[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    paths.push(url)
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer command-secret")
    const body = url.endsWith("/alpha/whoami")
      ? { org: { id: "org_1" } }
      : url.includes("/alpha/billing/credits?")
        ? { credits: { monthlyCredits: 10 }, windowLimits: { limited: true, fiveHour: { used: 1, cap: 10 } } }
        : url.includes("/alpha/billing/subscriptions?")
          ? { data: { planId: "individual-goat", currentPeriodStart: "2026-08-01T00:00:00Z", currentPeriodEnd: "2026-09-01T00:00:00Z" } }
          : { totalCost: 2 }
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
  }) as unknown as typeof fetch

  const parsed = await fetchCommandCodeUsage("command-secret", fetchImpl)
  assert.equal(parsed.planLabel, "GOAT")
  assert.equal(parsed.windows[0].label, "5h")
  assert.equal(paths.length, 4)
  assert.ok(paths.some(path => path.includes("/alpha/billing/credits?orgId=org_1")))
  assert.ok(paths.some(path => path.includes("/alpha/usage/summary?orgId=org_1&since=2026-08-01T00%3A00%3A00Z")))
})

test("fetchCommandCodeUsage works with a user key that has no organization", async () => {
  const paths: string[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    paths.push(url)
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer command-secret")
    const body = url.endsWith("/alpha/whoami")
      ? { success: true, user: { id: "user_1" }, org: null }
      : url.endsWith("/alpha/billing/credits")
        ? { credits: { monthlyCredits: 70 }, windowLimits: { limited: true, fiveHour: { used: 1, cap: 14 }, weekly: { used: 2, cap: 35 } } }
        : url.endsWith("/alpha/billing/subscriptions")
          ? { data: { planId: "individual-goat", currentPeriodStart: "2026-08-01T00:00:00Z", currentPeriodEnd: "2026-09-01T00:00:00Z" } }
          : { totalCost: 2 }
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
  }) as unknown as typeof fetch

  const parsed = await fetchCommandCodeUsage("command-secret", fetchImpl)
  assert.equal(parsed.planLabel, "GOAT")
  assert.equal(parsed.windows[0].label, "5h")
  assert.equal(paths.length, 4)
  assert.ok(paths.some(path => path.endsWith("/alpha/billing/credits")))
  assert.ok(paths.some(path => path.endsWith("/alpha/billing/subscriptions")))
  assert.ok(paths.some(path => path.includes("/alpha/usage/summary?since=2026-08-01T00%3A00%3A00Z")))
  assert.ok(paths.every(path => !path.includes("orgId")))
})

test("fetchCommandCodeUsage reports rejected credentials without leaking the key", async () => {
  const fetchImpl = (async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: "invalid credentials" }),
    text: async () => JSON.stringify({ error: "invalid credentials" }),
  }) as Response) as unknown as typeof fetch
  await assert.rejects(fetchCommandCodeUsage("command-secret", fetchImpl), error => {
    assert.match(String(error), /session expired/i)
    assert.doesNotMatch(String(error), /command-secret/)
    return true
  })
})

// checkProviderUsage with injected fake credentials (offline, never touches real auth)

function fakeCredential(value: string | null, accountId: string | null = null) {
  return () => ({ value, accountId, refresh: null, expires: null, source: "env" as const })
}

test("checkProviderUsage returns not-configured when no credential", async () => {
  const result = await checkProviderUsage("opencode-go", mockFetch(200, {}), fakeCredential(null))
  assert.equal(result.configured, false)
  assert.equal(result.ok, false)
  assert.equal(result.status.includes("not configured"), true)
})

test("checkProviderUsage rejects unknown provider", async () => {
  const result = await checkProviderUsage("unknown" as never, mockFetch(200, {}), fakeCredential(null))
  assert.equal(typeof result.providerId, "string")
  assert.equal(result.ok, false)
})

test("deepseek with injected credential parses balance (offline)", async () => {
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? ""
    assert.equal(auth, "Bearer test-ds-key-123")
    return {
      ok: true,
      status: 200,
      json: async () => ({ balance_infos: [{ currency: "USD", total_balance: "3.33" }] }),
      text: async () => "{}",
    } as Response
  }) as unknown as typeof fetch
  const result = await checkProviderUsage("deepseek", fetchImpl, fakeCredential("test-ds-key-123"))
  assert.equal(result.configured, true)
  assert.equal(result.ok, true)
  assert.equal(result.windows?.[0]?.valueLabel, "$3.33")
})

test("codex with injected credential sends accountId and parses", async () => {
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const account = (init?.headers as Record<string, string> | undefined)?.["ChatGPT-Account-Id"] ?? ""
    assert.equal(account, "acct-codex")
    return {
      ok: true,
      status: 200,
      json: async () => ({ rate_limit: { primary_window: { used_percent: 50, limit_window_seconds: 3600 } } }),
      text: async () => "{}",
    } as Response
  }) as unknown as typeof fetch
  const result = await checkProviderUsage("codex", fetchImpl, fakeCredential("codex-secret", "acct-codex"))
  assert.equal(result.ok, true)
  assert.equal(result.windows?.[0]?.percent, 50)
})

test("provider failure surfaces clear error without secrets", async () => {
  const fetchImpl = (async () => ({ ok: false, status: 500, text: async () => "boom", json: async () => ({}) }) as Response) as unknown as typeof fetch
  const result = await checkProviderUsage("opencode-go", fetchImpl, fakeCredential("secret-xyz"))
  assert.equal(result.ok, false)
  assert.equal(result.status.includes("secret-xyz"), false)
})

// ── Provider usage opt-in config (pure; no credentials involved) ──

test("resolveProviderUsageConfig defaults all providers to disabled", () => {
  const disabled = Object.fromEntries(USAGE_STAT_PROVIDER_IDS.map(id => [id, false]))
  assert.deepEqual(resolveProviderUsageConfig(undefined), disabled)
  assert.deepEqual(resolveProviderUsageConfig(null), disabled)
  assert.deepEqual(resolveProviderUsageConfig({}), disabled)
  assert.deepEqual(resolveProviderUsageConfig({ providerUsage: null }), disabled)
  assert.deepEqual(resolveProviderUsageConfig({ providerUsage: {} }), disabled)
})

test("resolveProviderUsageConfig enables only explicitly true providers", () => {
  const config = resolveProviderUsageConfig({
    providerUsage: { "opencode-go": true, deepseek: "yes", codex: true, "command-code": true },
  })
  assert.equal(config["opencode-go"], true)
  assert.equal(config.deepseek, false)
  assert.equal(config.codex, true)
  assert.equal(config["command-code"], true)
  assert.equal(config.claude, false)
})

test("resolveProviderUsageConfig ignores false, 1, and unknown provider keys", () => {
  const config = resolveProviderUsageConfig({
    providerUsage: { "opencode-go": false, codex: 1, h4x: true },
  })
  const all = resolveProviderUsageConfig({})
  assert.equal(config["opencode-go"], false)
  assert.equal(config.codex, false)
  for (const id of USAGE_STAT_PROVIDER_IDS) {
    assert.equal(typeof config[id], "boolean")
    void all[id]
  }
})

// ── Claude ──

test("parseClaudeUsage extracts 5h/weekly windows and ignores monthly extras in collapsed summary", () => {
  const windows = parseClaudeUsage({
    limits: [
      { kind: "session", percent: 37.4, resets_at: "2026-08-23T18:00:00Z" },
      { kind: "weekly_all", percent: 12.5, resets_at: "2026-08-25T00:00:00Z" },
    ],
    spend: { enabled: true, percent: 3, used: { amount_minor: 150, exponent: 2, currency: "USD" } },
  })
  assert.equal(windows[0].label, "5h")
  assert.equal(windows[0].percent, 37.4)
  assert.equal(windows[1].label, "7d")
  assert.equal(collapsedSummary(windows, "used"), "37%/5h 13%/7d")
})

test("parseClaudeUsage falls back to legacy five_hour/seven_day and adds scoped models after aggregates", () => {
  const windows = parseClaudeUsage({
    five_hour: { utilization: 10, resets_at: "2026-08-23T18:00:00Z" },
    seven_day: { utilization: 20, resets_at: "2026-08-25T00:00:00Z" },
    limits: [],
  })
  assert.deepEqual(windows.map(w => w.label), ["5h", "7d"])
})

// ── Kimi / z.ai / Zhipu / MiniMax ──

test("parseKimiUsage derives weekly + rate-limit windows from used or remaining", () => {
  const windows = parseKimiUsage({
    usage: { limit: 1000, used: 250, resetTime: "2026-08-24T00:00:00Z" },
    limits: [
      { window: { duration: 5, timeUnit: "TIME_UNIT_HOUR" }, detail: { limit: 200, remaining: 50, resetTime: "2026-08-23T20:00:00Z" } },
    ],
  })
  assert.equal(windows.find(w => w.label === "Weekly")?.percent, 25)
  assert.equal(windows.find(w => w.label === "Rate Limit (5h)")?.percent, 75)
})

test("parseZaiUsage maps credit limits and MCP tools with plan label", () => {
  const payload = {
    data: {
      level: "Pro",
      limits: [
        { type: "CREDIT_LIMIT", unit: 6, number: 1, percentage: 40.2, nextResetTime: 1756000000000, currentValue: 400, usage: 1000 },
        { type: "TIME_LIMIT", percentage: 8, nextResetTime: 1758000000000 },
      ],
    },
  }
  const windows = parseZaiUsage(payload)
  assert.equal(windows[0].label, "weekly")
  assert.equal(windows[0].percent, 40.2)
  assert.equal(windows[1].label, "MCP Tools")
  assert.ok(windows[0].valueLabel?.includes("400"))
})

test("parseZhipuaiUsage maps Tokens + MCP Tools", () => {
  const windows = parseZhipuaiUsage({
    data: { limits: [
      { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 55, nextResetTime: 1756000000000 },
      { type: "TIME_LIMIT", percentage: 12, nextResetTime: 1758000000000 },
    ] },
  })
  assert.deepEqual(windows.map(w => w.label), ["Tokens", "MCP Tools"])
  assert.equal(windows[0].percent, 55)
})

test("parseMiniMaxUsage honors remaining-field semantics for the CN endpoint", () => {
  const base = {
    base_resp: { status_code: 0 },
    model_remains: [{
      current_interval_total_count: 100,
      current_interval_usage_count: 30,
      current_weekly_total_count: 700,
      current_weekly_usage_count: 140,
      end_time: 1756000000000,
      weekly_end_time: 1758000000000,
    }],
  }
  const used = parseMiniMaxUsage(base, false)
  assert.equal(used.find(w => w.label === "5h")?.percent, 30)
  assert.equal(used.find(w => w.label === "weekly")?.percent, 20)

  const remaining = parseMiniMaxUsage(base, true)
  assert.equal(remaining.find(w => w.label === "5h")?.percent, 70)
  assert.equal(remaining.find(w => w.label === "weekly")?.percent, 80)
})

// ── OpenRouter / Ollama Cloud / Copilot / Cursor ──

test("parseOpenRouterCredits formats remaining/spent label", () => {
  const windows = parseOpenRouterCredits({ data: { total_credits: 50, total_usage: 12.5 } })
  assert.equal(windows[0].valueLabel, "$37.50 left · $12.50 spent")
  assert.deepEqual(parseOpenRouterCredits({ data: {} }), [])
})

test("parseOllamaSettingsHtml scrapes session/weekly/premium percentages", () => {
  const html = `<div>Session usage 42%</div><div>Weekly usage 7%</div><div>Premium requests 12 / 100</div>`
  const windows = parseOllamaSettingsHtml(html)
  assert.deepEqual(windows.map(w => w.label), ["Session", "Weekly", "Premium"])
  assert.equal(windows[0].percent, 42)
  assert.equal(windows[2].valueLabel, "12 / 100")
  assert.deepEqual(parseOllamaSettingsHtml("<p>nothing here</p>"), [])
})

test("parseOllamaSettingsHtml scrapes new monthly-dollar billing", () => {
  const html = `<h2>Included usage</h2><span class="rounded-full" >pro</span>
    <span class="text-sm">Monthly usage</span><span>$12.5 of $60 used</span>
    <div class="local-time" data-time="2026-10-02T09:54:08Z">Resets in 4 weeks.</div>
    <div>Balance remaining</div><div class="text-2xl">$3.20</div>`
  const windows = parseOllamaSettingsHtml(html)
  assert.equal(windows.length, 2)
  assert.equal(windows[0].label, "Monthly")
  assert.equal(windows[0].percent, 12.5 / 60 * 100)
  assert.equal(windows[0].valueLabel, "$47.50 / $60.00 left")
  assert.equal(windows[0].resetsAt, "2026-10-02T09:54:08.000Z")
  assert.equal(windows[1].label, "Extra (pro)")
  assert.equal(windows[1].valueLabel, "$3.20 left")
})

test("parseOllamaSettingsHtml new billing wins over legacy scrapes", () => {
  const html = `<div>Session usage 42%</div><div>Weekly usage 7%</div>
    <span>Monthly usage</span><span>$30 of $60 used</span>`
  const windows = parseOllamaSettingsHtml(html)
  assert.deepEqual(windows.map(w => w.label), ["Monthly"])
  assert.equal(windows[0].percent, 50)
})

test("buildCopilotWindows computes used percent from entitlement/remaining", () => {
  const windows = buildCopilotWindows({
    quota_reset_date: "2026-09-01T00:00:00Z",
    quota_snapshots: {
      chat: { entitlement: 300, remaining: 150 },
      premium_interactions: { entitlement: 1000, remaining: 990 },
    },
  })
  assert.deepEqual(windows.map(w => w.label), ["chat", "premium"])
  assert.equal(windows[0].percent, 50)
  assert.equal(windows[0].valueLabel, "150 / 300 left")
})

test("parseCursorUsage reads planUsage.totalPercentUsed", () => {
  const windows = parseCursorUsage({
    planUsage: { totalPercentUsed: 33 },
    billingCycleEnd: "2026-09-15T00:00:00Z",
  })
  assert.equal(windows[0].label, "Billing Cycle")
  assert.equal(windows[0].percent, 33)
  assert.deepEqual(parseCursorUsage({}), [])
})

// ── xAI protobuf (synthetic minimal frame) ──

function xaiFrame(fields: Array<{ path: number[]; kind: "float" | "varint"; value: number }>): Uint8Array {
  // Build one flat message: floats use field 1 (wire type 5), varints field 2.
  const chunks: number[] = []
  for (const f of fields) {
    if (f.kind === "float") {
      chunks.push(0x0d) // field 1, wire 5
      const buf = new ArrayBuffer(4)
      new DataView(buf).setFloat32(0, f.value, true)
      chunks.push(...new Uint8Array(buf))
    } else {
      chunks.push(0x10) // field 2, wire 0
      let v = Math.floor(f.value)
      do {
        let byte = v & 0x7f
        v >>>= 7
        if (v > 0) byte |= 0x80
        chunks.push(byte)
      } while (v > 0)
    }
  }
  return new Uint8Array(chunks)
}

test("parseXaiUsage extracts percent and reset from a gRPC-web framed response", () => {
  const nowSec = Math.floor(Date.now() / 1000) + 3600
  const inner = xaiFrame([
    { path: [1], kind: "float", value: 66.5 },
    { path: [], kind: "varint", value: nowSec },
  ])
  // Wrap inner as a nested message under field 1 of an outer message, then frame it.
  const outer: number[] = [0x0a, inner.length, ...inner]
  const len = outer.length
  const framed = new Uint8Array(5 + len)
  framed[0] = 0x00
  framed[1] = (len >>> 24) & 0xff
  framed[2] = (len >>> 16) & 0xff
  framed[3] = (len >>> 8) & 0xff
  framed[4] = len & 0xff
  framed.set(outer, 5)
  const parsed = parseXaiUsage(framed)
  assert.equal(parsed.usedPercent, 66.5)
  assert.ok(parsed.resetAt != null && parsed.resetAt > Date.now())
})

// ── Collapsed header summary ("n%/5h m%/7d") ──

test("collapsedSummary shows 5h/weekly pair and skips monthly/billing windows", () => {
  const windows = [
    { label: "5h", percent: 12, resetsAt: null, valueLabel: null },
    { label: "7d", percent: 34.6, resetsAt: null, valueLabel: null },
    { label: "Monthly", percent: 90, resetsAt: null, valueLabel: null },
  ]
  assert.equal(collapsedSummary(windows, "used"), "12%/5h 35%/7d")
  assert.equal(collapsedSummary(windows, "remaining"), "88%/5h 65%/7d")
})

test("collapsedSummary falls back gracefully per provider shape", () => {
  assert.equal(collapsedSummary([
    { label: "Rolling", percent: 5, resetsAt: null, valueLabel: null },
    { label: "Weekly", percent: 9, resetsAt: null, valueLabel: null },
    { label: "Monthly", percent: 77, resetsAt: null, valueLabel: null },
  ], "used"), "5%/5h 9%/7d")
  assert.equal(collapsedSummary([{ label: "Balance", percent: null, resetsAt: null, valueLabel: "$5.00" }], "used"), "$5.00")
  assert.equal(collapsedSummary([], "used"), null)
  assert.equal(collapsedSummary(undefined, "used"), null)
  // Session-only providers show a single percentage
  assert.equal(collapsedSummary([
    { label: "Tokens", percent: 44, resetsAt: null, valueLabel: null },
    { label: "MCP Tools", percent: 3, resetsAt: null, valueLabel: null },
  ], "used"), "44%")
})

// ── Ollama Cloud new-billing display ──

test("ollama collapsed summary shows remaining dollar valueLabel", () => {
  const windows = [
    { label: "Monthly", percent: 20.833, resetsAt: null, valueLabel: "$47.50 / $60.00 left" },
  ]
  assert.equal(collapsedSummary(windows, "remaining"), "79%/47.5$")
  assert.equal(collapsedSummary(windows, "used"), "21%/12.5$")
})

test("parseOllamaSettingsHtml monthly valueLabel carries remaining dollars", () => {
  const html = `<span>Monthly usage</span><span>$18 of $60 used</span>`
  const windows = parseOllamaSettingsHtml(html)
  assert.equal(windows[0].valueLabel, "$42.00 / $60.00 left")
})

// ── worstUsagePercent (dot color uses the tightest window) ──

test("worstUsagePercent returns the max used percent across windows", () => {
  assert.equal(worstUsagePercent([
    { label: "Daily", percent: 5, resetsAt: null, valueLabel: null },
    { label: "Weekly", percent: 96, resetsAt: null, valueLabel: null },
  ]), 96)
  assert.equal(worstUsagePercent([
    { label: "Weekly", percent: 96, resetsAt: null, valueLabel: null },
    { label: "Daily", percent: 5, resetsAt: null, valueLabel: null },
  ]), 96)
})

test("worstUsagePercent ignores null/NaN/Infinity and reports null when none", () => {
  assert.equal(worstUsagePercent([
    { label: "Credits", percent: null, resetsAt: null, valueLabel: "$5.00" },
    { label: "Weird", percent: Number.NaN, resetsAt: null, valueLabel: null },
    { label: "Inf", percent: Number.POSITIVE_INFINITY, resetsAt: null, valueLabel: null },
  ]), null)
  assert.equal(worstUsagePercent([]), null)
  assert.equal(worstUsagePercent(undefined), null)
  assert.equal(worstUsagePercent(null), null)
})

test("worstUsagePercent picks the exhausted window even when it is not first", () => {
  // First window has no percent; a later one is fully used.
  assert.equal(worstUsagePercent([
    { label: "Credits", percent: null, resetsAt: null, valueLabel: "$0.00" },
    { label: "Daily", percent: 100, resetsAt: null, valueLabel: null },
    { label: "Weekly", percent: 10, resetsAt: null, valueLabel: null },
  ]), 100)
})

// ── Devin gate predicate (AND of config + plugin + model) ──

test("isDevinUsageVisible requires all three conditions", () => {
  const all = { configEnabled: true, pluginIds: [DEVIN_PLUGIN_ID, "other"], hasDevinModel: true }
  assert.equal(isDevinUsageVisible(all), true)
  assert.equal(isDevinUsageVisible({ ...all, configEnabled: false }), false)
  assert.equal(isDevinUsageVisible({ ...all, pluginIds: [] }), false)
  assert.equal(isDevinUsageVisible({ ...all, pluginIds: ["other"] }), false)
  assert.equal(isDevinUsageVisible({ ...all, hasDevinModel: false }), false)
  // Plugin presence + model without opt-in is not enough (no OR semantics).
  assert.equal(isDevinUsageVisible({ configEnabled: false, pluginIds: [DEVIN_PLUGIN_ID], hasDevinModel: true }), false)
})

test("hasEnabledDevinModel only counts enabled devin-provider models", () => {
  assert.equal(hasEnabledDevinModel([{ providerID: "devin", enabled: true }]), true)
  assert.equal(hasEnabledDevinModel([{ providerID: "devin", enabled: false }]), false)
  assert.equal(hasEnabledDevinModel([{ providerID: "openai", enabled: true }]), false)
  assert.equal(hasEnabledDevinModel([{ providerID: "devin" }]), false)
  assert.equal(hasEnabledDevinModel([]), false)
  assert.equal(hasEnabledDevinModel(undefined), false)
  assert.equal(hasEnabledDevinModel(null), false)
})

// Gate state is scoped to the location that produced it (strict AND per location)
test("devinGatePlugins scopes plugin ids to their location and drops stale results", () => {
  const locA = devinLocationKey({ directory: "/a" })
  const locB = devinLocationKey({ directory: "/b" })
  assert.notEqual(locA, locB)
  assert.equal(devinLocationKey({ directory: "/a", workspaceID: "w1" }), "/a|w1")
  assert.equal(devinLocationKey(undefined), "|")

  const empty = { key: locB, seq: 1, pluginIds: [] as readonly string[] }
  // A result fetched for /a must not qualify /b.
  const rejected = devinGatePlugins(empty, locB, locA, 2, [DEVIN_PLUGIN_ID])
  assert.equal(rejected, empty) // same state object, ids never applied

  // Current-location result applies.
  const accepted = devinGatePlugins(empty, locB, locB, 2, [DEVIN_PLUGIN_ID])
  assert.equal(accepted.key, locB)
  assert.deepEqual(accepted.pluginIds, [DEVIN_PLUGIN_ID])

  // Older sequence numbers never overwrite a newer gate state.
  const stale = devinGatePlugins(accepted, locB, locB, 1, [])
  assert.equal(stale, accepted)
})

// A memoized boolean eligibility flips downstream effects only on real changes,
// so the 2-minute poll cannot retrigger fetches while the answer stays the same.
test("memoized devin eligibility does not re-fire downstream effects on equal polls", () => {
  createRoot((dispose: () => void) => {
    const [pluginIds, setPluginIds] = createSignal<readonly string[]>([DEVIN_PLUGIN_ID])
    const [hasModel, setHasModel] = createSignal(true)
    const eligible = createMemo(() => isDevinUsageVisible({
      configEnabled: true,
      pluginIds: pluginIds(),
      hasDevinModel: hasModel(),
    }))
    let runs = 0
    createComputed(() => { eligible(); runs++ })
    assert.equal(runs, 1)
    // Poll returns an equal-but-fresh plugin list: eligibility unchanged, no rerun.
    setPluginIds([DEVIN_PLUGIN_ID, "other-plugin"])
    assert.equal(runs, 1)
    // Losing the devin plugin flips the boolean: downstream fires once.
    setPluginIds(["other-plugin"])
    assert.equal(runs, 2)
    // Regaining it flips back.
    setPluginIds([DEVIN_PLUGIN_ID])
    assert.equal(runs, 3)
    dispose()
  })
})

// ── Devin credential file (temp XDG dir, offline) ──

test("readDevinCredentials reads apiKey/apiServerUrl from the devin plugin store", () => {
  const previous = process.env.XDG_CONFIG_HOME
  const dir = mkdtempSync(join(tmpdir(), "devin-creds-"))
  mkdirSync(join(dir, "opencode-devin-v2"), { recursive: true })
  writeFileSync(
    join(dir, "opencode-devin-v2", "credentials.json"),
    JSON.stringify({ apiKey: "k-123", apiServerUrl: "https://example.dev" }),
  )
  try {
    process.env.XDG_CONFIG_HOME = dir
    assert.deepEqual(readDevinCredentials(), { apiKey: "k-123", apiServerUrl: "https://example.dev" })
    writeFileSync(join(dir, "opencode-devin-v2", "credentials.json"), "not-json")
    assert.equal(readDevinCredentials(), null)
    writeFileSync(join(dir, "opencode-devin-v2", "credentials.json"), "{}")
    assert.deepEqual(readDevinCredentials(), { apiKey: null, apiServerUrl: null })
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
  }
})

test("readDevinCredentials returns null when the file is absent", () => {
  const previous = process.env.XDG_CONFIG_HOME
  const dir = mkdtempSync(join(tmpdir(), "devin-empty-"))
  try {
    process.env.XDG_CONFIG_HOME = dir
    assert.equal(readDevinCredentials(), null)
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
  }
})

// ── Devin quota parser ──

test("parseDevinUsage maps remaining percent to used percent with resets", () => {
  const parsed = parseDevinUsage({
    userStatus: {
      planStatus: {
        planInfo: { planName: "Pro", isDevin: true },
        dailyQuotaRemainingPercent: 75,
        weeklyQuotaRemainingPercent: 40,
        dailyQuotaResetAtUnix: "1790496000",
        weeklyQuotaResetAtUnix: 1790496000,
      },
    },
    planInfo: { planName: "Different" },
  })
  assert.ok(parsed)
  assert.equal(parsed.planLabel, "Pro") // nested planStatus.planInfo wins
  assert.deepEqual(parsed.windows.map(w => w.label), ["Daily", "Weekly"])
  assert.equal(parsed.windows[0].percent, 25)
  assert.equal(parsed.windows[1].percent, 60)
  assert.equal(parsed.windows[0].resetsAt, new Date(1790496000 * 1000).toISOString())
})

test("parseDevinUsage treats omitted weekly percent as fully exhausted (proto3)", () => {
  const parsed = parseDevinUsage({
    userStatus: {
      planStatus: {
        planInfo: { planName: "Pro", isDevin: true },
        dailyQuotaRemainingPercent: 100,
        dailyQuotaResetAtUnix: "1790496000",
        weeklyQuotaResetAtUnix: "1790496000",
      },
    },
  })
  assert.ok(parsed)
  assert.equal(parsed.windows[0].percent, 0)
  assert.equal(parsed.windows[1].label, "Weekly")
  assert.equal(parsed.windows[1].percent, 100) // omitted == 0 remaining
})

test("parseDevinUsage honors hideDailyQuota / hideWeeklyQuota", () => {
  const parsed = parseDevinUsage({
    userStatus: {
      planStatus: {
        planInfo: { planName: "Pro", hideWeeklyQuota: true },
        dailyQuotaRemainingPercent: 50,
        dailyQuotaResetAtUnix: "1790496000",
        weeklyQuotaRemainingPercent: 50,
        weeklyQuotaResetAtUnix: "1790496000",
      },
    },
  })
  assert.ok(parsed)
  assert.deepEqual(parsed.windows.map(w => w.label), ["Daily"])
})

test("parseDevinUsage returns null for missing or malformed planStatus", () => {
  assert.equal(parseDevinUsage(null), null)
  assert.equal(parseDevinUsage({}), null)
  assert.equal(parseDevinUsage({ userStatus: {} }), null)
  assert.equal(parseDevinUsage({ userStatus: { planStatus: {} } }), null)
  // planStatus without any quota fields is not a valid quota structure —
  // never fabricate 100% exhaustion.
  assert.equal(parseDevinUsage({ userStatus: { planStatus: { planInfo: { planName: "Free" } } } }), null)
})

test("parseDevinUsage rejects explicit invalid percent instead of fabricating 100% used", () => {
  const base = () => ({
    userStatus: {
      planStatus: {
        planInfo: { planName: "Pro" },
        dailyQuotaRemainingPercent: 60,
        dailyQuotaResetAtUnix: "1790496000",
        weeklyQuotaResetAtUnix: "1790496000",
      },
    },
  })
  for (const bad of ["garbage", {}, NaN, -5, 150, Infinity]) {
    const payload = base()
    ;(payload.userStatus.planStatus as Record<string, unknown>).dailyQuotaRemainingPercent = bad
    assert.equal(parseDevinUsage(payload), null, `expected null for ${String(bad)}`)
  }
  // Null / omitted weekly percent still means proto3 zero (fully used).
  const omitted = parseDevinUsage(base())
  assert.ok(omitted)
  assert.equal(omitted.windows[1].percent, 100)
})

test("parseDevinUsage never throws on extreme reset timestamps", () => {
  const parsed = parseDevinUsage({
    userStatus: {
      planStatus: {
        planInfo: { planName: "Pro" },
        dailyQuotaRemainingPercent: 60,
        dailyQuotaResetAtUnix: 1e30,
        weeklyQuotaRemainingPercent: 60,
        weeklyQuotaResetAtUnix: "not-a-date",
      },
    },
  })
  assert.ok(parsed)
  assert.equal(parsed.windows[0].percent, 40)
  assert.equal(parsed.windows[0].resetsAt, null)
  assert.equal(parsed.windows[1].resetsAt, null)
})

// ── Devin fetcher (mocked fetch, offline) ──

function devinOkPayload() {
  return {
    userStatus: {
      planStatus: {
        planInfo: { planName: "Pro", isDevin: true },
        dailyQuotaRemainingPercent: 60,
        dailyQuotaResetAtUnix: "1790496000",
        weeklyQuotaRemainingPercent: 20,
        weeklyQuotaResetAtUnix: "1790496000",
      },
    },
  }
}

test("fetchDevinUsage posts api_key metadata with connect headers, no redirects", async () => {
  let seen: { url: string; init?: RequestInit } | null = null
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen = { url, init }
    return { ok: true, status: 200, json: async () => devinOkPayload(), text: async () => "{}" } as Response
  }) as unknown as typeof fetch
  const parsed = await fetchDevinUsage({ apiKey: "devin-key-1", apiServerUrl: "https://api.devin.test" }, fetchImpl)
  assert.equal(seen!.url, `https://api.devin.test/exa.seat_management_pb.SeatManagementService/GetUserStatus`)
  const headers = seen!.init!.headers as Record<string, string>
  assert.equal(headers["Connect-Protocol-Version"], "1")
  assert.equal(headers["Content-Type"], "application/json")
  assert.equal((seen!.init as { redirect?: string }).redirect, "manual")
  assert.equal(headers.Authorization, undefined) // key travels in the body only
  const body = JSON.parse(String(seen!.init!.body))
  assert.equal(body.metadata.api_key, "devin-key-1")
  assert.equal(parsed.windows.length, 2)
  assert.equal(parsed.planLabel, "Pro")
})

test("fetchDevinUsage falls back to the default host and rejects non-https/base urls", async () => {
  const urls: string[] = []
  const fetchImpl = (async (url: string) => {
    urls.push(url)
    return { ok: true, status: 200, json: async () => devinOkPayload(), text: async () => "{}" } as Response
  }) as unknown as typeof fetch
  await fetchDevinUsage({ apiKey: "k", apiServerUrl: null }, fetchImpl)
  await fetchDevinUsage({ apiKey: "k", apiServerUrl: "http://insecure.example" }, fetchImpl)
  await fetchDevinUsage({ apiKey: "k", apiServerUrl: "https://user:pass@evil.example/?x=1" }, fetchImpl)
  await fetchDevinUsage({ apiKey: "k", apiServerUrl: "not a url" }, fetchImpl)
  assert.ok(urls.every(u => u.startsWith(`${DEVIN_API_FALLBACK_URL}/`)))
})

test("fetchDevinUsage does not leak key or raw error body", async () => {
  const fetchImpl = (async () => ({
    ok: false,
    status: 401,
    json: async () => ({ detail: "account devin-key-2 suspended, user: bob@corp.io" }),
    text: async () => "account devin-key-2 suspended, user: bob@corp.io",
  }) as Response) as unknown as typeof fetch
  await assert.rejects(fetchDevinUsage({ apiKey: "devin-key-2", apiServerUrl: null }, fetchImpl), (err: unknown) => {
    const msg = String(err)
    assert.match(msg, /session expired/i)
    assert.doesNotMatch(msg, /devin-key-2/)
    assert.doesNotMatch(msg, /bob@corp\.io/)
    return true
  })
  const fetch500 = (async () => ({
    ok: false, status: 500,
    json: async () => ({}), text: async () => "PII devin-key-2",
  }) as Response) as unknown as typeof fetch
  await assert.rejects(fetchDevinUsage({ apiKey: "devin-key-2", apiServerUrl: null }, fetch500), (err: unknown) => {
    assert.doesNotMatch(String(err), /PII|devin-key-2/)
    return true
  })
})

test("fetchDevinUsage throws when the payload has no quota structure", async () => {
  const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "{}" }) as Response) as unknown as typeof fetch
  await assert.rejects(fetchDevinUsage({ apiKey: "k", apiServerUrl: null }, fetchImpl), /could not be parsed/)
})

test("checkProviderUsage devin reports not-configured without a credentials file", async () => {
  const previous = process.env.XDG_CONFIG_HOME
  const dir = mkdtempSync(join(tmpdir(), "devin-none-"))
  try {
    process.env.XDG_CONFIG_HOME = dir
    const result = await checkProviderUsage("devin", mockFetch(200, {}), fakeCredential("ignored"))
    assert.equal(result.configured, false)
    assert.equal(result.ok, false)
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
  }
})

test("checkProviderUsage devin end-to-end with temp credentials file (offline)", async () => {
  const previous = process.env.XDG_CONFIG_HOME
  const dir = mkdtempSync(join(tmpdir(), "devin-e2e-"))
  mkdirSync(join(dir, "opencode-devin-v2"), { recursive: true })
  writeFileSync(join(dir, "opencode-devin-v2", "credentials.json"), JSON.stringify({ apiKey: "e2e-key", apiServerUrl: "https://devin.test" }))
  try {
    process.env.XDG_CONFIG_HOME = dir
    const result = await checkProviderUsage("devin", mockFetch(200, devinOkPayload()), fakeCredential(null))
    assert.equal(result.configured, true)
    assert.equal(result.ok, true)
    assert.equal(result.planLabel, "Pro")
    assert.deepEqual(result.windows?.map(w => w.label), ["Daily", "Weekly"])
    assert.equal(result.windows?.[0]?.percent, 40)
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
  }
})
