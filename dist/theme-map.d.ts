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
}
export declare function resolveThemeColors(theme: ResolvedTheme): ThemeColorMap;
