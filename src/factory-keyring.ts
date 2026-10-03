// factory-keyring.ts - Factory CLI keyring credential source.
//
// The `droid` CLI stores its WorkOS subscription credentials in
// ~/.factory/auth.v2.keyring as `base64(iv):base64(authTag):base64(ciphertext)`
// AES-256-GCM JSON. The 32-byte data key is held in the OS keyring under
// service "Factory CLI", account "auth-encryption-key", readable through the
// keytar NAPI module the CLI itself ships at ~/.factory/bin/keytar.node
// (overridable via FACTORY_KEYTAR_PATH).
//
// The stored access_token is a short-lived (~24 h) WorkOS JWT; the keyring
// also carries a long-lived refresh_token. When the access token is expired or
// nearly so, this module rotates it through the same endpoint the CLI uses —
//   POST <workosBase>/authenticate
//   grant_type=refresh_token&refresh_token=<rt>&client_id=<client_id>
// — then re-encrypts and writes the keyring back so the CLI never sees a
// revoked refresh token. All other keyring fields (whoami,
// active_organization_id, region, ...) are preserved verbatim.
//
// Safety properties kept throughout:
//   - read-only on the happy path: a still-valid access token is used as-is;
//   - the file is re-read before any write so a concurrent CLI refresh wins
//     (we never resurrect a rotated-out refresh token);
//   - writes go through a .bak copy plus tmp+rename, mode 0600;
//   - FACTORY_DISABLE_KEYRING disables the whole source;
//   - secrets stay in memory; errors carry HTTP status only.
//
// Honored environment overrides (matching the CLI):
//   FACTORY_HOME_OVERRIDE   - replaces ~/.factory entirely
//   FACTORY_ENV=development - uses ~/.factory-dev and the dev client id
//   FACTORY_KEYTAR_PATH     - alternate keytar.node location
//   FACTORY_WORKOS_BASE_URL - alternate WorkOS base URL
//   FACTORY_DISABLE_KEYRING - skip this source entirely

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { copyFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import { createRequire } from "node:module"

import type { FactoryUsageCredential } from "./droid-usage.js"

// ── Environment / path resolution ──

const WORKOS_PROD_CLIENT_ID = "client_01HNM792M5G5G1A2THWPXKFMXB"
const WORKOS_DEV_CLIENT_ID = "client_01HNM7927XNSKCJ4982Z5J3FFZ"
const DEFAULT_WORKOS_BASE_URL = "https://api.workos.com/user_management"
const KEYRING_SERVICE = "Factory CLI"
const KEYRING_ACCOUNTS = ["auth-encryption-key", "auth-encryption-key-security-cli"] as const

function envText(name: string): string | null {
  const value = process.env[name]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function isDevEnv(): boolean {
  return envText("FACTORY_ENV")?.toLowerCase() === "development"
}

export function isFactoryKeyringDisabled(): boolean {
  const value = envText("FACTORY_DISABLE_KEYRING")
  return value !== null && value !== "0" && value.toLowerCase() !== "false"
}

/** Directory the CLI uses for auth.v2.keyring (FACTORY_HOME_OVERRIDE wins). */
export function factoryConfigDir(): string {
  const override = envText("FACTORY_HOME_OVERRIDE")
  if (override && isAbsolute(override)) return override
  return join(homedir(), isDevEnv() ? ".factory-dev" : ".factory")
}

export function factoryKeyringPath(): string {
  return join(factoryConfigDir(), "auth.v2.keyring")
}

export function factoryKeytarPath(): string {
  return envText("FACTORY_KEYTAR_PATH") ?? join(factoryConfigDir(), "bin", "keytar.node")
}

function factoryKeyringService(): string {
  return isDevEnv() ? `${KEYRING_SERVICE}-dev` : KEYRING_SERVICE
}

export function factoryWorkosBaseUrl(): string {
  return (envText("FACTORY_WORKOS_BASE_URL") ?? DEFAULT_WORKOS_BASE_URL).replace(/\/+$/, "")
}

function defaultClientId(): string {
  return isDevEnv() ? WORKOS_DEV_CLIENT_ID : WORKOS_PROD_CLIENT_ID
}

// ── AES-256-GCM file format (iv : authTag : ciphertext, base64) ──

/**
 * Decrypt the keyring file body. Returns the parsed credential object or null
 * for malformed input, bad key, or corrupt data — the caller treats null as
 * "keyring unavailable" rather than an error worth surfacing.
 */
export function decryptFactoryKeyring(raw: string, key: Buffer): Record<string, unknown> | null {
  const parts = raw.trim().split(":")
  if (parts.length !== 3) return null
  try {
    const iv = Buffer.from(parts[0], "base64")
    const tag = Buffer.from(parts[1], "base64")
    const ciphertext = Buffer.from(parts[2], "base64")
    if (iv.length !== 16 || tag.length !== 16 || ciphertext.length === 0) return null
    const decipher = createDecipheriv("aes-256-gcm", key, iv)
    decipher.setAuthTag(tag)
    const parsed = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"))
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** Encrypt a credential object into the CLI's `iv:tag:ciphertext` format. */
export function encryptFactoryKeyring(data: Record<string, unknown>, key: Buffer): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()])
  return `${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ciphertext.toString("base64")}`
}

// ── JWT helpers (claims are read, never verified — the server verifies) ──

function jwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".")
  if (parts.length !== 3) return null
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
    return claims && typeof claims === "object" ? claims as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** Access-token expiry in epoch ms, or null when the token is not a JWT. */
export function jwtExpiresAtMs(token: string): number | null {
  const exp = jwtClaims(token)?.exp
  return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null
}

/**
 * WorkOS client_id embedded in the access token (matches what the CLI sends on
 * refresh). Falls back to the env-selected default when the claim is absent.
 */
export function factoryClientId(token: string | null): string {
  const claim = token ? jwtClaims(token)?.client_id : null
  return typeof claim === "string" && claim.trim() ? claim : defaultClientId()
}

// ── Storage seam (real implementation + injectable fake for tests) ──

export interface FactoryKeyringStorage {
  /** Raw `iv:tag:ct` file body, or null when absent/unreadable. */
  readRaw(): string | null
  /** Atomic replace with mode 0600. */
  writeRaw(data: string): void
  /** Copy the current file to <path>.bak before it is overwritten. */
  backupRaw(): void
  /** The 32-byte AES key from the OS keyring, or null when unavailable. */
  getKey(): Promise<Buffer | null>
}

interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>
}

let keytarModule: KeytarLike | null = null

/**
 * Load the keytar NAPI module shipped with the CLI. Works in both Node (native
 * addon ABI) and Bun (its NAPI layer) — the CLI itself is Bun-compiled and
 * loads this exact file. Returns null on any failure.
 */
function loadKeytar(): KeytarLike | null {
  // Only a successful load is cached — a transient failure (module not yet
  // downloaded, DBus hiccup) must not pin this process to "no keyring".
  if (keytarModule) return keytarModule
  try {
    const path = factoryKeytarPath()
    if (!existsSync(path)) return null
    // The same fake-anchor trick credentials.ts uses to obtain a CommonJS
    // require inside the ESM bundle.
    const require = createRequire(join(homedir(), ".opencode", "usage-stat-require.cjs"))
    const mod = require(path) as unknown
    keytarModule = mod && typeof (mod as KeytarLike).getPassword === "function" ? mod as KeytarLike : null
  } catch {
    return null
  }
  return keytarModule
}

const KEYTAR_TIMEOUT_MS = 5_000

/** Read the AES key from the OS keyring; null on any failure or timeout. */
async function readKeyEncryptionKey(): Promise<Buffer | null> {
  const keytar = loadKeytar()
  if (!keytar) return null
  const service = factoryKeyringService()
  for (const account of KEYRING_ACCOUNTS) {
    try {
      const value = await Promise.race([
        keytar.getPassword(service, account),
        new Promise<null>(resolve => setTimeout(() => resolve(null), KEYTAR_TIMEOUT_MS)),
      ])
      if (typeof value === "string" && value.trim()) {
        const key = Buffer.from(value.trim(), "base64")
        if (key.length === 32) return key
      }
    } catch { /* try next account */ }
  }
  return null
}

/** Real storage backed by ~/.factory and the OS keyring. */
function createFactoryKeyringStorage(): FactoryKeyringStorage {
  const path = factoryKeyringPath()
  return {
    readRaw() {
      try {
        if (!existsSync(path) || !statSync(path).isFile()) return null
        const raw = readFileSync(path, "utf8").trim()
        return raw || null
      } catch {
        return null
      }
    },
    writeRaw(data) {
      const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
      writeFileSync(tmp, data, { mode: 0o600 })
      renameSync(tmp, path)
    },
    backupRaw() {
      try {
        if (existsSync(path)) copyFileSync(path, `${path}.bak`)
      } catch { /* best-effort backup */ }
    },
    getKey: readKeyEncryptionKey,
  }
}

// ── WorkOS refresh ──

export interface WorkosTokenPair {
  accessToken: string
  refreshToken: string
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const REFRESH_TIMEOUT_MS = 15_000

function timedFetch(url: string, init: RequestInit, fetchImpl: FetchLike, timeoutMs = REFRESH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetchImpl(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

/**
 * Error raised when the keyring is present and readable but the access token
 * could not be renewed. Distinct from "no keyring" so the caller can report a
 * real failure instead of "credential missing".
 */
export class FactoryKeyringRefreshError extends Error {
  readonly statusCode: number | null
  constructor(message: string, statusCode: number | null = null) {
    super(message)
    this.name = "FactoryKeyringRefreshError"
    this.statusCode = statusCode
  }
}

async function refreshRequest(
  refreshToken: string,
  clientId: string,
  fetchImpl: FetchLike,
): Promise<WorkosTokenPair> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  })
  const response = await timedFetch(`${factoryWorkosBaseUrl()}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  }, fetchImpl)
  if (!response.ok) {
    throw new FactoryKeyringRefreshError(`WorkOS token refresh failed (HTTP ${response.status})`, response.status)
  }
  const parsed = await response.json().catch(() => null) as Record<string, unknown> | null
  const accessToken = typeof parsed?.access_token === "string" ? parsed.access_token : null
  const newRefresh = typeof parsed?.refresh_token === "string" ? parsed.refresh_token : null
  if (!accessToken || !newRefresh) {
    throw new FactoryKeyringRefreshError("WorkOS token refresh returned an unexpected response")
  }
  return { accessToken, refreshToken: newRefresh }
}

const inflightRefreshes = new Map<string, Promise<WorkosTokenPair>>()

/**
 * Rotate a refresh token with two safety valves:
 *   - identical in-flight refreshes are deduplicated (two plugin call sites
 *     must not double-rotate);
 *   - transient failures (network / 5xx) get one retry; 4xx is terminal.
 */
export function refreshFactoryWorkosToken(
  refreshToken: string,
  clientId: string,
  fetchImpl: FetchLike = fetch,
): Promise<WorkosTokenPair> {
  const inflight = inflightRefreshes.get(refreshToken)
  if (inflight) return inflight
  const promise = (async (): Promise<WorkosTokenPair> => {
    try {
      return await refreshRequest(refreshToken, clientId, fetchImpl)
    } catch (error) {
      const status = error instanceof FactoryKeyringRefreshError ? error.statusCode : null
      const transient = status === null || status >= 500
      if (!transient) throw error
      return refreshRequest(refreshToken, clientId, fetchImpl)
    }
  })().finally(() => {
    inflightRefreshes.delete(refreshToken)
  })
  inflightRefreshes.set(refreshToken, promise)
  return promise
}

// ── Credential resolution ──

interface LoadedKeyring {
  data: Record<string, unknown>
  key: Buffer
}

async function loadKeyring(storage: FactoryKeyringStorage): Promise<LoadedKeyring | null> {
  const raw = storage.readRaw()
  if (!raw) return null
  const key = await storage.getKey()
  if (!key) return null
  const data = decryptFactoryKeyring(raw, key)
  return data ? { data, key } : null
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function toCredential(accessToken: string, data: Record<string, unknown>): FactoryUsageCredential {
  return {
    accessToken,
    cookie: null,
    organizationId: text(data.active_organization_id),
  }
}

const REFRESH_MARGIN_MS = 2 * 60_000

function expiringSoon(token: string, marginMs: number): boolean {
  const expMs = jwtExpiresAtMs(token)
  // Non-JWT tokens can't be checked — use them as-is and let the API judge.
  return expMs !== null && expMs - Date.now() <= marginMs
}

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
export async function getFactoryKeyringCredential(opts: {
  storage?: FactoryKeyringStorage
  fetchImpl?: FetchLike
  refreshMarginMs?: number
} = {}): Promise<FactoryUsageCredential | null> {
  if (isFactoryKeyringDisabled()) return null
  const storage = opts.storage ?? createFactoryKeyringStorage()
  const fetchImpl = opts.fetchImpl ?? fetch
  const margin = opts.refreshMarginMs ?? REFRESH_MARGIN_MS

  const loaded = await loadKeyring(storage)
  if (!loaded) return null

  const accessToken = text(loaded.data.access_token)
  const refreshToken = text(loaded.data.refresh_token)
  if (!accessToken) return null
  if (!expiringSoon(accessToken, margin) || !refreshToken) {
    // Fresh token, or a token we cannot judge/refresh — hand it out as-is.
    return toCredential(accessToken, loaded.data)
  }

  const clientId = factoryClientId(accessToken)
  const pair = await refreshFactoryWorkosToken(refreshToken, clientId, fetchImpl)

  // Re-read before writing: the CLI may have refreshed concurrently while our
  // request was in flight. If it rotated the same refresh token, the pair we
  // hold is still valid but writing it back would resurrect a stale snapshot —
  // trust whatever is on disk now instead.
  const current = await loadKeyring(storage)
  const currentRefresh = current ? text(current.data.refresh_token) : null
  if (current && currentRefresh && currentRefresh !== refreshToken) {
    const currentAccess = text(current.data.access_token)
    if (currentAccess && !expiringSoon(currentAccess, margin)) {
      return toCredential(currentAccess, current.data)
    }
    // Their refresh token is still not usable — rotate theirs, then persist.
    const pair2 = await refreshFactoryWorkosToken(currentRefresh, factoryClientId(currentAccess), fetchImpl)
    const latest = (await loadKeyring(storage)) ?? current
    saveKeyring(storage, latest, {
      ...latest.data,
      access_token: pair2.accessToken,
      refresh_token: pair2.refreshToken,
    })
    return toCredential(pair2.accessToken, latest.data)
  }

  saveKeyring(storage, current ?? loaded, {
    ...(current?.data ?? loaded.data),
    access_token: pair.accessToken,
    refresh_token: pair.refreshToken,
  })
  return toCredential(pair.accessToken, loaded.data)
}

function saveKeyring(
  storage: FactoryKeyringStorage,
  loaded: LoadedKeyring,
  data: Record<string, unknown>,
): void {
  storage.backupRaw()
  storage.writeRaw(encryptFactoryKeyring(data, loaded.key))
}
