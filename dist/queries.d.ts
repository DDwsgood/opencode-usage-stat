import type { OpenCodeClient, SessionMessageInfo } from "@opencode-ai/client";
import type { AgentBreakdownItem, CacheSavings, DailyBreakdownItem, ErrorStats, HourlyHeatmapItem, MessageRow, ModelBreakdownItem, ModelLatencyItem, OverheadStats, PeriodComparison, PeriodSnapshot, ProjectBreakdownItem, ProviderBreakdownItem, ReportSourceMeta, SessionBreakdownItem, SessionKindSplit, SessionReportInput, SessionTokenData, UsageFilters, UsageReport } from "./formatter.js";
import type { LoadRange, SessionRow, UsageRow } from "./sqlite-source.js";
export type { UsageRow, SessionRow } from "./sqlite-source.js";
/** Bind the TUI plugin's V2 client. Must be called before any query. */
export declare function setV2Client(c: OpenCodeClient): void;
export declare function getV2Client(): OpenCodeClient | null;
export type ProgressFn = (done: number, total: number) => void;
export interface Dataset {
    sessions: Map<string, SessionRow>;
    rows: UsageRow[];
    source: ReportSourceMeta;
    /** Sessions whose messages could not be read (API path); excluded from overhead. */
    failedSessions: Set<string>;
}
export interface LoadOptions extends LoadRange {
    onProgress?: ProgressFn;
}
/** Invalidate cached data (called when the client is rebound or data changes materially). */
export declare function clearQueryCache(): void;
/** Load projected rows for the range, SQLite first, API as fallback. */
export declare function loadDataset(opts?: LoadOptions): Promise<Dataset>;
/** Project a V2 assistant message to the report row (exported for tests). */
export declare function projectAssistant(m: SessionMessageInfo | undefined, sessionID: string): UsageRow | null;
/** Convert day-granularity filters to a [since, until) millisecond window in local time. */
export declare function filtersToRange(filters: UsageFilters): LoadRange;
export declare function summarizeRows(rows: UsageRow[]): SessionTokenData;
export declare function modelBreakdownRows(rows: UsageRow[]): ModelBreakdownItem[];
export declare function providerBreakdownRows(rows: UsageRow[]): ProviderBreakdownItem[];
export declare function dailyBreakdownRows(rows: UsageRow[], limit?: number): DailyBreakdownItem[];
export declare function sessionBreakdownRows(rows: UsageRow[], sessions: Map<string, SessionRow>, limit?: number): SessionBreakdownItem[];
export type RequestOutcome = "success" | "failed" | "aborted" | "pending";
/** Outcome classification shared by every report (see ErrorStats). */
export declare function classifyRow(r: Pick<UsageRow, "finish" | "errorType" | "completed">): RequestOutcome;
export declare function errorStatsRows(rows: UsageRow[]): ErrorStats;
export declare function heatmapRows(rows: UsageRow[]): HourlyHeatmapItem[];
/**
 * Overhead for sessions whose whole lifetime lies inside the window (so each
 * session is counted once across adjacent periods): session totals minus the
 * Σ of that session's assistant rows, floored at 0 per field.
 */
export declare function overheadStatsRows(rows: UsageRow[], sessions: Map<string, SessionRow>, range?: LoadRange, exclude?: Set<string>): OverheadStats;
export declare function projectBreakdownRows(rows: UsageRow[], sessions: Map<string, SessionRow>, limit?: number): ProjectBreakdownItem[];
export declare function agentBreakdownRows(rows: UsageRow[]): AgentBreakdownItem[];
export declare function sessionKindRows(rows: UsageRow[], sessions: Map<string, SessionRow>): SessionKindSplit;
/** completed − created for successful requests, per model. */
export declare function modelLatencyRows(rows: UsageRow[]): ModelLatencyItem[];
export declare function cacheSavingsFromModels(models: ModelBreakdownItem[]): CacheSavings;
export declare function periodSnapshotRows(rows: UsageRow[]): PeriodSnapshot;
/**
 * Previous window of the same length. Day-aligned windows report day labels;
 * sub-day windows (5h) report minute labels. Unbounded ranges have no previous.
 */
export declare function previousRange(range: LoadRange): {
    sinceMs: number;
    untilMs: number;
    label: {
        start: string;
        end: string;
    };
} | null;
export interface PeriodReport extends UsageReport {
    hourlyHeatmap: HourlyHeatmapItem[];
    errors: ErrorStats;
    overhead?: OverheadStats;
    projects: ProjectBreakdownItem[];
    agents: AgentBreakdownItem[];
    sessionKinds: SessionKindSplit;
    modelLatency: ModelLatencyItem[];
    cacheSavings: CacheSavings;
    comparison: PeriodComparison;
    source: ReportSourceMeta;
}
/** Every period aggregate from a single load (plus the previous window for comparison). */
export declare function getPeriodReport(filters?: UsageFilters, window?: LoadRange, onProgress?: ProgressFn): Promise<PeriodReport>;
/** Session + descendants (root first). SQLite first, API fallback. */
export declare function getSessionFamily(sessionId: string): Promise<string[]>;
/** Fetch child (forked/family) session IDs for a parent session recursively. */
export declare function getChildSessionIds(parentSessionId: string): Promise<string[]>;
/** All data the session report needs, from one family-scoped load. */
export declare function getSessionReportInput(sessionId: string, onProgress?: ProgressFn): Promise<SessionReportInput>;
export declare function getSummary(filters?: UsageFilters): Promise<SessionTokenData>;
export declare function getModelBreakdown(filters?: UsageFilters): Promise<ModelBreakdownItem[]>;
export declare function getProviderBreakdown(filters?: UsageFilters): Promise<ProviderBreakdownItem[]>;
export declare function getDailyBreakdown(filters?: UsageFilters): Promise<DailyBreakdownItem[]>;
export declare function getSessionBreakdown(filters?: UsageFilters): Promise<SessionBreakdownItem[]>;
/** Per-request message details for a session + its children (old dashboard contract). */
export declare function getMessageDetails(sessionId: string): Promise<MessageRow[]>;
export declare function getSessionTitle(sessionId: string): Promise<string>;
/** Request outcome stats (finish / error.type based; see ErrorStats). */
export declare function getErrorStats(filters?: UsageFilters): Promise<ErrorStats>;
/** Hourly heatmap (dow 0-6, hour 0-23) for the total dashboard. */
export declare function getHourlyHeatmap(filters?: UsageFilters): Promise<HourlyHeatmapItem[]>;
export declare function getUsageReport(filters?: UsageFilters): Promise<UsageReport>;
/** Available model IDs across all sessions (used by filters / exports). */
export declare function getAvailableModels(): Promise<string[]>;
export declare function getAvailableProviders(): Promise<string[]>;
/**
 * Real session count for the given filters (untruncated). Report KPIs must use
 * this instead of the session table array, which is capped by `limit`.
 */
export declare function getSessionCount(filters?: UsageFilters): Promise<number>;
