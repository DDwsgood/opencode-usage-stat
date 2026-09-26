import type { ResolvedCredential } from "./credentials.js";
import { formatResetDuration } from "./formatter.js";
/** Relative reset formatting shared with the UI ("5m"/"3h"/"2d"/"now"). */
export { formatResetDuration as formatReset };
export declare const PROVIDER_TIMEOUT_MS = 15000;
export interface UsageWindow {
    label: string;
    percent: number | null;
    resetsAt: string | null;
    valueLabel: string | null;
}
export interface ProviderUsageResult {
    providerId: ProviderId;
    providerName: string;
    configured: boolean;
    ok: boolean;
    /** Short human status line (no secrets). */
    status: string;
    error?: string;
    windows?: UsageWindow[];
    planLabel?: string | null;
}
/** How collapsed headers present usage percentages. */
export type UsageDisplayMode = "used" | "remaining";
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
declare function toNumber(value: unknown): number | null;
export { toNumber };
export declare const OPENCODE_GO_ENV_KEYS: string[];
export declare const OPENCODE_GO_URL = "https://opencode.ai/zen/go/v1/usage";
export interface OpenCodeGoPayload {
    usage?: Record<string, {
        percent?: number;
        resetsAt?: string;
    }>;
}
/** Parse the OpenCode Go usage API payload into usage windows. */
export declare function parseOpenCodeGoUsage(payload: unknown): UsageWindow[];
export declare function fetchOpenCodeGoUsage(apiKey: string, fetchImpl?: FetchLike): Promise<UsageWindow[]>;
export declare const DEEPSEEK_ALIASES: string[];
export declare const DEEPSEEK_ENV_KEYS: string[];
export declare const DEEPSEEK_URL = "https://api.deepseek.com/user/balance";
export interface DeepSeekPayload {
    balance_infos?: Array<{
        currency?: string;
        total_balance?: string | number;
    }>;
    is_available?: boolean;
}
/** Parse DeepSeek balance, preferring USD then CNY. */
export declare function parseDeepSeekBalance(payload: unknown): UsageWindow[];
export declare function fetchDeepSeekBalance(apiKey: string, fetchImpl?: FetchLike): Promise<UsageWindow[]>;
export declare const CODEX_ALIASES: string[];
export declare const CODEX_ENV_KEYS: string[];
export declare const CODEX_URL = "https://chatgpt.com/backend-api/wham/usage";
export interface CodexPayload {
    rate_limit?: {
        primary_window?: {
            used_percent?: number;
            limit_window_seconds?: number;
            reset_at?: string | number;
        };
        secondary_window?: {
            used_percent?: number;
            limit_window_seconds?: number;
            reset_at?: string | number;
        };
    };
    credits?: {
        balance?: number;
        unlimited?: boolean;
    };
    spend_control?: {
        individual_limit?: {
            used?: number;
            limit?: number;
            used_percent?: number;
        };
    };
}
/** Parse the ChatGPT wham/usage payload. */
export declare function parseCodexUsage(payload: unknown): UsageWindow[];
export declare function fetchCodexUsage(accessToken: string, accountId: string | null, fetchImpl?: FetchLike): Promise<UsageWindow[]>;
export declare const CLAUDE_ALIASES: string[];
export declare const CLAUDE_ENV_KEYS: string[];
export declare const CLAUDE_URL = "https://api.anthropic.com/api/oauth/usage";
/**
 * Parse the Anthropic OAuth usage payload:
 *   limits[].kind = session -> 5h window, weekly_all -> 7d window,
 *   weekly_scoped -> per-model 7d rows; falls back to legacy five_hour/seven_day;
 *   spend (extra usage credits) becomes an "Extra Usage" row.
 */
export declare function parseClaudeUsage(payload: unknown): UsageWindow[];
export declare function fetchClaudeUsage(accessToken: string, fetchImpl?: FetchLike): Promise<UsageWindow[]>;
export declare const KIMI_ALIASES: string[];
export declare const KIMI_ENV_KEYS: string[];
export declare const KIMI_URL = "https://api.kimi.com/coding/v1/usages";
export declare function parseKimiUsage(payload: unknown): UsageWindow[];
export declare function fetchKimiUsage(apiKey: string, fetchImpl?: FetchLike): Promise<UsageWindow[]>;
export declare const ZAI_ALIASES: string[];
export declare const ZAI_ENV_KEYS: string[];
export declare const ZAI_URL = "https://api.z.ai/api/monitor/usage/quota/limit";
export declare function parseZaiUsage(payload: unknown): UsageWindow[];
export declare function fetchZaiUsage(apiKey: string, fetchImpl?: FetchLike): Promise<{
    windows: UsageWindow[];
    planLabel: string | null;
}>;
export declare const ZHIPUAI_ALIASES: string[];
export declare const ZHIPUAI_ENV_KEYS: string[];
export declare const ZHIPUAI_URL = "https://open.bigmodel.cn/api/monitor/usage/quota/limit";
export declare function parseZhipuaiUsage(payload: unknown): UsageWindow[];
export declare function fetchZhipuaiUsage(apiKey: string, fetchImpl?: FetchLike): Promise<UsageWindow[]>;
export declare const MINIMAX_ALIASES: string[];
export declare const MINIMAX_ENV_KEYS: string[];
export declare const MINIMAX_CN_ALIASES: string[];
export declare const MINIMAX_CN_ENV_KEYS: string[];
export declare function parseMiniMaxUsage(payload: unknown, usageFieldsAreRemaining: boolean): UsageWindow[];
export declare const OPENROUTER_ALIASES: string[];
export declare const OPENROUTER_ENV_KEYS: string[];
export declare const OPENROUTER_URL = "https://openrouter.ai/api/v1/credits";
export declare function parseOpenRouterCredits(payload: unknown): UsageWindow[];
export declare function fetchOpenRouterCredits(apiKey: string, fetchImpl?: FetchLike): Promise<UsageWindow[]>;
export declare const OLLAMA_CLOUD_ALIASES: string[];
export declare const OLLAMA_CLOUD_ENV_KEYS: string[];
export interface OllamaCloudCredential {
    cookie: string | null;
}
/** Cookie from the plugin's own secure file or OpenChamber's shared one. */
export declare function resolveOllamaCloudCookie(): string | null;
/**
 * Parse https://ollama.com/settings HTML into usage windows. Fragile by design.
 * New billing (Sept 2026): "Monthly usage" meter, "$X of $Y used", reset via
 * data-time, plan badge after "Included usage", plus "Balance remaining".
 * Legacy billing: Session/Weekly percentages and "Premium requests N / M".
 */
export declare function parseOllamaSettingsHtml(html: string): UsageWindow[];
export declare function fetchOllamaCloudUsage(cookie: string, fetchImpl?: FetchLike): Promise<UsageWindow[]>;
export declare const COPILOT_ALIASES: string[];
export declare const COPILOT_ENV_KEYS: string[];
export declare function buildCopilotWindows(payload: unknown): UsageWindow[];
export declare function fetchCopilotUsage(accessToken: string, addonOnly: boolean, fetchImpl?: FetchLike): Promise<UsageWindow[]>;
export declare const GOOGLE_ALIASES: string[];
export declare const GOOGLE_ENV_KEYS: string[];
/** Fetch Gemini/Antigravity per-model quota. Reads its own auth sources; ignores the generic secret. */
export declare function fetchGoogleUsage(fetchImpl?: FetchLike): Promise<UsageWindow[]>;
export declare const XAI_ALIASES: string[];
export declare const XAI_ENV_KEYS: string[];
/** Extract current-period usedPercent + reset from the billing protobuf response. */
export declare function parseXaiUsage(bytes: Uint8Array): {
    usedPercent: number;
    resetAt: number | null;
};
interface XaiAuthMaterial {
    accessToken: string | null;
    refreshToken: string | null;
    expires: number | null;
}
export declare function fetchXaiUsage(material: XaiAuthMaterial, fetchImpl?: FetchLike): Promise<UsageWindow[]>;
export declare const CURSOR_ALIASES: string[];
export declare const CURSOR_ENV_KEYS: string[];
export interface CursorCredential {
    accessToken: string | null;
}
/** Access token from a secure local JSON file ({ accessToken }) or the credential DB. */
export declare function resolveCursorCredential(resolved: ResolvedCredential): string | null;
export declare function parseCursorUsage(payload: unknown): UsageWindow[];
export declare function fetchCursorUsage(accessToken: string, fetchImpl?: FetchLike): Promise<UsageWindow[]>;
export declare const COMMAND_CODE_ALIASES: string[];
export declare const COMMAND_CODE_ENV_KEYS: string[];
export declare const COMMAND_CODE_API_BASE = "https://api.commandcode.ai";
export interface CommandCodeUsageData {
    credits?: unknown;
    subscription?: unknown;
    summary?: unknown;
}
/** Parse the official Command Code CLI's alpha usage responses. */
export declare function parseCommandCodeUsage(data: CommandCodeUsageData): {
    windows: UsageWindow[];
    planLabel: string | null;
};
/** Prefer the normal resolver, then reuse the official CLI's local auth file. */
export declare function resolveCommandCodeCredential(resolved: ResolvedCredential): string | null;
export declare function fetchCommandCodeUsage(apiKey: string, fetchImpl?: FetchLike): Promise<{
    windows: UsageWindow[];
    planLabel: string | null;
}>;
export declare const DEVIN_ALIASES: string[];
export declare const DEVIN_ENV_KEYS: string[];
export declare const DEVIN_API_FALLBACK_URL = "https://server.codeium.com";
export declare const DEVIN_USER_STATUS_PATH = "/exa.seat_management_pb.SeatManagementService/GetUserStatus";
/**
 * Parse the Devin GetUserStatus payload into daily/weekly quota windows.
 *
 * Response shape:
 *   { userStatus: { planStatus: { planInfo: { planName, isDevin,
 *     hideDailyQuota?, hideWeeklyQuota? }, dailyQuotaRemainingPercent?,
 *     weeklyQuotaRemainingPercent?, dailyQuotaResetAtUnix?,
 *     weeklyQuotaResetAtUnix? } }, planInfo: {...} }
 *
 * proto3 omits zero-valued scalar fields, so an omitted remaining percent
 * means 0% left (100% used) — but only when the response carries a real
 * quota structure. A missing/malformed planStatus returns null instead of
 * fabricating exhaustion. The nested planStatus.planInfo is authoritative
 * for the plan name; the top-level planInfo may disagree.
 */
export declare function parseDevinUsage(payload: unknown): {
    windows: UsageWindow[];
    planLabel: string | null;
} | null;
export declare function fetchDevinUsage(credentials: {
    apiKey: string;
    apiServerUrl: string | null;
}, fetchImpl?: FetchLike): Promise<{
    windows: UsageWindow[];
    planLabel: string | null;
}>;
export declare const DEVIN_PLUGIN_ID = "opencode-devin-v2";
export declare function hasEnabledDevinModel(models: ReadonlyArray<{
    providerID?: string;
    enabled?: boolean;
}> | undefined | null): boolean;
export declare function isDevinUsageVisible(opts: {
    configEnabled: boolean;
    pluginIds: readonly string[];
    hasDevinModel: boolean;
}): boolean;
/**
 * Stable key identifying the location a gate check belongs to, so an async
 * plugin-list response can be scoped to (and rejected for) the location that
 * was current when it was issued.
 */
export declare function devinLocationKey(location: {
    directory?: string;
    workspaceID?: string;
} | undefined | null): string;
/**
 * Apply an async plugin-list result to the gate only when it still belongs to
 * the current location and is not superseded by a newer request. Otherwise
 * the previous state stands — a stale list must never qualify another
 * location (strict AND applies per location).
 */
export declare function devinGatePlugins(state: {
    key: string;
    seq: number;
    pluginIds: readonly string[];
}, currentKey: string, requestKey: string, seq: number, pluginIds: readonly string[]): {
    key: string;
    seq: number;
    pluginIds: readonly string[];
};
export type ProviderId = "opencode-go" | "deepseek" | "codex" | "claude" | "kimi-for-coding" | "zai-coding-plan" | "zhipuai-coding-plan" | "minimax-coding-plan" | "minimax-cn-coding-plan" | "openrouter" | "ollama-cloud" | "github-copilot" | "github-copilot-addon" | "google" | "xai" | "cursor" | "command-code" | "devin";
interface ProviderSpec {
    id: ProviderId;
    name: string;
    aliases: string[];
    envKeys: string[];
}
export declare const PROVIDERS: readonly ProviderSpec[];
export declare const USAGE_STAT_PROVIDER_IDS: readonly ProviderId[];
export interface CredentialResolver {
    (spec: {
        aliases: string[];
        envKeys: string[];
    }): ResolvedCredential;
}
/** Default resolver: OpenCode credential DB → auth.json → env → .env. */
export declare const defaultCredentialResolver: CredentialResolver;
/** Dollar-pool value label produced by the Ollama Cloud new-billing parser. */
export declare const DOLLAR_POOL_LABEL: RegExp;
/** Remaining dollars from a dollar-pool value label, null when not one. */
export declare function dollarPoolRemaining(valueLabel: string | null): number | null;
/** Compact dollar amount without symbol: "60" / "47.5" / "12.34". */
export declare function shortDollars(value: number): string;
/**
 * Highest used percent across all windows (== tightest remaining headroom),
 * ignoring null/NaN/Infinity. Returns null when no window reports a percent.
 * Display-mode independent: percent is always "used" in UsageWindow.
 */
export declare function worstUsagePercent(windows: UsageWindow[] | undefined | null): number | null;
/**
 * Collapsed-row summary: "n%/5h m%/7d" for the session and weekly windows.
 * Monthly/billing-cycle totals are intentionally
 * ignored in the collapsed state (they remain visible when expanded),
 * except dollar-pool windows (Ollama Cloud new billing) surface
 * "[percent]%/[credits]$". Returns null when nothing displayable
 * exists (caller falls back to status text).
 */
export declare function collapsedSummary(windows: UsageWindow[] | undefined, mode: UsageDisplayMode): string | null;
/**
 * Resolve secret (kept private) and fetch provider usage.
 * `getCredential` is injectable for tests (defaults to the real resolver).
 */
export declare function checkProviderUsage(providerId: ProviderId, fetchImpl?: FetchLike, getCredential?: CredentialResolver): Promise<ProviderUsageResult>;
export type ProviderUsageConfig = Partial<Record<ProviderId, boolean>>;
/** Provider polling is opt-in; omitted or non-boolean values remain disabled. */
export declare function resolveProviderUsageConfig(options: unknown): Record<ProviderId, boolean>;
