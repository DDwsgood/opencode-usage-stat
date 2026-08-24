import type { Context } from "@opencode-ai/plugin/tui/context";
import type { UsageFilters, CombinedReportData, ApiCostAnalysis, SessionTokenData, ModelBreakdownItem, MessageRow, ErrorStats } from "./formatter.js";
export type ReportFormat = "html" | "text" | "json";
export type ReportScopeKind = "session" | "5h" | "7d" | "30d" | "all" | "days";
export interface ReportScope {
    kind: ReportScopeKind;
    label: string;
    days?: number;
}
export interface SessionReportView {
    sessionId: string;
    sessionTitle: string;
    subagentCount: number;
    summary: SessionTokenData;
    models: ModelBreakdownItem[];
    messages: MessageRow[];
    apiCost: ApiCostAnalysis;
    errors: ErrorStats;
    generatedAt: string;
    sessionDurationMs: number;
    firstMessageTime: number | null;
    lastMessageTime: number | null;
    tps: number;
    costPerRequest: number;
    p50Duration: number;
    p90Duration: number;
    maxDuration: number;
    avgDuration: number;
    peakTokens: number;
    peakTokensIndex: number;
}
/** Returns the date-range filter for non-session scopes. */
export declare function getDateRangeForScope(scope: ReportScope): UsageFilters;
/** Build the cumulative (total) report data for a date-range scope. */
export declare function buildCombinedData(context: Context, filters?: UsageFilters): Promise<CombinedReportData>;
/** Build a CombinedReportData covering the last N hours. */
export declare function buildRecentHoursReportData(context: Context, hours: number): Promise<CombinedReportData>;
/** Plain-text summary for cumulative/date-range reports. */
export declare function renderPeriodTextReport(data: CombinedReportData): string;
/** Plain-text summary for the current-session report. */
export declare function renderSessionTextReport(data: SessionReportView): string;
export declare function toPeriodJsonReport(data: CombinedReportData): CombinedReportData;
export declare function toSessionJsonReport(data: SessionReportView): SessionReportView;
