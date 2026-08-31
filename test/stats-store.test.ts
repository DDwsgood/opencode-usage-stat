import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readPersistedStats, setUsageStatStorePaths } from "../src/stats-store.js"

test("v2 rebuild excludes legacy TPS spikes and uses token-weighted body TPS", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-stat-store-test-"))
  const statsPath = join(dir, "stats.json")
  const logPath = join(dir, "usage-stat.jsonl")
  try {
    writeFileSync(statsPath, JSON.stringify({
      version: 1,
      updatedAt: "",
      migratedFromLogs: true,
      models: {
        "anthropic/claude": { avgTPS: 492000, maxTPS: 492000 },
      },
    }))
    const base = {
      ts: "2026-08-30T00:00:00.000Z",
      model: "anthropic/claude",
      providerID: "anthropic",
      modelID: "claude",
      sessionID: "sess-1",
      ttft_ms: null,
      latency_ms: null,
      inputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
    }
    writeFileSync(logPath, [
      JSON.stringify({ ...base, outputTokens: 984, reasoningTokens: 0, tps: 492000, tps_source: "all-output-window" }),
      JSON.stringify({
        ...base,
        schema: 2,
        messageID: "msg-1",
        outputTokens: 100,
        reasoningTokens: 0,
        tps: 100,
        tps_source: "step-body-window",
        tpsTokens: 100,
        tpsWindowMs: 1000,
        latency_source: "inbox-to-step-streamed",
      }),
      JSON.stringify({
        ...base,
        schema: 2,
        messageID: "msg-2",
        outputTokens: 1000,
        reasoningTokens: 0,
        tps: 1000,
        tps_source: "step-body-window",
        tpsTokens: 1000,
        tpsWindowMs: 1000,
        latency_source: "inbox-to-step-streamed",
      }),
    ].join("\n") + "\n")
    setUsageStatStorePaths(statsPath, logPath)

    const rows = readPersistedStats()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].avgTPS, 550)
    assert.equal(rows[0].maxTPS, 1000)
    assert.equal(rows[0].p50TPS, 550)
    assert.equal(rows[0].tpsTotalTokens, 1100)
    assert.equal(rows[0].tpsTotalTimeMs, 2000)
    assert.equal(JSON.parse(readFileSync(statsPath, "utf-8")).version, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
