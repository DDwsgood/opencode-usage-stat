export interface AuthEntry {
    type?: string;
    key?: string;
    token?: string;
    access?: string;
    accountId?: string | null;
}
export declare function credentialDatabasePath(): string;
export declare function parseCredentialValue(raw: unknown): AuthEntry | null;
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
    /** Which source the secret came from (used only to surface "configured" status). */
    source: "sqlite" | "env" | "dotenv" | null;
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
