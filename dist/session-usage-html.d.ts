import type { ModelBreakdownItem, MessageRow, SessionTokenData, ApiCostAnalysis, ErrorStats } from "./formatter.js";
interface SessionReportData {
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
export declare function buildSessionReportData(sessionId: string, sessionTitle: string, subagentCount: number, summary: SessionTokenData, models: ModelBreakdownItem[], messages: MessageRow[], errors: ErrorStats): Promise<SessionReportData>;
export declare function generateSessionUsageHtml(data: SessionReportData): string;
export {};
