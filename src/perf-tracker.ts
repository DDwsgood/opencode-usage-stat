// perf-tracker.ts - Real-time performance tracking for the current session.
// Adapted from opencode-tokenwatch (MIT, (c) TTWK). Log path renamed to
// usage-stat.jsonl to avoid clashing with the original tokenwatch plugin.
import type { LogEntry, ModelPerfStats, SessionPerfStats } from "./formatter.js"
import { isMissingCache } from "./formatter.js"
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { existsSync, statSync } from "node:fs"
import { updatePersistedStats } from "./stats-store.js"

const DEFAULT_LOG_PATH = join(homedir(), ".opencode", "usage-stat.jsonl")

// Test-injectable log path (keeps unit tests offline from the real home dir).
let logPath: string | null = null
export function setUsageStatLogPath(path: string): void {
  logPath = path
}
function resolveLogPath(): string {
  return logPath ?? DEFAULT_LOG_PATH
}

const FIRST_OUTPUT_PART_TYPES = new Set(["text", "reasoning", "tool"])
const MIN_TPS_WINDOW_MS = 50

interface PartEvent {
  message_id?: string
  session_id?: string
  type?: string
  text?: string
  time?: { start?: number }
}

interface InboxEnqueuedEvent {
  created?: number
  data?: { sessionID?: string; inboxID?: string; item?: { type?: string } }
}

interface InboxDeliveredEvent {
  data?: { sessionID?: string; inboxID?: string }
}

interface StepStartedEvent {
  created?: number
  data?: {
    sessionID?: string
    assistantMessageID?: string
    model?: { providerID?: string; id?: string }
  }
}

interface StepStreamedEvent {
  created?: number
  data?: { sessionID?: string; assistantMessageID?: string }
}

interface StepTerminalEvent {
  data?: {
    sessionID?: string
    assistantMessageID?: string
    tokens?: {
      input?: number
      output?: number
      reasoning?: number
      cache?: { read?: number; write?: number }
    }
    cost?: number
  }
}

interface MessageRemoveEvent {
  properties: {
    sessionID?: string
    messageID?: string
  }
}

interface StepTiming {
  sessionID: string
  providerID: string
  modelID: string
  startedAt: number
  streamedAt: number | null
  firstOutputAt: number | null
}

class PerfTracker {
  private steps = new Map<string, StepTiming>()
  private inboxStarts = new Map<string, { sessionID: string; created: number }>()
  private promptStarts = new Map<string, number[]>()
  private messagePromptStarts = new Map<string, number>()
  private promptAssociationAttempted = new Set<string>()
  private settledMessages = new Set<string>()
  private statsMap = new Map<string, ModelPerfStats>()
  /** 原始样本串，用于分位数计算，不持久化 */
  private ttftSamples = new Map<string, number[]>()
  private tpsSamples = new Map<string, number[]>()
  private latencySamples = new Map<string, number[]>()

  handleInboxEnqueued(event: InboxEnqueuedEvent): void {
    const sessionID = event.data?.sessionID
    const inboxID = event.data?.inboxID
    const created = event.created
    if (!sessionID || !inboxID || !created || event.data?.item?.type !== "user") return
    this.inboxStarts.set(inboxID, { sessionID, created })
  }

  handleInboxDelivered(event: InboxDeliveredEvent): void {
    const inboxID = event.data?.inboxID
    if (!inboxID) return
    const start = this.inboxStarts.get(inboxID)
    this.inboxStarts.delete(inboxID)
    if (!start || (event.data?.sessionID && event.data.sessionID !== start.sessionID)) return
    const queue = this.promptStarts.get(start.sessionID) ?? []
    queue.push(start.created)
    this.promptStarts.set(start.sessionID, queue)
  }

  private associatePrompt(messageID: string, sessionID?: string): void {
    if (this.promptAssociationAttempted.has(messageID)) return
    this.promptAssociationAttempted.add(messageID)
    const queue = sessionID ? this.promptStarts.get(sessionID) : undefined
    const promptStart = queue?.shift()
    if (promptStart !== undefined) this.messagePromptStarts.set(messageID, promptStart)
    if (sessionID && queue?.length === 0) this.promptStarts.delete(sessionID)
  }

  handleStepStarted(event: StepStartedEvent): void {
    const messageID = event.data?.assistantMessageID
    const sessionID = event.data?.sessionID
    const startedAt = event.created
    if (!messageID || !sessionID || typeof startedAt !== "number") return
    this.associatePrompt(messageID, sessionID)
    this.steps.set(messageID, {
      sessionID,
      providerID: event.data?.model?.providerID ?? "unknown",
      modelID: event.data?.model?.id ?? "unknown",
      startedAt,
      streamedAt: null,
      firstOutputAt: null,
    })
  }

  handlePartUpdated(event: PartEvent): void {
    if (!event.time?.start || !event.message_id) return
    // The first text, reasoning, or tool-input fragment is the closest host-side
    // approximation of first output. TPS itself uses Step.Started/Streamed.
    const type = event.type ?? ""
    if (!FIRST_OUTPUT_PART_TYPES.has(type)) return
    this.associatePrompt(event.message_id, event.session_id)
    const step = this.steps.get(event.message_id)
    if (!step) return
    step.firstOutputAt = step.firstOutputAt === null
      ? event.time.start
      : Math.min(step.firstOutputAt, event.time.start)
  }

  handleStepStreamed(event: StepStreamedEvent): void {
    const messageID = event.data?.assistantMessageID
    const streamedAt = event.created
    if (!messageID || typeof streamedAt !== "number") return
    const step = this.steps.get(messageID)
    if (!step || streamedAt < step.startedAt) return
    step.streamedAt = streamedAt
  }

  handleStepTerminal(event: StepTerminalEvent): void {
    const messageID = event.data?.assistantMessageID
    if (!messageID) return
    const step = this.steps.get(messageID)
    if (!step) return

    const settledKey = `${step.sessionID}/${messageID}`
    if (this.settledMessages.has(settledKey)) {
      this.clearMessage(messageID)
      return
    }

    const tokens = event.data?.tokens

    const inputTokens = tokens?.input ?? 0
    const outputTokens = tokens?.output ?? 0
    const reasoningTokens = tokens?.reasoning ?? 0
    const cacheRead = tokens?.cache?.read ?? 0
    const cacheWrite = tokens?.cache?.write ?? 0
    const cost = event.data?.cost ?? 0

    if (inputTokens + outputTokens + reasoningTokens + cacheRead + cacheWrite === 0) {
      this.clearMessage(messageID)
      return
    }

    const promptStart = this.messagePromptStarts.get(messageID) ?? null
    const ttftMs = step.firstOutputAt !== null && promptStart !== null && step.firstOutputAt >= promptStart
      ? step.firstOutputAt - promptStart
      : null
    const latencyMs = step.streamedAt !== null && promptStart !== null && step.streamedAt >= promptStart
      ? step.streamedAt - promptStart
      : null
    const bodyMs = step.streamedAt !== null ? step.streamedAt - step.startedAt : null
    const generatedTokens = outputTokens + reasoningTokens
    const tps = (bodyMs !== null && bodyMs >= MIN_TPS_WINDOW_MS && generatedTokens > 0)
      ? (generatedTokens / bodyMs) * 1000
      : null

    this.settledMessages.add(settledKey)
    this.clearMessage(messageID)

    const providerID = step.providerID
    const modelID = step.modelID
    const model = `${providerID}/${modelID}`

    const entry: LogEntry = {
      schema: 2,
      ts: new Date().toISOString(),
      messageID,
      model,
      providerID,
      modelID,
      sessionID: step.sessionID,
      ttft_ms: ttftMs,
      ttft_source: "inbox-enqueued",
      tps,
      tps_source: "step-body-window",
      tpsTokens: generatedTokens,
      tpsWindowMs: tps === null ? undefined : bodyMs ?? undefined,
      latency_ms: latencyMs,
      latency_source: "inbox-to-step-streamed",
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      cost,
    }

    this.appendLog(entry)
    this.updateStats(model, entry)
  }

  private clearMessage(messageID: string): void {
    this.steps.delete(messageID)
    this.messagePromptStarts.delete(messageID)
    this.promptAssociationAttempted.delete(messageID)
  }

  private appendLog(entry: LogEntry): void {
    try {
      const MAX_SIZE = 5 * 1024 * 1024
      const KEEP_LINES = 2000
      if (existsSync(resolveLogPath()) && statSync(resolveLogPath()).size > MAX_SIZE) {
        const lines = readFileSync(resolveLogPath(), "utf-8").trim().split("\n")
        writeFileSync(resolveLogPath(), lines.slice(-KEEP_LINES).join("\n") + "\n")
      }
      appendFileSync(resolveLogPath(), JSON.stringify(entry) + "\n")
    } catch {
      // Silently fail — logging is non-critical
    }
    updatePersistedStats(entry)
  }

  handleMessageRemoved(event: MessageRemoveEvent): void {
    const mid = event.properties?.messageID ?? ""
    if (mid) this.clearMessage(mid)
  }

  private updateStats(model: string, entry: LogEntry): void {
    let stats = this.statsMap.get(model)
    if (!stats) {
      stats = {
        model,
        providerID: entry.providerID,
        requestCount: 0,
        ttftCount: 0,
        tpsCount: 0,
        latencyCount: 0,
        totalInput: 0,
        totalOutput: 0,
        totalCacheRead: 0,
        totalCacheWrite: 0,
        totalCost: 0,
        avgTTFT: null,
        maxTTFT: null,
        minTTFT: null,
        p50TTFT: null,
        p95TTFT: null,
        p99TTFT: null,
        avgTPS: null,
        maxTPS: null,
        minTPS: null,
        p50TPS: null,
        p95TPS: null,
        p99TPS: null,
        tpsTotalTokens: 0,
        tpsTotalTimeMs: 0,
        avgLatency: null,
        maxLatency: null,
        minLatency: null,
        p50Latency: null,
        p95Latency: null,
        p99Latency: null,
        cacheHitRate: null,
      }
      this.statsMap.set(model, stats)
    }

    stats.requestCount++
    stats.totalInput += entry.inputTokens
    stats.totalOutput += entry.outputTokens
    stats.totalCacheRead += entry.cacheReadTokens
    stats.totalCacheWrite += entry.cacheWriteTokens
    stats.totalCost += entry.cost

    if (entry.ttft_ms !== null) {
      stats.ttftCount++
      const c = stats.ttftCount
      const prev = stats.avgTTFT
      stats.avgTTFT = prev !== null ? prev + (entry.ttft_ms - prev) / c : entry.ttft_ms
      stats.maxTTFT = stats.maxTTFT !== null ? Math.max(stats.maxTTFT, entry.ttft_ms) : entry.ttft_ms
      stats.minTTFT = stats.minTTFT !== null ? Math.min(stats.minTTFT, entry.ttft_ms) : entry.ttft_ms
      const ttftArr = this.ttftSamples.get(model) ?? []
      ttftArr.push(entry.ttft_ms)
      this.ttftSamples.set(model, ttftArr)
    }

    if (entry.tps !== null && entry.tpsTokens != null && entry.tpsWindowMs != null && entry.tpsWindowMs > 0) {
      stats.tpsCount++
      stats.tpsTotalTokens += entry.tpsTokens
      stats.tpsTotalTimeMs += entry.tpsWindowMs
      stats.avgTPS = (stats.tpsTotalTokens / stats.tpsTotalTimeMs) * 1000
      stats.maxTPS = stats.maxTPS !== null ? Math.max(stats.maxTPS, entry.tps) : entry.tps
      stats.minTPS = stats.minTPS !== null ? Math.min(stats.minTPS, entry.tps) : entry.tps
      const tpsArr = this.tpsSamples.get(model) ?? []
      tpsArr.push(entry.tps)
      this.tpsSamples.set(model, tpsArr)
    }

    if (entry.latency_ms !== null) {
      stats.latencyCount++
      const c = stats.latencyCount
      const prev = stats.avgLatency
      stats.avgLatency = prev !== null ? prev + (entry.latency_ms - prev) / c : entry.latency_ms
      stats.maxLatency = stats.maxLatency !== null ? Math.max(stats.maxLatency, entry.latency_ms) : entry.latency_ms
      stats.minLatency = stats.minLatency !== null ? Math.min(stats.minLatency, entry.latency_ms) : entry.latency_ms
      const latArr = this.latencySamples.get(model) ?? []
      latArr.push(entry.latency_ms)
      this.latencySamples.set(model, latArr)
    }
  }

  private percentile(sortedArr: number[], p: number): number | null {
    if (sortedArr.length === 0) return null
    if (sortedArr.length === 1) return sortedArr[0]
    const idx = (p / 100) * (sortedArr.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    if (lo === hi) return sortedArr[lo]
    return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo)
  }

  getSessionStats(): SessionPerfStats {
    let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0
    let totalRequests = 0, totalCost = 0
    let weightedHitSum = 0, totalReqForHit = 0

    for (const [model, s] of this.statsMap) {
      totalInput += s.totalInput
      totalOutput += s.totalOutput
      totalCacheRead += s.totalCacheRead
      totalCacheWrite += s.totalCacheWrite
      totalRequests += s.requestCount
      totalCost += s.totalCost

      const ttftArr = [...(this.ttftSamples.get(model) ?? [])].sort((a, b) => a - b)
      s.p50TTFT = this.percentile(ttftArr, 50)
      s.p95TTFT = this.percentile(ttftArr, 95)
      s.p99TTFT = this.percentile(ttftArr, 99)

      const tpsArr = [...(this.tpsSamples.get(model) ?? [])].sort((a, b) => a - b)
      s.p50TPS = this.percentile(tpsArr, 50)
      s.p95TPS = this.percentile(tpsArr, 95)
      s.p99TPS = this.percentile(tpsArr, 99)

      const latArr = [...(this.latencySamples.get(model) ?? [])].sort((a, b) => a - b)
      s.p50Latency = this.percentile(latArr, 50)
      s.p95Latency = this.percentile(latArr, 95)
      s.p99Latency = this.percentile(latArr, 99)

      const denom = s.totalInput + s.totalCacheRead
      s.cacheHitRate = denom > 0 ? (s.totalCacheRead / denom) * 100 : null

      if (s.cacheHitRate !== null && !isMissingCache(s.requestCount, s.totalCacheRead)) {
        weightedHitSum += s.cacheHitRate * s.requestCount
        totalReqForHit += s.requestCount
      }
    }

    const weightedCacheHitRate = totalReqForHit > 0 ? weightedHitSum / totalReqForHit : null

    return {
      models: Object.fromEntries(this.statsMap),
      totals: { totalInput, totalOutput, totalCacheRead, totalCacheWrite, totalRequests, totalCost, weightedCacheHitRate },
    }
  }

  readLogs(last: number = 50): LogEntry[] {
    try {
      if (!existsSync(resolveLogPath())) return []
      const content = readFileSync(resolveLogPath(), "utf-8").trim()
      if (!content) return []
      const lines = content.split("\n")
      const entries: LogEntry[] = []
      for (let i = lines.length - 1; i >= 0 && entries.length < last; i--) {
        try {
          const entry = JSON.parse(lines[i]) as LogEntry
          if (entry.schema !== 2 || entry.tps_source !== "step-body-window") continue
          entries.push({
            ...entry,
            ttft_ms: entry.ttft_source === "inbox-enqueued" ? entry.ttft_ms : null,
            tps: entry.schema === 2 && entry.tps_source === "step-body-window" ? entry.tps : null,
            latency_ms: entry.schema === 2 && entry.latency_source === "inbox-to-step-streamed" ? entry.latency_ms : null,
          })
        } catch {
          // Skip malformed lines
        }
      }
      return entries.reverse()
    } catch {
      return []
    }
  }

  reset(): void {
    this.steps.clear()
    this.inboxStarts.clear()
    this.promptStarts.clear()
    this.messagePromptStarts.clear()
    this.promptAssociationAttempted.clear()
    this.settledMessages.clear()
    this.statsMap.clear()
    this.ttftSamples.clear()
    this.tpsSamples.clear()
    this.latencySamples.clear()
  }

  loadSession(sessionID: string): void {
    this.loadSessions(sessionID ? [sessionID] : [])
  }

  loadSessions(sessionIDs: readonly string[]): void {
    this.steps.clear()
    this.inboxStarts.clear()
    this.promptStarts.clear()
    this.messagePromptStarts.clear()
    this.promptAssociationAttempted.clear()
    this.settledMessages.clear()
    this.statsMap.clear()
    this.ttftSamples.clear()
    this.tpsSamples.clear()
    this.latencySamples.clear()

    const ids = new Set(sessionIDs.filter(Boolean))
    if (ids.size === 0) return

    try {
      if (!existsSync(resolveLogPath())) return
      const content = readFileSync(resolveLogPath(), "utf-8").trim()
      if (!content) return
      const lines = content.split("\n")
      for (const line of lines) {
        if (!line) continue
        try {
          const entry = JSON.parse(line) as LogEntry
          if (entry.schema !== 2 || entry.tps_source !== "step-body-window") continue
          if (entry.messageID) this.settledMessages.add(`${entry.sessionID}/${entry.messageID}`)
          if (ids.has(entry.sessionID)) {
            this.updateStats(entry.model, {
              ...entry,
              ttft_ms: entry.ttft_source === "inbox-enqueued" ? entry.ttft_ms : null,
              tps: entry.tps,
              latency_ms: entry.latency_source === "inbox-to-step-streamed" ? entry.latency_ms : null,
            })
          }
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Non-critical loading failure
    }
  }
}

export function createPerfTracker(): PerfTracker {
  return new PerfTracker()
}
export type { PartEvent, PerfTracker }
export function readLogs(last: number = 50): LogEntry[] {
  const tracker = new PerfTracker()
  return tracker.readLogs(last)
}
