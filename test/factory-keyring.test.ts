// factory-keyring.test.ts - Keyring decrypt/refresh logic with injected storage.

import test from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"

import {
  decryptFactoryKeyring,
  encryptFactoryKeyring,
  factoryClientId,
  FactoryKeyringRefreshError,
  getFactoryKeyringCredential,
  jwtExpiresAtMs,
  refreshFactoryWorkosToken,
  type FactoryKeyringStorage,
} from "../src/factory-keyring.js"

const TEST_KEY = randomBytes(32)

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

function mintJwt(claims: Record<string, unknown>): string {
  return `${b64url({ alg: "RS256" })}.${b64url(claims)}.sig`
}

function jwtExpiringIn(seconds: number, extra: Record<string, unknown> = {}): string {
  return mintJwt({ exp: Math.floor(Date.now() / 1000) + seconds, client_id: "client_test", ...extra })
}

function keyringJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: jwtExpiringIn(3600),
    refresh_token: "rt-1",
    active_organization_id: "org-1",
    whoami: { principalKind: "human", nested: { deep: [1, 2] } },
    ...overrides,
  }
}

function seal(data: Record<string, unknown>, key: Buffer = TEST_KEY): string {
  return encryptFactoryKeyring(data, key)
}

interface FakeStorage extends FactoryKeyringStorage {
  writes: string[]
  backups: number
  setRaw(raw: string | null): void
}

function fakeStorage(initial: string | null | (() => string | null), key: Buffer | null = TEST_KEY): FakeStorage {
  let current: string | null | (() => string | null) = initial
  const state: FakeStorage = {
    writes: [],
    backups: 0,
    readRaw: () => (typeof current === "function" ? current() : current),
    writeRaw(data) {
      state.writes.push(data)
      state.setRaw(data)
    },
    backupRaw() {
      state.backups++
    },
    getKey: async () => key,
    setRaw(next) {
      current = next
    },
  }
  return state
}

function refreshResponse(pair: { accessToken?: string; refreshToken?: string } = {}): Response {
  return new Response(JSON.stringify({
    access_token: pair.accessToken ?? jwtExpiringIn(3600, { client_id: "client_test" }),
    refresh_token: pair.refreshToken ?? "rt-2",
  }), { status: 200, headers: { "Content-Type": "application/json" } })
}

type FetchCall = { url: string; body: string }

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

function recordingFetch(calls: FetchCall[], respond: (call: FetchCall) => Response | Promise<Response>): FetchImpl {
  return async (url, init) => {
    const call = { url, body: String(init?.body ?? "") }
    calls.push(call)
    return respond(call)
  }
}

function statusFetch(status: number, body?: unknown): FetchImpl {
  return async () => new Response(JSON.stringify(body ?? { error: "invalid_grant" }), { status })
}

// ── File format ──

test("encryptFactoryKeyring/decryptFactoryKeyring round-trips and matches iv:tag:ct shape", () => {
  const raw = encryptFactoryKeyring({ a: 1, b: "x" }, TEST_KEY)
  const parts = raw.split(":")
  assert.equal(parts.length, 3)
  assert.equal(Buffer.from(parts[0], "base64").length, 16)
  assert.equal(Buffer.from(parts[1], "base64").length, 16)
  assert.deepEqual(decryptFactoryKeyring(raw, TEST_KEY), { a: 1, b: "x" })
})

test("decryptFactoryKeyring returns null for malformed input, wrong key, and corrupt data", () => {
  assert.equal(decryptFactoryKeyring("not-even-close", TEST_KEY), null)
  assert.equal(decryptFactoryKeyring("a:b", TEST_KEY), null)
  assert.equal(decryptFactoryKeyring("a:b:c:d", TEST_KEY), null)
  const sealed = seal({ x: 1 })
  assert.equal(decryptFactoryKeyring(sealed, randomBytes(32)), null)
  const [iv, tag, ct] = seal({ x: 1 }).split(":")
  // Truncated IV/tag are rejected by the length check.
  assert.equal(decryptFactoryKeyring(`${iv.slice(0, 8)}:${tag}:${ct}`, TEST_KEY), null)
})

// ── JWT helpers ──

test("jwtExpiresAtMs reads exp seconds as ms and rejects non-JWTs", () => {
  const exp = Math.floor(Date.now() / 1000) + 100
  assert.equal(jwtExpiresAtMs(mintJwt({ exp })), exp * 1000)
  assert.equal(jwtExpiresAtMs("opaque-token"), null)
  assert.equal(jwtExpiresAtMs(mintJwt({ noexp: 1 })), null)
})

test("factoryClientId prefers the token claim, falls back to the env default", () => {
  assert.equal(factoryClientId(mintJwt({ client_id: "client_abc" })), "client_abc")
  assert.equal(factoryClientId(mintJwt({})), "client_01HNM792M5G5G1A2THWPXKFMXB")
  assert.equal(factoryClientId("not-a-jwt"), "client_01HNM792M5G5G1A2THWPXKFMXB")
  const previous = process.env.FACTORY_ENV
  try {
    process.env.FACTORY_ENV = "development"
    assert.equal(factoryClientId(null), "client_01HNM7927XNSKCJ4982Z5J3FFZ")
  } finally {
    if (previous === undefined) delete process.env.FACTORY_ENV
    else process.env.FACTORY_ENV = previous
  }
})

// ── Credential resolution ──

test("getFactoryKeyringCredential returns null when file, key, or plaintext is unavailable", async () => {
  assert.equal(await getFactoryKeyringCredential({ storage: fakeStorage(null) }), null)
  assert.equal(await getFactoryKeyringCredential({ storage: fakeStorage("garbage") }), null)
  assert.equal(await getFactoryKeyringCredential({ storage: fakeStorage(seal(keyringJson()), null) }), null)
  // A file the key cannot decrypt is unavailable, not a failure.
  assert.equal(await getFactoryKeyringCredential({ storage: fakeStorage(seal(keyringJson(), randomBytes(32))) }), null)
})

test("getFactoryKeyringCredential honors FACTORY_DISABLE_KEYRING", async () => {
  const previous = process.env.FACTORY_DISABLE_KEYRING
  try {
    process.env.FACTORY_DISABLE_KEYRING = "1"
    assert.equal(await getFactoryKeyringCredential({ storage: fakeStorage(seal(keyringJson())) }), null)
  } finally {
    if (previous === undefined) delete process.env.FACTORY_DISABLE_KEYRING
    else process.env.FACTORY_DISABLE_KEYRING = previous
  }
})

test("getFactoryKeyringCredential uses a fresh access token without refreshing or writing", async () => {
  const token = jwtExpiringIn(3600)
  const storage = fakeStorage(seal(keyringJson({ access_token: token })))
  const calls: FetchCall[] = []
  const credential = await getFactoryKeyringCredential({ storage, fetchImpl: recordingFetch(calls, () => refreshResponse()) })
  assert.equal(credential?.accessToken, token)
  assert.equal(credential?.organizationId, "org-1")
  assert.equal(credential?.cookie, null)
  assert.equal(calls.length, 0)
  assert.equal(storage.writes.length, 0)
  assert.equal(storage.backups, 0)
})

test("getFactoryKeyringCredential uses a non-JWT token as-is", async () => {
  const storage = fakeStorage(seal(keyringJson({ access_token: "opaque-at" })))
  const credential = await getFactoryKeyringCredential({ storage, fetchImpl: statusFetch(500) })
  assert.equal(credential?.accessToken, "opaque-at")
})

test("getFactoryKeyringCredential returns an expiring token as-is when no refresh token exists", async () => {
  const token = jwtExpiringIn(-60)
  const storage = fakeStorage(seal(keyringJson({ access_token: token, refresh_token: undefined })))
  const credential = await getFactoryKeyringCredential({ storage, fetchImpl: statusFetch(500) })
  assert.equal(credential?.accessToken, token)
})

test("getFactoryKeyringCredential refreshes an expired token, writes back preserving other fields", async () => {
  const newAccess = jwtExpiringIn(3600)
  const storage = fakeStorage(seal(keyringJson({ access_token: jwtExpiringIn(-120), refresh_token: "rt-old" })))
  const calls: FetchCall[] = []
  const credential = await getFactoryKeyringCredential({
    storage,
    fetchImpl: async (url, init) => {
      calls.push({ url, body: String(init?.body ?? "") })
      return refreshResponse({ accessToken: newAccess, refreshToken: "rt-new" })
    },
  })
  assert.equal(credential?.accessToken, newAccess)
  // The refresh POST went to the WorkOS authenticate endpoint with the old rt.
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /workos\.com\/user_management\/authenticate$/)
  const body = new URLSearchParams(calls[0].body)
  assert.equal(body.get("grant_type"), "refresh_token")
  assert.equal(body.get("refresh_token"), "rt-old")
  assert.equal(body.get("client_id"), "client_test")
  // The file was backed up once and rewritten once with the merged record.
  assert.equal(storage.backups, 1)
  assert.equal(storage.writes.length, 1)
  const saved = decryptFactoryKeyring(storage.writes[0], TEST_KEY)!
  assert.equal(saved.access_token, newAccess)
  assert.equal(saved.refresh_token, "rt-new")
  assert.equal(saved.active_organization_id, "org-1")
  assert.deepEqual(saved.whoami, { principalKind: "human", nested: { deep: [1, 2] } })
})

test("getFactoryKeyringCredential throws FactoryKeyringRefreshError when refresh is rejected", async () => {
  const storage = fakeStorage(seal(keyringJson({ access_token: jwtExpiringIn(-60) })))
  await assert.rejects(
    () => getFactoryKeyringCredential({ storage, fetchImpl: statusFetch(400) }),
    (error: unknown) => {
      assert.ok(error instanceof FactoryKeyringRefreshError)
      assert.equal((error as FactoryKeyringRefreshError).statusCode, 400)
      return true
    },
  )
  assert.equal(storage.writes.length, 0)
})

test("getFactoryKeyringCredential trusts a concurrently-rotated on-disk token instead of overwriting it", async () => {
  const cliNewAccess = jwtExpiringIn(3600)
  let raw: string | null = seal(keyringJson({ access_token: jwtExpiringIn(-60), refresh_token: "rt-old" }))
  const storage = fakeStorage(() => raw)
  const calls: FetchCall[] = []
  const credential = await getFactoryKeyringCredential({
    storage,
    fetchImpl: async (url, init) => {
      calls.push({ url, body: String(init?.body ?? "") })
      // The CLI rotated the same refresh token while our request was in flight.
      raw = seal(keyringJson({ access_token: cliNewAccess, refresh_token: "rt-cli-new" }))
      return refreshResponse({ accessToken: jwtExpiringIn(3600), refreshToken: "rt-ours" })
    },
  })
  // We must hand out the on-disk pair, never resurrect our rotated-out rt-ours.
  assert.equal(credential?.accessToken, cliNewAccess)
  assert.equal(storage.writes.length, 0)
  assert.equal(storage.backups, 0)
})

test("getFactoryKeyringCredential rotates the newer on-disk pair when the CLI wrote an expired token", async () => {
  const finalAccess = jwtExpiringIn(3600)
  let raw: string | null = seal(keyringJson({ access_token: jwtExpiringIn(-60), refresh_token: "rt-old" }))
  const storage = fakeStorage(() => raw)
  const refreshes: string[] = []
  const credential = await getFactoryKeyringCredential({
    storage,
    fetchImpl: async (url, init) => {
      const rt = new URLSearchParams(String(init?.body ?? "")).get("refresh_token")!
      refreshes.push(rt)
      if (rt === "rt-old") {
        // CLI wrote a still-expired token during our first refresh.
        raw = seal(keyringJson({ access_token: jwtExpiringIn(-30), refresh_token: "rt-cli" }))
        return refreshResponse({ accessToken: jwtExpiringIn(3600), refreshToken: "rt-ours" })
      }
      assert.equal(rt, "rt-cli")
      return refreshResponse({ accessToken: finalAccess, refreshToken: "rt-final" })
    },
  })
  assert.equal(credential?.accessToken, finalAccess)
  assert.deepEqual(refreshes, ["rt-old", "rt-cli"])
  const saved = decryptFactoryKeyring(storage.writes.at(-1)!, TEST_KEY)!
  assert.equal(saved.refresh_token, "rt-final")
})

// ── Refresh request itself ──

test("refreshFactoryWorkosToken deduplicates identical in-flight refreshes", async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls++
    await new Promise(resolve => setTimeout(resolve, 5))
    return refreshResponse()
  }
  const [a, b] = await Promise.all([
    refreshFactoryWorkosToken("rt-dup", "client_test", fetchImpl),
    refreshFactoryWorkosToken("rt-dup", "client_test", fetchImpl),
  ])
  assert.equal(calls, 1)
  assert.equal(a, b)
})

test("refreshFactoryWorkosToken retries once on transient failures but not on 4xx", async () => {
  let transientCalls = 0
  const flaky = async () => {
    transientCalls++
    return transientCalls === 1 ? new Response("oops", { status: 503 }) : refreshResponse()
  }
  const pair = await refreshFactoryWorkosToken("rt-retry", "client_test", flaky)
  assert.ok(pair.accessToken)
  assert.equal(transientCalls, 2)

  let permanentCalls = 0
  await assert.rejects(
    () => refreshFactoryWorkosToken("rt-dead", "client_test", async () => {
      permanentCalls++
      return new Response("invalid_grant", { status: 403 })
    }),
    FactoryKeyringRefreshError,
  )
  assert.equal(permanentCalls, 1)
})
