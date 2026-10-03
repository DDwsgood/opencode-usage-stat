import type { ResolvedTheme } from "@opencode-ai/theme/tui";
import { RGBA } from "@opentui/core";
export interface ThemeColorMap {
    primary: RGBA;
    muted: RGBA;
    dim: RGBA;
    green: RGBA;
    red: RGBA;
    amber: RGBA;
    purple: RGBA;
    cyan: RGBA;
    border: RGBA;
    /** Dist bar: cache read (hit). */
    distCache: RGBA;
    /** Dist bar: uncached input + cache write. */
    distInput: RGBA;
    /** Dist bar: output + reasoning. */
    distOutput: RGBA;
}
export declare function resolveThemeColors(theme: ResolvedTheme): ThemeColorMap;
