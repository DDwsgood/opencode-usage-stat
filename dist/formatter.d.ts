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
export interface ErrorStats {
    successCount: number;
    failedCount: number;
    errorRate: number;
    byModel: Array<{
        provider: string;
        model: string;
        failed: number;
        total: number;
    }>;
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
}
/**
 * 判定某模型的缓存数据是否属于"上游不回传"（MISSING）。
 * 判定标准：请求数 >= 2 且 cacheRead 严格为 0。
 */
export declare function isMissingCache(requestCount: number, totalCacheRead: number): boolean;
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
export declare function cacheHitRate(input: number, cacheRead: number): number;
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
    avgTPS: number | null;
    maxTPS: number | null;
    minTPS: number | null;
    avgLatency: number | null;
    maxLatency: number | null;
    minLatency: number | null;
    p50Latency: number | null;
    p95Latency: number | null;
    p99Latency: number | null;
    /** 该模型加权缓存命中率：cacheRead / (cacheRead + input) */
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
    ts: string;
    model: string;
    providerID: string;
    modelID: string;
    sessionID: string;
    ttft_ms: number | null;
    /** TTFT start clock; absent entries used the obsolete assistant-created clock. */
    ttft_source?: "inbox-enqueued";
    tps: number | null;
    /** TPS uses visible + reasoning tokens over the first-to-last output window. */
    tps_source?: "all-output-window";
    latency_ms: number | null;
    /** Latency uses prompt enqueue to the final reasoning/text output event. */
    latency_source?: "inbox-to-last-output";
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cost: number;
}
