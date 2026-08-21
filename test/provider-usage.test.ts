import { test } from "node:test"
import assert from "node:assert/strict"
import {
  parseOpenCodeGoUsage,
  parseDeepSeekBalance,
  parseCodexUsage,
  fetchOpenCodeGoUsage,
  fetchDeepSeekBalance,
  fetchCodexUsage,
  checkProviderUsage,
  resolveProviderUsageConfig,
} from "../src/provider-usage.js"

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

// checkProviderUsage with injected fake credentials (offline, never touches real auth)

function fakeCredential(value: string | null, accountId: string | null = null) {
  return () => ({ value, accountId, source: "env" as const })
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
  const disabled = { "opencode-go": false, deepseek: false, codex: false }
  assert.deepEqual(resolveProviderUsageConfig(undefined), disabled)
  assert.deepEqual(resolveProviderUsageConfig(null), disabled)
  assert.deepEqual(resolveProviderUsageConfig({}), disabled)
  assert.deepEqual(resolveProviderUsageConfig({ providerUsage: null }), disabled)
  assert.deepEqual(resolveProviderUsageConfig({ providerUsage: {} }), disabled)
})

test("resolveProviderUsageConfig enables only explicitly true providers", () => {
  const config = resolveProviderUsageConfig({
    providerUsage: { "opencode-go": true, deepseek: "yes", codex: true },
  })
  assert.deepEqual(config, { "opencode-go": true, deepseek: false, codex: true })
})

test("resolveProviderUsageConfig ignores false, 1, and unknown provider keys", () => {
  const config = resolveProviderUsageConfig({
    providerUsage: { "opencode-go": false, codex: 1, h4x: true },
  })
  assert.deepEqual(config, { "opencode-go": false, deepseek: false, codex: false })
})
