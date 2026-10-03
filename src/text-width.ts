// text-width.ts - terminal cell width helpers for the TUI sidebar.
// East Asian Wide/Fullwidth ranges plus common emoji count as 2 cells;
// combining marks, variation selectors and ZWJ count as 0. Ambiguous-width
// symbols (█ ░ ● ▾ …) stay at 1, matching how OpenTUI lays them out.

const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115F],   // Hangul Jamo leading consonants
  [0x231A, 0x231B],   // ⌚⌛
  [0x23E9, 0x23EC],
  [0x23F0, 0x23F0],
  [0x23F3, 0x23F3],
  [0x25FD, 0x25FE],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267F, 0x267F],
  [0x2693, 0x2693],
  [0x26A1, 0x26A1],
  [0x26AA, 0x26AB],
  [0x26BD, 0x26BE],
  [0x26C4, 0x26C5],
  [0x26CE, 0x26CE],
  [0x26D4, 0x26D4],
  [0x26EA, 0x26EA],
  [0x26F2, 0x26F3],
  [0x26F5, 0x26F5],
  [0x26FA, 0x26FA],
  [0x26FD, 0x26FD],
  [0x2705, 0x2705],
  [0x270A, 0x270B],
  [0x2728, 0x2728],
  [0x274C, 0x274C],
  [0x274E, 0x274E],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27B0, 0x27B0],
  [0x27BF, 0x27BF],
  [0x2B1B, 0x2B1C],
  [0x2B50, 0x2B50],
  [0x2B55, 0x2B55],
  [0x2E80, 0x303E],   // CJK radicals, Kangxi, CJK symbols & punctuation
  [0x3041, 0x33FF],   // Hiragana, Katakana, Bopomofo, Hangul compat, CJK compat
  [0x3400, 0x4DBF],   // CJK Ext A
  [0x4E00, 0x9FFF],   // CJK Unified
  [0xA000, 0xA4CF],   // Yi
  [0xA960, 0xA97F],
  [0xAC00, 0xD7A3],   // Hangul syllables
  [0xF900, 0xFAFF],   // CJK compat ideographs
  [0xFE10, 0xFE19],   // vertical forms
  [0xFE30, 0xFE6F],   // CJK compat forms, small form variants
  [0xFF00, 0xFF60],   // fullwidth ASCII/punctuation
  [0xFFE0, 0xFFE6],   // fullwidth signs
  [0x1F004, 0x1F004],
  [0x1F0CF, 0x1F0CF],
  [0x1F18E, 0x1F18E],
  [0x1F191, 0x1F19A],
  [0x1F200, 0x1F251],
  [0x1F300, 0x1F64F], // misc symbols & pictographs, emoticons
  [0x1F680, 0x1F6FF], // transport & map
  [0x1F7E0, 0x1F7EB],
  [0x1F900, 0x1F9FF], // supplemental symbols & pictographs
  [0x1FA70, 0x1FAFF],
  [0x20000, 0x3FFFD], // CJK Ext B+
]

function inRanges(code: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const [start, end] = ranges[mid]
    if (code < start) hi = mid - 1
    else if (code > end) lo = mid + 1
    else return true
  }
  return false
}

export function charWidth(code: number): number {
  if (code === 0) return 0
  if (code < 0x20 || (code >= 0x7F && code < 0xA0)) return 0
  if ((code >= 0x0300 && code <= 0x036F) || (code >= 0x200B && code <= 0x200F) ||
    (code >= 0xFE00 && code <= 0xFE0F) || (code >= 0x1F3FB && code <= 0x1F3FF) ||
    (code >= 0xE0100 && code <= 0xE01EF)) return 0
  return inRanges(code, WIDE_RANGES) ? 2 : 1
}

export function visualWidth(str: string): number {
  let w = 0
  for (const c of str) w += charWidth(c.codePointAt(0) ?? 0)
  return w
}

/** Cut `str` to at most `width` cells, ending with `ellipsis` when cut. */
export function truncateToWidth(str: string, width: number, ellipsis = "…"): string {
  if (width <= 0) return ""
  if (visualWidth(str) <= width) return str
  const ellW = visualWidth(ellipsis)
  if (ellW > width) return ""
  const budget = width - ellW
  let out = ""
  let used = 0
  for (const c of str) {
    const cw = charWidth(c.codePointAt(0) ?? 0)
    if (used + cw > budget) break
    out += c
    used += cw
  }
  return out + ellipsis
}

export function padEndToWidth(str: string, width: number): string {
  return str + " ".repeat(Math.max(0, width - visualWidth(str)))
}

/** Center within `width` cells; text wider than `width` is truncated so it never overflows. */
export function centerAlign(text: string, width: number): string {
  if (width <= 0) return ""
  const fitted = truncateToWidth(text, width)
  const w = visualWidth(fitted)
  const left = Math.floor((width - w) / 2)
  return " ".repeat(left) + fitted + " ".repeat(width - w - left)
}
