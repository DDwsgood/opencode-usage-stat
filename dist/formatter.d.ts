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
    meta: HtmlReportMeta;
    apiCost?: ApiCostAnalysis;
    errors?: ErrorStats;
    hourlyHeatmap?: HourlyHeatmapItem[];
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
export declare function cacheHitRate(input: number, cacheRead: number): number;
export declare function getPresetRange(preset: "all" | "7d" | "30d" | "month"): Pick<UsageFilters, "startDate" | "endDate">;
