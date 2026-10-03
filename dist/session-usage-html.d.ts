import type { ModelBreakdownItem, MessageRow, SessionTokenData, ApiCostAnalysis, ErrorStats, OverheadStats, AgentBreakdownItem, SessionBreakdownItem, ReportSourceMeta, SessionReportInput } from "./formatter.js";
export interface SessionReportData {
    sessionId: string;
    sessionTitle: string;
    subagentCount: number;
    summary: SessionTokenData;
    models: ModelBreakdownItem[];
    messages: MessageRow[];
    apiCost: ApiCostAnalysis;
    errors: ErrorStats;
    generatedAt: string;
    overhead?: OverheadStats;
    agents?: AgentBreakdownItem[];
    childSessions?: SessionBreakdownItem[];
    source?: ReportSourceMeta;
    sessionDurationMs: number;
    firstMessageTime: number | null;
    lastMessageTime: number | null;
    /** Generation speed: Σ(output + reasoning) / Σ(completed − created), completed requests only. */
    tps: number;
    /** Numerator/denominator of `tps`; optional so callers holding only the contract fields still type-check. */
    genTokens?: number;
    genTimeMs?: number;
    costPerRequest: number;
    p50Duration: number;
    p90Duration: number;
    maxDuration: number;
    avgDuration: number;
    peakTokens: number;
    peakTokensIndex: number;
}
/** Σ(output + reasoning) over Σ(completed − created) seconds; only requests with a positive duration count. */
export declare function generationSpeed(messages: Pick<MessageRow, "outputTokens" | "reasoningTokens" | "timeCreated" | "timeCompleted">[]): {
    tps: number;
    tokens: number;
    timeMs: number;
};
export declare function buildSessionReportData(input: SessionReportInput): Promise<SessionReportData>;
export declare function generateSessionUsageHtml(data: SessionReportData): string;
