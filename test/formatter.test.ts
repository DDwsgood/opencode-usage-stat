import { test } from "node:test"
import assert from "node:assert/strict"
import {
  formatTokens,
  formatCost,
  formatDuration,
  cacheHitRate,
  isMissingCache,
  totalInputTokens,
  getPresetRange,
  parseDaysFilter,
} from "../src/formatter.js"
import { estimateApiCost, setPricingCacheForTest } from "../src/pricing.js"
import { renderPeriodTextReport } from "../src/report-formats.js"
import type { CombinedReportData } from "../src/formatter.js"

test("formatTokens scales units", () => {
  assert.equal(formatTokens(0), "0")
  assert.equal(formatTokens(999), "999")
  assert.equal(formatTokens(1000), "1.0K")
  assert.equal(formatTokens(1_234_567), "1.2M")
  assert.equal(formatTokens(1_000_000_000), "1.0B")
})

test("formatCost renders cents and micro", () => {
  assert.equal(formatCost(0), "$0.00")
  assert.equal(formatCost(1), "$1.00")
  assert.equal(formatCost(0.001), "$0.0010")
  assert.equal(formatCost(123.456), "$123.46")
})

test("formatDuration renders units", () => {
  assert.equal(formatDuration(null), "—")
  assert.equal(formatDuration(500), "500ms")
  assert.equal(formatDuration(2500), "2.5s")
  assert.equal(formatDuration(90000), "1m 30s")
})

test("cacheHitRate computes token cache ratio", () => {
  assert.equal(cacheHitRate(100, 100), 0.5)
  assert.equal(cacheHitRate(0, 0), 0)
})

test("cacheHitRate includes cacheWrite in the denominator", () => {
  // raw input + cacheRead + cacheWrite = 100 + 100 + 100
  assert.ok(Math.abs(cacheHitRate(100, 100, 100) - 1 / 3) < 1e-12)
  // write-only window: no reads, so the rate is exactly 0% (not missing)
  assert.equal(cacheHitRate(0, 0, 100), 0)
  // zero denominator stays well-defined
  assert.equal(cacheHitRate(0, 0, 0), 0)
})

test("cacheHitRate matches the real fixture (raw 394 / read 566496 / write 75221)", () => {
  const rate = cacheHitRate(394, 566496, 75221)
  assert.ok(Math.abs(rate * 100 - 88.224) < 0.001, `expected ~88.224%, got ${(rate * 100).toFixed(3)}%`)
  assert.equal(totalInputTokens(394, 75221), 75615)
  // TOKEN TOTAL keeps the original value and never re-adds write
  assert.equal(394 + 6884 + 1187 + 566496 + 75221, 650182)
})

test("isMissingCache flags zero-cache models", () => {
  assert.equal(isMissingCache(2, 0), true)
  assert.equal(isMissingCache(1, 0), false)
  assert.equal(isMissingCache(2, 10), false)
})

test("isMissingCache treats write-only stats as present, not missing", () => {
  // cacheWrite > 0 means the upstream does report cache stats; show 0% instead
  assert.equal(isMissingCache(2, 0, 100), false)
  assert.equal(isMissingCache(2, 0, 0), true)
  assert.equal(isMissingCache(1, 0, 100), false)
})

test("totalInputTokens folds cacheWrite into the displayed input", () => {
  assert.equal(totalInputTokens(100, 25), 125)
  assert.equal(totalInputTokens(0, 0), 0)
})

test("new cache writes change the trend: recent writes lower the windowed rate", () => {
  // Mirrors the TUI model trend windows (recent 3 messages vs previous 3).
  type Sample = { inputTokens: number; cacheRead: number; cacheWrite: number }
  const hit = (input: number, cacheRead: number, cacheWrite: number) => ({ inputTokens: input, cacheRead, cacheWrite } as Sample)
  const windowRate = (msgs: Sample[]) => {
    let cache = 0, total = 0
    for (const m of msgs) {
      cache += m.cacheRead
      total += totalInputTokens(m.inputTokens, m.cacheWrite) + m.cacheRead
    }
    return total > 0 ? (cache / total) * 100 : 0
  }
  const previous = [hit(0, 100, 0), hit(0, 100, 0), hit(0, 100, 0)]
  const recent = [hit(0, 100, 0), hit(0, 100, 0), hit(0, 100, 100)]
  assert.equal(windowRate(previous), 100)
  // 300 reads / (300 + 200, the last message's write) = 75%
  assert.equal(windowRate(recent), 75)
  assert.ok(windowRate(recent) < windowRate(previous))
})

test("trend window uses the real fixture denominator (394 + 566496 + 75221)", () => {
  type Sample = { inputTokens: number; cacheRead: number; cacheWrite: number }
  const windowRate = (msgs: Sample[]) => {
    let cache = 0, total = 0
    for (const m of msgs) {
      cache += m.cacheRead
      total += totalInputTokens(m.inputTokens, m.cacheWrite) + m.cacheRead
    }
    return total > 0 ? (cache / total) * 100 : 0
  }
  // Same totals as the real session, split across a 3-message recent window.
  const recent: Sample[] = [
    { inputTokens: 394, cacheRead: 566496, cacheWrite: 0 },
    { inputTokens: 0, cacheRead: 0, cacheWrite: 0 },
    { inputTokens: 0, cacheRead: 0, cacheWrite: 75221 },
  ]
  assert.equal(566496 + 394 + 75221, 642111)
  assert.ok(Math.abs(windowRate(recent) - 88.224) < 0.001, `expected ~88.224%, got ${windowRate(recent).toFixed(3)}%`)
})

const PRICING_FIXTURE = { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 }

test("write-only cache stats are priced from real counts, not the 94% MISSING heuristic", () => {
  setPricingCacheForTest({ "anthropic/claude-sonnet": PRICING_FIXTURE })
  const est = estimateApiCost("anthropic", "claude-sonnet", 2, 100, 0, 0, 0, 500)
  assert.equal(est.estimated, false)
  // raw input * input_rate + cacheWrite * cache_write_rate
  const expected = (100 / 1e6) * PRICING_FIXTURE.input + (500 / 1e6) * PRICING_FIXTURE.cache_write
  assert.ok(Math.abs((est.cost ?? -1) - expected) < 1e-12, `expected ${expected}, got ${est.cost}`)
})

test("truly zero-cache models still use the 94% MISSING heuristic", () => {
  setPricingCacheForTest({ "anthropic/claude-sonnet": PRICING_FIXTURE })
  const est = estimateApiCost("anthropic", "claude-sonnet", 2, 100, 0, 0, 0, 0)
  assert.equal(est.estimated, true)
  const expected = ((100 * (1 - 0.94)) / 1e6) * PRICING_FIXTURE.input
    + ((100 * 0.94) / 1e6) * PRICING_FIXTURE.cache_read
  assert.ok(Math.abs((est.cost ?? -1) - expected) < 1e-12, `expected ${expected}, got ${est.cost}`)
})

test("text report shows INPUT as raw+write while cache read/write stay separate and total is unchanged", () => {
  const data = {
    filters: {},
    summary: {
      model: "", provider: "", modelsUsed: [],
      totalTokens: 650182, inputTokens: 394, outputTokens: 6884, reasoningTokens: 1187,
      cacheRead: 566496, cacheWrite: 75221, totalCost: 0, requestCount: 1,
    },
    models: [], providers: [], daily: [], sessions: [],
    meta: { generatedAt: "", dateRange: { start: "—", end: "—" } },
  } as CombinedReportData
  const text = renderPeriodTextReport(data)
  assert.match(text, /Input Tokens: 75\.6K/)
  assert.match(text, /Cache Write: 75\.2K/)
  assert.match(text, /Cache Read: 566\.5K/)
  assert.match(text, /Total Tokens: 650\.2K/)
})

test("getPresetRange returns sane ranges", () => {
  const all = getPresetRange("all")
  assert.deepEqual(all, {})
  const d7 = getPresetRange("7d")
  assert.match(d7.startDate ?? "", /^\d{4}-\d{2}-\d{2}$/)
  assert.match(d7.endDate ?? "", /^\d{4}-\d{2}-\d{2}$/)
  const month = getPresetRange("month")
  assert.equal(month.startDate, month.startDate!.slice(0, 8) + "01")
})
// ── parseDaysFilter (/total-usage [days]) ──

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)
}

test("parseDaysFilter accepts a day count and yields an inclusive range ending today", () => {
  const range = parseDaysFilter("7")
  const pad = (n: number) => String(n).padStart(2, "0")
  const now = new Date()
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  assert.equal(range.endDate, today)
  assert.equal(daysBetween(range.startDate!, range.endDate!), 6)
})

test("parseDaysFilter falls back to all-time for junk/missing/out-of-range input", () => {
  assert.deepEqual(parseDaysFilter(undefined), getPresetRange("all"))
  assert.deepEqual(parseDaysFilter(""), getPresetRange("all"))
  assert.deepEqual(parseDaysFilter("abc"), getPresetRange("all"))
  assert.deepEqual(parseDaysFilter("0"), getPresetRange("all"))
  assert.deepEqual(parseDaysFilter("-3"), getPresetRange("all"))
  assert.deepEqual(parseDaysFilter("99999"), getPresetRange("all"))
})
