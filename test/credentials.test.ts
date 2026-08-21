import { test } from "node:test"
import assert from "node:assert/strict"
import { parseEnvFile, parseCredentialValue, credentialDatabasePath } from "../src/credentials.js"
import { defaultProviderCollapse, mergeProviderCollapse, PROVIDER_IDS } from "../src/provider-collapse.js"

test("parseEnvFile handles quotes and comments", () => {
  const parsed = parseEnvFile(
    [
      "# comment",
      "KEY=value",
      'QUOTED="hello world"',
      "SINGLE='x=1'",
      "EMPTY=",
      "  SPACED  =  padded  ",
    ].join("\n"),
  )
  assert.equal(parsed["KEY"], "value")
  assert.equal(parsed["QUOTED"], "hello world")
  assert.equal(parsed["SINGLE"], "x=1")
  assert.equal(parsed["EMPTY"], "")
  assert.equal(parsed["SPACED"], "padded")
})

test("parseEnvFile ignores malformed lines", () => {
  const parsed = parseEnvFile("BADLINE\n=novalue\nOK=1\n")
  assert.equal(parsed["BADLINE"], undefined)
  assert.equal(parsed["OK"], "1")
})

// ── SQLite credential value parsing (pure; never touches a real DB) ──

test("parseCredentialValue extracts key/token/access and accountId", () => {
  const entry = parseCredentialValue(JSON.stringify({ key: "sk-test-1", accountId: "acct-1" }))
  assert.equal(entry?.key, "sk-test-1")
  assert.equal(entry?.accountId, "acct-1")

  const token = parseCredentialValue(JSON.stringify({ token: "tok-1" }))
  assert.equal(token?.token, "tok-1")

  const access = parseCredentialValue({ access: "acc-1" })
  assert.equal(access?.access, "acc-1")
})

test("parseCredentialValue resolves accountId from common field shapes", () => {
  const fromMeta = parseCredentialValue(JSON.stringify({ token: "tok-1", metadata: { account_id: "meta-acct" } }))
  assert.equal(fromMeta?.accountId, "meta-acct")

  const fromNestedAccount = parseCredentialValue(JSON.stringify({ token: "tok-2", account: { id: "nested-acct" } }))
  assert.equal(fromNestedAccount?.accountId, "nested-acct")

  const fromSnake = parseCredentialValue({ access: "acc-2", account_id: "snake-acct" })
  assert.equal(fromSnake?.accountId, "snake-acct")
})

test("parseCredentialValue rejects malformed and non-object input without throwing", () => {
  assert.equal(parseCredentialValue("not-json"), null)
  assert.equal(parseCredentialValue("{bad"), null)
  assert.equal(parseCredentialValue(42), null)
  assert.equal(parseCredentialValue(null), null)
  assert.equal(parseCredentialValue(undefined), null)
})

test("parseCredentialValue never exposes the secret as accountId or via metadata", () => {
  const entry = parseCredentialValue(JSON.stringify({
    key: "sk-super-secret",
    metadata: { accountId: "", token: "meta-secret-2", access: "meta-access" },
  }))
  assert.equal(entry?.key, "sk-super-secret")
  assert.equal(entry?.accountId, null)
  assert.notEqual(entry?.accountId, "sk-super-secret")
  // Only the primary secret fields are read from the value; nothing is echoed.
  assert.deepEqual(Object.keys(entry ?? {}).sort(), ["access", "accountId", "key", "token", "type"].sort())
})

// ── DB path resolution (pure; never opens a database) ──

test("credentialDatabasePath honors XDG_DATA_HOME, absolute and relative OPENCODE_DB", () => {
  const prevXdg = process.env.XDG_DATA_HOME
  const prevDb = process.env.OPENCODE_DB
  try {
    process.env.XDG_DATA_HOME = "/tmp/us-xdg"
    delete process.env.OPENCODE_DB
    assert.equal(credentialDatabasePath(), "/tmp/us-xdg/opencode/opencode.db")

    process.env.XDG_DATA_HOME = "/tmp/us-xdg2"
    process.env.OPENCODE_DB = "custom.db"
    assert.equal(credentialDatabasePath(), "/tmp/us-xdg2/opencode/custom.db")

    process.env.OPENCODE_DB = "/abs/opencode.db"
    assert.equal(credentialDatabasePath(), "/abs/opencode.db")
  } finally {
    if (prevXdg === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = prevXdg
    if (prevDb === undefined) delete process.env.OPENCODE_DB
    else process.env.OPENCODE_DB = prevDb
  }
})

test("provider usage blocks default to collapsed for all three providers", () => {
  const def = defaultProviderCollapse()
  assert.deepEqual(Object.keys(def).sort(), ["codex", "deepseek", "opencode-go"])
  assert.deepEqual(PROVIDER_IDS, ["opencode-go", "deepseek", "codex"])
  for (const id of PROVIDER_IDS) {
    assert.equal(def[id], true, `${id} should be collapsed by default`)
  }
})

test("mergeProviderCollapse keeps defaults when nothing stored", () => {
  const merged = mergeProviderCollapse(null)
  assert.deepEqual(merged, defaultProviderCollapse())
})

test("mergeProviderCollapse honors stored overrides but ignores unknown keys", () => {
  const merged = mergeProviderCollapse({ "opencode-go": false, h4x: false })
  assert.equal(merged["opencode-go"], false)
  assert.equal(merged["deepseek"], true)
  assert.equal(merged["codex"], true)
  assert.equal(merged["h4x"], undefined)
})