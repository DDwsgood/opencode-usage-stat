import { test } from "node:test"
import assert from "node:assert/strict"
import type { OpenCodeClient, SessionMessageInfo } from "@opencode-ai/client"
import {
  fetchSessionTokenMessages,
  mergeTokenMessages,
  messageToTokenMessage,
  type TokenMessage,
} from "../src/token-messages.js"

function assistant(id: string, input: number): SessionMessageInfo {
  return {
    id,
    type: "assistant",
    agent: "primary",
    model: { providerID: "test", id: "model" },
    content: [],
    time: { created: input },
    tokens: { input, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

test("full restore follows message cursors across compaction history", async () => {
  const messages: SessionMessageInfo[] = Array.from({ length: 225 }, (_, index) => assistant(`m-${index}`, index + 1))
  messages.splice(205, 0, {
    id: "compact-1",
    type: "compaction",
    status: "completed",
    reason: "auto",
    summary: "summary",
    recent: "",
    time: { created: 206 },
  })
  const calls: Array<{ cursor?: string; order?: "asc" | "desc" }> = []
  const client = {
    message: {
      async list(input: { cursor?: string; order?: "asc" | "desc"; limit?: number }) {
        calls.push({ cursor: input.cursor, order: input.order })
        const start = input.cursor ? Number(input.cursor) : 0
        const page = messages.slice(start, start + (input.limit ?? 200))
        return {
          data: page,
          cursor: { next: page.length > 0 ? String(start + page.length) : undefined },
        }
      },
    },
  } as OpenCodeClient

  const restored = await fetchSessionTokenMessages(client, "session-1")

  assert.equal(restored.length, 225)
  assert.equal(restored.reduce((total, message) => total + message.inputTokens, 0), 25_425)
  assert.deepEqual(calls.map((call) => call.order), ["asc", undefined, undefined])
  assert.deepEqual(calls.map((call) => call.cursor), [undefined, "200", "226"])
})

test("recent refresh merges without dropping restored history", () => {
  const existing: TokenMessage[] = Array.from({ length: 225 }, (_, index) => ({
    id: `m-${index}`,
    sessionID: "session-1",
    providerID: "test",
    modelID: "model",
    inputTokens: index + 1,
    outputTokens: 1,
    reasoningTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
  }))
  const incoming = [{ ...existing[224], outputTokens: 2 }, { ...existing[224], id: "m-225" }]

  const merged = mergeTokenMessages(existing, incoming)

  assert.equal(merged.length, 226)
  assert.equal(merged[224].outputTokens, 2)
  assert.equal(merged[225].id, "m-225")
})

test("cache-only assistant usage is retained", () => {
  const message = assistant("cache-only", 0)
  if (message.type !== "assistant") throw new Error("expected assistant")
  message.tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 128, write: 64 } }

  assert.deepEqual(messageToTokenMessage(message, "session-1"), {
    id: "cache-only",
    sessionID: "session-1",
    providerID: "test",
    modelID: "model",
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheRead: 128,
    cacheWrite: 64,
    cost: 0,
  })
})
