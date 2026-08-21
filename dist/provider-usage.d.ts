export declare const PROVIDER_TIMEOUT_MS = 15000;
export interface UsageWindow {
    label: string;
    percent: number | null;
    resetsAt: string | null;
    valueLabel: string | null;
}
export interface ProviderUsageResult {
    providerId: "opencode-go" | "deepseek" | "codex";
    providerName: string;
    configured: boolean;
    ok: boolean;
    /** Short human status line (no secrets). */
    status: string;
    error?: string;
    windows?: UsageWindow[];
}
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
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
export declare const USAGE_STAT_PROVIDER_IDS: ("deepseek" | "opencode-go" | "codex")[];
export interface CredentialResolver {
    (spec: {
        aliases: string[];
        envKeys: string[];
    }): {
        value: string | null;
        accountId: string | null;
        source: "sqlite" | "env" | "dotenv" | null;
    };
}
/** Default resolver: reads the OpenCode V2 credential DB / env / .env. */
export declare const defaultCredentialResolver: CredentialResolver;
/**
 * Resolve secret (kept private) and fetch provider usage.
 * `getCredential` is injectable for tests (defaults to the real resolver).
 */
export declare function checkProviderUsage(providerId: "opencode-go" | "deepseek" | "codex", fetchImpl?: FetchLike, getCredential?: CredentialResolver): Promise<ProviderUsageResult>;
export type ProviderUsageConfig = Record<"opencode-go" | "deepseek" | "codex", boolean>;
/** Provider polling is opt-in; omitted or non-boolean values remain disabled. */
export declare function resolveProviderUsageConfig(options: unknown): ProviderUsageConfig;
export {};
