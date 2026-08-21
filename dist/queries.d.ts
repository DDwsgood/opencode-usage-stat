import type { OpenCodeClient } from "@opencode-ai/client";
import type { DailyBreakdownItem, ErrorStats, HourlyHeatmapItem, MessageRow, ModelBreakdownItem, ProviderBreakdownItem, SessionBreakdownItem, SessionTokenData, UsageFilters, UsageReport } from "./formatter.js";
/** Bind the TUI plugin's V2 client. Must be called before any query. */
export declare function setV2Client(c: OpenCodeClient): void;
export declare function getV2Client(): OpenCodeClient | null;
export declare function getSummary(filters?: UsageFilters): Promise<SessionTokenData>;
export declare function getModelBreakdown(filters?: UsageFilters): Promise<ModelBreakdownItem[]>;
export declare function getProviderBreakdown(filters?: UsageFilters): Promise<ProviderBreakdownItem[]>;
export declare function getDailyBreakdown(filters?: UsageFilters): Promise<DailyBreakdownItem[]>;
export declare function getSessionBreakdown(filters?: UsageFilters): Promise<SessionBreakdownItem[]>;
/** Fetch child (forked/family) session IDs for a parent session recursively. */
export declare function getChildSessionIds(parentSessionId: string): Promise<string[]>;
/** Per-request message details for a session + its children (old dashboard contract). */
export declare function getMessageDetails(sessionId: string): Promise<MessageRow[]>;
export declare function getSessionTitle(sessionId: string): Promise<string>;
/** 失败请求统计 (assistant with tokens all zero, or error finish) */
export declare function getErrorStats(filters?: UsageFilters): Promise<ErrorStats>;
/** Hourly heatmap (dow 0-6, hour 0-23) for the total dashboard. */
export declare function getHourlyHeatmap(filters?: UsageFilters): Promise<HourlyHeatmapItem[]>;
export declare function getUsageReport(filters?: UsageFilters): Promise<UsageReport>;
/** Available model IDs across all sessions (used by filters / exports). */
export declare function getAvailableModels(): Promise<string[]>;
export declare function getAvailableProviders(): Promise<string[]>;
