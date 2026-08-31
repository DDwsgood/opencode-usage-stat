import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createPerfTracker, setUsageStatLogPath } from "../src/perf-tracker.js"
import type { PerfTracker } from "../src/perf-tracker.js"
import { setUsageStatStorePaths } from "../src/stats-store.js"

const dir = mkdtempSync(join(tmpdir(), "usage-stat-test-"))
setUsageStatLogPath(join(dir, "usage-stat.jsonl"))
setUsageStatStorePaths(join(dir, "usage-stat-stats.json"), join(dir, "usage-stat.jsonl"))

test.after(() => {
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
})

function promptStart(tracker: PerfTracker, start: number, inboxID = `inbox-${start}`): void {
  tracker.handleInboxEnqueued({
    created: start,
    data: { sessionID: "sess-1", inboxID, item: { type: "user" } },
  })
  tracker.handleInboxDelivered({ data: { sessionID: "sess-1", inboxID } })
}

function stepStart(tracker: PerfTracker, messageID: string, created: number): void {
  tracker.handleStepStarted({
    created,
    data: {
      sessionID: "sess-1",
      assistantMessageID: messageID,
      model: { providerID: "anthropic", id: "claude" },
    },
  })
}

function outputStart(tracker: PerfTracker, messageID: string, type: "text" | "reasoning" | "tool", created: number): void {
  tracker.handlePartUpdated({
    message_id: messageID,
    session_id: "sess-1",
    type,
    time: { start: created },
  })
}

function stepStreamed(tracker: PerfTracker, messageID: string, created: number): void {
  tracker.handleStepStreamed({ created, data: { sessionID: "sess-1", assistantMessageID: messageID } })
}

function stepDone(
  tracker: PerfTracker,
  messageID: string,
  over: { output?: number; reasoning?: number; input?: number; cacheRead?: number } = {},
): void {
  tracker.handleStepTerminal({
    data: {
      sessionID: "sess-1",
      assistantMessageID: messageID,
      tokens: {
        input: over.input ?? 10,
        output: over.output ?? 100,
        reasoning: over.reasoning ?? 20,
        cache: { read: over.cacheRead ?? 5, write: 0 },
      },
      cost: 0.1,
    },
  })
}

test("TTFT uses the earliest text, reasoning, or tool-input boundary", () => {
  const tracker = createPerfTracker()
  promptStart(tracker, 1000)
  stepStart(tracker, "m1", 1100)
  outputStart(tracker, "m1", "text", 1600)
  outputStart(tracker, "m1", "reasoning", 1300)
  outputStart(tracker, "m1", "tool", 1400)
  stepStreamed(tracker, "m1", 2300)
  stepDone(tracker, "m1")

  const model = tracker.getSessionStats().models["anthropic/claude"]
  assert.equal(model.avgTTFT, 300)
  assert.equal(model.avgLatency, 1300)
})

test("TPS uses completion tokens over the complete provider body window", () => {
  const tracker = createPerfTracker()
  stepStart(tracker, "body", 1000)
  outputStart(tracker, "body", "reasoning", 1200)
  outputStart(tracker, "body", "text", 2000)
  stepStreamed(tracker, "body", 5000)
  stepDone(tracker, "body", { output: 4000, reasoning: 500 })

  const model = tracker.getSessionStats().models["anthropic/claude"]
  assert.equal(model.avgTPS, 1125)
  assert.equal(model.tpsTotalTokens, 4500)
  assert.equal(model.tpsTotalTimeMs, 4000)
})

test("reasoning plus tool-input does not divide all tokens by the reasoning-only span", () => {
  const tracker = createPerfTracker()
  stepStart(tracker, "tool", 1000)
  outputStart(tracker, "tool", "reasoning", 1200)
  outputStart(tracker, "tool", "tool", 1800)
  stepStreamed(tracker, "tool", 4000)
  stepDone(tracker, "tool", { output: 6800, reasoning: 200 })

  const tps = tracker.getSessionStats().models["anthropic/claude"].avgTPS
  assert.ok(tps !== null)
  assert.ok(Math.abs(tps - (7000 / 3)) < 1e-9)
  assert.notEqual(tps, 7000 / 0.6)
})

test("token-weighted TPS replaces the arithmetic mean of per-step rates", () => {
  const tracker = createPerfTracker()
  stepStart(tracker, "slow", 0)
  stepStreamed(tracker, "slow", 1000)
  stepDone(tracker, "slow", { output: 100, reasoning: 0 })
  stepStart(tracker, "fast", 2000)
  stepStreamed(tracker, "fast", 2500)
  stepDone(tracker, "fast", { output: 1000, reasoning: 0 })

  const model = tracker.getSessionStats().models["anthropic/claude"]
  assert.ok(Math.abs((model.avgTPS ?? 0) - (1100 / 1.5)) < 1e-9)
  assert.equal(model.p50TPS, 1050)
  assert.notEqual(model.avgTPS, (100 + 2000) / 2)
})

test("a retry with the same message ID resets the body start", () => {
  const tracker = createPerfTracker()
  stepStart(tracker, "retry", 100)
  stepStart(tracker, "retry", 1000)
  stepStreamed(tracker, "retry", 2000)
  stepDone(tracker, "retry", { output: 100, reasoning: 0 })

  assert.equal(tracker.getSessionStats().models["anthropic/claude"].avgTPS, 100)
})

test("sub-50ms body windows are excluded instead of producing spikes", () => {
  const tracker = createPerfTracker()
  stepStart(tracker, "short", 1000)
  stepStreamed(tracker, "short", 1002)
  stepDone(tracker, "short", { output: 100, reasoning: 0 })

  const model = tracker.getSessionStats().models["anthropic/claude"]
  assert.equal(model.avgTPS, null)
  assert.equal(model.tpsCount, 0)
})

test("missing Step.Streamed leaves TPS and prompt latency unknown", () => {
  const tracker = createPerfTracker()
  promptStart(tracker, 100)
  stepStart(tracker, "missing-stream", 200)
  outputStart(tracker, "missing-stream", "text", 300)
  stepDone(tracker, "missing-stream")

  const model = tracker.getSessionStats().models["anthropic/claude"]
  assert.equal(model.avgTTFT, 200)
  assert.equal(model.avgTPS, null)
  assert.equal(model.avgLatency, null)
})

test("reasoning-only output contributes to body TPS", () => {
  const tracker = createPerfTracker()
  stepStart(tracker, "reasoning-only", 100)
  outputStart(tracker, "reasoning-only", "reasoning", 120)
  stepStreamed(tracker, "reasoning-only", 1100)
  stepDone(tracker, "reasoning-only", { output: 0, reasoning: 200 })

  assert.equal(tracker.getSessionStats().models["anthropic/claude"].avgTPS, 200)
})

test("tool continuation without a delivered prompt has no TTFT or prompt latency", () => {
  const tracker = createPerfTracker()
  stepStart(tracker, "continuation", 100)
  outputStart(tracker, "continuation", "tool", 150)
  stepStreamed(tracker, "continuation", 1100)
  stepDone(tracker, "continuation")

  const model = tracker.getSessionStats().models["anthropic/claude"]
  assert.equal(model.avgTTFT, null)
  assert.equal(model.avgLatency, null)
  assert.equal(model.avgTPS, 120)
})

test("an enqueued prompt is not consumed until inbox delivery", () => {
  const tracker = createPerfTracker()
  tracker.handleInboxEnqueued({
    created: 100,
    data: { sessionID: "sess-1", inboxID: "pending", item: { type: "user" } },
  })
  stepStart(tracker, "before-delivery", 200)
  outputStart(tracker, "before-delivery", "text", 300)
  stepStreamed(tracker, "before-delivery", 1000)
  stepDone(tracker, "before-delivery")

  assert.equal(tracker.getSessionStats().models["anthropic/claude"].avgTTFT, null)
})

test("compaction inbox items are not treated as prompt starts", () => {
  const tracker = createPerfTracker()
  tracker.handleInboxEnqueued({
    created: 100,
    data: { sessionID: "sess-1", inboxID: "compact", item: { type: "compaction" } },
  })
  tracker.handleInboxDelivered({ data: { sessionID: "sess-1", inboxID: "compact" } })
  stepStart(tracker, "compaction-step", 200)
  outputStart(tracker, "compaction-step", "reasoning", 300)
  stepStreamed(tracker, "compaction-step", 1000)
  stepDone(tracker, "compaction-step")

  assert.equal(tracker.getSessionStats().models["anthropic/claude"].avgTTFT, null)
})

test("duplicate terminal events do not double-count a step", () => {
  const tracker = createPerfTracker()
  stepStart(tracker, "once", 100)
  stepStreamed(tracker, "once", 1100)
  stepDone(tracker, "once")
  stepStart(tracker, "once", 2000)
  stepStreamed(tracker, "once", 3000)
  stepDone(tracker, "once")

  assert.equal(tracker.getSessionStats().models["anthropic/claude"].requestCount, 1)
})
