import { test } from "node:test"
import assert from "node:assert/strict"
import {
  formatTokens,
  formatCost,
  formatDuration,
  cacheHitRate,
  isMissingCache,
  getPresetRange,
  parseDaysFilter,
} from "../src/formatter.js"

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

test("isMissingCache flags zero-cache models", () => {
  assert.equal(isMissingCache(2, 0), true)
  assert.equal(isMissingCache(1, 0), false)
  assert.equal(isMissingCache(2, 10), false)
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
