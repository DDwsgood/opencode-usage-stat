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

/**
 * Part types that represent a real model streaming output ("first token").
 * Text is the classic body; reasoning streams first on many models (e.g.
 * DeepSeek-R1, Claude, o-series). Counting only later text inflates TTFT and
 * understates the generation interval, so TPS becomes unrealistically high.
 * We accept both (and any delta part that carries a timestamp) and keep the
 * EARLIEST one for TTFT / TPS generation-window start.
 */
const FIRST_OUTPUT_PART_TYPES = new Set(["text", "reasoning"])

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
  data?: { sessionID?: string; assistantMessageID?: string }
}

interface MessageUpdateEvent {
  properties: {
    info: {
      id?: string
      sessionID?: string
      role?: string
      providerID?: string
      modelID?: string
      model?: { providerID?: string; id?: string }
      tokens?: {
        input?: number
        output?: number
        reasoning?: number
        cache?: { read?: number; write?: number }
      }
      cost?: number
      time?: { created?: number; completed?: number }
    }
  }
}

interface MessageRemoveEvent {
  properties: {
    sessionID?: string
    messageID?: string
  }
}

class PerfTracker {
  private firstPartTimes = new Map<string, number>()
  private lastPartTimes = new Map<string, number>()
  private inboxStarts = new Map<string, { sessionID: string; created: number }>()
  private promptStarts = new Map<string, number[]>()
  private messagePromptStarts = new Map<string, number>()
  private promptAssociationAttempted = new Set<string>()
  private statsMap = new Map<string, ModelPerfStats>()
  /** 原始样本串，用于分位数计算，不持久化 */
  private ttftSamples = new Map<string, number[]>()
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
    if (messageID) this.associatePrompt(messageID, event.data?.sessionID)
  }

  handlePartUpdated(event: PartEvent): void {
    if (!event.time?.start || !event.message_id) return
    // Only count parts that represent real model streaming output. Reasoning is
    // often the first streamed content; text may never arrive for tool-only
    // turns. Ignore tool/snapshot/step-start control parts so TTFT measures the
    // true first output token.
    const type = event.type ?? ""
    if (!FIRST_OUTPUT_PART_TYPES.has(type)) return
    this.associatePrompt(event.message_id, event.session_id)
    // Bug fix: take the EARLIEST first-output part (e.g. reasoning before text).
    const cur = this.firstPartTimes.get(event.message_id) ?? Number.POSITIVE_INFINITY
    if (event.time.start < cur) {
      this.firstPartTimes.set(event.message_id, event.time.start)
    }
  }

  handlePartEnded(event: PartEvent): void {
    if (!event.time?.start || !event.message_id || !FIRST_OUTPUT_PART_TYPES.has(event.type ?? "")) return
    const current = this.lastPartTimes.get(event.message_id) ?? Number.NEGATIVE_INFINITY
    if (event.time.start > current) this.lastPartTimes.set(event.message_id, event.time.start)
  }

  handleMessageUpdated(event: MessageUpdateEvent): void {
    const info = event.properties?.info
    if (!info || info.role !== "assistant") return
    if (!info.time?.completed) return

    const messageID = info.id ?? ""
    const created = info.time.created
    const completed = info.time.completed
    if (!created || !completed) {
      this.firstPartTimes.delete(messageID)
      this.lastPartTimes.delete(messageID)
      this.messagePromptStarts.delete(messageID)
      this.promptAssociationAttempted.delete(messageID)
      return
    }

    const sessionID = info.sessionID ?? ""
    const providerID = info.providerID ?? info.model?.providerID ?? "unknown"
    const modelID = info.modelID ?? info.model?.id ?? "unknown"
    const model = `${providerID}/${modelID}`
    const tokens = info.tokens

    const inputTokens = tokens?.input ?? 0
    const outputTokens = tokens?.output ?? 0
    const reasoningTokens = tokens?.reasoning ?? 0
    const cacheRead = tokens?.cache?.read ?? 0
    const cacheWrite = tokens?.cache?.write ?? 0
    const cost = info.cost ?? 0

    // 过滤全零 token 的失败请求，不写入日志和统计，防止污染数据
    if (inputTokens + outputTokens + reasoningTokens + cacheRead + cacheWrite === 0) {
      this.firstPartTimes.delete(messageID)
      this.lastPartTimes.delete(messageID)
      this.messagePromptStarts.delete(messageID)
      this.promptAssociationAttempted.delete(messageID)
      return
    }

    const firstPart = this.firstPartTimes.get(messageID) ?? null
    const lastPart = this.lastPartTimes.get(messageID) ?? null
    const promptStart = this.messagePromptStarts.get(messageID) ?? null

    const ttftMs = firstPart !== null && promptStart !== null && firstPart >= promptStart ? firstPart - promptStart : null
    const latencyMs = lastPart !== null && promptStart !== null && lastPart >= promptStart ? lastPart - promptStart : null
    const genMs = firstPart !== null && lastPart !== null ? lastPart - firstPart : null
    const generatedTokens = outputTokens + reasoningTokens
    const tps = (genMs !== null && genMs > 0 && generatedTokens > 0)
      ? (generatedTokens / genMs) * 1000
      : null

    this.firstPartTimes.delete(messageID)
    this.lastPartTimes.delete(messageID)
    this.messagePromptStarts.delete(messageID)
    this.promptAssociationAttempted.delete(messageID)

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      model,
      providerID,
      modelID,
      sessionID,
      ttft_ms: ttftMs,
      ttft_source: "inbox-enqueued",
      tps,
      tps_source: "all-output-window",
      latency_ms: latencyMs,
      latency_source: "inbox-to-last-output",
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
    if (mid) {
      this.firstPartTimes.delete(mid)
      this.lastPartTimes.delete(mid)
      this.messagePromptStarts.delete(mid)
      this.promptAssociationAttempted.delete(mid)
    }
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

    if (entry.tps !== null) {
      stats.tpsCount++
      const c = stats.tpsCount
      const prev = stats.avgTPS
      stats.avgTPS = prev !== null ? prev + (entry.tps - prev) / c : entry.tps
      stats.maxTPS = stats.maxTPS !== null ? Math.max(stats.maxTPS, entry.tps) : entry.tps
      stats.minTPS = stats.minTPS !== null ? Math.min(stats.minTPS, entry.tps) : entry.tps
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
      for (let i = Math.max(0, lines.length - last); i < lines.length; i++) {
        try {
          const entry = JSON.parse(lines[i]) as LogEntry
          entries.push({
            ...entry,
            ttft_ms: entry.ttft_source === "inbox-enqueued" ? entry.ttft_ms : null,
            tps: entry.tps_source === "all-output-window" ? entry.tps : null,
            latency_ms: entry.latency_source === "inbox-to-last-output" ? entry.latency_ms : null,
          })
        } catch {
          // Skip malformed lines
        }
      }
      return entries
    } catch {
      return []
    }
  }

  reset(): void {
    this.firstPartTimes.clear()
    this.lastPartTimes.clear()
    this.inboxStarts.clear()
    this.promptStarts.clear()
    this.messagePromptStarts.clear()
    this.promptAssociationAttempted.clear()
    this.statsMap.clear()
    this.ttftSamples.clear()
    this.latencySamples.clear()
  }

  loadSession(sessionID: string): void {
    this.loadSessions(sessionID ? [sessionID] : [])
  }

  loadSessions(sessionIDs: readonly string[]): void {
    this.firstPartTimes.clear()
    this.lastPartTimes.clear()
    this.inboxStarts.clear()
    this.promptStarts.clear()
    this.messagePromptStarts.clear()
    this.promptAssociationAttempted.clear()
    this.statsMap.clear()
    this.ttftSamples.clear()
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
          if (ids.has(entry.sessionID)) {
            this.updateStats(entry.model, {
              ...entry,
              ttft_ms: entry.ttft_source === "inbox-enqueued" ? entry.ttft_ms : null,
              tps: entry.tps_source === "all-output-window" ? entry.tps : null,
              latency_ms: entry.latency_source === "inbox-to-last-output" ? entry.latency_ms : null,
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
