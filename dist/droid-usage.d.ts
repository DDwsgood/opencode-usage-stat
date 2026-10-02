import type { ProviderUsageResult, UsageWindow } from "./provider-usage.js";
export declare const DROID_PLUGIN_ID = "opencode-droid-v2";
export declare const DROID_PROVIDER_NAME = "Droid (Factory)";
export declare const DROID_ALIASES: string[];
export declare const DROID_ENV_KEYS: string[];
/**
 * Portable RPC descriptor, structurally identical to `DroidUsageRpc` exported
 * by opencode-droid-v2/rpc.ts. Kept as a local literal so this plugin takes no
 * dependency on the droid plugin's internals or on @factory packages; the
 * host resolves the registered handler by `id`.
 */
export declare const DROID_USAGE_RPC: {
    readonly id: "opencode-droid-v2";
    readonly events: {};
    readonly methods: {
        readonly usage: {
            readonly input: {
                readonly type: "object";
                readonly properties: {
                    readonly sessionID: {
                        readonly type: "string";
                    };
                };
                readonly additionalProperties: false;
            };
            readonly output: {
                readonly type: "object";
                readonly properties: {
                    readonly version: {
                        readonly const: 1;
                    };
                    readonly records: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "object";
                        };
                    };
                };
                readonly required: readonly ["version", "records"];
                readonly additionalProperties: false;
            };
        };
    };
};
export interface DroidTokenUsage {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
    thinkingTokens?: number;
    /** Factory Standard Credits consumed. Absent means unknown, not zero. */
    factoryCredits?: number;
}
/** One cumulative usage record per OpenCode session, as published by the RPC. */
export interface DroidUsageRecord {
    version: 1;
    providerID: "droid";
    sessionID: string;
    droidSessionID: string;
    requestID: string;
    modelID: string;
    time: number;
    usage: DroidTokenUsage;
    /** In-process cumulative per-session totals. */
    total: DroidTokenUsage;
}
/** Minimal shape of the method client returned by `client.rpc(DROID_USAGE_RPC)`. */
export interface DroidUsageQuery {
    usage(input: {
        sessionID?: string;
    }, options?: {
        location?: {
            directory?: string;
        };
    }): Promise<unknown>;
}
/**
 * Account-quota result produced by a quota source (e.g. the official Factory
 * web endpoint). When no source is configured the UI reports account quota as
 * unavailable rather than inventing subscription numbers.
 */
export interface DroidAccountQuota {
    windows: UsageWindow[];
    planLabel?: string | null;
}
export type DroidAccountQuotaSource = () => Promise<DroidAccountQuota | null>;
export declare const FACTORY_USAGE_URL = "https://api.factory.ai/api/billing/limits";
export interface FactoryUsageCredential {
    cookie: string | null;
    accessToken: string | null;
    organizationId: string | null;
}
/**
 * Saved Factory web credential from the secure provider JSON
 * (~/.config/openchamber/quota/droid.json or ~/.config/opencode/usage-stat/droid.json):
 * `{ cookie?, accessToken?, organizationId? }`. null when neither secret exists.
 */
export declare function resolveFactoryUsageCredential(): FactoryUsageCredential | null;
/**
 * Parse GET /api/billing/limits into account-quota windows.
 * The live response is a bare `{ limits: { standard|core: {
 * fiveHour|weekly|monthly }, ... }, extraUsageBalanceCents, extraUsageAllowed }`.
 * Also accepts a caller's `data` wrapper. `extraUsageBalanceCents` is a USD
 * cash balance (NOT FSC); there is no absolute FSC cap in the payload, so
 * only real usedPercent shares are shown. No reliable plan field exists —
 * planLabel stays null.
 */
export declare function parseFactorySubscriptionUsage(payload: unknown): DroidAccountQuota | null;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
/**
 * Fetch the Factory billing-limits endpoint with a saved web credential.
 * The legacy subscription/usage endpoint does not contain these rate windows.
 * Authorization and Cookie are both sent when both are saved (matching the
 * official frontend). Fixed HTTPS host, redirect:manual (never follow a
 * redirect carrying auth),
 * 15s timeout. Error messages carry status only — the body may contain
 * account data and is never echoed.
 */
export declare function fetchFactorySubscriptionUsage(credential: FactoryUsageCredential, fetchImpl?: FetchLike): Promise<DroidAccountQuota>;
/**
 * Account-quota source for checkDroidUsage: re-reads the secure JSON on every
 * call (so a freshly saved credential is picked up without a restart) and
 * returns null when no credential exists. Fetch failures propagate so the
 * caller can distinguish "not configured" from "failed".
 */
export declare function makeFactoryAccountQuotaSource(fetchImpl?: FetchLike): DroidAccountQuotaSource;
/** An enabled model from the `droid` provider must exist at the location. */
export declare function hasEnabledDroidModel(models: ReadonlyArray<{
    providerID?: string;
    enabled?: boolean;
}> | undefined | null): boolean;
/** Visible only when ALL three hold: config opt-in, plugin installed, enabled droid model. */
export declare function isDroidUsageVisible(opts: {
    configEnabled: boolean;
    pluginIds: readonly string[];
    hasDroidModel: boolean;
}): boolean;
/**
 * Validate the `{ version: 1, records: [...] }` RPC output. Returns null when
 * the payload does not match the published shape; malformed entries are
 * dropped individually so one bad record cannot blank the block.
 */
export declare function parseDroidUsagePayload(payload: unknown): DroidUsageRecord[] | null;
/**
 * Keep only records belonging to the given session family, deduplicated per
 * OpenCode sessionID (latest `time` wins). Other sessions in the process are
 * never summed into the displayed total.
 */
export declare function filterDroidRecords(records: readonly DroidUsageRecord[] | undefined | null, family: readonly string[]): DroidUsageRecord[];
export interface DroidUsageSummary {
    /** Sessions in the family with at least one record. */
    sessions: number;
    /**
     * Sum of per-session cumulative FSC, or null when no record reports the
     * field at all (unknown, never fabricated as zero). A real 0 is kept.
     */
    fsc: number | null;
    /** Some in-scope records report FSC and some do not — the sum is a lower bound. */
    partial: boolean;
    inputTokens: number;
    outputTokens: number;
}
export declare function summarizeDroidRecords(records: readonly DroidUsageRecord[]): DroidUsageSummary;
/** Compact FSC amount: "0", "0.075", "12.5", "1,234". No currency symbol. */
export declare function formatFsc(value: number): string;
/**
 * Session-tracked windows for the block (FSC + optional token totals).
 * Percent is always null — tracked consumption has no quota to express a
 * share of. Account-level windows come from checkDroidUsage's quota source.
 */
export declare function droidUsageWindows(summary: DroidUsageSummary, hasRecords: boolean): UsageWindow[];
/**
 * Sanitized error text. The RPC layer may throw `{ type, message, data }`
 * objects whose `data`/`message` can carry server-side detail — never echoed.
 */
export declare function droidRpcErrorMessage(error: unknown): string;
export interface DroidCheckOptions {
    /** Location the RPC/plugin gate applies to (forwarded to client.rpc options). */
    location?: {
        directory?: string;
    };
    /** Account-quota source (e.g. makeFactoryAccountQuotaSource()); optional. */
    accountQuota?: DroidAccountQuotaSource;
}
/**
 * Fetch + reduce Droid usage: session-family tracked FSC via the plugin RPC
 * plus, when a credential exists, real account quota from the official Factory
 * endpoint. The two halves degrade independently — a failed/missing RPC keeps
 * account quota, and a failed/missing quota keeps tracking — but nothing is
 * ever presented as something it is not (no model consumption shown as
 * account totals, no fabricated subscription figures).
 *
 * `query` is the method client obtained via `context.client.rpc(DROID_USAGE_RPC)`
 * (null when the host predates plugin RPC support). A single all-sessions
 * snapshot is fetched and filtered to the family — other sessions in the
 * process are never summed.
 */
export declare function checkDroidUsage(query: DroidUsageQuery | null | undefined, family: readonly string[], options?: DroidCheckOptions): Promise<ProviderUsageResult>;
export {};
