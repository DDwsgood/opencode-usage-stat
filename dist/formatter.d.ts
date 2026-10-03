export interface UsageFilters {
    sessionId?: string;
    sessionIds?: string[];
    model?: string;
    provider?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
}
export interface SessionTokenData {
    model: string;
    provider: string;
    modelsUsed: string[];
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheRead: number;
    cacheWrite: number;
    totalCost: number;
    requestCount: number;
}
export interface ModelBreakdownItem {
    provider: string;
    model: string;
    requests: number;
    sessions: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheRead: number;
    cacheWrite: number;
    totalCost: number;
}
export interface ProviderBreakdownItem {
    provider: string;
    requests: number;
    sessions: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheRead: number;
    totalCost: number;
}
export interface DailyBreakdownItem {
    day: string;
    requests: number;
    sessions: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheRead: number;
    totalCost: number;
}
export interface SessionBreakdownItem {
    sessionId: string;
    title: string;
    provider: string;
    model: string;
    requests: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheRead: number;
    totalCost: number;
    day: string;
}
export interface ErrorTypeItem {
    type: string;
    count: number;
}
export interface FinishReasonItem {
    reason: string;
    count: number;
}
/**
 * Request outcome stats. A message whose `finish` is missing and that has no
 * `time.completed` is still in progress and is excluded from every bucket.
 */
export interface ErrorStats {
    /** Completed and finish !== "error". */
    successCount: number;
    /** finish === "error" and error.type !== "aborted", regardless of tokens. */
    failedCount: number;
    /** error.type === "aborted" (user interrupt); excluded from errorRate. */
    abortedCount: number;
    /** failed / (success + failed) */
    errorRate: number;
    byModel: Array<{
        provider: string;
        model: string;
        failed: number;
        aborted: number;
        total: number;
    }>;
    /** Includes the aborted row; sorted by count desc. */
    byType: ErrorTypeItem[];
    finishReasons: FinishReasonItem[];
}
/**
 * Usage not attached to assistant messages (title generation, compaction) =
 * session-level totals − Σ assistant usage of that session, floored at 0 per
 * field. Derived estimate.
 */
export interface OverheadStats {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: number;
    /** Sessions with overhead > 0. */
    sessions: number;
}
export interface ProjectBreakdownItem {
    directory: string;
    projectId: string;
    sessions: number;
    requests: number;
    totalTokens: number;
    totalCost: number;
}
export interface AgentBreakdownItem {
    agent: string;
    sessions: number;
    requests: number;
    totalTokens: number;
    totalCost: number;
}
export interface SessionKindTotals {
    sessions: number;
    requests: number;
    totalTokens: number;
    totalCost: number;
}
/** child = sessions with a parent_id. */
export interface SessionKindSplit {
    root: SessionKindTotals;
    child: SessionKindTotals;
}
/** Latency = time.completed − time.created. */
export interface ModelLatencyItem {
    provider: string;
    model: string;
    samples: number;
    p50Ms: number;
    p90Ms: number;
    avgMs: number;
}
export interface CacheSavings {
    /** Σ cacheRead × (input price − cache_read price); estimate. */
    estimatedSavedCost: number | null;
    byModel: Array<{
        provider: string;
        model: string;
        cacheRead: number;
        saved: number | null;
    }>;
}
export interface PeriodSnapshot {
    totalTokens: number;
    totalCost: number;
    requestCount: number;
    sessions: number;
    cacheHitRate: number | null;
    errorRate: number;
}
/** previous = null for the all-history range. */
export interface PeriodComparison {
    previous: PeriodSnapshot | null;
    previousRange: {
        start: string;
        end: string;
    } | null;
}
export interface ReportSourceMeta {
    source: "sqlite" | "api";
    elapsedMs: number;
}
export interface HourlyHeatmapItem {
    dow: number;
    hour: number;
    requests: number;
    totalTokens: number;
    totalCost: number;
}
export interface UsageReport {
    filters: UsageFilters;
    summary: SessionTokenData;
    models: ModelBreakdownItem[];
    providers: ProviderBreakdownItem[];
    daily: DailyBreakdownItem[];
    sessions: SessionBreakdownItem[];
    /** Untruncated session count matching the filters (sessions[] is capped by limit). */
    totalSessions?: number;
    errors?: ErrorStats;
}
export interface ApiCostModelItem {
    provider: string;
    model: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheRead: number;
    cacheWrite: number;
    reportedCost: number;
    apiEquivCost: number | null;
    estimated: boolean;
    pricingProvider: string | null;
}
export interface ApiCostAnalysis {
    totalApiCost: number | null;
    reportedCost: number;
    byModel: ApiCostModelItem[];
}
export interface HtmlReportMeta {
    generatedAt: string;
    dateRange: {
        start: string;
        end: string;
    };
    source?: ReportSourceMeta;
}
export interface CombinedReportData {
    summary: SessionTokenData;
    models: ModelBreakdownItem[];
    providers: ProviderBreakdownItem[];
    daily: DailyBreakdownItem[];
    sessions: SessionBreakdownItem[];
    /** Untruncated session count matching the filters. */
    totalSessions?: number;
    meta: HtmlReportMeta;
    apiCost?: ApiCostAnalysis;
    errors?: ErrorStats;
    hourlyHeatmap?: HourlyHeatmapItem[];
    perfLogs?: LogEntry[];
    perfSummary?: ModelPerfStats[];
    overhead?: OverheadStats;
    /** Sorted by totalTokens desc, at most 20. */
    projects?: ProjectBreakdownItem[];
    agents?: AgentBreakdownItem[];
    sessionKinds?: SessionKindSplit;
    modelLatency?: ModelLatencyItem[];
    cacheSavings?: CacheSavings;
    comparison?: PeriodComparison;
}
/** Per-message row for detailed session breakdown */
export interface MessageRow {
    messageId: string;
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: number;
    timeCreated: number;
    timeCompleted: number | null;
    sessionId?: string;
    agent?: string;
    finish?: string | null;
    errorType?: string | null;
    isChild?: boolean;
}
/** Input for session-usage-html.ts buildSessionReportData. */
export interface SessionReportInput {
    sessionId: string;
    sessionTitle: string;
    subagentCount: number;
    summary: SessionTokenData;
    models: ModelBreakdownItem[];
    messages: MessageRow[];
    errors: ErrorStats;
    overhead?: OverheadStats;
    agents?: AgentBreakdownItem[];
    /** Per-child-session totals. */
    childSessions?: SessionBreakdownItem[];
    source?: ReportSourceMeta;
}
/**
 * 判定某模型的缓存数据是否属于"上游不回传"（MISSING）。
 * 判定标准：请求数 >= 2 且 cacheRead 与 cacheWrite 均为 0。
 * 只要有 cacheWrite 就说明上游确实回传了缓存统计，只是本窗口尚未命中读取，
 * 此时应显示 0% 命中率而不是 MISSING。
 */
export declare function isMissingCache(requestCount: number, totalCacheRead: number, totalCacheWrite?: number): boolean;
export declare function formatTokens(n: number): string;
export declare function formatCost(n: number): string;
export declare function formatDuration(ms: number | null): string;
/**
 * Relative time until an ISO reset timestamp ("now"/"5m"/"3h"/"2d").
 * Single shared implementation (previously duplicated with diverging behavior
 * in provider-usage.ts and provider-usage-blocks.tsx).
 */
export declare function formatResetDuration(iso: string): string;
/** Linear-interpolation percentile over a sorted-ascending array. */
export declare function percentileSorted(sortedAsc: number[], p: number): number;
/**
 * 界面展示用的 INPUT 口径：raw uncached input + cacheWrite。
 * 缓存读取（cacheRead）仍作为独立桶展示；TOKEN TOTAL 不受影响，不会重复加 write。
 * 纯展示计算，不修改任何持久化的 input/cache 字段。
 */
export declare function totalInputTokens(input: number, cacheWrite: number): number;
/**
 * 缓存读取命中率（统一口径）：
 *   cacheRead / (raw uncached input + cacheRead + cacheWrite)
 *
 * 传入 cacheWrite 后，分母与界面展示的 INPUT（已含 cacheWrite）一致，
 * 避免「展示口径含 write、命中率分母不含 write」造成的不一致。
 */
export declare function cacheHitRate(input: number, cacheRead: number, cacheWrite?: number): number;
export declare function getPresetRange(preset: "all" | "7d" | "30d" | "month"): Pick<UsageFilters, "startDate" | "endDate">;
/**
 * Parse `/total-usage [days]` raw slash input into a date-range filter.
 * Accepts an integer 1..3650; anything else falls back to the all-time range.
 */
export declare function parseDaysFilter(input: string | undefined): Pick<UsageFilters, "startDate" | "endDate">;
export declare function formatFilters(filters: UsageFilters): string;
export declare function formatStatusBar(data: SessionTokenData): string;
export interface SessionPerfStats {
    models: Record<string, ModelPerfStats>;
    totals: {
        totalInput: number;
        totalOutput: number;
        totalCacheRead: number;
        totalCacheWrite: number;
        totalRequests: number;
        totalCost: number;
        /** 全局加权缓存命中率（按请求数加权平均） */
        weightedCacheHitRate: number | null;
    };
}
export interface ModelPerfStats {
    model: string;
    providerID: string;
    requestCount: number;
    ttftCount: number;
    tpsCount: number;
    latencyCount: number;
    totalInput: number;
    totalOutput: number;
    totalCacheRead: number;
    totalCacheWrite: number;
    totalCost: number;
    avgTTFT: number | null;
    maxTTFT: number | null;
    minTTFT: number | null;
    p50TTFT: number | null;
    p95TTFT: number | null;
    p99TTFT: number | null;
    /** Token/time weighted response-body TPS across valid steps. */
    avgTPS: number | null;
    maxTPS: number | null;
    minTPS: number | null;
    p50TPS: number | null;
    p95TPS: number | null;
    p99TPS: number | null;
    /** Completion tokens represented by valid TPS samples. */
    tpsTotalTokens: number;
    /** Provider response-body milliseconds represented by valid TPS samples. */
    tpsTotalTimeMs: number;
    avgLatency: number | null;
    maxLatency: number | null;
    minLatency: number | null;
    p50Latency: number | null;
    p95Latency: number | null;
    p99Latency: number | null;
    /** 该模型加权缓存命中率：cacheRead / (cacheRead + raw input + cacheWrite) */
    cacheHitRate: number | null;
}
export interface TokenDistribution {
    system: number;
    user: number;
    agent: number;
    toolCall: number;
    toolResult: number;
    output: number;
    total: number;
}
export interface LogEntry {
    /** Performance record schema. Version 2 uses step response-body timing. */
    schema?: 2;
    ts: string;
    messageID?: string;
    model: string;
    providerID: string;
    modelID: string;
    sessionID: string;
    ttft_ms: number | null;
    /** TTFT start clock; absent entries used the obsolete assistant-created clock. */
    ttft_source?: "inbox-enqueued";
    tps: number | null;
    /** TPS uses completion tokens over the provider response-body window. */
    tps_source?: "all-output-window" | "step-body-window";
    tpsTokens?: number;
    tpsWindowMs?: number;
    latency_ms: number | null;
    /** Latency uses prompt enqueue to the provider response-body boundary. */
    latency_source?: "inbox-to-last-output" | "inbox-to-step-streamed";
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cost: number;
}
