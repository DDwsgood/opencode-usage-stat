// tui-layout.ts - pure width/segment math for the sidebar so layout rules
// can be unit-tested without a renderer.
import { truncateToWidth, visualWidth } from "./text-width.js"

// ── Token distribution bar ──

export interface DistInput {
  cacheRead: number
  /** Uncached input + cache write. */
  input: number
  /** Output + reasoning. */
  output: number
}

export interface DistSegments {
  cache: number
  input: number
  output: number
}

/**
 * Split `width` cells across cache / input / output by token share using
 * largest-remainder rounding. Every non-zero category gets at least one cell
 * (when width allows), and the sum is exactly `width` whenever any category
 * is non-zero.
 */
export function distSegments(data: DistInput, width: number): DistSegments {
  const values = [data.cacheRead, data.input, data.output].map(v => (Number.isFinite(v) && v > 0 ? v : 0))
  const total = values[0] + values[1] + values[2]
  const w = Math.max(0, Math.floor(width))
  if (total <= 0 || w === 0) return { cache: 0, input: 0, output: 0 }
  const nonZero = [0, 1, 2].filter(i => values[i] > 0)
  const out = [0, 0, 0]

  if (w <= nonZero.length) {
    // Not enough cells for everyone: the biggest categories get one each.
    const ranked = [...nonZero].sort((a, b) => values[b] - values[a] || a - b)
    for (const i of ranked.slice(0, w)) out[i] = 1
  } else {
    const exact = values.map(v => (v / total) * w)
    let assigned = 0
    for (let i = 0; i < 3; i++) {
      out[i] = Math.floor(exact[i])
      assigned += out[i]
    }
    const byRemainder = [...nonZero].sort((a, b) =>
      (exact[b] - out[b]) - (exact[a] - out[a]) || values[b] - values[a] || a - b)
    for (let k = 0; assigned < w; k++, assigned++) out[byRemainder[k % byRemainder.length]]++
    // Enforce the 1-cell minimum by borrowing from the widest segment.
    for (const i of nonZero) {
      if (out[i] > 0) continue
      const donor = [0, 1, 2].reduce((best, j) => (out[j] > out[best] ? j : best), 0)
      out[donor]--
      out[i] = 1
    }
  }
  return { cache: out[0], input: out[1], output: out[2] }
}

export const DIST_BAR_MIN = 6
export const DIST_BAR_MAX = 48
/** " 100.0%" */
export const DIST_RATE_BUDGET = 7
/** " ↑12.3%" */
export const DIST_TREND_BUDGET = 7

/**
 * Dist bar width inside a model block. `contentWidth` is the usable row
 * width, `prefixWidth` the padded "Dist: " label, `suffix` the actual text
 * after the bar (rate/MISSING + trend). A fixed suffix budget keeps bars of
 * different models aligned; a longer real suffix shrinks the bar instead of
 * wrapping.
 */
export function distBarWidth(contentWidth: number, prefixWidth: number, suffix: string, showTrend: boolean): number {
  const budget = DIST_RATE_BUDGET + (showTrend ? DIST_TREND_BUDGET : 0)
  const suffixW = Math.max(budget, visualWidth(suffix))
  return clamp(contentWidth - prefixWidth - suffixW, DIST_BAR_MIN, DIST_BAR_MAX)
}

// ── Provider usage rows ──

export const PROVIDER_BAR_MIN = 5
export const PROVIDER_BAR_MAX = 20

export interface ProviderRowLayout {
  barWidth: number
  /** Reset suffix to render (may be shortened or "" to make the row fit). */
  reset: string
}

/**
 * Fit "label + bar + suffix + reset" into `contentWidth` cells. The bar
 * shrinks first; below PROVIDER_BAR_MIN the reset suffix falls back to
 * `compactReset`, then disappears.
 */
export function providerRowLayout(
  contentWidth: number,
  label: string,
  suffix: string,
  reset: string,
  compactReset: string,
): ProviderRowLayout {
  const fixed = visualWidth(label) + visualWidth(suffix)
  for (const r of reset ? [reset, compactReset, ""] : [""]) {
    const bar = contentWidth - fixed - visualWidth(r)
    if (bar >= PROVIDER_BAR_MIN || r === "") {
      return { barWidth: clamp(bar, PROVIDER_BAR_MIN, PROVIDER_BAR_MAX), reset: r }
    }
  }
  return { barWidth: PROVIDER_BAR_MIN, reset: "" }
}

/**
 * Provider header "● Name ▾" + gap + right text within `available` cells.
 * The right text is cut first; the name only shrinks when it alone is too wide.
 */
export function providerHeaderFit(available: number, name: string, right: string): { name: string; right: string } {
  // "● " before the name and " ▾" after it.
  const chrome = 4
  const fittedName = truncateToWidth(name, Math.max(1, available - chrome))
  const room = available - chrome - visualWidth(fittedName) - 1
  return { name: fittedName, right: room >= 2 ? truncateToWidth(right, room) : "" }
}

export type UsageLevel = "ok" | "warn" | "critical"

/** Color level from the *used* percent, regardless of display mode. */
export function usageLevel(usedPercent: number | null | undefined): UsageLevel {
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) return "ok"
  if (usedPercent >= 90) return "critical"
  if (usedPercent >= 70) return "warn"
  return "ok"
}

export function percentBar(percent: number, width: number): string {
  const p = Number.isFinite(percent) ? percent : 0
  const filled = Math.max(0, Math.min(width, Math.floor((p / 100) * width)))
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled))
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)))
}
