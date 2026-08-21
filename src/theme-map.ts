// theme-map.ts - Map the V2 ResolvedTheme to the semantic colors the panel uses.
import type { ResolvedTheme } from "@opencode-ai/theme/tui"
import { RGBA } from "@opentui/core"

export interface ThemeColorMap {
  primary: RGBA
  muted: RGBA
  dim: RGBA
  green: RGBA
  red: RGBA
  amber: RGBA
  purple: RGBA
  cyan: RGBA
  border: RGBA
}

export function resolveThemeColors(theme: ResolvedTheme): ThemeColorMap {
  const primary = theme.text?.default ?? RGBA.fromInts(200, 210, 230, 255)
  const muted = theme.text?.subdued ?? RGBA.fromInts(140, 150, 170, 255)
  const dim = RGBA.fromInts(100, 108, 122, 255)
  const green = theme.text?.feedback?.success?.default ?? RGBA.fromInts(63, 185, 80, 255)
  const red = theme.text?.feedback?.error?.default ?? RGBA.fromInts(244, 67, 54, 255)
  const amber = theme.text?.feedback?.warning?.default ?? RGBA.fromInts(255, 193, 7, 255)
  const purple = RGBA.fromInts(180, 120, 255, 255)
  const cyan = RGBA.fromInts(80, 190, 255, 255)
  const border = theme.border?.default ?? RGBA.fromInts(55, 65, 80, 255)
  return { primary, muted, dim, green, red, amber, purple, cyan, border }
}