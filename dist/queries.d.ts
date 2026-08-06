import type { DailyBreakdownItem, ErrorStats, HourlyHeatmapItem, ModelBreakdownItem, MessageRow, ProviderBreakdownItem, SessionBreakdownItem, SessionTokenData, UsageFilters, UsageReport } from "./formatter.js";
export declare function getSummary(filters?: UsageFilters): Promise<SessionTokenData>;
export declare function getModelBreakdown(filters?: UsageFilters): Promise<ModelBreakdownItem[]>;
export declare function getProviderBreakdown(filters?: UsageFilters): Promise<ProviderBreakdownItem[]>;
export declare function getDailyBreakdown(filters?: UsageFilters): Promise<DailyBreakdownItem[]>;
export declare function getSessionBreakdown(filters?: UsageFilters): Promise<SessionBreakdownItem[]>;
/** Get all child session IDs for a given parent session (subagent sessions) */
export declare function getChildSessionIds(parentSessionId: string): Promise<string[]>;
/** Per-message detail for a specific session - used in /session-usage report */
export declare function getMessageDetails(sessionId: string): Promise<MessageRow[]>;
/** Get session title for a given session ID */
export declare function getSessionTitle(sessionId: string): Promise<string>;
export declare function getErrorStats(filters?: UsageFilters): Promise<ErrorStats>;
export declare function getHourlyHeatmap(filters?: UsageFilters): Promise<HourlyHeatmapItem[]>;
export declare function getUsageReport(filters?: UsageFilters): Promise<UsageReport>;
