import { test } from "node:test"
import assert from "node:assert/strict"
import {
  distSegments,
  distBarWidth,
  providerRowLayout,
  providerHeaderFit,
  usageLevel,
  percentBar,
  DIST_BAR_MIN,
  PROVIDER_BAR_MIN,
  PROVIDER_BAR_MAX,
} from "../src/tui-layout.js"
import { visualWidth } from "../src/text-width.js"

const sum = (s: { cache: number; input: number; output: number }) => s.cache + s.input + s.output

test("distSegments splits by token share and fills the width exactly", () => {
  assert.deepEqual(distSegments({ cacheRead: 50, input: 30, output: 20 }, 10), { cache: 5, input: 3, output: 2 })
  assert.deepEqual(distSegments({ cacheRead: 1, input: 1, output: 1 }, 10), { cache: 4, input: 3, output: 3 })
  assert.deepEqual(distSegments({ cacheRead: 0, input: 0, output: 0 }, 10), { cache: 0, input: 0, output: 0 })
  assert.deepEqual(distSegments({ cacheRead: 5, input: 0, output: 0 }, 8), { cache: 8, input: 0, output: 0 })
})

test("distSegments gives every non-zero category at least one cell", () => {
  const s = distSegments({ cacheRead: 1_000_000, input: 10, output: 5 }, 12)
  assert.equal(s.input, 1)
  assert.equal(s.output, 1)
  assert.equal(s.cache, 10)
  assert.equal(sum(s), 12)
})

test("distSegments with fewer cells than categories keeps the largest", () => {
  assert.deepEqual(distSegments({ cacheRead: 100, input: 50, output: 10 }, 2), { cache: 1, input: 1, output: 0 })
  assert.deepEqual(distSegments({ cacheRead: 100, input: 50, output: 10 }, 0), { cache: 0, input: 0, output: 0 })
})

test("distSegments sums to width across many inputs", () => {
  const samples = [
    [952, 30, 18], [1, 2, 3], [0, 7, 3], [123456, 0, 1], [9, 9, 9999], [0.4, 0.4, 0.2],
  ]
  for (const [cacheRead, input, output] of samples) {
    for (let w = 3; w <= 48; w++) {
      const s = distSegments({ cacheRead, input, output }, w)
      assert.equal(sum(s), w, `w=${w} ${cacheRead}/${input}/${output}`)
      if (cacheRead > 0) assert.ok(s.cache >= 1)
      if (input > 0) assert.ok(s.input >= 1)
      if (output > 0) assert.ok(s.output >= 1)
    }
  }
})

test("distSegments ignores negative and non-finite values", () => {
  assert.deepEqual(distSegments({ cacheRead: -5, input: Number.NaN, output: 10 }, 6), { cache: 0, input: 0, output: 6 })
})

// Layout insets mirrored from sidebar.tsx / provider-usage-blocks.tsx.
const MODEL_ROW = (panel: number) => panel - 4
const PROVIDER_HEADER = (panel: number) => panel - 4
const PROVIDER_BODY = (panel: number) => panel - 6
const PANEL_WIDTHS = [30, 34, 38, 45, 60, 80]

test("Dist line never exceeds the model row width", () => {
  for (const panel of PANEL_WIDTHS) {
    for (const prefix of ["Dist: ", "分布: "]) {
      for (const suffix of [" 95.2%", " 100.0% ↑12.3%", " 0.0% ↓100.0%", " MISSING", " 9.1%"]) {
        for (const showTrend of [true, false]) {
          const bar = distBarWidth(MODEL_ROW(panel), visualWidth(prefix), suffix, showTrend)
          const line = visualWidth(prefix) + bar + visualWidth(suffix)
          if (MODEL_ROW(panel) - visualWidth(prefix) - visualWidth(suffix) >= DIST_BAR_MIN) {
            assert.ok(line <= MODEL_ROW(panel), `panel=${panel} ${prefix}${suffix} → ${line}`)
          }
        }
      }
    }
  }
  // Wider panels get longer bars than the old fixed budget (panel-4-6-11-7).
  assert.ok(distBarWidth(MODEL_ROW(38), 6, " 95.2%", true) > 38 - 4 - 6 - 11 - 7)
  // Bars of different models stay aligned when suffixes fit the budget.
  assert.equal(distBarWidth(34, 6, " 95.2%", true), distBarWidth(34, 6, " 9.1% ↑0.1%", true))
})

const WINDOW_LABELS = [
  "5h: ", "Weekly: ", "Monthly: ", "Daily: ", "Credits: ", "Extra usage: ", "Session FSC: ", "Account quota: ",
]
const SUFFIXES = [" 100%", " 7%", " 100% left", " 0% left", " 100% 剩余"]
const RESETS: Array<[string, string]> = [
  [" · Resets 6d", " · 6d"], [" · Resets 59m", " · 59m"], [" · 重置 23h", " · 23h"], ["", ""],
]

test("provider percent rows fit at 38/45/60 columns, droid group included", () => {
  for (const panel of [38, 45, 60]) {
    for (const indent of [0, 1]) {
      const width = PROVIDER_BODY(panel) - indent
      for (const label of WINDOW_LABELS) {
        for (const suffix of SUFFIXES) {
          for (const [reset, compact] of RESETS) {
            const r = providerRowLayout(width, label, suffix, reset, compact)
            const line = visualWidth(label) + r.barWidth + visualWidth(suffix) + visualWidth(r.reset)
            assert.ok(r.barWidth >= PROVIDER_BAR_MIN && r.barWidth <= PROVIDER_BAR_MAX)
            assert.ok(line <= width, `panel=${panel} indent=${indent} "${label}${suffix}${reset}" → ${line}/${width}`)
          }
        }
      }
    }
  }
})

test("provider row keeps the full reset text when it fits and drops it last", () => {
  const wide = providerRowLayout(54, "Weekly: ", " 100%", " · Resets 6d", " · 6d")
  assert.equal(wide.reset, " · Resets 6d")
  assert.equal(wide.barWidth, PROVIDER_BAR_MAX)
  // Default 38-column panel: "Weekly: ████████████ 100% · Resets 6d" used to wrap.
  const def = providerRowLayout(32, "Weekly: ", " 100%", " · Resets 6d", " · 6d")
  assert.equal(def.reset, " · Resets 6d")
  assert.equal(visualWidth("Weekly: ") + def.barWidth + 5 + 12, 32)
  const remaining = providerRowLayout(32, "Weekly: ", " 100% left", " · Resets 6d", " · 6d")
  assert.equal(remaining.reset, " · 6d")
  const tiny = providerRowLayout(20, "Weekly: ", " 100% left", " · Resets 6d", " · 6d")
  assert.equal(tiny.reset, "")
})

test("provider header right text is cut by remaining width", () => {
  for (const panel of [38, 45, 60]) {
    const avail = PROVIDER_HEADER(panel)
    for (const name of ["Codex", "MiniMax CN Coding Plan", "GitHub Copilot Add-on", "智谱 Coding Plan"]) {
      for (const right of ["12%/5h 40%/7d", "Unavailable: request timed out after 15s", "刷新中…", "未配置"]) {
        const fit = providerHeaderFit(avail, name, right)
        const line = 2 + visualWidth(fit.name) + 2 + (fit.right ? 1 + visualWidth(fit.right) : 0)
        assert.ok(line <= avail, `panel=${panel} ${name} | ${right} → ${line}/${avail}`)
      }
    }
  }
  assert.deepEqual(providerHeaderFit(34, "Codex", "12%/5h 40%/7d"), { name: "Codex", right: "12%/5h 40%/7d" })
})

test("usageLevel colors by used percent", () => {
  assert.equal(usageLevel(95), "critical")
  assert.equal(usageLevel(90), "critical")
  assert.equal(usageLevel(70), "warn")
  assert.equal(usageLevel(69.9), "ok")
  assert.equal(usageLevel(null), "ok")
  assert.equal(usageLevel(Number.NaN), "ok")
})

test("percentBar fills proportionally", () => {
  assert.equal(percentBar(50, 10), "█████░░░░░")
  assert.equal(percentBar(100, 4), "████")
  assert.equal(percentBar(150, 4), "████")
  assert.equal(percentBar(-5, 4), "░░░░")
})
