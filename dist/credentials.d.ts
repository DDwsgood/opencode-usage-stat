export interface AuthEntry {
    type?: string;
    key?: string;
    token?: string;
    access?: string;
    refresh?: string;
    expires?: number;
    accountId?: string | null;
}
export declare function credentialDatabasePath(): string;
export declare function parseCredentialValue(raw: unknown): AuthEntry | null;
export declare function authJsonPath(): string;
/** Read the OpenCode OAuth auth file. Returns {} on any failure; never throws. */
export declare function readAuthJson(): Record<string, unknown>;
/** First matching, non-empty auth.json entry for `aliases` (in order). */
export declare function authJsonEntry(aliases: string[]): AuthEntry | null;
/**
 * Secure per-provider credential JSON (cookies / refresh tokens that never go
 * through env). Checked in order:
 *   1. ~/.config/openchamber/quota/<id>.json   (reuse OpenChamber credentials)
 *   2. ~/.config/opencode/usage-stat/<id>.json (this plugin's own store, 0600)
 */
export declare function readSecureProviderJson(providerId: string): Record<string, unknown> | null;
export interface DevinCredentials {
    apiKey: string | null;
    apiServerUrl: string | null;
}
/**
 * Devin (opencode-devin-v2 plugin) credentials, read only from that plugin's
 * own store: <XDG_CONFIG_HOME>/opencode-devin-v2/credentials.json with
 * `{ "apiKey": "...", "apiServerUrl": "https://..." }`. Never logged.
 */
export declare function readDevinCredentials(): DevinCredentials | null;
export declare function parseEnvFile(content: string): Record<string, string>;
/** True when running under WSL (Microsoft kernel). */
export declare function isWsl(): boolean;
/**
 * Windows username inference for generic WSL .env discovery.
 * Uses env only — never a hardcoded absolute user path.
 */
export declare function windowsUsername(): string | null;
export interface ResolvedCredential {
    /** Primary secret, if available. Stays in memory; never logged. */
    value: string | null;
    /** accountId for Codex/OpenAI style entries. */
    accountId: string | null;
    /** OAuth refresh token when the source entry carries one (auth.json only). */
    refresh: string | null;
    /** Access-token expiry (epoch ms) when known. */
    expires: number | null;
    /** Which source the secret came from (used only to surface "configured" status). */
    source: "sqlite" | "auth" | "env" | "dotenv" | null;
}
/**
 * Resolve a credential for `aliases` (SQLite integration IDs, ordered by priority).
 * Falls back to env vars and then safe .env files.
 */
export declare function resolveCredential(opts: {
    aliases: string[];
    envKeys: string[];
}): ResolvedCredential;
/** Whether this credential is configured without exposing the secret. */
export declare function isConfigured(opts: {
    aliases: string[];
    envKeys: string[];
}): boolean;
