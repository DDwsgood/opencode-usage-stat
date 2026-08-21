import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createPerfTracker, setUsageStatLogPath } from "../src/perf-tracker.js"
import type { PerfTracker } from "../src/perf-tracker.js"
import { setUsageStatStorePaths } from "../src/stats-store.js"

// Isolate storage into a temp dir so tests never touch ~/.opencode.
const dir = mkdtempSync(join(tmpdir(), "usage-stat-test-"))
setUsageStatLogPath(join(dir, "usage-stat.jsonl"))
setUsageStatStorePaths(join(dir, "usage-stat-stats.json"), join(dir, "usage-stat.jsonl"))

test.after(() => {
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
})

function partUpdate(tracker: PerfTracker, messageId: string, type: string, start: number): void {
  tracker.handlePartUpdated({ message_id: messageId, session_id: "sess-1", type, time: { start } })
}

function partEnd(tracker: PerfTracker, messageId: string, type: string, end: number): void {
  tracker.handlePartEnded({ message_id: messageId, type, time: { start: end } })
}

function promptStart(tracker: PerfTracker, start: number, inboxID = `inbox-${start}`): void {
  tracker.handleInboxEnqueued({
    created: start,
    data: { sessionID: "sess-1", inboxID, item: { type: "user" } },
  })
  tracker.handleInboxDelivered({ data: { sessionID: "sess-1", inboxID } })
}

function messageDone(
  tracker: PerfTracker,
  messageId: string,
  created: number,
  completed: number,
  over: { output?: number; reasoning?: number; input?: number; cacheRead?: number; providerID?: string; modelID?: string } = {},
): void {
  tracker.handleMessageUpdated({
    properties: {
      info: {
        id: messageId,
        sessionID: "sess-1",
        role: "assistant",
        providerID: over.providerID ?? "anthropic",
        modelID: over.modelID ?? "claude",
        tokens: {
          input: over.input ?? 10,
          output: over.output ?? 100,
          reasoning: over.reasoning ?? 20,
          cache: { read: over.cacheRead ?? 5, write: 0 },
        },
        cost: 0.1,
        time: { created, completed },
      },
    },
  })
}

test("TTFT counts earliest streaming output part (reasoning before text)", () => {
  const tracker = createPerfTracker()
  const promptEnqueued = 1000
  const created = 1180
  const reasoningStart = 1200 // reasoning streams first — the true first output
  const textStart = 2000 // text arrives later
  const completed = 5000

  promptStart(tracker, promptEnqueued)
  partUpdate(tracker, "m1", "reasoning", reasoningStart)
  partUpdate(tracker, "m1", "text", textStart)
  messageDone(tracker, "m1", created, completed, { output: 1000 })

  const stats = tracker.getSessionStats()
  const model = stats.models["anthropic/claude"]
  assert.ok(model, "model stats should exist")
  // TTFT = earliest first output (reasoning) - local prompt enqueue.
  assert.equal(model.avgTTFT, reasoningStart - promptEnqueued)
  assert.equal(model.avgTTFT, 200)
  // max/min equal average for a single sample
  assert.equal(model.maxTTFT, 200)
  assert.equal(model.minTTFT, 200)
})

test("TPS uses all output tokens over the first-to-last output window", () => {
  const tracker = createPerfTracker()
  const created = 1000
  const reasoningStart = 1200
  const textStart = 2000 // must NOT be used as generation start
  const reasoningEnd = 3000
  const textEnd = 5000
  const completed = 5200
  const outputTokens = 4000
  const reasoningTokens = 500

  partUpdate(tracker, "m2", "reasoning", reasoningStart)
  partUpdate(tracker, "m2", "text", textStart)
  partEnd(tracker, "m2", "reasoning", reasoningEnd)
  partEnd(tracker, "m2", "text", textEnd)
  messageDone(tracker, "m2", created, completed, { output: outputTokens, reasoning: reasoningTokens })

  const stats = tracker.getSessionStats()
  const model = stats.models["anthropic/claude"]
  assert.ok(model)

  const genMs = textEnd - reasoningStart
  const expectedTps = ((outputTokens + reasoningTokens) / genMs) * 1000
  assert.ok(Math.abs((model.avgTPS ?? -1) - expectedTps) < 1e-9, `expected ${expectedTps}, got ${model.avgTPS}`)
  // The later text start would give a much higher TPS — ensure we didn't use it.
  const inflatedTps = ((outputTokens + reasoningTokens) / (textEnd - textStart)) * 1000
  assert.notEqual(model.avgTPS, inflatedTps)
})

test("latency spans prompt enqueue to final output and excludes later settlement", () => {
  const tracker = createPerfTracker()
  promptStart(tracker, 100)
  tracker.handleStepStarted({ data: { sessionID: "sess-1", assistantMessageID: "latency" } })
  partUpdate(tracker, "latency", "reasoning", 300)
  partUpdate(tracker, "latency", "text", 500)
  partEnd(tracker, "latency", "reasoning", 800)
  partEnd(tracker, "latency", "text", 1000)
  messageDone(tracker, "latency", 290, 2000, { output: 100, reasoning: 50 })

  const model = tracker.getSessionStats().models["anthropic/claude"]
  assert.equal(model.avgLatency, 900)
  assert.equal(model.avgTTFT, 200)
  assert.ok(Math.abs((model.avgTPS ?? -1) - (150 / 700) * 1000) < 1e-9)
})

test("reasoning-only output contributes to TPS", () => {
  const tracker = createPerfTracker()
  partUpdate(tracker, "reasoning-only", "reasoning", 100)
  partEnd(tracker, "reasoning-only", "reasoning", 1100)
  messageDone(tracker, "reasoning-only", 90, 1200, { output: 0, reasoning: 200 })

  assert.equal(tracker.getSessionStats().models["anthropic/claude"].avgTPS, 200)
})

test("text-only turn still records TTFT from text", () => {
  const tracker = createPerfTracker()
  const promptEnqueued = 100
  const created = 350
  const textStart = 400
  const completed = 1000

  promptStart(tracker, promptEnqueued)
  partUpdate(tracker, "m3", "text", textStart)
  messageDone(tracker, "m3", created, completed, { output: 500 })

  const stats = tracker.getSessionStats()
  const model = stats.models["anthropic/claude"]
  assert.equal(model.avgTTFT, 300)
})

test("control parts (tool/step-start) are ignored for first-output timing", () => {
  const tracker = createPerfTracker()
  const promptEnqueued = 100
  const created = 380
  const toolStart = 150 // tool part earlier — must be ignored
  const textStart = 400
  const completed = 1000

  promptStart(tracker, promptEnqueued)
  partUpdate(tracker, "m4", "tool", toolStart)
  partUpdate(tracker, "m4", "text", textStart)
  messageDone(tracker, "m4", created, completed, { output: 300 })

  const stats = tracker.getSessionStats()
  const model = stats.models["anthropic/claude"]
  assert.equal(model.avgTTFT, 300)
})

test("earliest reasoning wins when multiple reasoning deltas stream", () => {
  const tracker = createPerfTracker()
  const promptEnqueued = 100
  const created = 140
  const firstDelta = 150
  const laterDelta = 260
  const textStart = 500
  const completed = 2000

  promptStart(tracker, promptEnqueued)
  partUpdate(tracker, "m5", "reasoning", laterDelta)
  partUpdate(tracker, "m5", "reasoning", firstDelta) // earlier arrives second
  partUpdate(tracker, "m5", "text", textStart)
  messageDone(tracker, "m5", created, completed, { output: 800 })

  const stats = tracker.getSessionStats()
  const model = stats.models["anthropic/claude"]
  assert.equal(model.avgTTFT, 50)
})

test("tool continuation without a delivered user prompt has no TTFT sample", () => {
  const tracker = createPerfTracker()
  partUpdate(tracker, "tool-continuation", "text", 500)
  messageDone(tracker, "tool-continuation", 490, 1000)

  const model = tracker.getSessionStats().models["anthropic/claude"]
  assert.ok(model)
  assert.equal(model.avgTTFT, null)
  assert.equal(model.ttftCount, 0)
})

test("enqueued prompt is not consumed until inbox delivery", () => {
  const tracker = createPerfTracker()
  tracker.handleInboxEnqueued({
    created: 100,
    data: { sessionID: "sess-1", inboxID: "pending", item: { type: "user" } },
  })
  partUpdate(tracker, "before-delivery", "text", 500)
  messageDone(tracker, "before-delivery", 490, 1000)
  assert.equal(tracker.getSessionStats().models["anthropic/claude"].avgTTFT, null)
})

test("compaction inbox items are not treated as prompt TTFT starts", () => {
  const tracker = createPerfTracker()
  tracker.handleInboxEnqueued({
    created: 100,
    data: { sessionID: "sess-1", inboxID: "compact", item: { type: "compaction" } },
  })
  tracker.handleInboxDelivered({ data: { sessionID: "sess-1", inboxID: "compact" } })
  partUpdate(tracker, "compaction-step", "reasoning", 500)
  messageDone(tracker, "compaction-step", 490, 1000)
  assert.equal(tracker.getSessionStats().models["anthropic/claude"].avgTTFT, null)
})

test("tool-only first step consumes the prompt before a continuation step", () => {
  const tracker = createPerfTracker()
  promptStart(tracker, 100)
  tracker.handleStepStarted({ data: { sessionID: "sess-1", assistantMessageID: "tool-only" } })
  messageDone(tracker, "tool-only", 400, 600)

  tracker.handleStepStarted({ data: { sessionID: "sess-1", assistantMessageID: "continuation" } })
  partUpdate(tracker, "continuation", "text", 800)
  messageDone(tracker, "continuation", 790, 1000)

  const model = tracker.getSessionStats().models["anthropic/claude"]
  assert.equal(model.ttftCount, 0)
  assert.equal(model.avgTTFT, null)
})
