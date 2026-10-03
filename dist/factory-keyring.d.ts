import type { FactoryUsageCredential } from "./droid-usage.js";
export declare function isFactoryKeyringDisabled(): boolean;
/** Directory the CLI uses for auth.v2.keyring (FACTORY_HOME_OVERRIDE wins). */
export declare function factoryConfigDir(): string;
export declare function factoryKeyringPath(): string;
export declare function factoryKeytarPath(): string;
export declare function factoryWorkosBaseUrl(): string;
/**
 * Decrypt the keyring file body. Returns the parsed credential object or null
 * for malformed input, bad key, or corrupt data — the caller treats null as
 * "keyring unavailable" rather than an error worth surfacing.
 */
export declare function decryptFactoryKeyring(raw: string, key: Buffer): Record<string, unknown> | null;
/** Encrypt a credential object into the CLI's `iv:tag:ciphertext` format. */
export declare function encryptFactoryKeyring(data: Record<string, unknown>, key: Buffer): string;
/** Access-token expiry in epoch ms, or null when the token is not a JWT. */
export declare function jwtExpiresAtMs(token: string): number | null;
/**
 * WorkOS client_id embedded in the access token (matches what the CLI sends on
 * refresh). Falls back to the env-selected default when the claim is absent.
 */
export declare function factoryClientId(token: string | null): string;
export interface FactoryKeyringStorage {
    /** Raw `iv:tag:ct` file body, or null when absent/unreadable. */
    readRaw(): string | null;
    /** Atomic replace with mode 0600. */
    writeRaw(data: string): void;
    /** Copy the current file to <path>.bak before it is overwritten. */
    backupRaw(): void;
    /** The 32-byte AES key from the OS keyring, or null when unavailable. */
    getKey(): Promise<Buffer | null>;
}
export interface WorkosTokenPair {
    accessToken: string;
    refreshToken: string;
}
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
/**
 * Error raised when the keyring is present and readable but the access token
 * could not be renewed. Distinct from "no keyring" so the caller can report a
 * real failure instead of "credential missing".
 */
export declare class FactoryKeyringRefreshError extends Error {
    readonly statusCode: number | null;
    constructor(message: string, statusCode?: number | null);
}
/**
 * Rotate a refresh token with two safety valves:
 *   - identical in-flight refreshes are deduplicated (two plugin call sites
 *     must not double-rotate);
 *   - transient failures (network / 5xx) get one retry; 4xx is terminal.
 */
export declare function refreshFactoryWorkosToken(refreshToken: string, clientId: string, fetchImpl?: FetchLike): Promise<WorkosTokenPair>;
/**
 * Resolve a Factory credential from the CLI keyring.
 *
 * Returns null when the source is unavailable (keyring disabled, file absent,
 * keytar/OS-keyring unreachable, undecryptable file) — the caller falls back
 * to a saved web credential. Throws FactoryKeyringRefreshError only when a
 * readable keyring exists but its expired access token could not be rotated,
 * so "logged in but session dead" is reported as a failure rather than "no
 * credential".
 */
export declare function getFactoryKeyringCredential(opts?: {
    storage?: FactoryKeyringStorage;
    fetchImpl?: FetchLike;
    refreshMarginMs?: number;
}): Promise<FactoryUsageCredential | null>;
export {};
