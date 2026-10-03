import { test } from "node:test"
import assert from "node:assert/strict"
import { Script } from "node:vm"
import {
  middleEllipsis,
  shortenHome,
  pathBasename,
  relativeChange,
  pointChange,
  fmtRangeShort,
  barListHtml,
  errorTypesPanelHtml,
  finishReasonsPanelHtml,
  overheadPanelHtml,
  footerSourceHtml,
} from "../src/html-common.js"
import { generateTotalUsageHtml } from "../src/total-usage-html.js"
import { buildSessionReportData, generateSessionUsageHtml, generationSpeed } from "../src/session-usage-html.js"
import { setPricingCacheForTest } from "../src/pricing.js"
import type { CombinedReportData, ErrorStats, MessageRow, SessionTokenData } from "../src/formatter.js"

test("middleEllipsis keeps short strings and trims long ones to max", () => {
  assert.equal(middleEllipsis("/a/b", 10), "/a/b")
  const long = "/home/user/projects/very-long-client-name/monorepo/packages/frontend"
  const out = middleEllipsis(long, 30)
  assert.equal(Array.from(out).length, 30)
  assert.ok(out.includes("\u2026"))
  assert.ok(out.endsWith("packages/frontend"), out)
  assert.ok(out.startsWith("/home/user"), out)
  assert.equal(middleEllipsis("abcdef", 2), "ab")
})

test("middleEllipsis counts CJK/astral characters as single units", () => {
  const out = middleEllipsis("/home/u/工作/毕业论文/数据处理脚本/阶段二", 12)
  assert.equal(Array.from(out).length, 12)
  assert.ok(out.endsWith("阶段二"))
  assert.equal(Array.from(middleEllipsis("😀".repeat(10), 5)).length, 5)
})

test("shortenHome and pathBasename", () => {
  assert.equal(shortenHome("/home/u/proj", "/home/u"), "~/proj")
  assert.equal(shortenHome("/home/u", "/home/u/"), "~")
  assert.equal(shortenHome("/home/user2/x", "/home/u"), "/home/user2/x")
  assert.equal(shortenHome("/x", ""), "/x")
  assert.equal(pathBasename("/home/u/proj/"), "proj")
  assert.equal(pathBasename("C:\\work\\repo"), "repo")
  assert.equal(pathBasename("global"), "global")
})

test("relativeChange formats direction and percent", () => {
  assert.deepEqual(relativeChange(112.3, 100), { direction: "up", text: "\u2191 12.3%" })
  assert.deepEqual(relativeChange(80, 100), { direction: "down", text: "\u2193 20.0%" })
  assert.deepEqual(relativeChange(100, 100), { direction: "flat", text: "\u2192 0.0%" })
  assert.deepEqual(relativeChange(5, 0), { direction: "up", text: "\u2191 new" })
  assert.equal(relativeChange(5, null), null)
  assert.equal(relativeChange(5, undefined), null)
  assert.equal(relativeChange(Number.NaN, 3), null)
  assert.equal(relativeChange(250, 10)?.text, "\u2191 2400%")
})

test("pointChange reports percentage points", () => {
  assert.deepEqual(pointChange(0.91, 0.874), { direction: "up", text: "\u2191 3.6 pp" })
  assert.deepEqual(pointChange(0.01, 0.0121), { direction: "down", text: "\u2193 0.2 pp" })
  assert.equal(pointChange(0.5, null), null)
  assert.equal(pointChange(null, 0.5), null)
})

test("fmtRangeShort drops a shared year", () => {
  assert.equal(fmtRangeShort("2026-08-04", "2026-09-02"), "08-04 \u2192 09-02")
  assert.equal(fmtRangeShort("2025-12-20", "2026-01-18"), "2025-12-20 \u2192 2026-01-18")
  assert.equal(fmtRangeShort("\u2014", "\u2014"), "\u2014 \u2192 \u2014")
})

test("generationSpeed uses output+reasoning over summed completed durations", () => {
  const rows = [
    { outputTokens: 900, reasoningTokens: 100, timeCreated: 0, timeCompleted: 10_000 },
    { outputTokens: 500, reasoningTokens: 0, timeCreated: 20_000, timeCompleted: 25_000 },
    { outputTokens: 9999, reasoningTokens: 0, timeCreated: 30_000, timeCompleted: null },
    { outputTokens: 9999, reasoningTokens: 0, timeCreated: 40_000, timeCompleted: 40_000 },
  ]
  const g = generationSpeed(rows)
  assert.equal(g.tokens, 1500)
  assert.equal(g.timeMs, 15_000)
  assert.equal(g.tps, 100)
  assert.deepEqual(generationSpeed([]), { tps: 0, tokens: 0, timeMs: 0 })
})

test("barListHtml escapes text and scales to the max", () => {
  const html = barListHtml([
    { label: "<b>x</b>", sub: "a&b", title: "\"q\"", value: 10, display: "10" },
    { label: "y", value: 5, display: "5", tone: "danger" },
  ], "List")
  assert.ok(!html.includes("<b>x</b>"))
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"))
  assert.ok(html.includes("a&amp;b"))
  assert.ok(html.includes("&quot;q&quot;"))
  assert.ok(html.includes("width:100.0%"))
  assert.ok(html.includes("width:50.0%"))
  assert.ok(html.includes("tone-danger"))
  assert.equal(barListHtml([], "x"), "")
})

const fullErrors: ErrorStats = {
  successCount: 90, failedCount: 4, abortedCount: 6, errorRate: 4 / 94,
  byModel: [{ provider: "p", model: "m", failed: 4, aborted: 6, total: 100 }],
  byType: [{ type: "aborted", count: 6 }, { type: "provider.rate-limit", count: 3 }, { type: "provider.transport", count: 1 }],
  finishReasons: [{ reason: "tool-calls", count: 70 }, { reason: "stop", count: 17 }, { reason: "length", count: 3 }, { reason: "error", count: 10 }],
}
const legacyErrors = { successCount: 90, failedCount: 4, errorRate: 4 / 94, byModel: [] } as unknown as ErrorStats

test("errorTypesPanelHtml lists failures and shows aborted separately", () => {
  const html = errorTypesPanelHtml(fullErrors)
  assert.ok(html.includes("provider.rate-limit"))
  assert.ok(!/bar-name">aborted</.test(html), "aborted must not be an error bar")
  assert.ok(html.includes("User aborted <strong>6</strong>"))
  assert.equal(errorTypesPanelHtml(legacyErrors), "")
  assert.equal(errorTypesPanelHtml(undefined), "")
  assert.equal(errorTypesPanelHtml({ ...fullErrors, failedCount: 0, abortedCount: 0, byType: [] }), "")
})

test("finishReasonsPanelHtml flags truncation and aborted overlap", () => {
  const html = finishReasonsPanelHtml(fullErrors)
  assert.ok(html.includes("length \u00b7 truncated"))
  assert.ok(html.includes("<strong>3</strong> responses hit the output limit"))
  assert.ok(html.includes("error \u00b7 incl. 6 aborted"))
  assert.equal(finishReasonsPanelHtml(legacyErrors), "")
})

test("overheadPanelHtml hides empty overhead and marks values as derived", () => {
  assert.equal(overheadPanelHtml(undefined), "")
  assert.equal(overheadPanelHtml({ inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0, sessions: 0 }), "")
  const html = overheadPanelHtml({ inputTokens: 1000, outputTokens: 200, reasoningTokens: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1200, cost: 0.5, sessions: 3 }, { showSessions: true })
  assert.ok(html.includes("Derived"))
  assert.ok(html.includes("1.2K"))
  assert.ok(html.includes(">Sessions<"))
})

test("footerSourceHtml names the source and build time", () => {
  assert.equal(footerSourceHtml(undefined), "Data: OpenCode V2 API")
  assert.equal(footerSourceHtml({ source: "sqlite", elapsedMs: 1489 }), "Data: SQLite (read-only) &middot; Built in 1.5s")
  assert.equal(footerSourceHtml({ source: "api", elapsedMs: 12 }), "Data: OpenCode V2 API &middot; Built in 12ms")
})

const summary: SessionTokenData = {
  model: "m", provider: "p", modelsUsed: ["m"], totalTokens: 1_000_000, inputTokens: 100_000, outputTokens: 20_000,
  reasoningTokens: 0, cacheRead: 850_000, cacheWrite: 30_000, totalCost: 12.5, requestCount: 100,
}

/** Compiles the report's own inline script (the last <script> block) to catch generated-JS syntax errors. */
function assertAppScriptParses(html: string): void {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
  assert.ok(blocks.length > 0)
  assert.doesNotThrow(() => new Script(blocks[blocks.length - 1]))
}

function baseTotal(): CombinedReportData {
  return {
    summary,
    models: [{ provider: "p", model: "m", requests: 100, sessions: 4, totalTokens: 1_000_000, inputTokens: 100_000, outputTokens: 20_000, reasoningTokens: 0, cacheRead: 850_000, cacheWrite: 30_000, totalCost: 12.5 }],
    providers: [{ provider: "p", requests: 100, sessions: 4, totalTokens: 1_000_000, inputTokens: 100_000, outputTokens: 20_000, reasoningTokens: 0, cacheRead: 850_000, totalCost: 12.5 }],
    daily: [{ day: "2026-10-02", requests: 100, sessions: 4, totalTokens: 1_000_000, inputTokens: 100_000, outputTokens: 20_000, reasoningTokens: 0, cacheRead: 850_000, totalCost: 12.5 }],
    sessions: [],
    totalSessions: 4,
    meta: { generatedAt: "2026-10-03 00:00:00", dateRange: { start: "2026-09-03", end: "2026-10-02" } },
    errors: legacyErrors,
  }
}

test("total report hides every new block when the new fields are missing", () => {
  const html = generateTotalUsageHtml(baseTotal())
  for (const id of ["workspaces", "reliability", "efficiency"]) assert.ok(!html.includes(`id="${id}"`), id)
  assert.ok(!html.includes('class="kpi-sub kpi-delta'))
  assert.ok(html.includes("4 failed &middot; 0 aborted"))
  assert.ok(html.includes("Data: OpenCode V2 API"))
  assert.ok(html.includes("No sessions in this period."))
  assertAppScriptParses(html)
})

test("total report renders new blocks, deltas and escapes directories", () => {
  const data: CombinedReportData = {
    ...baseTotal(),
    errors: fullErrors,
    meta: { ...baseTotal().meta, source: { source: "sqlite", elapsedMs: 840 } },
    projects: [{ directory: "/tmp/<img src=x onerror=alert(1)>/repo", projectId: "p1", sessions: 3, requests: 80, totalTokens: 800_000, totalCost: 10 }],
    agents: [{ agent: "build", sessions: 3, requests: 80, totalTokens: 800_000, totalCost: 10 }],
    sessionKinds: { root: { sessions: 2, requests: 60, totalTokens: 700_000, totalCost: 9 }, child: { sessions: 2, requests: 40, totalTokens: 300_000, totalCost: 3.5 } },
    modelLatency: [{ provider: "p", model: "m", samples: 100, p50Ms: 3000, p90Ms: 20000, avgMs: 8000 }],
    cacheSavings: { estimatedSavedCost: 42.5, byModel: [{ provider: "p", model: "m", cacheRead: 850_000, saved: 42.5 }] },
    overhead: { inputTokens: 5000, outputTokens: 300, reasoningTokens: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 5300, cost: 0.02, sessions: 2 },
    comparison: { previous: { totalTokens: 800_000, totalCost: 15, requestCount: 100, sessions: 4, cacheHitRate: 0.8, errorRate: 0.02 }, previousRange: { start: "2026-08-04", end: "2026-09-02" } },
  }
  const html = generateTotalUsageHtml(data)
  for (const id of ["workspaces", "reliability", "efficiency"]) assert.ok(html.includes(`id="${id}"`), id)
  assert.ok(html.includes("\u2191 25.0%"), "token delta")
  assert.ok(html.includes("delta-good"), "cost went down -> good")
  assert.ok(html.includes("vs 08-04 \u2192 09-02"))
  assert.ok(html.includes("4 failed &middot; 6 aborted"))
  assert.ok(html.includes("Data: SQLite (read-only) &middot; Built in 840ms"))
  assert.ok(html.includes("~$42.50"))
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, "")
  assert.ok(!markup.includes("<img src=x"))
  assert.ok(!/NaN|undefined/.test(markup))
  assertAppScriptParses(html)
})

function msg(i: number, extra: Partial<MessageRow> = {}): MessageRow {
  return {
    messageId: `m${i}`, model: "m", provider: "p", inputTokens: 1000, outputTokens: 400, reasoningTokens: 100,
    cacheRead: 9000, cacheWrite: 0, totalTokens: 10_500, cost: 0.01, timeCreated: i * 20_000, timeCompleted: i * 20_000 + 5000, ...extra,
  }
}

test("session report: Gen Tokens/s, aborted count and graceful degradation", async () => {
  setPricingCacheForTest({})
  const legacy = await buildSessionReportData({
    sessionId: "ses_1", sessionTitle: "t", subagentCount: 0, summary, models: baseTotal().models,
    messages: [msg(0), msg(1)], errors: legacyErrors,
  })
  assert.equal(legacy.tps, 100)
  const legacyHtml = generateSessionUsageHtml(legacy)
  assert.ok(legacyHtml.includes("Gen Tokens/s"))
  assert.ok(legacyHtml.includes("4 failed &middot; 0 aborted"))
  for (const id of ["agents", "reliability"]) assert.ok(!legacyHtml.includes(`id="${id}"`), id)
  assert.ok(!legacyHtml.includes(">Agent</th>"))
  assert.ok(!legacyHtml.includes(">Status</th>"))
  assertAppScriptParses(legacyHtml)

  const full = await buildSessionReportData({
    sessionId: "ses_1", sessionTitle: "<i>t</i>", subagentCount: 1, summary, models: baseTotal().models,
    messages: [msg(0, { agent: "build", finish: "tool-calls" }), msg(1, { agent: "explore", isChild: true, finish: "error", errorType: "aborted" })],
    errors: fullErrors,
    agents: [{ agent: "build", sessions: 1, requests: 1, totalTokens: 10_500, totalCost: 0.01 }],
    childSessions: [{ sessionId: "ses_c", title: "child", provider: "p", model: "m", requests: 1, totalTokens: 10_500, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheRead: 0, totalCost: 0.01, day: "2026-10-02" }],
    overhead: { inputTokens: 100, outputTokens: 10, reasoningTokens: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 110, cost: 0, sessions: 1 },
    source: { source: "sqlite", elapsedMs: 38 },
  })
  const html = generateSessionUsageHtml(full)
  for (const id of ["agents", "reliability"]) assert.ok(html.includes(`id="${id}"`), id)
  assert.ok(html.includes(">Agent</th>"))
  assert.ok(html.includes("status-chip tone-muted"))
  assert.ok(html.includes("4 failed &middot; 6 aborted"))
  assert.ok(html.includes("Data: SQLite (read-only)"))
  assert.ok(!html.includes("<i>t</i>"))
  assertAppScriptParses(html)
})
