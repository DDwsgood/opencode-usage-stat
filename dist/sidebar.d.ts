import type { JSX } from "solid-js";
import type { Context } from "@opencode-ai/plugin/tui/context";
import { formatTokens, formatCost } from "./formatter.js";
import type { PerfTracker } from "./perf-tracker.js";
import type { TokenMessage } from "./tui.js";
export interface SidebarConfig {
    sidebar: {
        showPerformance: boolean;
        showPricing: boolean;
        showTrend: boolean;
    };
    language: "zh" | "en" | "auto";
}
export { formatTokens, formatCost };
export declare function loadConfig(context: Context): SidebarConfig;
export interface UsageStatPanelProps {
    context: Context;
    perfTracker: PerfTracker;
    sessionID: string;
    revision: () => number;
    allTokenMessages: () => TokenMessage[];
}
export declare function UsageStatPanel(props: UsageStatPanelProps): JSX.Element;
