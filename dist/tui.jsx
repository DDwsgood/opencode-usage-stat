// src/tui.tsx
import { createSignal as createSignal3 } from "solid-js";
import { Plugin } from "@opencode-ai/plugin/tui";

// src/formatter.ts
function isMissingCache(requestCount, totalCacheRead) {
  return requestCount >= 2 && totalCacheRead === 0;
}
function formatTokens(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
function formatCost(n) {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}
function formatDuration(ms) {
  if (ms === null) return "\u2014";
  if (ms < 1e3) return `${ms.toFixed(0)}ms`;
  if (ms < 6e4) return `${(ms / 1e3).toFixed(1)}s`;
  const m = Math.floor(ms / 6e4);
  const s = Math.floor(ms % 6e4 / 1e3);
  return `${m}m ${s}s`;
}
function cacheHitRate(input, cacheRead) {
  if (input + cacheRead === 0) return 0;
  return cacheRead / (input + cacheRead);
}
function getPresetRange(preset) {
  if (preset === "all") return {};
  const end = /* @__PURE__ */ new Date();
  const start = new Date(end);
  if (preset === "7d") start.setDate(end.getDate() - 6);
  if (preset === "30d") start.setDate(end.getDate() - 29);
  if (preset === "month") start.setDate(1);
  const format = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  return { startDate: format(start), endDate: format(end) };
}

// src/perf-tracker.ts
import { appendFileSync, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
import { homedir as homedir2 } from "node:os";
import { existsSync as existsSync2, statSync } from "node:fs";

// src/stats-store.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
var DEFAULT_STATS_PATH = join(homedir(), ".opencode", "usage-stat-stats.json");
var DEFAULT_LOG_PATH = join(homedir(), ".opencode", "usage-stat.jsonl");
var statsPath = null;
var logPath = null;
function resolveStatsPath() {
  return statsPath ?? DEFAULT_STATS_PATH;
}
function resolveLogPath() {
  return logPath ?? DEFAULT_LOG_PATH;
}
var RESERVOIR_SIZE = 500;
var CURRENT_VERSION = 1;
function loadStatsFile() {
  try {
    if (!existsSync(resolveStatsPath())) {
      return { version: CURRENT_VERSION, updatedAt: "", migratedFromLogs: false, models: {} };
    }
    const content = readFileSync(resolveStatsPath(), "utf-8");
    const parsed = JSON.parse(content);
    if (parsed?.version === CURRENT_VERSION && parsed.models) return parsed;
  } catch {
  }
  return { version: CURRENT_VERSION, updatedAt: "", migratedFromLogs: false, models: {} };
}
function saveStatsFile(file) {
  try {
    file.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    writeFileSync(resolveStatsPath(), JSON.stringify(file), "utf-8");
  } catch {
  }
}
function reservoirAdd(reservoir, value, totalCount) {
  if (reservoir.length < RESERVOIR_SIZE) {
    return [...reservoir, value];
  }
  const j = Math.floor(Math.random() * totalCount);
  if (j < RESERVOIR_SIZE) {
    const next = [...reservoir];
    next[j] = value;
    return next;
  }
  return reservoir;
}
function applyEntryToModels(models, entry) {
  const key = entry.model;
  let s = models[key];
  if (!s) {
    s = {
      model: entry.model,
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
      avgTPS: null,
      maxTPS: null,
      minTPS: null,
      avgLatency: null,
      maxLatency: null,
      minLatency: null,
      ttftReservoir: [],
      latencyReservoir: []
    };
    models[key] = s;
  }
  s.requestCount++;
  s.totalInput += entry.inputTokens;
  s.totalOutput += entry.outputTokens;
  s.totalCacheRead += entry.cacheReadTokens;
  s.totalCacheWrite += entry.cacheWriteTokens;
  s.totalCost += entry.cost;
  if (entry.ttft_ms != null) {
    s.ttftCount++;
    const c = s.ttftCount;
    s.avgTTFT = s.avgTTFT != null ? s.avgTTFT + (entry.ttft_ms - s.avgTTFT) / c : entry.ttft_ms;
    s.maxTTFT = s.maxTTFT != null ? Math.max(s.maxTTFT, entry.ttft_ms) : entry.ttft_ms;
    s.minTTFT = s.minTTFT != null ? Math.min(s.minTTFT, entry.ttft_ms) : entry.ttft_ms;
    s.ttftReservoir = reservoirAdd(s.ttftReservoir, entry.ttft_ms, s.ttftCount);
  }
  if (entry.tps != null) {
    s.tpsCount++;
    const c = s.tpsCount;
    s.avgTPS = s.avgTPS != null ? s.avgTPS + (entry.tps - s.avgTPS) / c : entry.tps;
    s.maxTPS = s.maxTPS != null ? Math.max(s.maxTPS, entry.tps) : entry.tps;
    s.minTPS = s.minTPS != null ? Math.min(s.minTPS, entry.tps) : entry.tps;
  }
  if (entry.latency_ms != null) {
    s.latencyCount++;
    const c = s.latencyCount;
    s.avgLatency = s.avgLatency != null ? s.avgLatency + (entry.latency_ms - s.avgLatency) / c : entry.latency_ms;
    s.maxLatency = s.maxLatency != null ? Math.max(s.maxLatency, entry.latency_ms) : entry.latency_ms;
    s.minLatency = s.minLatency != null ? Math.min(s.minLatency, entry.latency_ms) : entry.latency_ms;
    s.latencyReservoir = reservoirAdd(s.latencyReservoir, entry.latency_ms, s.latencyCount);
  }
}
function migrateFromLogsIfNeeded(file) {
  if (file.migratedFromLogs) return false;
  if (!existsSync(resolveLogPath())) {
    file.migratedFromLogs = true;
    return true;
  }
  try {
    const content = readFileSync(resolveLogPath(), "utf-8").trim();
    if (!content) {
      file.migratedFromLogs = true;
      return true;
    }
    let migrated = 0;
    for (const line of content.split("\n")) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.model && entry.ts) {
          applyEntryToModels(file.models, entry);
          migrated++;
        }
      } catch {
      }
    }
    file.migratedFromLogs = true;
    if (migrated > 0) {
      ;
      file._migratedFrom = `${resolveLogPath()} (${migrated} entries)`;
    }
    return true;
  } catch {
    file.migratedFromLogs = true;
    return true;
  }
}
function percentile(arr, p) {
  if (arr.length === 0) return null;
  if (arr.length === 1) return arr[0];
  const idx = p / 100 * (arr.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return arr[lo];
  return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo);
}
function updatePersistedStats(entry) {
  try {
    const file = loadStatsFile();
    applyEntryToModels(file.models, entry);
    saveStatsFile(file);
  } catch {
  }
}
function readPersistedStats() {
  try {
    const file = loadStatsFile();
    if (!file.migratedFromLogs) {
      file.models = {};
      migrateFromLogsIfNeeded(file);
      saveStatsFile(file);
    }
    return Object.values(file.models).map((s) => {
      const ttftArr = [...s.ttftReservoir].sort((a, b) => a - b);
      const latArr = [...s.latencyReservoir].sort((a, b) => a - b);
      const denom = s.totalInput + s.totalCacheRead;
      return {
        model: s.model,
        providerID: s.providerID,
        requestCount: s.requestCount,
        ttftCount: s.ttftCount,
        tpsCount: s.tpsCount,
        latencyCount: s.latencyCount,
        totalInput: s.totalInput,
        totalOutput: s.totalOutput,
        totalCacheRead: s.totalCacheRead,
        totalCacheWrite: s.totalCacheWrite,
        totalCost: s.totalCost,
        avgTTFT: s.avgTTFT,
        maxTTFT: s.maxTTFT,
        minTTFT: s.minTTFT,
        p50TTFT: percentile(ttftArr, 50),
        p95TTFT: percentile(ttftArr, 95),
        p99TTFT: percentile(ttftArr, 99),
        avgTPS: s.avgTPS,
        maxTPS: s.maxTPS,
        minTPS: s.minTPS,
        avgLatency: s.avgLatency,
        maxLatency: s.maxLatency,
        minLatency: s.minLatency,
        p50Latency: percentile(latArr, 50),
        p95Latency: percentile(latArr, 95),
        p99Latency: percentile(latArr, 99),
        cacheHitRate: denom > 0 ? s.totalCacheRead / denom * 100 : null
      };
    });
  } catch {
    return [];
  }
}

// src/perf-tracker.ts
var DEFAULT_LOG_PATH2 = join2(homedir2(), ".opencode", "usage-stat.jsonl");
var logPath2 = null;
function resolveLogPath2() {
  return logPath2 ?? DEFAULT_LOG_PATH2;
}
var FIRST_OUTPUT_PART_TYPES = /* @__PURE__ */ new Set(["text", "reasoning"]);
var PerfTracker = class {
  firstPartTimes = /* @__PURE__ */ new Map();
  lastPartTimes = /* @__PURE__ */ new Map();
  inboxStarts = /* @__PURE__ */ new Map();
  promptStarts = /* @__PURE__ */ new Map();
  messagePromptStarts = /* @__PURE__ */ new Map();
  promptAssociationAttempted = /* @__PURE__ */ new Set();
  statsMap = /* @__PURE__ */ new Map();
  /** 原始样本串，用于分位数计算，不持久化 */
  ttftSamples = /* @__PURE__ */ new Map();
  latencySamples = /* @__PURE__ */ new Map();
  handleInboxEnqueued(event) {
    const sessionID = event.data?.sessionID;
    const inboxID = event.data?.inboxID;
    const created = event.created;
    if (!sessionID || !inboxID || !created || event.data?.item?.type !== "user") return;
    this.inboxStarts.set(inboxID, { sessionID, created });
  }
  handleInboxDelivered(event) {
    const inboxID = event.data?.inboxID;
    if (!inboxID) return;
    const start = this.inboxStarts.get(inboxID);
    this.inboxStarts.delete(inboxID);
    if (!start || event.data?.sessionID && event.data.sessionID !== start.sessionID) return;
    const queue = this.promptStarts.get(start.sessionID) ?? [];
    queue.push(start.created);
    this.promptStarts.set(start.sessionID, queue);
  }
  associatePrompt(messageID, sessionID) {
    if (this.promptAssociationAttempted.has(messageID)) return;
    this.promptAssociationAttempted.add(messageID);
    const queue = sessionID ? this.promptStarts.get(sessionID) : void 0;
    const promptStart = queue?.shift();
    if (promptStart !== void 0) this.messagePromptStarts.set(messageID, promptStart);
    if (sessionID && queue?.length === 0) this.promptStarts.delete(sessionID);
  }
  handleStepStarted(event) {
    const messageID = event.data?.assistantMessageID;
    if (messageID) this.associatePrompt(messageID, event.data?.sessionID);
  }
  handlePartUpdated(event) {
    if (!event.time?.start || !event.message_id) return;
    const type = event.type ?? "";
    if (!FIRST_OUTPUT_PART_TYPES.has(type)) return;
    this.associatePrompt(event.message_id, event.session_id);
    const cur = this.firstPartTimes.get(event.message_id) ?? Number.POSITIVE_INFINITY;
    if (event.time.start < cur) {
      this.firstPartTimes.set(event.message_id, event.time.start);
    }
  }
  handlePartEnded(event) {
    if (!event.time?.start || !event.message_id || !FIRST_OUTPUT_PART_TYPES.has(event.type ?? "")) return;
    const current = this.lastPartTimes.get(event.message_id) ?? Number.NEGATIVE_INFINITY;
    if (event.time.start > current) this.lastPartTimes.set(event.message_id, event.time.start);
  }
  handleMessageUpdated(event) {
    const info = event.properties?.info;
    if (!info || info.role !== "assistant") return;
    if (!info.time?.completed) return;
    const messageID = info.id ?? "";
    const created = info.time.created;
    const completed = info.time.completed;
    if (!created || !completed) {
      this.firstPartTimes.delete(messageID);
      this.lastPartTimes.delete(messageID);
      this.messagePromptStarts.delete(messageID);
      this.promptAssociationAttempted.delete(messageID);
      return;
    }
    const sessionID = info.sessionID ?? "";
    const providerID = info.providerID ?? info.model?.providerID ?? "unknown";
    const modelID = info.modelID ?? info.model?.id ?? "unknown";
    const model = `${providerID}/${modelID}`;
    const tokens = info.tokens;
    const inputTokens = tokens?.input ?? 0;
    const outputTokens = tokens?.output ?? 0;
    const reasoningTokens = tokens?.reasoning ?? 0;
    const cacheRead = tokens?.cache?.read ?? 0;
    const cacheWrite = tokens?.cache?.write ?? 0;
    const cost = info.cost ?? 0;
    if (inputTokens + outputTokens + reasoningTokens + cacheRead + cacheWrite === 0) {
      this.firstPartTimes.delete(messageID);
      this.lastPartTimes.delete(messageID);
      this.messagePromptStarts.delete(messageID);
      this.promptAssociationAttempted.delete(messageID);
      return;
    }
    const firstPart = this.firstPartTimes.get(messageID) ?? null;
    const lastPart = this.lastPartTimes.get(messageID) ?? null;
    const promptStart = this.messagePromptStarts.get(messageID) ?? null;
    const ttftMs = firstPart !== null && promptStart !== null && firstPart >= promptStart ? firstPart - promptStart : null;
    const latencyMs = lastPart !== null && promptStart !== null && lastPart >= promptStart ? lastPart - promptStart : null;
    const genMs = firstPart !== null && lastPart !== null ? lastPart - firstPart : null;
    const generatedTokens = outputTokens + reasoningTokens;
    const tps = genMs !== null && genMs > 0 && generatedTokens > 0 ? generatedTokens / genMs * 1e3 : null;
    this.firstPartTimes.delete(messageID);
    this.lastPartTimes.delete(messageID);
    this.messagePromptStarts.delete(messageID);
    this.promptAssociationAttempted.delete(messageID);
    const entry = {
      ts: (/* @__PURE__ */ new Date()).toISOString(),
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
      cost
    };
    this.appendLog(entry);
    this.updateStats(model, entry);
  }
  appendLog(entry) {
    try {
      const MAX_SIZE = 5 * 1024 * 1024;
      const KEEP_LINES = 2e3;
      if (existsSync2(resolveLogPath2()) && statSync(resolveLogPath2()).size > MAX_SIZE) {
        const lines = readFileSync2(resolveLogPath2(), "utf-8").trim().split("\n");
        writeFileSync2(resolveLogPath2(), lines.slice(-KEEP_LINES).join("\n") + "\n");
      }
      appendFileSync(resolveLogPath2(), JSON.stringify(entry) + "\n");
    } catch {
    }
    updatePersistedStats(entry);
  }
  handleMessageRemoved(event) {
    const mid = event.properties?.messageID ?? "";
    if (mid) {
      this.firstPartTimes.delete(mid);
      this.lastPartTimes.delete(mid);
      this.messagePromptStarts.delete(mid);
      this.promptAssociationAttempted.delete(mid);
    }
  }
  updateStats(model, entry) {
    let stats = this.statsMap.get(model);
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
        cacheHitRate: null
      };
      this.statsMap.set(model, stats);
    }
    stats.requestCount++;
    stats.totalInput += entry.inputTokens;
    stats.totalOutput += entry.outputTokens;
    stats.totalCacheRead += entry.cacheReadTokens;
    stats.totalCacheWrite += entry.cacheWriteTokens;
    stats.totalCost += entry.cost;
    if (entry.ttft_ms !== null) {
      stats.ttftCount++;
      const c = stats.ttftCount;
      const prev = stats.avgTTFT;
      stats.avgTTFT = prev !== null ? prev + (entry.ttft_ms - prev) / c : entry.ttft_ms;
      stats.maxTTFT = stats.maxTTFT !== null ? Math.max(stats.maxTTFT, entry.ttft_ms) : entry.ttft_ms;
      stats.minTTFT = stats.minTTFT !== null ? Math.min(stats.minTTFT, entry.ttft_ms) : entry.ttft_ms;
      const ttftArr = this.ttftSamples.get(model) ?? [];
      ttftArr.push(entry.ttft_ms);
      this.ttftSamples.set(model, ttftArr);
    }
    if (entry.tps !== null) {
      stats.tpsCount++;
      const c = stats.tpsCount;
      const prev = stats.avgTPS;
      stats.avgTPS = prev !== null ? prev + (entry.tps - prev) / c : entry.tps;
      stats.maxTPS = stats.maxTPS !== null ? Math.max(stats.maxTPS, entry.tps) : entry.tps;
      stats.minTPS = stats.minTPS !== null ? Math.min(stats.minTPS, entry.tps) : entry.tps;
    }
    if (entry.latency_ms !== null) {
      stats.latencyCount++;
      const c = stats.latencyCount;
      const prev = stats.avgLatency;
      stats.avgLatency = prev !== null ? prev + (entry.latency_ms - prev) / c : entry.latency_ms;
      stats.maxLatency = stats.maxLatency !== null ? Math.max(stats.maxLatency, entry.latency_ms) : entry.latency_ms;
      stats.minLatency = stats.minLatency !== null ? Math.min(stats.minLatency, entry.latency_ms) : entry.latency_ms;
      const latArr = this.latencySamples.get(model) ?? [];
      latArr.push(entry.latency_ms);
      this.latencySamples.set(model, latArr);
    }
  }
  percentile(sortedArr, p) {
    if (sortedArr.length === 0) return null;
    if (sortedArr.length === 1) return sortedArr[0];
    const idx = p / 100 * (sortedArr.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sortedArr[lo];
    return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
  }
  getSessionStats() {
    let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0;
    let totalRequests = 0, totalCost = 0;
    let weightedHitSum = 0, totalReqForHit = 0;
    for (const [model, s] of this.statsMap) {
      totalInput += s.totalInput;
      totalOutput += s.totalOutput;
      totalCacheRead += s.totalCacheRead;
      totalCacheWrite += s.totalCacheWrite;
      totalRequests += s.requestCount;
      totalCost += s.totalCost;
      const ttftArr = [...this.ttftSamples.get(model) ?? []].sort((a, b) => a - b);
      s.p50TTFT = this.percentile(ttftArr, 50);
      s.p95TTFT = this.percentile(ttftArr, 95);
      s.p99TTFT = this.percentile(ttftArr, 99);
      const latArr = [...this.latencySamples.get(model) ?? []].sort((a, b) => a - b);
      s.p50Latency = this.percentile(latArr, 50);
      s.p95Latency = this.percentile(latArr, 95);
      s.p99Latency = this.percentile(latArr, 99);
      const denom = s.totalInput + s.totalCacheRead;
      s.cacheHitRate = denom > 0 ? s.totalCacheRead / denom * 100 : null;
      if (s.cacheHitRate !== null && !isMissingCache(s.requestCount, s.totalCacheRead)) {
        weightedHitSum += s.cacheHitRate * s.requestCount;
        totalReqForHit += s.requestCount;
      }
    }
    const weightedCacheHitRate = totalReqForHit > 0 ? weightedHitSum / totalReqForHit : null;
    return {
      models: Object.fromEntries(this.statsMap),
      totals: { totalInput, totalOutput, totalCacheRead, totalCacheWrite, totalRequests, totalCost, weightedCacheHitRate }
    };
  }
  readLogs(last = 50) {
    try {
      if (!existsSync2(resolveLogPath2())) return [];
      const content = readFileSync2(resolveLogPath2(), "utf-8").trim();
      if (!content) return [];
      const lines = content.split("\n");
      const entries = [];
      for (let i = Math.max(0, lines.length - last); i < lines.length; i++) {
        try {
          const entry = JSON.parse(lines[i]);
          entries.push({
            ...entry,
            ttft_ms: entry.ttft_source === "inbox-enqueued" ? entry.ttft_ms : null,
            tps: entry.tps_source === "all-output-window" ? entry.tps : null,
            latency_ms: entry.latency_source === "inbox-to-last-output" ? entry.latency_ms : null
          });
        } catch {
        }
      }
      return entries;
    } catch {
      return [];
    }
  }
  reset() {
    this.firstPartTimes.clear();
    this.lastPartTimes.clear();
    this.inboxStarts.clear();
    this.promptStarts.clear();
    this.messagePromptStarts.clear();
    this.promptAssociationAttempted.clear();
    this.statsMap.clear();
    this.ttftSamples.clear();
    this.latencySamples.clear();
  }
  loadSession(sessionID) {
    this.loadSessions(sessionID ? [sessionID] : []);
  }
  loadSessions(sessionIDs) {
    this.firstPartTimes.clear();
    this.lastPartTimes.clear();
    this.inboxStarts.clear();
    this.promptStarts.clear();
    this.messagePromptStarts.clear();
    this.promptAssociationAttempted.clear();
    this.statsMap.clear();
    this.ttftSamples.clear();
    this.latencySamples.clear();
    const ids = new Set(sessionIDs.filter(Boolean));
    if (ids.size === 0) return;
    try {
      if (!existsSync2(resolveLogPath2())) return;
      const content = readFileSync2(resolveLogPath2(), "utf-8").trim();
      if (!content) return;
      const lines = content.split("\n");
      for (const line of lines) {
        if (!line) continue;
        try {
          const entry = JSON.parse(line);
          if (ids.has(entry.sessionID)) {
            this.updateStats(entry.model, {
              ...entry,
              ttft_ms: entry.ttft_source === "inbox-enqueued" ? entry.ttft_ms : null,
              tps: entry.tps_source === "all-output-window" ? entry.tps : null,
              latency_ms: entry.latency_source === "inbox-to-last-output" ? entry.latency_ms : null
            });
          }
        } catch {
        }
      }
    } catch {
    }
  }
};
function createPerfTracker() {
  return new PerfTracker();
}
function readLogs(last = 50) {
  const tracker = new PerfTracker();
  return tracker.readLogs(last);
}

// src/sidebar.tsx
import { createSignal as createSignal2, createMemo, createEffect as createEffect2, For as For2, Show as Show2, onCleanup as onCleanup2 } from "solid-js";
import { RGBA as RGBA3 } from "@opentui/core";

// src/i18n.ts
var zh = {
  panelTitle: "Usage Stat",
  providerUsageTitle: "Provider Usage",
  collapse: "\u6298\u53E0",
  expand: "\u5C55\u5F00",
  sessionSummary: "\u4F1A\u8BDD\u7D2F\u8BA1",
  input: "\u8F93\u5165",
  output: "\u8F93\u51FA",
  cacheRead: "\u7F13\u5B58",
  cacheWrite: "\u7F13\u5B58\u5199",
  cacheMiss: "\u672A\u547D\u4E2D",
  hitRate: "\u547D\u4E2D\u7387",
  missing: "MISSING",
  requests: "\u8BF7\u6C42",
  cost: "\u6210\u672C",
  trendUp: "\u2191",
  trendDown: "\u2193",
  cache: "\u7F13\u5B58",
  lat: "\u5EF6\u8FDF",
  performance: "\u6027\u80FD",
  pricing: "Pricing",
  modelLabel: "\u6A21\u578B",
  provider: "\u63D0\u4F9B\u5546",
  ttft: "TTFT",
  tps: "TPS",
  latency: "\u5EF6\u8FDF",
  avg: "\u5E73\u5747",
  max: "\u6700\u5927",
  min: "\u6700\u5C0F",
  read: "\u8BFB",
  write: "\u5199",
  sessionAccumulated: "Session\u7D2F\u8BA1",
  saving: "\u8282\u7701",
  priceInput: "\u8F93\u5165",
  priceCacheRead: "\u7F13\u5B58\u8BFB",
  priceCacheWrite: "\u7F13\u5B58\u5199",
  priceOutput: "\u8F93\u51FA",
  total: "\u603B\u8BA1",
  system: "\u7CFB\u7EDF\u63D0\u793A",
  user: "\u7528\u6237",
  agent: "Agent\u6307\u4EE4",
  toolCall: "Tool\u8C03\u7528",
  toolResult: "Tool\u7ED3\u679C",
  outputTokens: "\u8F93\u51FA",
  showPerformance: "\u663E\u793A\u6027\u80FD\u6307\u6807",
  showPricing: "\u663E\u793A\u6A21\u578B\u5B9A\u4EF7",
  showTrend: "\u663E\u793A\u8D8B\u52BF\u6307\u793A\u5668",
  language: "\u8BED\u8A00",
  auto: "\u81EA\u52A8",
  cmdTitleHtml: "HTML\u62A5\u544A",
  cmdDescHtml: "\u751F\u6210\u4EA4\u4E92\u5F0FHTML\u4EEA\u8868\u76D8\uFF0C\u5C55\u793AToken\u7528\u91CF\u3001\u7F13\u5B58\u548C\u6027\u80FD\u56FE\u8868",
  cmdTitleJson: "JSON\u5BFC\u51FA",
  cmdDescJson: "\u5BFC\u51FA\u539F\u59CB\u7528\u91CF\u6570\u636E\u4E3AJSON\u6587\u4EF6",
  cmdTitleText: "\u6587\u672C\u62A5\u544A",
  cmdDescText: "\u751F\u6210\u7EAF\u6587\u672C\u62A5\u544A\u6587\u4EF6",
  cmdTitleSettings: "\u8BBE\u7F6E",
  cmdDescSettings: "\u914D\u7F6E\u4FA7\u8FB9\u680F\u663E\u793A\u9009\u9879",
  descShowPerformance: "\u5728\u4FA7\u8FB9\u680F\u663E\u793ATPS\u3001TTFT\u3001\u5EF6\u8FDF\u7B49\u6307\u6807",
  descShowPricing: "\u5728\u4FA7\u8FB9\u680F\u663E\u793A\u6210\u672C\u4F30\u7B97",
  descShowTrend: "\u5728\u4FA7\u8FB9\u680F\u663E\u793AToken\u7528\u91CF\u8D8B\u52BF",
  settingsLanguage: "\u8BED\u8A00",
  descSettingsLanguage: "\u5207\u6362\u663E\u793A\u8BED\u8A00",
  settingsTitle: "Usage Stat \u8BBE\u7F6E",
  settingsPlaceholder: "\u5207\u6362\u8BBE\u7F6E\u9879...",
  langAuto: "\u81EA\u52A8",
  done: "\u5B8C\u6210",
  closeSettings: "\u5173\u95ED\u8BBE\u7F6E",
  menuToday: "\u4ECA\u5929",
  menu7d: "\u6700\u8FD1 7 \u5929",
  menu30d: "\u6700\u8FD1 30 \u5929",
  menuAll: "\u5168\u90E8\u65F6\u95F4",
  menuCurrentSession: "\u5F53\u524D\u4F1A\u8BDD",
  providerNotConfigured: "\u672A\u914D\u7F6E",
  providerRefreshing: "\u5237\u65B0\u4E2D\u2026",
  providerError: "\u4E0D\u53EF\u7528",
  providerResets: "\u91CD\u7F6E",
  opencodeGo: "OpenCode Go",
  deepseek: "DeepSeek",
  codex: "Codex"
};
var en = {
  panelTitle: "Usage Stat",
  providerUsageTitle: "Provider Usage",
  collapse: "Collapse",
  expand: "Expand",
  sessionSummary: "Session",
  input: "Input",
  output: "Output",
  cacheRead: "Cache",
  cacheWrite: "C.Write",
  cacheMiss: "Cache Miss",
  hitRate: "Hit Rate",
  missing: "MISSING",
  requests: "Req",
  cost: "Cost",
  trendUp: "\u2191",
  trendDown: "\u2193",
  cache: "Cache",
  lat: "Lat",
  performance: "Performance",
  pricing: "Pricing",
  modelLabel: "Model",
  provider: "Provider",
  ttft: "TTFT",
  tps: "TPS",
  latency: "Latency",
  avg: "Avg",
  max: "Max",
  min: "Min",
  read: "Read",
  write: "Write",
  sessionAccumulated: "Session Accumulated",
  saving: "Saving",
  priceInput: "Input",
  priceCacheRead: "Cache Read",
  priceCacheWrite: "Cache Write",
  priceOutput: "Output",
  total: "Total",
  system: "System",
  user: "User",
  agent: "Agent",
  toolCall: "Tool Call",
  toolResult: "Tool Result",
  outputTokens: "Output",
  showPerformance: "Show Performance",
  showPricing: "Show Pricing",
  showTrend: "Show Trend",
  language: "Language",
  auto: "Auto",
  cmdTitleHtml: "HTML Report",
  cmdDescHtml: "Generate interactive HTML dashboard with token usage, cache, and performance charts",
  cmdTitleJson: "JSON Export",
  cmdDescJson: "Export raw usage data as JSON file",
  cmdTitleText: "Text Report",
  cmdDescText: "Generate plain text report file",
  cmdTitleSettings: "Settings",
  cmdDescSettings: "Configure sidebar display options",
  descShowPerformance: "Display TPS, TTFT, latency metrics in sidebar",
  descShowPricing: "Display cost estimates in sidebar",
  descShowTrend: "Display token usage trend in sidebar",
  settingsLanguage: "Language",
  descSettingsLanguage: "Switch display language",
  settingsTitle: "Usage Stat Settings",
  settingsPlaceholder: "Toggle settings...",
  langAuto: "Auto",
  done: "Done",
  closeSettings: "Close settings",
  menuToday: "Today",
  menu7d: "Last 7 Days",
  menu30d: "Last 30 Days",
  menuAll: "All Time",
  menuCurrentSession: "Current Session",
  providerNotConfigured: "Not configured",
  providerRefreshing: "Refreshing\u2026",
  providerError: "Unavailable",
  providerResets: "Resets",
  opencodeGo: "OpenCode Go",
  deepseek: "DeepSeek",
  codex: "Codex"
};
var currentLang = detectLanguage();
function detectLanguage() {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (locale.startsWith("zh")) return "zh";
  } catch {
  }
  return "en";
}
function setLanguage(lang) {
  if (lang === "auto") {
    currentLang = detectLanguage();
  } else {
    currentLang = lang;
  }
}
function t(key) {
  const table = currentLang === "zh" ? zh : en;
  return table[key] ?? key;
}

// src/provider-usage-blocks.tsx
import { createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import { RGBA as RGBA2 } from "@opentui/core";

// src/credentials.ts
import { existsSync as existsSync3, readFileSync as readFileSync3 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { dirname, isAbsolute, join as join3, parse as parsePath } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
function getDataHome() {
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg && xdg.trim()) return xdg.trim();
  return join3(homedir3(), ".local", "share");
}
function credentialDatabasePath() {
  const configured = process.env.OPENCODE_DB?.trim();
  if (configured && isAbsolute(configured)) return configured;
  return join3(getDataHome(), "opencode", configured || "opencode.db");
}
function parseCredentialValue(raw) {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!value || typeof value !== "object") return null;
    const entry = value;
    const metadata = entry.metadata && typeof entry.metadata === "object" ? entry.metadata : null;
    const text = (candidate) => typeof candidate === "string" && candidate.trim() ? candidate : void 0;
    const accountId = text(entry.accountId) ?? text(entry.accountID) ?? text(entry.account_id) ?? text(entry["account-id"]) ?? text(metadata?.accountId) ?? text(metadata?.accountID) ?? text(metadata?.account_id) ?? (entry.account && typeof entry.account === "object" ? text(entry.account.id) ?? text(entry.account.accountId) ?? text(entry.account.account_id) : void 0);
    return {
      type: text(entry.type),
      key: text(entry.key),
      token: text(entry.token),
      access: text(entry.access),
      accountId: accountId ?? null
    };
  } catch {
    return null;
  }
}
function sqliteCredential(aliases) {
  if (aliases.length === 0) return null;
  const path = credentialDatabasePath();
  if (!existsSync3(path)) return null;
  const placeholders = aliases.map(() => "?").join(",");
  const sql = `SELECT integration_id, value, time_updated FROM credential WHERE integration_id IN (${placeholders})`;
  let database;
  try {
    const require2 = createRequire(import.meta.url);
    let rows;
    if (typeof globalThis.Bun !== "undefined") {
      const { Database } = require2("bun:sqlite");
      database = new Database(path, { readonly: true });
      rows = database.query(sql).all(...aliases);
    } else {
      const { DatabaseSync } = require2("node:sqlite");
      database = new DatabaseSync(path, { readOnly: true });
      rows = database.prepare(sql).all(...aliases);
    }
    rows.sort((a, b) => aliases.indexOf(a.integration_id) - aliases.indexOf(b.integration_id) || (b.time_updated ?? 0) - (a.time_updated ?? 0));
    for (const row of rows) {
      const entry = parseCredentialValue(row.value);
      if (entry && isNonEmpty(entry.key ?? entry.token ?? entry.access)) return entry;
    }
  } catch {
    return null;
  } finally {
    try {
      database?.close();
    } catch {
    }
  }
  return null;
}
function parseEnvFile(content) {
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}
function candidateEnvDirs() {
  const dirs = [];
  const home = homedir3();
  if (home && !dirs.includes(home)) dirs.push(home);
  try {
    let dir = process.cwd();
    for (let i = 0; i < 10 && dir; i++) {
      if (!dirs.includes(dir)) dirs.push(dir);
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
  }
  try {
    const winHome = process.env.USERPROFILE;
    if (winHome && winHome.includes(":\\")) {
      const wslHome = inferWslHome(winHome);
      if (wslHome && !dirs.includes(wslHome)) dirs.push(wslHome);
    }
  } catch {
  }
  return dirs;
}
function inferWslHome(winPath) {
  const drive = /^([A-Za-z]):\\(.*)$/.exec(winPath);
  if (!drive) return null;
  const [, letter, rest] = drive;
  const unixRest = rest.replace(/\\/g, "/");
  try {
    const out = execFileSync("wslpath", ["-u", winPath], { encoding: "utf8", timeout: 3e3 }).trim();
    if (out.startsWith("/")) return out;
  } catch {
  }
  return `/mnt/${letter.toLowerCase()}/${unixRest}`;
}
function loadDotEnv() {
  const out = {};
  for (const dir of candidateEnvDirs()) {
    const file = join3(dir, ".env");
    try {
      if (!existsSync3(file)) continue;
      const parsed = parseEnvFile(readFileSync3(file, "utf8"));
      for (const [k, v] of Object.entries(parsed)) {
        if (!(k in out)) out[k] = v;
      }
    } catch {
    }
  }
  return out;
}
function isNonEmpty(s) {
  return typeof s === "string" && s.trim().length > 0;
}
function resolveCredential(opts) {
  const entry = sqliteCredential(opts.aliases);
  if (entry) {
    const value = entry.key ?? entry.token ?? entry.access ?? null;
    if (isNonEmpty(value)) {
      return { value, accountId: isNonEmpty(entry.accountId) ? entry.accountId : null, source: "sqlite" };
    }
  }
  for (const key of opts.envKeys) {
    const v = process.env[key];
    if (isNonEmpty(v)) {
      return { value: v, accountId: null, source: "env" };
    }
  }
  const dot = loadDotEnv();
  for (const key of opts.envKeys) {
    const v = dot[key];
    if (isNonEmpty(v)) {
      return { value: v, accountId: null, source: "dotenv" };
    }
  }
  return { value: null, accountId: null, source: null };
}

// src/provider-usage.ts
var PROVIDER_TIMEOUT_MS = 15e3;
function fetchWithTimeout(url, init, fetchImpl, timeoutMs = PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetchImpl(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}
function parseError(body) {
  if (!body) return null;
  try {
    const data = JSON.parse(body);
    const msg = data?.error?.message ?? data?.message ?? data?.detail;
    if (typeof msg === "string" && msg.trim()) return msg.slice(0, 200);
  } catch {
  }
  return null;
}
function fmtNum(n) {
  if (!Number.isFinite(n)) return "0";
  return String(n);
}
var OPENCODE_GO_ALIASES = ["opencode-go", "opencode", "zen"];
var OPENCODE_GO_ENV_KEYS = ["OPENCODE_GO_API_KEY", "OPENCODE_API_KEY"];
var OPENCODE_GO_URL = "https://opencode.ai/zen/go/v1/usage";
function parseOpenCodeGoUsage(payload) {
  const usage = (payload && typeof payload === "object" ? payload.usage : null) ?? null;
  if (!usage || typeof usage !== "object") return [];
  const out = [];
  const order = [
    ["rolling", "Rolling"],
    ["weekly", "Weekly"],
    ["monthly", "Monthly"]
  ];
  for (const [key, label] of order) {
    const entry = usage[key];
    if (!entry || typeof entry !== "object") continue;
    const percent = entry.percent;
    if (typeof percent !== "number" || !Number.isFinite(percent)) continue;
    const resetsAt = typeof entry.resetsAt === "string" ? entry.resetsAt : null;
    if (resetsAt != null && !Number.isFinite(new Date(resetsAt).getTime())) continue;
    out.push({
      label,
      percent: Math.min(100, Math.max(0, percent)),
      resetsAt,
      valueLabel: `${percent.toFixed(1)}% used`
    });
  }
  return out;
}
async function fetchOpenCodeGoUsage(apiKey, fetchImpl = fetch) {
  const response = await fetchWithTimeout(
    OPENCODE_GO_URL,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "opencode-usage-stat"
      }
    },
    fetchImpl
  );
  if (response.status === 401 || response.status === 403) {
    throw new Error("OpenCode Go authentication failed");
  }
  if (!response.ok) {
    throw new Error(`OpenCode Go usage API returned HTTP ${response.status}`);
  }
  const windows = parseOpenCodeGoUsage(await response.json().catch(() => null));
  if (windows.length === 0) throw new Error("OpenCode Go usage data could not be parsed");
  return windows;
}
var DEEPSEEK_ALIASES = ["deepseek"];
var DEEPSEEK_ENV_KEYS = ["DEEPSEEK_API_KEY"];
var DEEPSEEK_URL = "https://api.deepseek.com/user/balance";
function parseDeepSeekBalance(payload) {
  const data = payload && typeof payload === "object" ? payload : null;
  const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : [];
  const pick = infos.find((i) => i?.currency === "USD") ?? infos.find((i) => i?.currency === "CNY") ?? null;
  if (!pick) return [];
  const raw = pick.total_balance;
  const balance = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(balance)) return [];
  const isCny = pick.currency === "CNY";
  const symbol = isCny ? "\xA5" : "$";
  return [{
    label: "Balance",
    percent: null,
    resetsAt: null,
    valueLabel: `${symbol}${balance.toFixed(2)}${isCny ? " CNY" : ""}`
  }];
}
async function fetchDeepSeekBalance(apiKey, fetchImpl = fetch) {
  const response = await fetchWithTimeout(
    DEEPSEEK_URL,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Accept-Encoding": "identity"
      }
    },
    fetchImpl
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const parsed = parseError(body);
    if (response.status === 401 || response.status === 403) {
      throw new Error("DeepSeek session expired \u2014 re-authenticate");
    }
    throw new Error(parsed ?? `DeepSeek API error: ${response.status}`);
  }
  const windows = parseDeepSeekBalance(await response.json().catch(() => null));
  if (windows.length === 0) throw new Error("DeepSeek balance data could not be parsed");
  return windows;
}
var CODEX_ALIASES = ["openai", "codex", "chatgpt"];
var CODEX_ENV_KEYS = [];
var CODEX_URL = "https://chatgpt.com/backend-api/wham/usage";
function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}
function windowLabelFromSeconds(seconds) {
  if (seconds == null) return "Window";
  const hours = seconds / 3600;
  if (hours >= 24 && hours % 24 === 0) return `${hours / 24}d`;
  if (hours >= 1) return `${hours}h`;
  return `${seconds}s`;
}
function toResetTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 1e10 ? value * 1e3 : value;
    return new Date(milliseconds).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return toResetTimestamp(numeric);
    const milliseconds = Date.parse(value);
    if (Number.isFinite(milliseconds)) return new Date(milliseconds).toISOString();
  }
  return null;
}
function parseCodexUsage(payload) {
  const data = payload && typeof payload === "object" ? payload : null;
  if (!data) return [];
  const out = [];
  const primary = data.rate_limit?.primary_window;
  if (primary) {
    const percent = toNumber(primary.used_percent);
    const seconds = toNumber(primary.limit_window_seconds);
    out.push({
      label: windowLabelFromSeconds(seconds),
      percent: percent != null ? Math.min(100, Math.max(0, percent)) : null,
      resetsAt: toResetTimestamp(primary.reset_at),
      valueLabel: percent != null ? `${percent.toFixed(1)}% used` : null
    });
  }
  const secondary = data.rate_limit?.secondary_window;
  if (secondary) {
    const percent = toNumber(secondary.used_percent);
    const seconds = toNumber(secondary.limit_window_seconds);
    out.push({
      label: windowLabelFromSeconds(seconds),
      percent: percent != null ? Math.min(100, Math.max(0, percent)) : null,
      resetsAt: toResetTimestamp(secondary.reset_at),
      valueLabel: percent != null ? `${percent.toFixed(1)}% used` : null
    });
  }
  if (data.credits) {
    const balance = toNumber(data.credits.balance);
    const unlimited = Boolean(data.credits.unlimited);
    out.push({
      label: "Credits",
      percent: null,
      resetsAt: null,
      valueLabel: unlimited ? "Unlimited" : balance != null ? `$${balance.toFixed(2)}` : null
    });
  }
  if (data.spend_control?.individual_limit) {
    const sl = data.spend_control.individual_limit;
    const used = toNumber(sl.used);
    const limit = toNumber(sl.limit);
    const percent = toNumber(sl.used_percent);
    out.push({
      label: "Spend Limit",
      percent: percent != null ? Math.min(100, Math.max(0, percent)) : null,
      resetsAt: null,
      valueLabel: used != null && limit != null ? `${fmtNum(used)} / ${fmtNum(limit)} used` : null
    });
  }
  return out;
}
async function fetchCodexUsage(accessToken, accountId, fetchImpl = fetch) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  };
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;
  const response = await fetchWithTimeout(CODEX_URL, { method: "GET", headers }, fetchImpl);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const parsed = parseError(body);
    if (response.status === 401) {
      throw new Error("Codex session expired \u2014 re-authenticate with OpenAI");
    }
    throw new Error(parsed ?? `Codex API error: ${response.status}`);
  }
  const windows = parseCodexUsage(await response.json().catch(() => null));
  if (windows.length === 0) throw new Error("Codex usage data could not be parsed");
  return windows;
}
var PROVIDERS = [
  { id: "opencode-go", name: "OpenCode Go", aliases: OPENCODE_GO_ALIASES, envKeys: OPENCODE_GO_ENV_KEYS },
  { id: "deepseek", name: "DeepSeek", aliases: DEEPSEEK_ALIASES, envKeys: DEEPSEEK_ENV_KEYS },
  { id: "codex", name: "Codex", aliases: CODEX_ALIASES, envKeys: CODEX_ENV_KEYS }
];
var USAGE_STAT_PROVIDER_IDS = PROVIDERS.map((p) => p.id);
var defaultCredentialResolver = (spec) => resolveCredential(spec);
async function checkProviderUsage(providerId, fetchImpl = fetch, getCredential = defaultCredentialResolver) {
  const spec = PROVIDERS.find((p) => p.id === providerId);
  if (!spec) return { providerId, providerName: providerId, configured: false, ok: false, status: "Unknown provider" };
  const resolved = getCredential({ aliases: spec.aliases, envKeys: spec.envKeys });
  const secret = resolved.value;
  if (!secret) {
    return {
      providerId: spec.id,
      providerName: spec.name,
      configured: false,
      ok: false,
      status: `${spec.name} \u2014 not configured`,
      error: "Not configured"
    };
  }
  try {
    let windows;
    if (spec.id === "opencode-go") {
      windows = await fetchOpenCodeGoUsage(secret, fetchImpl);
    } else if (spec.id === "deepseek") {
      windows = await fetchDeepSeekBalance(secret, fetchImpl);
    } else {
      windows = await fetchCodexUsage(secret, resolved.accountId, fetchImpl);
    }
    return {
      providerId: spec.id,
      providerName: spec.name,
      configured: true,
      ok: true,
      status: summarize(spec.name, windows),
      windows
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    return {
      providerId: spec.id,
      providerName: spec.name,
      configured: true,
      ok: false,
      status: `${spec.name} \u2014 ${message}`,
      error: message
    };
  }
}
function summarize(name, windows) {
  const first = windows[0];
  if (!first) return `${name} \u2014 no data`;
  if (first.valueLabel) {
    if (first.resetsAt) {
      return `${name} \u2014 ${first.valueLabel} \xB7 resets ${formatReset(first.resetsAt)}`;
    }
    return `${name} \u2014 ${first.valueLabel}`;
  }
  if (first.percent != null) {
    const suffix = first.resetsAt ? ` \xB7 resets ${formatReset(first.resetsAt)}` : "";
    return `${name} \u2014 ${first.percent.toFixed(0)}%${suffix}`;
  }
  return name;
}
function formatReset(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const now = Date.now();
  const diff = d.getTime() - now;
  if (diff <= 0) return "soon";
  const hours = diff / 36e5;
  if (hours < 48 && hours > 24) return `${Math.round(hours / 24)}d`;
  if (hours < 24) {
    const mins = Math.max(1, Math.round(diff / 6e4));
    if (mins < 60) return `${mins}m`;
    return `${Math.round(hours)}h`;
  }
  return `${Math.round(hours / 24)}d`;
}
function resolveProviderUsageConfig(options) {
  const source = options && typeof options === "object" ? options.providerUsage : null;
  const value = source && typeof source === "object" ? source : {};
  return {
    "opencode-go": value["opencode-go"] === true,
    deepseek: value.deepseek === true,
    codex: value.codex === true
  };
}

// src/provider-collapse.ts
var PROVIDER_IDS = ["opencode-go", "deepseek", "codex"];

// src/theme-map.ts
import { RGBA } from "@opentui/core";
function resolveThemeColors(theme) {
  const primary = theme.text?.default ?? RGBA.fromInts(200, 210, 230, 255);
  const muted = theme.text?.subdued ?? RGBA.fromInts(140, 150, 170, 255);
  const dim = RGBA.fromInts(100, 108, 122, 255);
  const green = theme.text?.feedback?.success?.default ?? RGBA.fromInts(63, 185, 80, 255);
  const red = theme.text?.feedback?.error?.default ?? RGBA.fromInts(244, 67, 54, 255);
  const amber = theme.text?.feedback?.warning?.default ?? RGBA.fromInts(255, 193, 7, 255);
  const purple = RGBA.fromInts(180, 120, 255, 255);
  const cyan = RGBA.fromInts(80, 190, 255, 255);
  const border = theme.border?.default ?? RGBA.fromInts(55, 65, 80, 255);
  return { primary, muted, dim, green, red, amber, purple, cyan, border };
}

// src/provider-usage-blocks.tsx
var PROVIDER_NAMES = {
  "opencode-go": "OpenCode Go",
  deepseek: "DeepSeek",
  codex: "Codex"
};
var REFRESH_MS = 2 * 60 * 1e3;
var PROVIDER_COLORS = {
  "opencode-go": RGBA2.fromInts(80, 190, 255, 255),
  deepseek: RGBA2.fromInts(78, 140, 255, 255),
  codex: RGBA2.fromInts(205, 130, 255, 255)
};
function ProviderUsageBlocks(props) {
  const { context } = props;
  const enabledIds = PROVIDER_IDS.filter((id) => resolveProviderUsageConfig(context.options)[id]);
  const colors = resolveThemeColors(context.theme);
  const primaryColor = () => colors.primary;
  const mutedColor = () => colors.muted;
  const dimColor = () => colors.dim;
  const greenColor = () => colors.green;
  const redColor = () => colors.red;
  const amberColor = () => colors.amber;
  const cyanColor = () => colors.cyan;
  const [states, setStates] = createSignal(
    enabledIds.map((id) => ({ id, collapsed: true, loading: false, result: null }))
  );
  async function refreshOne(id) {
    setStates((prev) => prev.map((s) => s.id === id ? { ...s, loading: true } : s));
    const result = await checkProviderUsage(id);
    setStates((prev) => prev.map((state) => {
      if (state.id !== id) return state;
      return { ...state, loading: false, result };
    }));
  }
  function initialRefresh() {
    for (const id of enabledIds) {
      void refreshOne(id);
    }
  }
  createEffect(() => {
    if (enabledIds.length === 0) return;
    initialRefresh();
    const timers = [];
    for (const id of enabledIds) {
      timers.push(setInterval(() => {
        void refreshOne(id);
      }, REFRESH_MS));
    }
    onCleanup(() => {
      for (const timer of timers) clearInterval(timer);
    });
  });
  function toggle(id) {
    setStates((prev) => prev.map((s) => s.id === id ? { ...s, collapsed: !s.collapsed } : s));
  }
  function statusColor(s) {
    if (s.loading) return mutedColor();
    if (!s.result) return dimColor();
    if (!s.result.ok) return redColor();
    const first = s.result.windows?.[0];
    if (first?.percent != null) {
      if (first.percent >= 90) return redColor();
      if (first.percent >= 70) return amberColor();
      return greenColor();
    }
    return greenColor();
  }
  function percentBar(percent, width) {
    const filled = Math.max(0, Math.min(width, Math.floor(percent / 100 * width)));
    return "\u2588".repeat(filled) + "\u2591".repeat(Math.max(0, width - filled));
  }
  function formatReset2(iso) {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    const diff = d.getTime() - Date.now();
    if (diff <= 0) return "now";
    const mins = Math.round(diff / 6e4);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 48) return `${hours}h`;
    return `${Math.round(hours / 24)}d`;
  }
  return <Show when={states().length > 0}>
      <box flexDirection="column" marginTop={1} paddingX={1}>
      <For each={states()}>
        {(state) => {
    const isOpen = () => !state.collapsed;
    const color = () => statusColor(state);
    const dot = () => {
      if (state.loading) return "\u25CC";
      if (!state.result) return "\u25CB";
      if (!state.result.ok) return "\u25CF";
      const first = state.result.windows?.[0];
      if (first == null) return "\u25CF";
      if (first.percent == null) return "\u25C6";
      return "\u25CF";
    };
    const headerText = () => {
      if (state.loading) return `${t("providerRefreshing")}\u2026`;
      const first = state.result?.windows?.[0];
      if (state.result?.ok && first?.percent != null) return `${first.percent.toFixed(0)}% used`;
      if (state.result?.ok && first?.valueLabel) return first.valueLabel;
      const status = state.result?.status ?? t("providerNotConfigured");
      const prefix = `${PROVIDER_NAMES[state.id]} \u2014 `;
      return status.startsWith(prefix) ? status.slice(prefix.length) : status;
    };
    return <box flexDirection="column">
              <box flexDirection="row" justifyContent="space-between" gap={1} onMouseDown={() => toggle(state.id)} paddingX={0}>
                <text fg={PROVIDER_COLORS[state.id] ?? cyanColor()}>
                  <span style={{ fg: color() }}>{dot()}</span>{" "}
                  <span style={{ fg: primaryColor() }}>{PROVIDER_NAMES[state.id]}</span>
                  {isOpen() ? " \u25BE" : " \u25B8"}
                </text>
                <text fg={mutedColor()}>
                  {headerText().length > 32 ? headerText().slice(0, 31) + "\u2026" : headerText()}
                </text>
              </box>

              <Show when={isOpen()}>
                <box flexDirection="column" paddingX={1} marginTop={0}>
                  <Show when={state.loading && !state.result}>
                    <text fg={mutedColor()}>{t("providerRefreshing")}…</text>
                  </Show>

                  <Show when={!state.loading && !state.result}>
                    <text fg={mutedColor()}>—</text>
                  </Show>

                  <Show when={state.result !== null && !state.result.ok}>
                    <text fg={redColor()}>{state.result.status}</text>
                    <Show when={state.result !== null && !state.result.configured}>
                      <text fg={dimColor()}>enable via plugin config: providerUsage.&lt;id&gt; = true</text>
                    </Show>
                  </Show>

                  <Show when={state.result !== null && state.result.ok && state.result.windows}>
                    <For each={state.result.windows}>
                      {(win) => {
      const label = win.label ? win.label + ": " : "";
      if (win.percent != null) {
        return <text fg={mutedColor()}>
                              {label}
                              <span style={{ fg: statusColor(state) }}>
                                {percentBar(win.percent, 12)} {win.percent.toFixed(0)}%
                              </span>
                              {win.resetsAt ? <span style={{ fg: dimColor() }}> · {t("providerResets")} {formatReset2(win.resetsAt)}</span> : null}
                            </text>;
      }
      if (win.valueLabel) {
        return <text fg={mutedColor()}>
                              {label}
                              <span style={{ fg: greenColor() }}>{win.valueLabel}</span>
                            </text>;
      }
      return <text fg={mutedColor()}>{label}—</text>;
    }}
                    </For>
                  </Show>
                </box>
              </Show>
            </box>;
  }}
      </For>
      </box>
    </Show>;
}

// src/queries.ts
var client = null;
function setV2Client(c) {
  client = c;
}
function requireClient() {
  if (!client) throw new Error("Usage Stat client is not initialized (setV2Client not called)");
  return client;
}
async function fetchAllSessions(limit = 500) {
  const c = requireClient();
  const all = [];
  let cursor;
  for (; ; ) {
    const res = await c.session.list({ limit, cursor });
    const page = res?.data;
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    const next = res?.cursor?.next;
    if (!next) break;
    cursor = next;
  }
  return all;
}
async function fetchAllMessages(sessionID, limit = 1e3) {
  const c = requireClient();
  const all = [];
  let cursor;
  for (; ; ) {
    const res = await c.message.list({ sessionID, limit, order: "asc", cursor });
    const page = res?.data;
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    const next = res?.cursor?.next;
    if (!next) break;
    cursor = next;
  }
  return all;
}
function asAssistant(m, sessionID) {
  if (!m || typeof m !== "object" || m.type !== "assistant") return null;
  const a = m;
  const tokens = a.tokens;
  if (!tokens || typeof tokens !== "object") return null;
  const input = tokens.input ?? 0;
  const output = tokens.output ?? 0;
  const reasoning = tokens.reasoning ?? 0;
  const cacheRead = tokens.cache?.read ?? 0;
  const cacheWrite = tokens.cache?.write ?? 0;
  return {
    sessionID,
    providerID: a.model?.providerID ?? "unknown",
    modelID: a.model?.id ?? "unknown",
    messageID: a.id,
    role: "assistant",
    created: a.time?.created ?? 0,
    completed: a.time?.completed,
    cost: a.cost ?? 0,
    tokens: {
      input,
      output,
      reasoning,
      cacheRead,
      cacheWrite,
      total: input + output + reasoning + cacheRead + cacheWrite
    }
  };
}
function isValidDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function toLocalDay(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function matchesFilters(a, filters) {
  if (filters.sessionIds && filters.sessionIds.length > 0 && !filters.sessionIds.includes(a.sessionID)) return false;
  if (filters.sessionId && a.sessionID !== filters.sessionId) return false;
  if (filters.provider && a.providerID !== filters.provider) return false;
  if (filters.model && a.modelID !== filters.model) return false;
  if (a.created != null) {
    const day = toLocalDay(a.created);
    if (filters.startDate && isValidDate(filters.startDate) && day < filters.startDate) return false;
    if (filters.endDate && isValidDate(filters.endDate) && day > filters.endDate) return false;
  }
  return true;
}
async function loadAssistants(filters = {}) {
  const sessions = await fetchAllSessions();
  const out = [];
  for (const s of sessions) {
    let msgs;
    try {
      msgs = await fetchAllMessages(s.id);
    } catch {
      continue;
    }
    for (const m of msgs) {
      const a = asAssistant(m, s.id);
      if (!a) continue;
      if (a.tokens.total <= 0) continue;
      if (!matchesFilters(a, filters)) continue;
      out.push(a);
    }
  }
  return out;
}
function toSessionTokenData(assistants) {
  const models = /* @__PURE__ */ new Set();
  const providers = /* @__PURE__ */ new Set();
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let totalCost = 0;
  for (const a of assistants) {
    const t2 = a.tokens;
    totalTokens += t2.total;
    inputTokens += t2.input;
    outputTokens += t2.output;
    reasoningTokens += t2.reasoning;
    cacheRead += t2.cacheRead;
    cacheWrite += t2.cacheWrite;
    totalCost += a.cost;
    models.add(a.modelID);
    providers.add(a.providerID);
  }
  const modelsArray = Array.from(models);
  return {
    model: modelsArray.length === 1 ? modelsArray[0] : "",
    provider: providers.size === 1 ? Array.from(providers)[0] : "",
    modelsUsed: modelsArray,
    totalTokens,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheRead,
    cacheWrite,
    totalCost,
    requestCount: assistants.length
  };
}
async function getSummary(filters = {}) {
  return toSessionTokenData(await loadAssistants(filters));
}
async function getModelBreakdown(filters = {}) {
  const assistants = await loadAssistants(filters);
  const map = /* @__PURE__ */ new Map();
  const sessionSet = /* @__PURE__ */ new Set();
  for (const a of assistants) {
    const key = `${a.providerID ?? "unknown"}|${a.modelID ?? "unknown"}`;
    const t2 = a.tokens;
    let item = map.get(key);
    if (!item) {
      item = {
        provider: a.providerID ?? "unknown",
        model: a.modelID ?? "unknown",
        requests: 0,
        sessions: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalCost: 0
      };
      map.set(key, item);
    }
    item.requests++;
    item.totalTokens += t2.total;
    item.inputTokens += t2.input;
    item.outputTokens += t2.output;
    item.reasoningTokens += t2.reasoning;
    item.cacheRead += t2.cacheRead;
    item.cacheWrite += t2.cacheWrite;
    item.totalCost += a.cost;
    sessionSet.add(`${key}|${a.sessionID}`);
  }
  for (const s of sessionSet) {
    const [provider, model] = s.split("|");
    const item = map.get(`${provider}|${model}`);
    if (item) item.sessions++;
  }
  return Array.from(map.values()).sort((a, b) => b.totalTokens - a.totalTokens);
}
async function getProviderBreakdown(filters = {}) {
  const assistants = await loadAssistants(filters);
  const map = /* @__PURE__ */ new Map();
  const sessionSet = /* @__PURE__ */ new Set();
  for (const a of assistants) {
    const key = a.providerID ?? "unknown";
    const t2 = a.tokens;
    let item = map.get(key);
    if (!item) {
      item = {
        provider: key,
        requests: 0,
        sessions: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheRead: 0,
        totalCost: 0
      };
      map.set(key, item);
    }
    item.requests++;
    item.totalTokens += t2.total;
    item.inputTokens += t2.input;
    item.outputTokens += t2.output;
    item.reasoningTokens += t2.reasoning;
    item.cacheRead += t2.cacheRead;
    item.totalCost += a.cost;
    sessionSet.add(`${key}|${a.sessionID}`);
  }
  for (const s of sessionSet) {
    const [provider] = s.split("|");
    const item = map.get(provider);
    if (item) item.sessions++;
  }
  return Array.from(map.values()).sort((a, b) => b.totalTokens - a.totalTokens);
}
async function getDailyBreakdown(filters = {}) {
  const limit = filters.limit ?? 90;
  const assistants = await loadAssistants(filters);
  const map = /* @__PURE__ */ new Map();
  const sessionSet = /* @__PURE__ */ new Set();
  for (const a of assistants) {
    const day = a.created != null ? toLocalDay(a.created) : "unknown";
    const t2 = a.tokens;
    let item = map.get(day);
    if (!item) {
      item = {
        day,
        requests: 0,
        sessions: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheRead: 0,
        totalCost: 0
      };
      map.set(day, item);
    }
    item.requests++;
    item.totalTokens += t2.total;
    item.inputTokens += t2.input;
    item.outputTokens += t2.output;
    item.reasoningTokens += t2.reasoning;
    item.cacheRead += t2.cacheRead;
    item.totalCost += a.cost;
    sessionSet.add(`${day}|${a.sessionID}`);
  }
  for (const s of sessionSet) {
    const [day] = s.split("|");
    const item = map.get(day);
    if (item) item.sessions++;
  }
  return Array.from(map.values()).sort((a, b) => a.day < b.day ? 1 : -1).slice(0, Math.max(1, limit));
}
async function getSessionBreakdown(filters = {}) {
  const limit = filters.limit ?? 15;
  const sessions = await fetchAllSessions();
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const assistants = await loadAssistants(filters);
  const map = /* @__PURE__ */ new Map();
  for (const a of assistants) {
    let item = map.get(a.sessionID);
    const t2 = a.tokens;
    if (!item) {
      const s = byId.get(a.sessionID);
      const first = s?.model;
      item = {
        sessionId: a.sessionID,
        title: s?.title ?? "(untitled)",
        provider: a.providerID ?? "unknown",
        model: a.modelID ?? first?.id ?? "unknown",
        requests: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheRead: 0,
        totalCost: 0,
        day: a.created != null ? toLocalDay(a.created) : ""
      };
      map.set(a.sessionID, item);
    }
    item.requests++;
    item.totalTokens += t2.total;
    item.inputTokens += t2.input;
    item.outputTokens += t2.output;
    item.reasoningTokens += t2.reasoning;
    item.cacheRead += t2.cacheRead;
    item.totalCost += a.cost;
    if (a.created != null) {
      const day = toLocalDay(a.created);
      if (day > item.day) item.day = day;
    }
  }
  return Array.from(map.values()).sort((a, b) => a.day < b.day ? 1 : -1).slice(0, Math.max(1, limit));
}
async function getChildSessionIds(parentSessionId) {
  try {
    const sessions = await fetchAllSessions();
    const direct = sessions.filter((s) => s.parentID === parentSessionId).map((s) => s.id);
    const out = [...direct];
    for (const id of direct) {
      try {
        out.push(...await getChildSessionIds(id));
      } catch {
      }
    }
    return Array.from(new Set(out));
  } catch {
    return [];
  }
}
async function getMessageDetails(sessionId) {
  const childIds = await getChildSessionIds(sessionId);
  const allIds = [sessionId, ...childIds];
  const filters = { sessionIds: allIds };
  const assistants = await loadAssistants(filters);
  return assistants.sort((a, b) => a.created - b.created).map((a) => ({
    messageId: a.messageID,
    model: a.modelID ?? "unknown",
    provider: a.providerID ?? "unknown",
    inputTokens: a.tokens.input,
    outputTokens: a.tokens.output,
    reasoningTokens: a.tokens.reasoning,
    cacheRead: a.tokens.cacheRead,
    cacheWrite: a.tokens.cacheWrite,
    totalTokens: a.tokens.total,
    cost: a.cost,
    timeCreated: a.created,
    timeCompleted: a.completed ?? null
  }));
}
async function getSessionTitle(sessionId) {
  const c = requireClient();
  try {
    const s = await c.session.get({ sessionID: sessionId });
    return s?.title ?? "(untitled)";
  } catch {
    return "(untitled)";
  }
}
async function getErrorStats(filters = {}) {
  const sessions = await fetchAllSessions();
  let successCount = 0;
  let failedCount = 0;
  const byModelMap = /* @__PURE__ */ new Map();
  for (const s of sessions) {
    let msgs;
    try {
      msgs = await fetchAllMessages(s.id);
    } catch {
      continue;
    }
    for (const m of msgs) {
      if (m?.type !== "assistant") continue;
      const a = asAssistant(m, s.id);
      if (!a) continue;
      if (!matchesFilters(a, filters)) continue;
      const key = `${a.providerID}|${a.modelID}`;
      let row = byModelMap.get(key);
      if (!row) {
        row = { provider: a.providerID, model: a.modelID, failed: 0, total: 0 };
        byModelMap.set(key, row);
      }
      row.total++;
      if (a.tokens.total === 0) {
        row.failed++;
        failedCount++;
      } else {
        successCount++;
      }
    }
  }
  const byModel = Array.from(byModelMap.values()).sort((a, b) => b.failed - a.failed);
  const errorRate = successCount + failedCount > 0 ? failedCount / (successCount + failedCount) : 0;
  return { successCount, failedCount, errorRate, byModel };
}
async function getHourlyHeatmap(filters = {}) {
  const assistants = await loadAssistants(filters);
  const map = /* @__PURE__ */ new Map();
  for (const a of assistants) {
    const created = a.created;
    if (created == null) continue;
    const d = new Date(created);
    const dow = d.getDay();
    const hour = d.getHours();
    const key = `${dow}|${hour}`;
    let item = map.get(key);
    if (!item) {
      item = { dow, hour, requests: 0, totalTokens: 0, totalCost: 0 };
      map.set(key, item);
    }
    item.requests++;
    item.totalTokens += a.tokens.total;
    item.totalCost += a.cost;
  }
  return Array.from(map.values());
}
async function getUsageReport(filters = {}) {
  const [summary, models, providers, daily, sessions, errors] = await Promise.all([
    getSummary(filters),
    getModelBreakdown(filters),
    getProviderBreakdown(filters),
    getDailyBreakdown(filters),
    getSessionBreakdown(filters),
    getErrorStats(filters)
  ]);
  return { filters, summary, models, providers, daily, sessions, errors };
}

// src/pricing.ts
import { readFileSync as readFileSync4, writeFileSync as writeFileSync3, existsSync as existsSync4 } from "node:fs";
import { join as join4 } from "node:path";
import { homedir as homedir4 } from "node:os";
import { execSync } from "node:child_process";
var PRICING_PATH = join4(homedir4(), ".opencode", "usage-stat-pricing.json");
var MODELS_DEV_URL = "https://models.dev/api.json";
var MISSING_HIT_RATE = 0.94;
var CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
var MODEL_PREFIX_MAP = [
  // DeepSeek
  { prefix: "deepseek-v4-pro", provider: "deepseek" },
  { prefix: "deepseek-v4-flash", provider: "deepseek" },
  { prefix: "deepseek-v3", provider: "deepseek" },
  // GLM (Zhipu)
  { prefix: "glm-5.2", provider: "zhipuai" },
  { prefix: "glm-5.1", provider: "zhipuai" },
  { prefix: "glm-5", provider: "zhipuai" },
  { prefix: "glm-4", provider: "zhipuai" },
  // Kimi (Moonshot)
  { prefix: "kimi-k3", provider: "moonshotai" },
  { prefix: "kimi-k2.7", provider: "moonshotai" },
  { prefix: "kimi-k2.6", provider: "moonshotai" },
  { prefix: "kimi-k2.5", provider: "moonshotai" },
  { prefix: "kimi-k2", provider: "moonshotai" },
  // OpenAI
  { prefix: "gpt-5.6", provider: "openai" },
  { prefix: "gpt-5.5", provider: "openai" },
  { prefix: "gpt-5", provider: "openai" },
  // Qwen (Alibaba)
  { prefix: "qwen3.7", provider: "alibaba-cn" },
  { prefix: "qwen3.6", provider: "alibaba-cn" },
  { prefix: "qwen3.5", provider: "alibaba-cn" },
  { prefix: "qwen3", provider: "alibaba-cn" },
  // Doubao - models.dev has no official volcengine provider, use nano-gpt proxy pricing
  { prefix: "doubao-seed-2-0-pro", provider: "nano-gpt" },
  { prefix: "doubao-seed-2-1-pro", provider: "nano-gpt" },
  { prefix: "doubao-seed", provider: "nano-gpt" },
  // MiniMax
  { prefix: "minimax-m", provider: "opencode-go" },
  // MiMo
  { prefix: "mimo-v2", provider: "opencode-go" },
  // Hy3
  { prefix: "hy3", provider: "opencode-go" }
];
function resolveOfficialProvider(modelID) {
  let best = null;
  for (const entry of MODEL_PREFIX_MAP) {
    if (modelID.startsWith(entry.prefix)) {
      if (!best || entry.prefix.length > best.prefix.length) best = entry;
    }
  }
  return best?.provider ?? null;
}
var VIRTUAL_PREFIX_MAP = {
  "oc-": ["opencode-go"],
  "ds-": ["deepseek"],
  "ol-": []
  // Ollama Cloud – typically free, no pricing needed
};
function stripVirtualPrefix(modelID) {
  for (const prefix of Object.keys(VIRTUAL_PREFIX_MAP)) {
    if (modelID.startsWith(prefix)) return modelID.slice(prefix.length);
  }
  return modelID;
}
function tokenizeModelID(id) {
  return id.toLowerCase().split(/[-_.]+/).filter((t2) => t2.length >= 2);
}
function fuzzyLookupPricing(modelID) {
  const queryTokens = tokenizeModelID(modelID);
  if (queryTokens.length === 0) return null;
  const pricing = getPricing();
  let bestKey = null;
  let bestScore = 0;
  for (const key of Object.keys(pricing.models)) {
    const slashIdx = key.indexOf("/");
    if (slashIdx === -1) continue;
    const provider = key.slice(0, slashIdx);
    const candidate = key.slice(slashIdx + 1);
    const candTokens = tokenizeModelID(candidate);
    let hits = 0;
    for (const qt of queryTokens) {
      if (candTokens.some((ct) => ct === qt || ct.includes(qt) || qt.includes(ct))) {
        hits++;
      }
    }
    const score = hits / queryTokens.length;
    const boost = provider === "opencode-go" || provider === "deepseek" || provider === "zhipuai" || provider === "moonshotai" || provider === "alibaba-cn" ? 5e-3 : 0;
    if (score + boost > bestScore && score >= 0.5) {
      bestScore = score + boost;
      bestKey = key;
    }
  }
  return bestKey ? { key: bestKey, pricing: pricing.models[bestKey] } : null;
}
function fetchAndCachePricing() {
  try {
    const tmpJson = execSync(`curl -s "${MODELS_DEV_URL}"`, {
      timeout: 3e4,
      encoding: "utf-8",
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024
    });
    const apiData = JSON.parse(tmpJson);
    const models = {};
    for (const [providerID, providerVal] of Object.entries(apiData)) {
      const providerModels = providerVal?.models;
      if (typeof providerModels !== "object" || !providerModels) continue;
      for (const [modelID, modelVal] of Object.entries(providerModels)) {
        const cost = modelVal?.cost;
        if (!cost) continue;
        const key = `${providerID}/${modelID}`;
        models[key] = {
          input: cost.input,
          output: cost.output,
          reasoning: cost.reasoning,
          cache_read: cost.cache_read,
          cache_write: cost.cache_write
        };
      }
    }
    const cache = {
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      models
    };
    writeFileSync3(PRICING_PATH, JSON.stringify(cache), "utf-8");
    return cache;
  } catch {
    return loadCachedPricing();
  }
}
function loadCachedPricing() {
  try {
    if (existsSync4(PRICING_PATH)) {
      const content = readFileSync4(PRICING_PATH, "utf-8");
      return JSON.parse(content);
    }
  } catch {
  }
  return { fetchedAt: "", models: {} };
}
var pricingCache = null;
function getPricing() {
  if (pricingCache) return pricingCache;
  const cached = loadCachedPricing();
  const now = Date.now();
  const fetchedAt = cached.fetchedAt ? new Date(cached.fetchedAt).getTime() : 0;
  if (cached.models && Object.keys(cached.models).length > 0 && now - fetchedAt < CACHE_TTL_MS) {
    pricingCache = cached;
  } else {
    pricingCache = fetchAndCachePricing();
  }
  return pricingCache;
}
function lookupPricing(providerID, modelID) {
  const pricing = getPricing();
  const directKey = `${providerID}/${modelID}`;
  if (pricing.models[directKey]) return pricing.models[directKey];
  const stripped = stripVirtualPrefix(modelID);
  if (stripped !== modelID) {
    const strippedKey = `${providerID}/${stripped}`;
    if (pricing.models[strippedKey]) return pricing.models[strippedKey];
    const mappedProviders = VIRTUAL_PREFIX_MAP[Object.keys(VIRTUAL_PREFIX_MAP).find((p) => modelID.startsWith(p)) ?? ""] ?? [];
    for (const up of mappedProviders) {
      const upstreamKey = `${up}/${stripped}`;
      if (pricing.models[upstreamKey]) return pricing.models[upstreamKey];
    }
  }
  const officialProvider = resolveOfficialProvider(stripped);
  if (officialProvider) {
    const officialKey = `${officialProvider}/${stripped}`;
    if (pricing.models[officialKey]) return pricing.models[officialKey];
    const officialKeyOrig = `${officialProvider}/${modelID}`;
    if (pricing.models[officialKeyOrig]) return pricing.models[officialKeyOrig];
  }
  const fuzzy = fuzzyLookupPricing(stripped);
  if (fuzzy) return fuzzy.pricing;
  return null;
}
function estimateApiCost(providerID, modelID, requestCount, inputTokens, outputTokens, reasoningTokens, cacheRead, cacheWrite) {
  const model = `${providerID}/${modelID}`;
  const pricing = lookupPricing(providerID, modelID);
  if (!pricing) {
    return { model, cost: null, estimated: false, pricingProvider: null };
  }
  const stripped = stripVirtualPrefix(modelID);
  const officialProvider = resolveOfficialProvider(stripped) ?? providerID;
  const inputRate = pricing.input ?? 0;
  const outputRate = pricing.output ?? 0;
  const reasoningRate = pricing.reasoning ?? pricing.output ?? 0;
  const cacheReadRate = pricing.cache_read ?? 0;
  const cacheWriteRate = pricing.cache_write ?? 0;
  const isMissing = isMissingCache(requestCount, cacheRead);
  let cost;
  if (isMissing) {
    const nonCacheInput = inputTokens * (1 - MISSING_HIT_RATE);
    const cacheInput = inputTokens * MISSING_HIT_RATE;
    cost = nonCacheInput / 1e6 * inputRate + cacheInput / 1e6 * cacheReadRate + outputTokens / 1e6 * outputRate + reasoningTokens / 1e6 * reasoningRate;
  } else {
    cost = inputTokens / 1e6 * inputRate + outputTokens / 1e6 * outputRate + reasoningTokens / 1e6 * reasoningRate + cacheRead / 1e6 * cacheReadRate + cacheWrite / 1e6 * cacheWriteRate;
  }
  return { model, cost, estimated: isMissing, pricingProvider: officialProvider };
}

// src/html-common.ts
import { existsSync as existsSync5, readFileSync as readFileSync5 } from "node:fs";
import { dirname as dirname2, join as join5 } from "node:path";
import { fileURLToPath } from "node:url";
function fmtTokens(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}
function fmtCost(n) {
  if (n === 0) return "$0.00";
  if (n < 0.01) return "$" + n.toFixed(6);
  return "$" + n.toFixed(2);
}
function fmtPercent(n) {
  return (n * 100).toFixed(1) + "%";
}
function fmtTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function fmtDateTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDuration(ms) {
  if (ms === null || ms <= 0) return "-";
  if (ms < 1e3) return `${ms.toFixed(0)}ms`;
  if (ms < 6e4) return `${(ms / 1e3).toFixed(1)}s`;
  if (ms >= 864e5) {
    const d = Math.floor(ms / 864e5);
    const h = Math.floor(ms % 864e5 / 36e5);
    return `${d}d ${h}h`;
  }
  if (ms >= 36e5) {
    const h = Math.floor(ms / 36e5);
    const m2 = Math.floor(ms % 36e5 / 6e4);
    return `${h}h ${m2}m`;
  }
  const m = Math.floor(ms / 6e4);
  const s = Math.floor(ms % 6e4 / 1e3);
  return `${m}m ${s}s`;
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function nowString() {
  const now = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}
function percentile2(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(Math.floor(sortedAsc.length * p), sortedAsc.length - 1);
  return sortedAsc[idx];
}
function embeddedEChartsScript() {
  const candidates = [
    join5(dirname2(fileURLToPath(import.meta.url)), "..", "vendor", "echarts.min.js"),
    join5(process.cwd(), "vendor", "echarts.min.js"),
    join5(process.cwd(), "dist", "..", "vendor", "echarts.min.js")
  ];
  for (const path of candidates) {
    if (!existsSync5(path)) continue;
    const source = readFileSync5(path, "utf8").replace(/<\/script/gi, "<\\/script");
    return `<script>${source}</script>`;
  }
  return `<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>`;
}
var HTML_HEAD_SHARED = embeddedEChartsScript();
function embeddedBackgroundTexture() {
  const candidates = [
    join5(dirname2(fileURLToPath(import.meta.url)), "..", "assets", "bg-texture.jpg"),
    join5(process.cwd(), "assets", "bg-texture.jpg"),
    join5(process.cwd(), "dist", "..", "assets", "bg-texture.jpg")
  ];
  for (const path of candidates) {
    if (existsSync5(path)) {
      const image = readFileSync5(path);
      const mime = image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png" : "image/jpeg";
      return `data:${mime};base64,` + image.toString("base64");
    }
  }
  return "";
}
var BACKGROUND_TEXTURE_URI = embeddedBackgroundTexture();
var BG_ANIMATION_HTML = `
<div class="scroll-progress" aria-hidden="true"><span id="scroll-progress-bar"></span></div>
<div class="bg-canvas" aria-hidden="true">
  <div class="bg-texture" style="background-image:url('${BACKGROUND_TEXTURE_URI}')"></div>
  <div class="bg-orb bg-orb-1"></div>
  <div class="bg-orb bg-orb-2"></div>
  <div class="bg-orb bg-orb-3"></div>
  <div class="bg-grid"></div>
  <div class="bg-noise"></div>
</div>`;
var BG_ANIMATION_CSS = `
  .bg-canvas { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  .bg-canvas canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .bg-texture { position:absolute; inset:-4%; background-size:cover; background-position:center; opacity:.40; filter:contrast(1.08) brightness(.82); mix-blend-mode:luminosity; animation:textureBreathe 28s ease-in-out infinite; }
  @keyframes textureBreathe { 0%,100%{transform:scale(1.035) translate3d(-.5%,0,0)} 50%{transform:scale(1.09) translate3d(1.2%,-1%,0)} }
  .scroll-progress { position: fixed; inset: 0 0 auto; height: 2px; z-index: 100; background: rgba(255,255,255,.035); pointer-events:none; }
  .scroll-progress span { display:block; width:100%; height:100%; transform:scaleX(0); transform-origin:left; background:linear-gradient(90deg,#77777f,#f2f2ef); box-shadow:0 0 18px rgba(242,242,239,.35); }
  .bg-orb { position: absolute; border-radius: 50%; filter: blur(120px); will-change: transform; }
  .bg-orb-1 { width: 70vw; height: 80vh; background: radial-gradient(circle, rgba(231,231,228,.92), transparent 65%); top: -30vh; left: -10vw; opacity:.16; animation: orbDrift 26s ease-in-out infinite; }
  .bg-orb-2 { width: 60vw; height: 70vh; background: radial-gradient(circle, rgba(157,157,166,.85), transparent 68%); top:35vh; right:-15vw; opacity:.10; animation: orbDrift 34s ease-in-out infinite reverse; }
  .bg-orb-3 { width: 55vw; height: 60vh; background: radial-gradient(circle, rgba(194,194,200,.9), transparent 70%); bottom:-25vh; left:25vw; opacity:.09; animation: orbDrift 42s ease-in-out infinite; }
  @keyframes orbDrift { 0%,100% { transform:translate3d(0,0,0) scale(1); } 50% { transform:translate3d(3%,-4%,0) scale(1.08); } }
  .bg-grid { position:absolute; inset:0; opacity:.52; background-image:linear-gradient(rgba(255,255,255,.028) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.028) 1px,transparent 1px); background-size:72px 72px; mask-image:radial-gradient(ellipse 100% 70% at 50% 0%,#000 20%,transparent 85%); -webkit-mask-image:radial-gradient(ellipse 100% 70% at 50% 0%,#000 20%,transparent 85%); }
  .bg-canvas::after { content:''; position:absolute; inset:0; background:linear-gradient(rgba(7,7,9,.15),rgba(7,7,9,.35)),radial-gradient(ellipse 95% 76% at 50% 40%,transparent 48%,rgba(0,0,0,.58) 100%); }
  .bg-noise { position:absolute; inset:-50%; width:200%; height:200%; opacity:.02; mix-blend-mode:overlay; background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.5'/%3E%3C/svg%3E"); animation:grain 7s steps(6) infinite; }
  @keyframes grain { 0%,100%{transform:translate(0,0)} 20%{transform:translate(-4%,3%)} 40%{transform:translate(3%,-5%)} 60%{transform:translate(-3%,-2%)} 80%{transform:translate(5%,4%)} }
  @media (prefers-reduced-motion:reduce) { .bg-orb,.bg-noise,.bg-texture{animation:none!important} .bg-canvas canvas{display:none} }`;
var BG_PARTICLE_JS = `
;(function() {
  var canvas = document.getElementById('bg-particles');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var w = 0, h = 0;
  var particles = [];
  var PARTICLE_COLORS = [[231,231,228],[194,194,200],[123,123,133]];

  function resize() {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var density = Math.floor(w * h / 22000);
    density = Math.min(density, 90);
    particles = [];
    for (var i = 0; i < density; i++) {
      var colorIdx = Math.floor(Math.random() * PARTICLE_COLORS.length);
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.16,
        vy: (Math.random() - 0.5) * 0.16,
        r: Math.random() * 1.4 + 0.3,
        depth: Math.random() * 0.6 + 0.4,
        phase: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.8 + 0.2,
        color: PARTICLE_COLORS[colorIdx],
      });
    }
  }

  var mouseX = -9999, mouseY = -9999;
  window.addEventListener('mousemove', function(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });
  window.addEventListener('mouseleave', function() {
    mouseX = -9999; mouseY = -9999;
  });

  var raf = 0;
  function draw(t) {
    ctx.clearRect(0, 0, w, h);

    // Draw connecting lines between nearby particles
    for (var i = 0; i < particles.length; i++) {
      var p1 = particles[i];
      for (var j = i + 1; j < particles.length; j++) {
        var p2 = particles[j];
        var dx = p1.x - p2.x;
        var dy = p1.y - p2.y;
        var distSq = dx * dx + dy * dy;
        if (distSq < 16900) {
          var alpha = (1 - Math.sqrt(distSq) / 130) * 0.055;
          ctx.strokeStyle = 'rgba(' + p1.color[0] + ',' + p1.color[1] + ',' + p1.color[2] + ',' + alpha + ')';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }
    }

    // Draw particles
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];

      // Gentle drift
      p.x += p.vx;
      p.y += p.vy;

      // Mouse repulsion
      var mdx = p.x - mouseX;
      var mdy = p.y - mouseY;
      var mdistSq = mdx * mdx + mdy * mdy;
      if (mdistSq < 10000 && mdistSq > 0) { // 100px radius
        var mdist = Math.sqrt(mdistSq);
        var force = (1 - mdist / 100) * 0.5;
        p.x += (mdx / mdist) * force;
        p.y += (mdy / mdist) * force;
      }

      // Wrap around edges
      if (p.x < -10) p.x = w + 10;
      if (p.x > w + 10) p.x = -10;
      if (p.y < -10) p.y = h + 10;
      if (p.y > h + 10) p.y = -10;

      // Twinkle
      var twinkle = 0.4 + 0.6 * Math.abs(Math.sin(p.phase + t * 0.0008 * p.speed));
      var alpha = twinkle * p.depth * 0.7;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.depth, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + p.color[0] + ',' + p.color[1] + ',' + p.color[2] + ',' + alpha + ')';
      ctx.fill();

      // Glow for larger particles
      if (p.r > 1) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + p.color[0] + ',' + p.color[1] + ',' + p.color[2] + ',' + (alpha * 0.15) + ')';
        ctx.fill();
      }
    }

    raf = requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener('resize', resize);
  raf = requestAnimationFrame(draw);

  // Pause when tab hidden to save CPU
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) { cancelAnimationFrame(raf); }
    else { raf = requestAnimationFrame(draw); }
  });
})();`;
var SHARED_CSS = `
  :root {
    --bg: #08080B; --bg-card: #111116; --bg-card-hover: #16161D; --border: #232330; --border-light: #2E2E3D;
    --text: #E8E8F5; --text-dim: #8888A0; --text-faint: #555568;
    --cache: #00F593; --input: #00D1FF; --output: #B545FF;
    --tps: #FFB800; --missing: #B478FF; --danger: #FF4757; --success: #00F593;
    --radius: 10px; --radius-sm: 6px;
    --shadow-sm: 0 2px 8px rgba(0,0,0,0.3);
    --shadow-md: 0 4px 16px rgba(0,0,0,0.4);
    --shadow-glow: 0 0 24px rgba(0,245,147,0.12);
    --ease: cubic-bezier(0.22, 1, 0.36, 1);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--bg); color: var(--text); font-family: 'Inter', -apple-system, sans-serif; font-size: 14px; line-height: 1.5; min-height: 100vh; -webkit-font-smoothing: antialiased; }
  .container { max-width: 1400px; margin: 0 auto; padding: 24px 20px; position: relative; z-index: 1; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding: 16px 0; border-bottom: 1px solid var(--border); margin-bottom: 24px; gap: 16px; flex-wrap: wrap; }
  .header-left h1 { font-size: 24px; font-weight: 700; color: var(--text); margin-bottom: 4px; letter-spacing: -0.5px; }
  .header-left h1 span { background: linear-gradient(135deg, #00D1FF, #B545FF); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  .header-left .session-info { font-size: 12px; color: var(--text-dim); font-family: 'JetBrains Mono', monospace; }
  .header-right { font-size: 12px; color: var(--text-dim); font-family: 'JetBrains Mono', monospace; text-align: right; }
  .header .meta { font-size: 12px; color: var(--text-dim); font-family: 'JetBrains Mono', monospace; }

  .kpi-row { display: grid; gap: 12px; margin-bottom: 24px; }
  .kpi-card {
    background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 16px 14px;
    text-align: center; position: relative; overflow: hidden;
    transition: border-color 0.4s var(--ease), transform 0.4s var(--ease), box-shadow 0.4s var(--ease);
  }
  .kpi-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, transparent, var(--border-light), transparent); opacity: 0.5; }
  .kpi-card:hover { border-color: var(--border-light); transform: translateY(-3px); box-shadow: var(--shadow-md); }
  .kpi-card.kpi-glow { box-shadow: var(--shadow-glow); border-color: var(--cache); }
  .kpi-label { font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px; font-weight: 500; }
  .kpi-value { font-size: 26px; font-weight: 800; font-family: 'JetBrains Mono', monospace; color: var(--text); font-variant-numeric: tabular-nums; letter-spacing: -0.5px; }
  .kpi-sub { font-size: 10px; color: var(--text-faint); margin-top: 4px; font-family: 'JetBrains Mono', monospace; }

  .section { margin-bottom: 28px; }
  .section-title { font-size: 15px; font-weight: 600; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; }
  .section-title::before { content: ''; display: inline-block; width: 3px; height: 16px; background: linear-gradient(180deg, var(--input), var(--output)); border-radius: 2px; }
  .section-title .sub { font-size: 12px; color: var(--text-dim); font-weight: 400; }
  .chart-box { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; height: 400px; }

  .tab-bar { display: flex; gap: 4px; margin-bottom: 12px; }
  .tab-btn { background: var(--bg-card); border: 1px solid var(--border); color: var(--text-dim); padding: 6px 18px; border-radius: var(--radius-sm) var(--radius-sm) 0 0; cursor: pointer; font-size: 13px; font-family: 'Inter', sans-serif; transition: all 0.2s var(--ease); }
  .tab-btn:hover { border-color: var(--input); color: var(--text); }
  .tab-btn.active { background: var(--border); color: var(--text); border-bottom-color: var(--border); }
  .tab-content { display: none; }
  .tab-content.active { display: block; }

  .model-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; margin-bottom: 16px; transition: border-color 0.3s var(--ease), transform 0.3s var(--ease); }
  .model-card:hover { border-color: var(--border-light); transform: translateY(-2px); }
  .model-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
  .model-name { font-size: 15px; font-weight: 600; color: var(--input); font-family: 'JetBrains Mono', monospace; }
  .model-provider { font-size: 12px; color: var(--text-dim); background: var(--border); padding: 2px 8px; border-radius: 4px; }
  .stat-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 12px; }
  .stat-item { display: flex; flex-direction: column; gap: 2px; }
  .stat-label { font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.3px; }
  .stat-value { font-size: 13px; font-family: 'JetBrains Mono', monospace; color: var(--text); font-variant-numeric: tabular-nums; }

  .token-bar { display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: var(--border); margin-bottom: 6px; }
  .token-seg { height: 100%; transition: width 0.5s var(--ease); }
  .token-seg.input { background: #00D1FF; }
  .token-seg.cache-read { background: #00F593; }
  .token-seg.reasoning { background: #FF8C00; }
  .token-seg.output { background: #B545FF; }
  .token-seg.cache-write { background: #4FC3F7; }
  .token-bar-legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11px; color: var(--text-dim); }
  .legend-item { display: flex; align-items: center; gap: 4px; }
  .legend-dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
  .legend-dot.input { background: #00D1FF; }
  .legend-dot.cache-read { background: #00F593; }
  .legend-dot.reasoning { background: #FF8C00; }
  .legend-dot.output { background: #B545FF; }
  .legend-dot.cache-write { background: #4FC3F7; }

  .data-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .data-table th { background: var(--bg-card); color: var(--text-dim); padding: 11px 10px; text-align: right; border-bottom: 2px solid var(--border); font-weight: 500; white-space: nowrap; position: sticky; top: 0; z-index: 1; }
  .data-table th:first-child, .data-table th:nth-child(3) { text-align: left; }
  .data-table th.sortable { cursor: pointer; user-select: none; }
  .data-table th.sortable:hover { color: var(--input); }
  .data-table th.sortable::after { content: ' \\2195'; font-size: 0.8em; opacity: 0.4; }
  .data-table th.sortable.asc::after { content: ' \\2191'; opacity: 1; color: var(--input); }
  .data-table th.sortable.desc::after { content: ' \\2193'; opacity: 1; color: var(--input); }
  .data-table td { padding: 8px 10px; text-align: right; border-bottom: 1px solid var(--border); font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
  .data-table td:first-child, .data-table td:nth-child(3) { text-align: left; color: var(--text); font-family: 'Inter', sans-serif; }
  .data-table tbody tr:nth-child(even) { background: rgba(255,255,255,0.012); }
  .data-table tbody tr:hover { background: rgba(0,209,255,0.05); }
  .model-cell { display: flex; align-items: center; gap: 8px; }
  .model-cell .model-icon { flex-shrink: 0; }
  .model-cell .model-name-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }

  .pagination-ctrl { display: none; align-items: center; gap: 14px; justify-content: center; padding: 14px 0 4px; }
  .page-btn { background: var(--bg-card); border: 1px solid var(--border); color: var(--text); padding: 5px 16px; border-radius: var(--radius-sm); cursor: pointer; font-size: 12px; font-family: 'Inter', sans-serif; transition: border-color 0.2s, color 0.2s; }
  .page-btn:hover:not(:disabled) { border-color: var(--input); color: var(--input); }
  .page-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .page-info { color: var(--text-dim); font-size: 12px; font-family: 'JetBrains Mono', monospace; min-width: 110px; text-align: center; }

  .provider-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
  .provider-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; border-left-width: 3px; transition: transform 0.3s var(--ease), border-color 0.3s var(--ease); }
  .provider-card:hover { transform: translateY(-2px); }
  .provider-name { font-size: 14px; font-weight: 600; margin-bottom: 8px; color: var(--input); }
  .provider-stat { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0; }
  .provider-stat .stat-label { color: var(--text-dim); }
  .provider-more { color: var(--text-dim); font-size: 11px; padding: 10px 4px 0; grid-column: 1 / -1; }

  .insight-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; display: flex; align-items: center; gap: 12px; transition: border-color 0.3s var(--ease); }
  .insight-card:hover { border-color: var(--border-light); }
  .insight-icon { width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
  .insight-body { flex: 1; min-width: 0; }
  .insight-title { font-size: 12px; color: var(--text-dim); margin-bottom: 2px; }
  .insight-value { font-size: 14px; font-weight: 600; color: var(--text); }
  .insight-value .accent { color: var(--input); }

  .empty-state { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 48px; text-align: center; color: var(--text-dim); font-size: 13px; }
  .footer { margin-top: 40px; padding: 16px 0; border-top: 1px solid var(--border); text-align: center; font-size: 11px; color: var(--text-dim); }
  .footer a { color: var(--input); text-decoration: none; }

  @media (max-width: 1200px) { .kpi-row.cols-9, .kpi-row.cols-10 { grid-template-columns: repeat(5, 1fr) !important; } }
  @media (max-width: 768px) {
    .kpi-row { grid-template-columns: repeat(2, 1fr) !important; }
    .stat-grid { grid-template-columns: repeat(2, 1fr); }
    .container { padding: 12px 10px; }
    .header { flex-direction: column; }
    .chart-box { height: 280px; }
    .data-table { font-size: 11px; }
    .data-table th, .data-table td { padding: 4px 6px; }
    .provider-row { grid-template-columns: 1fr; }
  }

  /* Graphite Observatory visual system */
  :root { color-scheme:dark; --bg:#0c0c0e;--bg-card:#131316;--bg-card-hover:#19191d;--border:rgba(255,255,255,.07);--border-light:rgba(255,255,255,.14);--text:#f2f2ef;--text-dim:#a8a8af;--text-faint:#717179;--cache:#8fb7a2;--input:#c8d4e3;--output:#b6adc8;--reasoning:#c4a982;--tps:#d0b77d;--missing:#a8a0bb;--danger:#df7b83;--success:#8fb7a2;--radius:20px;--radius-sm:10px;--shadow-md:0 28px 70px -36px rgba(0,0,0,.98);--shadow-glow:0 0 34px rgba(143,183,162,.12);--ease:cubic-bezier(.16,1,.3,1);--font-sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;--font-mono:ui-monospace,"SFMono-Regular",Consolas,"Liberation Mono",monospace; }
  html{scroll-behavior:smooth} body{font-family:var(--font-sans);overflow-x:hidden;text-rendering:optimizeLegibility} ::selection{background:#e7e7e4;color:#0c0c0e} ::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#2a2a30;border-radius:99px}::-webkit-scrollbar-thumb:hover{background:#3d3d46}:focus-visible{outline:2px solid #f2f2ef;outline-offset:3px}
  .container{max-width:1440px;padding:30px 24px 56px}.header{padding:24px 4px 30px;border:0;margin-bottom:20px;gap:24px}.header-left h1{font-size:clamp(30px,4vw,54px);line-height:1;font-weight:300;letter-spacing:-.055em;margin-bottom:12px}.header-left h1 span{background:none;-webkit-text-fill-color:initial;color:#8f8f98}.header-left .session-info,.header-right,.header .meta{font-size:10px;color:var(--text-dim);font-family:var(--font-mono);letter-spacing:.08em;text-transform:uppercase}.header-right,.header .meta{max-width:560px;text-align:right;padding-top:8px}
  .kpi-card{--mx:-999px;--my:-999px;background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.014) 48%,rgba(0,0,0,.16)),#131316;color:var(--text);border:1px solid var(--border);padding:22px 18px 18px;text-align:left;min-height:126px;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),var(--shadow-md);transition:transform .55s var(--ease),box-shadow .55s var(--ease),filter .55s var(--ease)}.kpi-card:first-child,.kpi-card:nth-child(6){background:linear-gradient(165deg,#f3f3f0,#e2e2de 58%,#d2d2cd);color:#131316;border-color:rgba(255,255,255,.55);box-shadow:inset 0 1px 0 rgba(255,255,255,.85),var(--shadow-md)}.kpi-card::before{inset:0;height:auto;background:radial-gradient(300px circle at var(--mx) var(--my),rgba(255,255,255,.12),transparent 68%);opacity:.72}.kpi-card:first-child::before,.kpi-card:nth-child(6)::before{background:radial-gradient(300px circle at var(--mx) var(--my),rgba(255,255,255,.78),transparent 68%)}.kpi-card::after{content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(115deg,transparent 28%,rgba(255,255,255,.18) 45%,transparent 60%);transform:translateX(-120%);animation:sheenSweep 8s cubic-bezier(.4,0,.2,1) infinite}.kpi-card:hover{transform:translateY(-6px) scale(1.012);border-color:rgba(255,255,255,.24);box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 34px 74px -34px rgba(0,0,0,.98)}.kpi-card.kpi-glow{border-color:rgba(255,255,255,.3);box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 0 0 1px rgba(255,255,255,.12),var(--shadow-md)}.kpi-label,.kpi-value,.kpi-sub{position:relative;z-index:1}.kpi-label{font-size:9px;color:#85858d;margin-bottom:16px;letter-spacing:.22em;font-family:var(--font-mono)}.kpi-value{font-size:clamp(25px,2.2vw,36px);line-height:1;font-weight:400;font-family:var(--font-mono);color:var(--text)!important;letter-spacing:-.055em}.kpi-sub{font-size:9px;color:#777780;margin-top:10px;font-family:var(--font-mono);letter-spacing:.04em}.kpi-card:first-child .kpi-label,.kpi-card:nth-child(6) .kpi-label{color:#55555d}.kpi-card:first-child .kpi-value,.kpi-card:nth-child(6) .kpi-value{color:#111114!important}.kpi-card:first-child .kpi-sub,.kpi-card:nth-child(6) .kpi-sub{color:#65656d}@keyframes sheenSweep{0%,58%{transform:translateX(-120%)}88%,100%{transform:translateX(120%)}}
  .section{margin-bottom:18px}.section-title{font-size:11px;font-family:var(--font-mono);font-weight:500;text-transform:uppercase;letter-spacing:.17em;color:#c9c9c7;margin-bottom:10px;padding:0 4px;border:0;gap:10px}.section-title::before{width:7px;height:7px;background:transparent;border:1px solid #d8d8d5;border-radius:50%;box-shadow:0 0 14px rgba(231,231,228,.35)}.section-title .sub{font-size:9px;color:var(--text-faint);letter-spacing:.08em;text-transform:none}
  .chart-box,.model-card,.provider-card,.insight-card,.empty-state{--mx:-999px;--my:-999px;background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.012) 42%,rgba(0,0,0,.14)),var(--bg-card);border:1px solid var(--border);box-shadow:inset 0 1px 0 rgba(255,255,255,.05),var(--shadow-md);position:relative;overflow:hidden}.chart-box::before,.model-card::before,.provider-card::before,.insight-card::before{content:'';position:absolute;inset:0;pointer-events:none;z-index:0;background:radial-gradient(360px circle at var(--mx) var(--my),rgba(255,255,255,.075),transparent 70%)}.chart-box{height:420px}.chart-box canvas{position:relative;z-index:1}
  .tab-bar,.view-btn-bar{display:inline-flex!important;gap:3px!important;margin-bottom:10px!important;padding:4px;background:rgba(255,255,255,.035);border:1px solid var(--border);border-radius:12px}.tab-btn,.view-btn{background:transparent!important;border:0!important;color:var(--text-dim)!important;padding:7px 14px!important;border-radius:8px!important;font-size:10px!important;font-family:var(--font-mono)!important;letter-spacing:.07em;transition:all .35s var(--ease)!important}.tab-btn:hover,.view-btn:hover{color:var(--text)!important;background:rgba(255,255,255,.05)!important}.tab-btn.active,.view-btn.active{background:#e7e7e4!important;color:#111114!important;box-shadow:0 8px 22px -12px rgba(255,255,255,.35)}.tab-content.active{animation:tabIn .55s var(--ease) both}@keyframes tabIn{from{opacity:0;transform:translateY(10px);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}
  .model-card{padding:18px;margin-bottom:12px;transition:transform .5s var(--ease),border-color .5s var(--ease)}.model-card:hover,.provider-card:hover,.insight-card:hover{border-color:var(--border-light);transform:translateY(-4px)}.model-card>*,.provider-card>*,.insight-card>*{position:relative;z-index:1}.model-card-header{margin-bottom:16px;padding-bottom:12px}.model-name{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:500;color:var(--text);font-family:var(--font-mono)}.model-provider{font-size:9px;color:var(--text-dim);background:rgba(255,255,255,.055);padding:4px 9px;border:1px solid var(--border);border-radius:99px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.08em}.stat-label{font-size:9px;color:var(--text-faint);letter-spacing:.13em;font-family:var(--font-mono)}.stat-value{font-family:var(--font-mono);color:var(--text)!important}.stat-value[style*="--cache"]{color:var(--cache)!important}.stat-value[style*="--tps"]{color:var(--tps)!important}.stat-value[style*="--danger"]{color:var(--danger)!important}.stat-value[style*="--missing"]{color:var(--missing)!important}
  .kpi-card:not(:first-child):not(:nth-child(6)) .kpi-value[style*="--cache"]{color:var(--cache)!important;text-shadow:0 0 24px rgba(143,183,162,.16)}.kpi-card:not(:first-child):not(:nth-child(6)) .kpi-value[style*="--tps"]{color:var(--tps)!important}.kpi-card:not(:first-child):not(:nth-child(6)) .kpi-value[style*="--missing"]{color:var(--missing)!important}.kpi-card:not(:first-child):not(:nth-child(6)) .kpi-value[style*="--danger"]{color:var(--danger)!important}
  .kpi-value[data-countup^="$"]{font-size:clamp(22px,2vw,32px)}
  .kpi-value.kpi-avg-daily{color:var(--avg-daily-color)!important}
  .token-bar{height:7px;border-radius:99px;background:rgba(255,255,255,.05);margin-bottom:9px}.token-seg{transition:width 1.2s var(--ease),filter .3s;box-shadow:inset 0 1px rgba(255,255,255,.18)}.token-seg:hover{filter:brightness(1.45)}.token-seg.input{background:var(--input)}.token-seg.cache-read{background:var(--cache)}.token-seg.reasoning{background:var(--reasoning)}.token-seg.output{background:var(--output)}.token-seg.cache-write{background:#8295a8}.legend-dot{width:7px;height:7px;border-radius:50%;box-shadow:0 0 8px currentColor}.legend-dot.input{background:var(--input)}.legend-dot.cache-read{background:var(--cache)}.legend-dot.reasoning{background:var(--reasoning)}.legend-dot.output{background:var(--output)}.legend-dot.cache-write{background:#8295a8}
  .table-scroll{width:100%;overflow:auto;border-radius:var(--radius);box-shadow:var(--shadow-md)}.data-table{min-width:760px;border-collapse:separate;border-spacing:0;font-size:11.5px;background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(0,0,0,.1)),var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;box-shadow:inset 0 1px rgba(255,255,255,.04)}.data-table th{background:#17171a;color:var(--text-dim);padding:13px 11px;border-bottom:1px solid var(--border);font-size:9px;letter-spacing:.1em;text-transform:uppercase;font-family:var(--font-mono)}.data-table th.sortable:hover,.data-table th.sortable.asc::after,.data-table th.sortable.desc::after{color:var(--text)}.data-table td{padding:10px 11px;border-bottom:1px solid rgba(255,255,255,.045);font-family:var(--font-mono);color:#c9c9ce;transition:background .3s,color .3s,transform .3s}.data-table td:first-child,.data-table td:nth-child(3){font-family:var(--font-sans)}.data-table tbody tr:hover{background:transparent}.data-table tbody tr:hover td{background:rgba(255,255,255,.045);color:#fff}.data-table tbody tr:hover td:first-child{transform:translateX(3px)}.data-table tbody tr:last-child td{border-bottom:0}.model-icon{background:rgba(255,255,255,.05);padding:2px;border:1px solid rgba(255,255,255,.08);border-radius:6px!important;box-sizing:content-box;filter:saturate(.78) contrast(1.08)}
  .page-btn{border-radius:99px;font-size:10px;font-family:var(--font-mono);transition:all .3s var(--ease)}.page-btn:hover:not(:disabled){border-color:var(--border-light);background:#e7e7e4;color:#111114;transform:translateY(-2px)}.page-info{font-size:10px;font-family:var(--font-mono)}.provider-card{padding:16px;border-color:var(--border)!important;border-left-width:1px!important;border-top:2px solid #8a8a92!important;transition:transform .5s var(--ease),border-color .5s var(--ease)}.provider-name{font-size:13px;font-weight:500;color:var(--text);font-family:var(--font-mono)}.insight-card{padding:16px;transition:transform .5s var(--ease),border-color .5s var(--ease)}.insight-icon{width:38px;height:38px;border-radius:50%;font-size:15px;border:1px solid var(--border-light);font-family:var(--font-mono)}.insight-value .accent{color:var(--text);text-decoration:underline;text-decoration-color:#666;text-underline-offset:3px}.empty-state{font-family:var(--font-mono);font-size:11px}.footer{font-size:9px;letter-spacing:.08em;text-transform:uppercase;font-family:var(--font-mono)}.footer a{color:var(--text);border-bottom:1px solid #555}
  .reveal-item{opacity:0;transform:translateY(26px);filter:blur(10px);transition:opacity .9s var(--ease),transform .9s var(--ease),filter .9s var(--ease);transition-delay:var(--reveal-delay,0ms)}.reveal-item.in-view{opacity:1;transform:none;filter:none}
  @media(max-width:768px){.container{padding:16px 10px 36px}.header-right,.header .meta{text-align:left}.chart-box{height:300px}.kpi-row.cols-9,.kpi-row.cols-10{grid-template-columns:repeat(2,minmax(0,1fr))!important}.kpi-card{min-height:112px;padding:18px 14px}.kpi-value[data-countup^="$"]{font-size:20px}.kpi-sub{font-size:8px;line-height:1.35;overflow-wrap:anywhere}}
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}.reveal-item{opacity:1!important;transform:none!important;filter:none!important}}
  `;
var SHARED_JS = `
var fmt = function(v) {
  if (v == null) return '\\u2014';
  if (v >= 1000000000) return (v/1000000000).toFixed(1)+'B';
  if (v >= 1000000) return (v/1000000).toFixed(1)+'M';
  if (v >= 1000) return (v/1000).toFixed(1)+'K';
  return String(v);
};
var fmtCost = function(v) {
  if (v == 0) return '$0.00';
  if (v < 0.01) return '$'+v.toFixed(6);
  return '$'+v.toFixed(2);
};

function graphiteChartOption(value) {
  if (typeof value === 'string') {
    var exact = {'#00D1FF':'#c8d4e3','#00F593':'#8fb7a2','#B545FF':'#b6adc8','#FF8C00':'#c4a982','#FFB800':'#d0b77d','#4FC3F7':'#8295a8','#FF6B6B':'#c38b91','#B478FF':'#a8a0bb','#2ED573':'#8fb7a2','#8888A0':'#9d9da6','#E8E8F5':'#f2f2ef','#232330':'#303035','#111116':'#131316','#151518':'#17171a','#1a3a2a':'#26362e','#0D3B2E':'#202d27'};
    if (exact[value]) return exact[value];
    return value.split('rgba(0,209,255,').join('rgba(200,212,227,').split('rgba(0,245,147,').join('rgba(143,183,162,').split('rgba(181,69,255,').join('rgba(182,173,200,').split('rgba(255,184,0,').join('rgba(208,183,125,').split('rgba(255,140,0,').join('rgba(196,169,130,');
  }
  if (Array.isArray(value)) return value.map(graphiteChartOption);
  if (value && typeof value === 'object') {
    Object.keys(value).forEach(function(k) { value[k] = graphiteChartOption(value[k]); });
    if (Array.isArray(value.series)) value.series.forEach(function(series) {
      if (series.lineStyle && series.lineStyle.color) {
        series.itemStyle = series.itemStyle || {};
        if (!series.itemStyle.color) series.itemStyle.color = series.lineStyle.color;
      }
    });
  }
  return value;
}

function installGraphiteECharts() {
  if (!window.echarts || window.echarts.__graphiteInstalled) return;
  var originalInit = window.echarts.init;
  window.echarts.init = function() {
    var args = Array.prototype.slice.call(arguments);
    args[2] = Object.assign({}, args[2] || {}, { devicePixelRatio: Math.min(2.5, Math.max(2, window.devicePixelRatio || 1)) });
    var chart = originalInit.apply(window.echarts, args);
    var originalSet = chart.setOption;
    chart.setOption = function(option) {
      arguments[0] = graphiteChartOption(option);
      return originalSet.apply(chart, arguments);
    };
    return chart;
  };
  window.echarts.__graphiteInstalled = true;
}

// Number count-up animation for KPI values
function countUp(el, target, duration) {
  duration = duration || 800;
  var start = 0;
  var startTime = null;
  var isStr = typeof target === 'string';
  var numericTarget = isStr ? parseFloat(target.replace(/[^\\d.]/g, '')) : target;
  if (isNaN(numericTarget)) { el.textContent = target; return; }
  var prefix = (isStr && target.startsWith('$')) ? '$' : '';
  var suffix = '';
  if (isStr) { var m = target.match(/[a-zA-Z%]+$/); if (m) suffix = m[0]; }
  function step(ts) {
    if (!startTime) startTime = ts;
    var progress = Math.min((ts - startTime) / duration, 1);
    var eased = 1 - Math.pow(1 - progress, 3);
    var val = start + (numericTarget - start) * eased;
    el.textContent = prefix + (val >= 100 ? val.toFixed(0) : val.toFixed(1)) + suffix;
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = isStr ? target : String(Math.round(val));
  }
  requestAnimationFrame(step);
}
function initCountUp() {
  document.querySelectorAll('.kpi-value[data-countup]').forEach(function(el) {
    var target = el.getAttribute('data-countup');
    countUp(el, target, 900);
  });
}

// Table sorting
function makeSortable(tableId) {
  var table = document.getElementById(tableId);
  if (!table) return;
  var thead = table.querySelector('thead');
  if (!thead) return;
  var ths = thead.querySelectorAll('th.sortable');
  var tbody = table.querySelector('tbody');
  if (!tbody) return;
  var rows = Array.from(tbody.querySelectorAll('tr'));
  var dir = 1;
  ths.forEach(function(th, colIdx) {
    th.addEventListener('click', function() {
      var actualCol = Array.from(th.parentNode.children).indexOf(th);
      dir = th.classList.contains('asc') ? -1 : 1;
      ths.forEach(function(t) { t.classList.remove('asc','desc'); });
      th.classList.add(dir === 1 ? 'asc' : 'desc');
      rows.sort(function(a, b) {
        var av = a.children[actualCol] ? a.children[actualCol].textContent.trim() : '';
        var bv = b.children[actualCol] ? b.children[actualCol].textContent.trim() : '';
        var an = parseFloat(av.replace(/[^\\d.\\-]/g, ''));
        var bn = parseFloat(bv.replace(/[^\\d.\\-]/g, ''));
        if (!isNaN(an) && !isNaN(bn)) return (an - bn) * dir;
        return av.localeCompare(bv) * dir;
      });
      rows.forEach(function(r) { tbody.appendChild(r); });
    });
  });
}

// Table pagination
function initPaginator(tableId, pageSize) {
  var tbody = document.querySelector('#' + tableId + ' tbody');
  if (!tbody) return;
  var rows = Array.from(tbody.querySelectorAll('tr'));
  if (rows.length <= pageSize) return;
  var totalPages = Math.ceil(rows.length / pageSize);
  var cur = 1;
  function render() {
    rows.forEach(function(r, i) { r.style.display = (i >= (cur - 1) * pageSize && i < cur * pageSize) ? '' : 'none'; });
    var info = document.getElementById(tableId + '-info');
    if (info) info.textContent = 'Page ' + cur + ' / ' + totalPages + ' (' + rows.length + ' rows)';
    var prevEl = document.getElementById(tableId + '-prev'); var nextEl = document.getElementById(tableId + '-next');
    if (prevEl) prevEl.disabled = cur === 1; if (nextEl) nextEl.disabled = cur === totalPages;
  }
  var prevEl = document.getElementById(tableId + '-prev'); var nextEl = document.getElementById(tableId + '-next');
  if (prevEl) prevEl.addEventListener('click', function() { if (cur > 1) { cur--; render(); } });
  if (nextEl) nextEl.addEventListener('click', function() { if (cur < totalPages) { cur++; render(); } });
  var ctrl = document.getElementById(tableId + '-ctrl'); if (ctrl) ctrl.style.display = 'flex';
  render();
}

// Shared motion layer: scroll reveal, pointer spotlight, progress indicator.
function initDashboardMotion() {
  installGraphiteECharts();
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var revealEls = Array.from(document.querySelectorAll('.kpi-card, .section, .two-col'));
  revealEls.forEach(function(el, i) {
    el.classList.add('reveal-item');
    el.style.setProperty('--reveal-delay', Math.min(i % 6, 5) * 55 + 'ms');
  });
  if (reduced || !('IntersectionObserver' in window)) {
    revealEls.forEach(function(el) { el.classList.add('in-view'); });
  } else {
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) { entry.target.classList.add('in-view'); observer.unobserve(entry.target); }
      });
    }, { threshold: 0.06, rootMargin: '0px 0px -42px 0px' });
    revealEls.forEach(function(el) { observer.observe(el); });
  }

  document.querySelectorAll('.kpi-card, .chart-box, .model-card, .provider-card, .insight-card').forEach(function(el) {
    el.addEventListener('pointermove', function(e) {
      var r = el.getBoundingClientRect();
      el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      el.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
    el.addEventListener('pointerleave', function() {
      el.style.setProperty('--mx', '-999px'); el.style.setProperty('--my', '-999px');
    });
  });

  document.querySelectorAll('.data-table').forEach(function(table) {
    table.setAttribute('role','table');
    if (!table.parentElement.classList.contains('table-scroll')) {
      var shell = document.createElement('div'); shell.className = 'table-scroll';
      table.parentNode.insertBefore(shell, table); shell.appendChild(table);
    }
  });

  if (!reduced) document.querySelectorAll('.token-seg').forEach(function(seg) {
    var target = seg.style.width;
    seg.style.width = '0%';
    requestAnimationFrame(function() { requestAnimationFrame(function() { seg.style.width = target; }); });
  });

  var progress = document.getElementById('scroll-progress-bar');
  var scheduled = false;
  function updateProgress() {
    scheduled = false;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var p = max > 0 ? Math.max(0, Math.min(1, window.scrollY / max)) : 0;
    if (progress) progress.style.transform = 'scaleX(' + p + ')';
  }
  window.addEventListener('scroll', function() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(updateProgress); }
  }, { passive: true });
  updateProgress();
}

window.addEventListener('resize', function() {
  if (window.__charts) Object.values(window.__charts).forEach(function(c) { if (c && c.resize) c.resize(); });
});`;

// src/model-icons.ts
import { existsSync as existsSync6, readFileSync as readFileSync6 } from "node:fs";
import { join as join6, dirname as dirname3 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
function resolveIconsDir() {
  const candidates = [];
  try {
    const url = import.meta.url;
    if (url) candidates.push(join6(dirname3(fileURLToPath2(url)), "..", "icons"));
  } catch {
  }
  const cwd = process.cwd();
  for (const base of [cwd, join6(cwd, "dist", "..")]) {
    candidates.push(join6(base, "icons"));
  }
  for (const c of candidates) {
    if (c && existsSync6(join6(c, "_default.svg"))) return c;
  }
  return null;
}
var ICONS_DIR = resolveIconsDir();
var _cache = /* @__PURE__ */ new Map();
var FALLBACK_FILL = "#C8C8D8";
var RULES = [
  // GPT family unified to OpenAI (gpt-*, o1/o3/o4, codex, chatgpt, sora, gpt-oss)
  [/^(gpt|o[1-4](?=[\b-]|$)|chatgpt|codex|sora)/, "openai.svg"],
  [/claude|anthropic/, "claude-color.svg"],
  [/deepseek/, "deepseek-color.svg"],
  [/gemini/, "gemini-color.svg"],
  [/gemma/, "gemma-color.svg"],
  [/qwen|qwq|qvq|qianwen/, "qwen-color.svg"],
  [/glm|chatglm|zhipu/, "zhipu-color.svg"],
  [/kimi|moonshot/, "kimi-color.svg"],
  [/grok/, "grok.svg"],
  [/doubao/, "doubao-color.svg"],
  [/\bseed\b/, "bytedance-color.svg"],
  [/llama/, "meta-color.svg"],
  [/mistral|mixtral|codestral|devstral/, "mistral-color.svg"],
  [/minimax|abab/, "minimax-color.svg"],
  [/hunyuan/, "hunyuan-color.svg"],
  [/hy3|hy[-_]/, "tencent.svg"],
  [/longcat/, "longcat-color.svg"],
  [/internlm/, "internlm-color.svg"],
  [/^step|stepfun/, "stepfun-color.svg"],
  [/command|cohere/, "cohere-color.svg"],
  [/\bling\b/, "ling.png"],
  [/mimo/, "xiaomimimo.svg"],
  [/nvidia/, "nvidia-color.svg"],
  [/ollama/, "ollama.svg"]
];
function normalizeModelId(modelId) {
  let id = modelId.toLowerCase().trim();
  for (const p of ["oc-", "ds-", "ol-"]) {
    if (id.startsWith(p)) {
      id = id.slice(p.length);
      break;
    }
  }
  if (id.includes("/")) id = id.split("/").pop().trim();
  return id;
}
function resolveIconFile(modelId) {
  const id = normalizeModelId(modelId);
  for (const [re, file] of RULES) {
    if (re.test(id)) return file;
  }
  return "_default.svg";
}
function readIconDataUri(fileName) {
  const cached = _cache.get(fileName);
  if (cached !== void 0) return cached;
  if (!ICONS_DIR) {
    _cache.set(fileName, "");
    return "";
  }
  const filePath = join6(ICONS_DIR, fileName);
  try {
    const buf = readFileSync6(filePath);
    let uri;
    if (fileName.endsWith(".svg")) {
      let text = buf.toString("utf8");
      text = text.replace(/currentColor/gi, FALLBACK_FILL);
      uri = "data:image/svg+xml;base64," + Buffer.from(text, "utf8").toString("base64");
    } else {
      uri = "data:image/png;base64," + buf.toString("base64");
    }
    _cache.set(fileName, uri);
    return uri;
  } catch {
    if (fileName !== "_default.svg") {
      const fallback = readIconDataUri("_default.svg");
      _cache.set(fileName, fallback);
      return fallback;
    }
    _cache.set(fileName, "");
    return "";
  }
}
function getModelIconDataUri(modelId) {
  return readIconDataUri(resolveIconFile(modelId));
}
function modelIconImg(modelId, size = 16) {
  const uri = getModelIconDataUri(modelId);
  if (!uri) return "";
  return `<img class="model-icon" src="${uri}" alt="" width="${size}" height="${size}" loading="lazy" style="width:${size}px;height:${size}px;vertical-align:middle;border-radius:3px;flex-shrink:0">`;
}

// src/session-usage-html.ts
function renderKpiCards(data) {
  const s = data.summary;
  let kpiInputSum = 0, kpiCacheSum = 0;
  for (const m of data.models) {
    if (isMissingCache(m.requests, m.cacheRead)) continue;
    kpiInputSum += m.inputTokens;
    kpiCacheSum += m.cacheRead;
  }
  const kpiHitRate = kpiInputSum + kpiCacheSum > 0 ? kpiCacheSum / (kpiInputSum + kpiCacheSum) : 0;
  const hitRatePct = kpiInputSum + kpiCacheSum > 0 ? fmtPercent(kpiHitRate) : "-";
  const isHighCache = kpiHitRate >= 0.85;
  const kpiHitColor = kpiHitRate >= 0.85 ? "var(--cache)" : kpiHitRate >= 0.7 ? "var(--tps)" : "var(--danger)";
  const apiCostTotal = data.apiCost.totalApiCost;
  const errorRatePct = (data.errors.errorRate * 100).toFixed(1) + "%";
  const errorColor = data.errors.errorRate >= 0.05 ? "var(--danger)" : data.errors.errorRate > 0 ? "var(--tps)" : "var(--cache)";
  const avgTokensPerReq = s.requestCount > 0 ? s.totalTokens / s.requestCount : 0;
  const tpsStr = data.tps > 0 ? data.tps >= 100 ? Math.round(data.tps).toString() : data.tps.toFixed(1) : "-";
  const cprStr = s.requestCount > 0 ? fmtCost(s.totalCost / s.requestCount) : "-";
  return `
    <div class="kpi-row cols-10" style="grid-template-columns:repeat(5,1fr)">
      <div class="kpi-card">
        <div class="kpi-label">Total Tokens</div>
        <div class="kpi-value" data-countup="${fmtTokens(s.totalTokens)}">${fmtTokens(s.totalTokens)}</div>
        <div class="kpi-sub">${s.requestCount} requests</div>
      </div>
      <div class="kpi-card${isHighCache ? " kpi-glow" : ""}">
        <div class="kpi-label">Cache Hit Rate</div>
        <div class="kpi-value" style="color:${kpiHitColor}" data-countup="${hitRatePct}">${hitRatePct}</div>
        <div class="kpi-sub">${fmtTokens(kpiCacheSum)} cached</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Requests</div>
        <div class="kpi-value" data-countup="${s.requestCount}">${s.requestCount}</div>
        <div class="kpi-sub">${s.modelsUsed.length} models</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Avg Tok/Req</div>
        <div class="kpi-value" data-countup="${fmtTokens(Math.round(avgTokensPerReq))}">${fmtTokens(Math.round(avgTokensPerReq))}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Tokens/s</div>
        <div class="kpi-value" data-countup="${tpsStr}">${tpsStr}</div>
        <div class="kpi-sub">${fmtDuration(data.sessionDurationMs)} span</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Reported Cost</div>
        <div class="kpi-value" style="color:var(--tps)" data-countup="${fmtCost(s.totalCost)}">${fmtCost(s.totalCost)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Cost/Request</div>
        <div class="kpi-value" data-countup="${cprStr}">${cprStr}</div>
      </div>
      <div class="kpi-card${apiCostTotal != null && apiCostTotal > s.totalCost ? " kpi-glow" : ""}">
        <div class="kpi-label">API Equiv. Cost</div>
        <div class="kpi-value" style="color:var(--missing)" data-countup="${apiCostTotal != null ? fmtCost(apiCostTotal) : "-"}">${apiCostTotal != null ? fmtCost(apiCostTotal) : "-"}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Avg Latency</div>
        <div class="kpi-value" data-countup="${fmtDuration(data.avgDuration)}">${fmtDuration(data.avgDuration)}</div>
        <div class="kpi-sub">p90: ${fmtDuration(data.p90Duration)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Error Rate</div>
        <div class="kpi-value" style="color:${errorColor}" data-countup="${errorRatePct}">${errorRatePct}</div>
        <div class="kpi-sub">${data.errors.failedCount} failed</div>
      </div>
    </div>`;
}
function renderModelCards(data) {
  const sorted = [...data.models].sort((a, b) => b.totalTokens - a.totalTokens);
  const cards = sorted.map((m) => {
    const isMissing = isMissingCache(m.requests, m.cacheRead);
    const hitRate = cacheHitRate(m.inputTokens, m.cacheRead);
    const hitColor = isMissing ? "var(--missing)" : hitRate >= 0.85 ? "var(--cache)" : hitRate >= 0.7 ? "var(--tps)" : "var(--danger)";
    const hitDisplay = isMissing ? "MISSING" : fmtPercent(hitRate);
    const apiItem = data.apiCost.byModel.find((a) => a.provider === m.provider && a.model === m.model);
    const apiCostStr = apiItem?.apiEquivCost != null ? apiItem.estimated ? `~${fmtCost(apiItem.apiEquivCost)}` : fmtCost(apiItem.apiEquivCost) : "-";
    const costPer1M = m.totalTokens > 0 ? m.totalCost / m.totalTokens * 1e6 : 0;
    const costPer1MStr = costPer1M > 0 ? `$${costPer1M.toFixed(4)}` : "-";
    const total = m.totalTokens || 1;
    const inputPct = (m.inputTokens / total * 100).toFixed(1);
    const outputPct = (m.outputTokens / total * 100).toFixed(1);
    const cacheReadPct = (m.cacheRead / total * 100).toFixed(1);
    const cacheWritePct = (m.cacheWrite / total * 100).toFixed(1);
    const reasoningPct = (m.reasoningTokens / total * 100).toFixed(1);
    return `
    <div class="model-card">
      <div class="model-card-header">
        <span class="model-name">${modelIconImg(m.model, 18)}${m.model}</span>
        <span class="model-provider">${m.provider}</span>
      </div>
      <div class="model-card-stats">
        <div class="stat-grid">
          <div class="stat-item"><span class="stat-label">Requests</span><span class="stat-value">${m.requests}</span></div>
          <div class="stat-item"><span class="stat-label">Total Tokens</span><span class="stat-value">${fmtTokens(m.totalTokens)}</span></div>
          <div class="stat-item"><span class="stat-label">Input</span><span class="stat-value" style="color:var(--input)">${fmtTokens(m.inputTokens)}</span></div>
          <div class="stat-item"><span class="stat-label">Output</span><span class="stat-value" style="color:var(--output)">${fmtTokens(m.outputTokens)}</span></div>
          <div class="stat-item"><span class="stat-label">Reasoning</span><span class="stat-value" style="color:#FF8C00">${fmtTokens(m.reasoningTokens)}</span></div>
          <div class="stat-item"><span class="stat-label">Cache Read</span><span class="stat-value" style="color:var(--cache)">${fmtTokens(m.cacheRead)}</span></div>
          <div class="stat-item"><span class="stat-label">Cache Write</span><span class="stat-value" style="color:#4FC3F7">${fmtTokens(m.cacheWrite)}</span></div>
          <div class="stat-item"><span class="stat-label">Hit Rate</span><span class="stat-value" style="color:${hitColor};font-weight:600">${hitDisplay}</span></div>
          <div class="stat-item"><span class="stat-label">Reported Cost</span><span class="stat-value">${fmtCost(m.totalCost)}</span></div>
          <div class="stat-item"><span class="stat-label">API Equiv.</span><span class="stat-value" style="color:var(--missing)">${apiCostStr}</span></div>
        </div>
      </div>
      <div class="token-bar">
        <div class="token-seg input" style="width:${inputPct}%" title="Input: ${fmtTokens(m.inputTokens)} (${inputPct}%)"></div>
        <div class="token-seg cache-read" style="width:${cacheReadPct}%" title="Cache Read: ${fmtTokens(m.cacheRead)} (${cacheReadPct}%)"></div>
        <div class="token-seg reasoning" style="width:${reasoningPct}%" title="Reasoning: ${fmtTokens(m.reasoningTokens)} (${reasoningPct}%)"></div>
        <div class="token-seg output" style="width:${outputPct}%" title="Output: ${fmtTokens(m.outputTokens)} (${outputPct}%)"></div>
        <div class="token-seg cache-write" style="width:${cacheWritePct}%" title="Cache Write: ${fmtTokens(m.cacheWrite)} (${cacheWritePct}%)"></div>
      </div>
      <div class="token-bar-legend">
        <span class="legend-item"><span class="legend-dot input"></span>Input ${inputPct}%</span>
        <span class="legend-item"><span class="legend-dot cache-read"></span>Cache R ${cacheReadPct}%</span>
        <span class="legend-item"><span class="legend-dot reasoning"></span>Reasoning ${reasoningPct}%</span>
        <span class="legend-item"><span class="legend-dot output"></span>Output ${outputPct}%</span>
        <span class="legend-item"><span class="legend-dot cache-write"></span>Cache W ${cacheWritePct}%</span>
        <span class="legend-item" style="margin-left:auto;color:var(--text-faint)">Cost/1M: ${costPer1MStr}</span>
      </div>
    </div>`;
  }).join("\n");
  return cards;
}
function renderMessageTable(data) {
  const rows = data.messages.map((msg, i) => {
    const isMissing = isMissingCache(1, msg.cacheRead);
    const hitRate = cacheHitRate(msg.inputTokens, msg.cacheRead);
    const hitColor = isMissing ? "var(--missing)" : hitRate >= 0.85 ? "var(--cache)" : hitRate >= 0.7 ? "var(--tps)" : "var(--danger)";
    const hitDisplay = isMissing ? "MISSING" : fmtPercent(hitRate);
    const duration = msg.timeCompleted ? msg.timeCompleted - msg.timeCreated : null;
    const durColor = duration != null && duration > data.p90Duration ? "var(--danger)" : "var(--text)";
    return `<tr>
      <td>${i + 1}</td>
      <td>${fmtTime(msg.timeCreated)}</td>
      <td><div class="model-cell">${modelIconImg(msg.model, 16)}<span class="model-name-text" title="${escapeHtml(msg.model)}">${escapeHtml(msg.model)}</span></div></td>
      <td>${fmtTokens(msg.totalTokens)}</td>
      <td>${fmtTokens(msg.inputTokens)}</td>
      <td>${fmtTokens(msg.outputTokens)}</td>
      <td>${fmtTokens(msg.reasoningTokens)}</td>
      <td>${fmtTokens(msg.cacheRead)}</td>
      <td>${fmtTokens(msg.cacheWrite)}</td>
      <td style="color:${hitColor};font-weight:600">${hitDisplay}</td>
      <td style="color:${durColor}">${fmtDuration(duration)}</td>
      <td>${fmtCost(msg.cost)}</td>
    </tr>`;
  }).join("\n");
  return `
  <div class="section">
    <div class="section-title">Per-Request Breakdown <span class="sub">(${data.messages.length} requests, click headers to sort)</span></div>
    <table id="messages-table" class="data-table">
      <thead><tr>
        <th class="sortable">#</th><th class="sortable">Time</th><th>Model</th><th class="sortable">Total</th>
        <th class="sortable">Input</th><th class="sortable">Output</th><th class="sortable">Reasoning</th>
        <th class="sortable">Cache R</th><th class="sortable">Cache W</th>
        <th class="sortable">Hit Rate</th><th class="sortable">Duration</th><th class="sortable">Cost</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="pagination-ctrl" id="messages-table-ctrl">
      <button class="page-btn" id="messages-table-prev">Prev</button>
      <span class="page-info" id="messages-table-info"></span>
      <button class="page-btn" id="messages-table-next">Next</button>
    </div>
  </div>`;
}
function renderTrendChartInit(data) {
  const labels = data.messages.map((_, i) => `#${i + 1}`);
  const inputTokens = data.messages.map((m) => m.inputTokens);
  const outputTokens = data.messages.map((m) => m.outputTokens);
  const cacheReadTokens = data.messages.map((m) => m.cacheRead);
  const totalTokens = data.messages.map((m) => m.totalTokens);
  const costs = data.messages.map((m) => m.cost);
  const ma5 = totalTokens.map((_, i) => {
    const start = Math.max(0, i - 4);
    const slice = totalTokens.slice(start, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
  return `
var trendLabels = ${JSON.stringify(labels)};
var trendInput = ${JSON.stringify(inputTokens)};
var trendOutput = ${JSON.stringify(outputTokens)};
var trendCache = ${JSON.stringify(cacheReadTokens)};
var trendTotal = ${JSON.stringify(totalTokens)};
var trendCost = ${JSON.stringify(costs)};
var trendMA5 = ${JSON.stringify(ma5)};

function initTrendChart() {
  var el = document.getElementById('trend-chart');
  if (!el) return;
  var chart = echarts.init(el);
  window.__charts = window.__charts || {};
  window.__charts.trend = chart;
  var option = {
    tooltip: { trigger: 'axis', formatter: function(params) {
      var html = '<b>Request ' + params[0].axisValue + '</b><br/>';
      params.forEach(function(p) {
        if (p.seriesName === 'Cost') html += p.marker + ' ' + p.seriesName + ': ' + fmtCost(p.value) + '<br/>';
        else html += p.marker + ' ' + p.seriesName + ': ' + fmt(p.value) + '<br/>';
      });
      return html;
    }},
    legend: { data: ['Total', 'MA(5)', 'Input', 'Cache Read', 'Output', 'Cost'], textStyle: { color: '#8888A0' }, top: 5, type: 'scroll' },
    grid: { left: 60, right: 70, bottom: 40, top: 50 },
    xAxis: { type: 'category', data: trendLabels, axisLabel: { color: '#8888A0', fontSize: 10 }, axisLine: { lineStyle: { color: '#232330' } } },
    yAxis: [
      { type: 'value', name: 'Tokens', nameTextStyle: { color: '#8888A0' }, axisLabel: { color: '#8888A0', formatter: fmt }, splitLine: { lineStyle: { color: '#232330', type: 'dashed' } } },
      { type: 'value', name: 'Cost', nameTextStyle: { color: '#FFB800' }, axisLabel: { color: '#FFB800', formatter: function(v) { return '$' + v.toFixed(4); } }, splitLine: { show: false } }
    ],
    series: [
      { name: 'Total', type: 'line', data: trendTotal, smooth: true, symbol: 'none', lineStyle: { color: '#E8E8F5', width: 1.5, type: 'dashed' }, itemStyle: { color: '#E8E8F5' } },
      { name: 'MA(5)', type: 'line', data: trendMA5, smooth: true, symbol: 'none', lineStyle: { color: '#FFB800', width: 2.5 } },
      { name: 'Input', type: 'line', data: trendInput, smooth: true, symbol: 'none', lineStyle: { color: '#00D1FF', width: 2 }, areaStyle: { color: 'rgba(0,209,255,0.08)' } },
      { name: 'Cache Read', type: 'line', data: trendCache, smooth: true, symbol: 'none', lineStyle: { color: '#00F593', width: 2 }, areaStyle: { color: 'rgba(0,245,147,0.08)' } },
      { name: 'Output', type: 'line', data: trendOutput, smooth: true, symbol: 'none', lineStyle: { color: '#B545FF', width: 2 } },
      { name: 'Cost', type: 'line', yAxisIndex: 1, data: trendCost, smooth: true, symbol: 'none', lineStyle: { color: '#FFB800', width: 1.5, opacity: 0.6 } }
    ]
  };
  chart.setOption(option);
  chart.resize();
}`;
}
function renderDurationChartInit(data) {
  const labels = data.messages.map((_, i) => `#${i + 1}`);
  const durations = data.messages.map((m) => {
    if (!m.timeCompleted) return 0;
    return (m.timeCompleted - m.timeCreated) / 1e3;
  });
  const p50 = data.p50Duration / 1e3;
  const p90 = data.p90Duration / 1e3;
  return `
var durLabels = ${JSON.stringify(labels)};
var durData = ${JSON.stringify(durations)};
var durP50 = ${p50.toFixed(2)};
var durP90 = ${p90.toFixed(2)};

function initDurationChart() {
  var el = document.getElementById('duration-chart');
  if (!el) return;
  var chart = echarts.init(el);
  window.__charts = window.__charts || {};
  window.__charts.duration = chart;
  var option = {
    tooltip: { trigger: 'axis', formatter: function(params) {
      var p = params[0];
      return '<b>Request ' + p.axisValue + '</b><br/>Duration: ' + p.value.toFixed(2) + 's';
    }},
    grid: { left: 60, right: 30, bottom: 40, top: 30 },
    xAxis: { type: 'category', data: durLabels, axisLabel: { color: '#8888A0', fontSize: 10 }, axisLine: { lineStyle: { color: '#232330' } } },
    yAxis: { type: 'value', name: 'Seconds', nameTextStyle: { color: '#8888A0' }, axisLabel: { color: '#8888A0', formatter: '{value}s' }, splitLine: { lineStyle: { color: '#232330', type: 'dashed' } } },
    series: [{
      type: 'bar', data: durData, barMaxWidth: 20,
      itemStyle: { color: function(p) { return p.value > durP90 ? '#FF4757' : p.value > durP50 ? '#FFB800' : '#00D1FF'; }, borderRadius: [3, 3, 0, 0] },
      markLine: {
        symbol: 'none', silent: true,
        data: [
          { yAxis: durP50, lineStyle: { color: '#00F593', type: 'dashed', width: 1.5 }, label: { formatter: 'p50 ' + durP50.toFixed(1) + 's', color: '#00F593', position: 'insideEndTop' } },
          { yAxis: durP90, lineStyle: { color: '#FF4757', type: 'dashed', width: 1.5 }, label: { formatter: 'p90 ' + durP90.toFixed(1) + 's', color: '#FF4757', position: 'insideEndBottom' } }
        ]
      }
    }]
  };
  chart.setOption(option);
  chart.resize();
}`;
}
function renderCacheTrendInit(data) {
  const labels = data.messages.map((_, i) => `#${i + 1}`);
  const hitRates = data.messages.map((m) => {
    if (isMissingCache(1, m.cacheRead)) return null;
    return cacheHitRate(m.inputTokens, m.cacheRead) * 100;
  });
  return `
var cacheLabels = ${JSON.stringify(labels)};
var cacheHitData = ${JSON.stringify(hitRates)};

function initCacheTrendChart() {
  var el = document.getElementById('cache-trend-chart');
  if (!el) return;
  var chart = echarts.init(el);
  window.__charts = window.__charts || {};
  window.__charts.cacheTrend = chart;
  var option = {
    tooltip: { trigger: 'axis', formatter: function(params) {
      var p = params[0];
      if (p.value == null) return '<b>Request ' + p.axisValue + '</b><br/>Cache: MISSING';
      return '<b>Request ' + p.axisValue + '</b><br/>Hit Rate: ' + p.value.toFixed(1) + '%';
    }},
    grid: { left: 50, right: 30, bottom: 40, top: 30 },
    visualMap: { show: false, dimension: 1, seriesIndex: 0, pieces: [
      { gte: 85, color: '#8fb7a2' },
      { gte: 70, lt: 85, color: '#d0b77d' },
      { lt: 70, color: '#df7b83' }
    ]},
    xAxis: { type: 'category', data: cacheLabels, axisLabel: { color: '#8888A0', fontSize: 10 }, axisLine: { lineStyle: { color: '#232330' } } },
    yAxis: { type: 'value', max: 100, name: 'Hit %', nameTextStyle: { color: '#8888A0' }, axisLabel: { color: '#8888A0', formatter: '{value}%' }, splitLine: { lineStyle: { color: '#232330', type: 'dashed' } } },
    series: [{
      type: 'line', data: cacheHitData, smooth: true, symbol: 'circle', symbolSize: 5,
      connectNulls: false,
      lineStyle: { color: '#00F593', width: 2 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(0,245,147,0.25)' }, { offset: 1, color: 'rgba(0,245,147,0.02)' }] } },
      itemStyle: { color: '#00F593' },
      markLine: { symbol: 'none', silent: true, data: [{ yAxis: 85, lineStyle: { color: '#232330', type: 'dotted' } }] }
    }]
  };
  chart.setOption(option);
  chart.resize();
}`;
}
function renderApiCostSection(data) {
  const apiCost = data.apiCost;
  if (!apiCost || apiCost.byModel.length === 0) return "";
  const rows = apiCost.byModel.filter((m) => m.apiEquivCost !== null || m.reportedCost === 0).sort((a, b) => (b.apiEquivCost ?? 0) - (a.apiEquivCost ?? 0));
  if (rows.length === 0) return "";
  const tableRows = rows.map((m) => {
    const apiStr = m.apiEquivCost != null ? m.estimated ? `<span style="color:var(--missing)">~${fmtCost(m.apiEquivCost)}</span>` : fmtCost(m.apiEquivCost) : '<span style="color:var(--text-faint)">N/A</span>';
    const estTag = m.estimated ? ` <span style="color:var(--missing);font-size:0.8em">(est.)</span>` : "";
    const pricingSrc = m.pricingProvider ? `<span style="color:var(--text-dim);font-size:0.85em">${m.pricingProvider}</span>` : "-";
    return `<tr>
      <td><div class="model-cell">${modelIconImg(m.model, 16)}<span class="model-name-text" title="${escapeHtml(m.model)}">${m.model}</span></div></td><td>${m.provider}</td><td>${pricingSrc}</td>
      <td>${m.requests}</td><td>${fmtTokens(m.inputTokens)}</td><td>${fmtTokens(m.outputTokens)}</td>
      <td>${fmtCost(m.reportedCost)}</td><td style="font-weight:600">${apiStr}${estTag}</td>
    </tr>`;
  }).join("\n");
  const totalApi = apiCost.totalApiCost ?? 0;
  const reported = apiCost.reportedCost;
  const diff = totalApi - reported;
  const diffStr = diff > 1e-3 ? `<span style="color:var(--missing)">+${fmtCost(diff)}</span>` : `<span style="color:var(--cache)">${fmtCost(diff)}</span>`;
  return `
  <div class="section">
    <div class="section-title">API Equivalent Cost Analysis</div>
    <p style="font-size:12px;color:var(--text-dim);padding:4px 0 8px">
      For providers that don't report cost, API equivalent cost is estimated using official model pricing (models.dev) &times; token usage.
      <span style="color:var(--missing)">~</span> = MISSING model (upstream no cache data) estimated at 94% hit rate.
    </p>
    <div class="kpi-row" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
      <div class="kpi-card"><div class="kpi-label">Reported Cost</div><div class="kpi-value" style="color:var(--tps)">${fmtCost(reported)}</div></div>
      <div class="kpi-card"><div class="kpi-label">API Equiv. Total</div><div class="kpi-value" style="color:var(--missing)">${apiCost.totalApiCost != null ? fmtCost(totalApi) : "-"}</div></div>
      <div class="kpi-card"><div class="kpi-label">Difference</div><div class="kpi-value">${diffStr}</div></div>
    </div>
    <table id="api-cost-table" class="data-table">
      <thead><tr><th>Model</th><th>Provider</th><th>Pricing Source</th><th>Req</th><th>Input</th><th>Output</th><th>Reported</th><th>API Equiv.</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>`;
}
function renderInsights(data) {
  const insights = [];
  if (data.messages.length > 0) {
    let maxCostIdx = 0;
    for (let i = 1; i < data.messages.length; i++) {
      if (data.messages[i].cost > data.messages[maxCostIdx].cost) maxCostIdx = i;
    }
    const mostExpensive = data.messages[maxCostIdx];
    if (mostExpensive.cost > 0) {
      insights.push({
        icon: "$",
        bg: "rgba(255,184,0,0.15)",
        title: "Most expensive request",
        value: `<span class="accent">${fmtCost(mostExpensive.cost)}</span> on request #${maxCostIdx + 1} (${mostExpensive.model})`
      });
    }
  }
  if (data.peakTokensIndex >= 0) {
    insights.push({
      icon: "\u26A1",
      bg: "rgba(0,209,255,0.15)",
      title: "Peak activity",
      value: `Request <span class="accent">#${data.peakTokensIndex + 1}</span> with <span class="accent">${fmtTokens(data.peakTokens)}</span> tokens`
    });
  }
  let bestStreak = 0, streakStart = 0, bestStart = 0;
  for (let i = 0; i < data.messages.length; i++) {
    const m = data.messages[i];
    if (!isMissingCache(1, m.cacheRead) && cacheHitRate(m.inputTokens, m.cacheRead) >= 0.85) {
      if (streakStart === -1) streakStart = i;
      const len = i - streakStart + 1;
      if (len > bestStreak) {
        bestStreak = len;
        bestStart = streakStart;
      }
    } else {
      streakStart = -1;
    }
  }
  if (bestStreak > 1) {
    insights.push({
      icon: "\u2713",
      bg: "rgba(0,245,147,0.15)",
      title: "Best cache streak",
      value: `<span class="accent">${bestStreak} requests</span> (#${bestStart + 1}-${bestStart + bestStreak}) above 85% hit rate`
    });
  }
  if (data.messages.length > 0) {
    const slowest = data.messages.reduce((max, m, i) => {
      const dur = m.timeCompleted ? m.timeCompleted - m.timeCreated : 0;
      return dur > max.dur ? { dur, i, model: m.model } : max;
    }, { dur: 0, i: 0, model: data.messages[0]?.model ?? "" });
    if (slowest.dur > 0) {
      insights.push({
        icon: "\u23F1",
        bg: "rgba(255,71,87,0.15)",
        title: "Slowest response",
        value: `<span class="accent">${fmtDuration(slowest.dur)}</span> on request #${slowest.i + 1} (${slowest.model})`
      });
    }
  }
  if (data.errors.failedCount > 0) {
    insights.push({
      icon: "!",
      bg: "rgba(255,71,87,0.15)",
      title: "Errors detected",
      value: `<span class="accent">${data.errors.failedCount} failed</span> out of ${data.errors.successCount + data.errors.failedCount} requests`
    });
  }
  if (insights.length === 0) return "";
  const cards = insights.map((ins) => `
    <div class="insight-card">
      <div class="insight-icon" style="background:${ins.bg};color:var(--text)">${ins.icon}</div>
      <div class="insight-body">
        <div class="insight-title">${ins.title}</div>
        <div class="insight-value">${ins.value}</div>
      </div>
    </div>`).join("\n");
  return `
  <div class="section">
    <div class="section-title">Smart Insights</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px">
      ${cards}
    </div>
  </div>`;
}
async function buildSessionReportData(sessionId, sessionTitle, subagentCount, summary, models, messages, errors) {
  const apiCostByModel = models.map((m) => {
    const est = estimateApiCost(
      m.provider,
      m.model,
      m.requests,
      m.inputTokens,
      m.outputTokens,
      m.reasoningTokens,
      m.cacheRead,
      m.cacheWrite
    );
    return {
      provider: m.provider,
      model: m.model,
      requests: m.requests,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      reasoningTokens: m.reasoningTokens,
      cacheRead: m.cacheRead,
      cacheWrite: m.cacheWrite,
      reportedCost: m.totalCost,
      apiEquivCost: est.cost,
      estimated: est.estimated,
      pricingProvider: est.pricingProvider
    };
  });
  const apiTotal = apiCostByModel.reduce((sum, m) => sum + (m.apiEquivCost ?? 0), 0);
  const apiCost = {
    totalApiCost: apiTotal > 0 ? apiTotal : null,
    reportedCost: summary.totalCost,
    byModel: apiCostByModel
  };
  const firstMsg = messages.length > 0 ? messages[0].timeCreated : null;
  const lastMsg = messages.length > 0 ? messages[messages.length - 1].timeCreated : null;
  const sessionDurationMs = firstMsg && lastMsg ? lastMsg - firstMsg : 0;
  const durationSec = sessionDurationMs / 1e3;
  const tps = durationSec > 0 ? summary.totalTokens / durationSec : 0;
  const costPerRequest = summary.requestCount > 0 ? summary.totalCost / summary.requestCount : 0;
  const durations = messages.map((m) => m.timeCompleted ? m.timeCompleted - m.timeCreated : null).filter((d) => d !== null && d > 0).sort((a, b) => a - b);
  const p50Duration = percentile2(durations, 0.5);
  const p90Duration = percentile2(durations, 0.9);
  const maxDuration = durations.length > 0 ? durations[durations.length - 1] : 0;
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  let peakTokens = 0, peakTokensIndex = -1;
  messages.forEach((m, i) => {
    if (m.totalTokens > peakTokens) {
      peakTokens = m.totalTokens;
      peakTokensIndex = i;
    }
  });
  return {
    sessionId,
    sessionTitle,
    subagentCount,
    summary,
    models,
    messages,
    apiCost,
    errors,
    generatedAt: nowString(),
    sessionDurationMs,
    firstMessageTime: firstMsg,
    lastMessageTime: lastMsg,
    tps,
    costPerRequest,
    p50Duration,
    p90Duration,
    maxDuration,
    avgDuration,
    peakTokens,
    peakTokensIndex
  };
}
function generateSessionUsageHtml(data) {
  const kpiStr = renderKpiCards(data);
  const modelCardsStr = renderModelCards(data);
  const messageTableStr = renderMessageTable(data);
  const apiCostStr = renderApiCostSection(data);
  const insightsStr = renderInsights(data);
  const trendJs = data.messages.length > 0 ? renderTrendChartInit(data) : "";
  const durationJs = data.messages.length > 0 ? renderDurationChartInit(data) : "";
  const cacheJs = data.messages.length > 0 ? renderCacheTrendInit(data) : "";
  const hasMessages = data.messages.length > 0;
  const showDates = data.sessionDurationMs >= 864e5;
  const firstTimeStr = data.firstMessageTime ? showDates ? fmtDateTime(data.firstMessageTime) : fmtTime(data.firstMessageTime) : "-";
  const lastTimeStr = data.lastMessageTime ? showDates ? fmtDateTime(data.lastMessageTime) : fmtTime(data.lastMessageTime) : "-";
  const durationStr = fmtDuration(data.sessionDurationMs);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Session Usage - ${escapeHtml(data.sessionTitle)}</title>
${HTML_HEAD_SHARED}
<style>
${BG_ANIMATION_CSS}
${SHARED_CSS}
</style>
</head>
<body>
${BG_ANIMATION_HTML}
<div class="container">
  <div class="header">
    <div class="header-left">
      <h1><span>Usage Stat</span> Session Report</h1>
      <div class="session-info">Session: ${escapeHtml(data.sessionId)} &middot; ${escapeHtml(data.sessionTitle)}${data.subagentCount > 0 ? ` &middot; <span style="color:var(--input)">+${data.subagentCount} subagent${data.subagentCount > 1 ? "s" : ""}</span>` : ""}</div>
      <div class="session-info" style="margin-top:2px">Timeline: ${firstTimeStr} \u2192 ${lastTimeStr} &middot; Duration: ${durationStr}</div>
    </div>
    <div class="header-right">Generated: ${data.generatedAt}</div>
  </div>

  ${kpiStr}

  ${insightsStr}

  <div class="section">
    <div class="section-title">Cache Hit Rate Trend</div>
    ${hasMessages ? '<div class="chart-box" id="cache-trend-chart" style="height:320px"></div>' : '<div class="empty-state">No message data.</div>'}
  </div>

  <div class="section">
    <div class="section-title">Per-Model Token Usage</div>
    ${data.models.length > 0 ? modelCardsStr : '<div class="empty-state">No model usage data in this session.</div>'}
  </div>

  ${hasMessages ? `
  <div class="section">
    <div class="section-title">Token &amp; Cost Trend Per Request <span class="sub">with 5-req moving average</span></div>
    <div class="chart-box" id="trend-chart"></div>
  </div>

  <div class="section">
    <div class="section-title">Response Latency Analysis <span class="sub">p50: ${fmtDuration(data.p50Duration)} &middot; p90: ${fmtDuration(data.p90Duration)} &middot; max: ${fmtDuration(data.maxDuration)}</span></div>
    <div class="chart-box" id="duration-chart" style="height:300px"></div>
  </div>` : ""}

  ${apiCostStr}

  ${messageTableStr}

  <div class="footer">
    Generated by opencode-usage-stat /session-usage &middot; Data: OpenCode V2 API
  </div>
</div>

<script>
${SHARED_JS}

${BG_PARTICLE_JS}

${trendJs}
${durationJs}
${cacheJs}

document.addEventListener('DOMContentLoaded', function() {
  initDashboardMotion();
  initCountUp();
  ${hasMessages ? "initTrendChart(); initDurationChart(); initCacheTrendChart();" : ""}
  makeSortable('messages-table');
  initPaginator('messages-table', 20);
  initPaginator('api-cost-table', 15);
});
</script>
</body>
</html>`;
}

// src/total-usage-html.ts
function sortModelsByUsage(models) {
  return [...models].filter((m) => m.totalTokens > 0).sort((a, b) => b.totalTokens - a.totalTokens);
}
function renderMeta(data) {
  const m = data.meta;
  return `Usage Stat Report &middot; ${m.dateRange.start} \u2192 ${m.dateRange.end} &middot; generated ${m.generatedAt}`;
}
function avgDailyUsageColor(tokens) {
  const light = [202, 184, 232];
  const deep = [91, 45, 142];
  if (tokens <= 5e7) {
    const alpha = Math.max(0, tokens / 5e7);
    return `rgba(${light.join(",")},${alpha.toFixed(3)})`;
  }
  const t2 = Math.min(1, (tokens - 5e7) / 15e7);
  const rgb = light.map((value, i) => Math.round(value + (deep[i] - value) * t2));
  return `rgb(${rgb.join(",")})`;
}
function renderKpiCards2(data) {
  const s = data.summary;
  let kpiInputSum = 0, kpiCacheSum = 0;
  for (const m of data.models) {
    if (isMissingCache(m.requests, m.cacheRead)) continue;
    kpiInputSum += m.inputTokens;
    kpiCacheSum += m.cacheRead;
  }
  const kpiHitRate = kpiInputSum + kpiCacheSum > 0 ? kpiCacheSum / (kpiInputSum + kpiCacheSum) : 0;
  const hitRatePct = kpiInputSum + kpiCacheSum > 0 ? fmtPercent(kpiHitRate) : "-";
  const isHighCache = kpiHitRate >= 0.85;
  const kpiHitColor = kpiHitRate >= 0.85 ? "var(--cache)" : kpiHitRate >= 0.7 ? "var(--tps)" : "var(--danger)";
  const apiCostTotal = data.apiCost?.totalApiCost ?? null;
  const errors = data.errors;
  const errorRatePct = errors ? (errors.errorRate * 100).toFixed(1) + "%" : "-";
  const errorColor = errors && errors.errorRate >= 0.05 ? "var(--danger)" : errors && errors.errorRate > 0 ? "var(--tps)" : "var(--cache)";
  const dailyCount = data.daily.length;
  const avgDailyTokens = dailyCount > 0 ? s.totalTokens / dailyCount : 0;
  const avgDailyColor = avgDailyUsageColor(avgDailyTokens);
  const costPerSession = data.sessions.length > 0 ? s.totalCost / data.sessions.length : 0;
  return `
    <div class="kpi-row cols-9" style="grid-template-columns:repeat(9,1fr)">
      <div class="kpi-card">
        <div class="kpi-label">Total Tokens</div>
        <div class="kpi-value" data-countup="${fmtTokens(s.totalTokens)}">${fmtTokens(s.totalTokens)}</div>
      </div>
      <div class="kpi-card${isHighCache ? " kpi-glow" : ""}">
        <div class="kpi-label">Cache Hit Rate</div>
        <div class="kpi-value" style="color:${kpiHitColor}" data-countup="${hitRatePct}">${hitRatePct}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Requests</div>
        <div class="kpi-value" data-countup="${s.requestCount}">${s.requestCount}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Sessions</div>
        <div class="kpi-value" data-countup="${data.sessions.length}">${data.sessions.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Avg Daily Tokens</div>
        <div class="kpi-value kpi-avg-daily" style="--avg-daily-color:${avgDailyColor}" data-countup="${fmtTokens(Math.round(avgDailyTokens))}">${fmtTokens(Math.round(avgDailyTokens))}</div>
        <div class="kpi-sub">${dailyCount} active days</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Cost</div>
        <div class="kpi-value" style="color:var(--tps)" data-countup="${fmtCost(s.totalCost)}">${fmtCost(s.totalCost)}</div>
        <div class="kpi-sub">${fmtCost(costPerSession)}/session</div>
      </div>
      <div class="kpi-card${apiCostTotal != null && apiCostTotal > s.totalCost ? " kpi-glow" : ""}">
        <div class="kpi-label">API Equiv. Cost</div>
        <div class="kpi-value" style="color:var(--missing)" data-countup="${apiCostTotal != null ? fmtCost(apiCostTotal) : "-"}">${apiCostTotal != null ? fmtCost(apiCostTotal) : "-"}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Models Used</div>
        <div class="kpi-value" data-countup="${data.models.length}">${data.models.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Error Rate</div>
        <div class="kpi-value" style="color:${errorColor}" data-countup="${errorRatePct}">${errorRatePct}</div>
        <div class="kpi-sub">${errors ? errors.failedCount + " failed" : ""}</div>
      </div>
    </div>`;
}
function renderModelChartInit(data) {
  const allSorted = sortModelsByUsage(data.models);
  const top = allSorted.slice(0, 15);
  const rest = allSorted.slice(15);
  const restTotalTokens = rest.reduce((s, m) => s + m.totalTokens, 0);
  const restTotalCost = rest.reduce((s, m) => s + m.totalCost, 0);
  const restTotalReq = rest.reduce((s, m) => s + m.requests, 0);
  const displayModels = [...top];
  if (rest.length > 0) {
    displayModels.push({
      model: `Others (${rest.length})`,
      provider: "",
      requests: restTotalReq,
      sessions: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: restTotalTokens,
      totalCost: restTotalCost
    });
  }
  const rev = [...displayModels].reverse();
  const names = rev.map((m) => m.model);
  const inputData = rev.map((m) => m.inputTokens);
  const outputData = rev.map((m) => m.outputTokens);
  const cacheData = rev.map((m) => m.cacheRead);
  const reasoningData = rev.map((m) => m.reasoningTokens);
  const costData = rev.map((m) => m.totalCost);
  const apiCostData = rev.map((m) => {
    if (m.model.startsWith("Others (")) {
      return rest.reduce((sum, item) => {
        const api2 = data.apiCost?.byModel.find((a) => a.provider === item.provider && a.model === item.model);
        return sum + (api2?.apiEquivCost ?? 0);
      }, 0);
    }
    const api = data.apiCost?.byModel.find((a) => a.provider === m.provider && a.model === m.model);
    return api?.apiEquivCost ?? 0;
  });
  const requestData = rev.map((m) => m.requests);
  const iconUris = rev.map((m) => getModelIconDataUri(m.model));
  const richEntries = iconUris.map(
    (uri, i) => `i${i}:{backgroundColor:{image:${JSON.stringify(uri)}},width:14,height:14,align:'center',verticalAlign:'middle'}`
  ).join(",");
  return `var modelNames = ${JSON.stringify(names)};
var modelInput = ${JSON.stringify(inputData)};
var modelOutput = ${JSON.stringify(outputData)};
var modelCache = ${JSON.stringify(cacheData)};
var modelReasoning = ${JSON.stringify(reasoningData)};
var modelCost = ${JSON.stringify(costData)};
var modelApiCost = ${JSON.stringify(apiCostData)};
var modelReq = ${JSON.stringify(requestData)};
var modelView = 'tokens';
var modelIconRich = {${richEntries}};

function initModelChart() {
  var el = document.getElementById('model-chart');
  if (!el) return;
  var chart = echarts.init(el);
  window.__charts = window.__charts || {};
  window.__charts.model = chart;
  renderModelChart();
}

function renderModelChart() {
  var chart = window.__charts.model;
  if (!chart) return;
  var labelFormatter = function(value, index) {
    var name = value.length > 24 ? value.slice(0, 22) + '\\u2026' : value;
    return '{i' + index + '|}  ' + name;
  };
  var option;
  if (modelView === 'tokens') {
    option = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: function(params) {
        var html = '<b>' + params[0].axisValue + '</b><br/>'; var total = 0;
        params.forEach(function(p) { html += p.marker + ' ' + p.seriesName + ': ' + fmt(p.value) + '<br/>'; total += p.value; });
        html += '<b>Total: ' + fmt(total) + '</b>'; return html;
      }},
      legend: { data: ['Input', 'Cache', 'Reasoning', 'Output'], textStyle: { color: '#8888A0' }, top: 5 },
      grid: { left: window.innerWidth < 700 ? 145 : 190, right: window.innerWidth < 700 ? 28 : 60, bottom: 28, top: 40 },
      xAxis: { type: 'value', name: 'Tokens', nameTextStyle: { color: '#8888A0' }, axisLabel: { color: '#8888A0', formatter: fmt }, splitLine: { lineStyle: { color: '#232330', type: 'dashed' } } },
      yAxis: { type: 'category', data: modelNames, axisLabel: { color: '#d6d6da', fontSize: 12, fontWeight: 500, formatter: labelFormatter, rich: modelIconRich }, axisLine: { lineStyle: { color: '#232330' } } },
      series: [
        { name: 'Input', type: 'bar', stack: 'tokens', data: modelInput, itemStyle: { color: '#00D1FF' }, barMaxWidth: 22 },
        { name: 'Cache', type: 'bar', stack: 'tokens', data: modelCache, itemStyle: { color: '#00F593' }, barMaxWidth: 22 },
        { name: 'Reasoning', type: 'bar', stack: 'tokens', data: modelReasoning, itemStyle: { color: '#FF8C00' }, barMaxWidth: 22 },
        { name: 'Output', type: 'bar', stack: 'tokens', data: modelOutput, itemStyle: { color: '#B545FF' }, barMaxWidth: 22,
          label: { show: true, position: 'right', formatter: function(p) { var t = modelInput[p.dataIndex] + modelOutput[p.dataIndex] + modelCache[p.dataIndex] + modelReasoning[p.dataIndex]; return t > 0 ? fmt(t) : ''; }, color: '#E8E8F5', fontSize: 11, fontWeight: 600 } }
      ]
    };
  } else if (modelView === 'cost') {
    option = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: function(p) {
        var actual = p.find(function(x){return x.seriesName === 'Actual Cost';});
        var api = p.find(function(x){return x.seriesName === 'API Equivalent';});
        var av = actual ? actual.value : 0, pv = api ? api.value : 0;
        return '<b>' + p[0].axisValue + '</b><br/>' + (actual ? actual.marker : '') + ' Actual Cost: ' + (av > 0 ? fmtCost(av) : 'MISSING') + '<br/>' + (api ? api.marker : '') + ' API Equivalent: ' + fmtCost(pv) + '<br/><b>Difference: ' + fmtCost(pv - av) + '</b>';
      }},
      legend: { data: ['Actual Cost', 'API Equivalent'], textStyle: { color: '#b8b8be', fontSize: 12 }, top: 5 },
      grid: { left: window.innerWidth < 700 ? 145 : 190, right: window.innerWidth < 700 ? 42 : 78, bottom: 28, top: 42 },
      xAxis: { type: 'value', name: 'Cost (USD)', nameTextStyle: { color: '#8888A0' }, axisLabel: { color: '#8888A0', formatter: function(v) { return '$' + v.toFixed(2); } }, splitLine: { lineStyle: { color: '#232330', type: 'dashed' } } },
      yAxis: { type: 'category', data: modelNames, axisLabel: { color: '#d6d6da', fontSize: 12, fontWeight: 500, formatter: labelFormatter, rich: modelIconRich }, axisLine: { lineStyle: { color: '#232330' } } },
      series: [
        { name: 'Actual Cost', type: 'bar', data: modelCost, barMaxWidth: 14, itemStyle: { color: '#d0b77d', borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', formatter: function(p) { return p.value > 0 ? '{actual|' + fmtCost(p.value) + '}' : '{missing|MISSING}'; }, fontSize: 11, fontWeight: 600,
            rich: { actual: { color: '#e0c888', fontSize: 11, fontWeight: 600 }, missing: { color: '#888891', fontSize: 10, fontWeight: 500 } } } },
        { name: 'API Equivalent', type: 'bar', data: modelApiCost, barMaxWidth: 14, itemStyle: { color: '#9d83c7', borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', formatter: function(p) { return p.value > 0 ? fmtCost(p.value) : ''; }, color: '#c5b2e4', fontSize: 11, fontWeight: 600 } }
      ]
    };
  } else {
    option = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: function(p) { return '<b>' + p[0].axisValue + '</b><br/>Requests: ' + p[0].value; }},
      grid: { left: window.innerWidth < 700 ? 145 : 190, right: window.innerWidth < 700 ? 28 : 60, bottom: 28, top: 20 },
      xAxis: { type: 'value', name: 'Requests', nameTextStyle: { color: '#8888A0' }, axisLabel: { color: '#8888A0' }, splitLine: { lineStyle: { color: '#232330', type: 'dashed' } } },
      yAxis: { type: 'category', data: modelNames, axisLabel: { color: '#d6d6da', fontSize: 12, fontWeight: 500, formatter: labelFormatter, rich: modelIconRich }, axisLine: { lineStyle: { color: '#232330' } } },
      series: [{ type: 'bar', data: modelReq, barMaxWidth: 22, itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: '#00D1FF' }, { offset: 1, color: '#0080FF' }] }, borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', formatter: function(p) { return p.value > 0 ? String(p.value) : ''; }, color: '#E8E8F5', fontSize: 11 } }]
    };
  }
  chart.setOption(option, true);
  chart.resize();
}

window.switchModelView = function(v) {
  modelView = v;
  document.querySelectorAll('.view-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelector('[data-view="' + v + '"]').classList.add('active');
  renderModelChart();
};`;
}
function providerBorderColor(provider) {
  const shades = ["#f2f2ef", "#d0d0cd", "#ababaf", "#85858d", "#66666f"];
  let hash = 0;
  for (let i = 0; i < provider.length; i++) hash = (hash << 5) - hash + provider.charCodeAt(i) | 0;
  return shades[Math.abs(hash) % shades.length];
}
function renderProviderDonutInit(data) {
  const sorted = [...data.providers].sort((a, b) => b.totalCost - a.totalCost);
  const top = sorted.slice(0, 8);
  const restCost = sorted.slice(8).reduce((s, p) => s + p.totalCost, 0);
  const items = top.map((p) => ({ name: p.provider, value: p.totalCost }));
  if (restCost > 0) items.push({ name: "Other", value: restCost });
  const colors = ["#FFB800", "#00D1FF", "#00F593", "#B545FF", "#FF8C00", "#4FC3F7", "#FF6B6B", "#B478FF", "#555568"];
  return `var provDonutData = ${JSON.stringify(items)};
var provDonutColors = ${JSON.stringify(colors)};
function initProviderDonut() {
  var el = document.getElementById('provider-donut');
  if (!el) return;
  var chart = echarts.init(el);
  window.__charts = window.__charts || {};
  window.__charts.providerDonut = chart;
  var option = {
    tooltip: { trigger: 'item', formatter: function(p) { return '<b>' + p.name + '</b><br/>Cost: ' + fmtCost(p.value) + ' (' + p.percent + '%)'; }},
    legend: { type: 'scroll', orient: 'vertical', right: 8, top: 'center', textStyle: { color: '#8888A0', fontSize: 11 } },
    color: provDonutColors,
    series: [{ type: 'pie', radius: ['42%', '70%'], center: ['35%', '50%'], avoidLabelOverlap: false,
      itemStyle: { borderColor: '#111116', borderWidth: 2, borderRadius: 4 },
      label: { show: false }, labelLine: { show: false },
      emphasis: { label: { show: true, fontSize: 13, fontWeight: 'bold', color: '#E8E8F5' }, scaleSize: 6 },
      data: provDonutData }]
  };
  chart.setOption(option);
  chart.resize();
}`;
}
function renderApiCostSection2(data) {
  const apiCost = data.apiCost;
  if (!apiCost || apiCost.byModel.length === 0) return "";
  const rows = apiCost.byModel.filter((m) => m.apiEquivCost !== null || m.reportedCost === 0).sort((a, b) => (b.apiEquivCost ?? 0) - (a.apiEquivCost ?? 0));
  if (rows.length === 0) return "";
  const tableRows = rows.map((m) => {
    const apiStr = m.apiEquivCost != null ? m.estimated ? `<span style="color:var(--missing)">~${fmtCost(m.apiEquivCost)}</span>` : fmtCost(m.apiEquivCost) : '<span style="color:var(--text-faint)">N/A</span>';
    const estTag = m.estimated ? ` <span style="color:var(--missing);font-size:0.8em">(est.)</span>` : "";
    const pricingSrc = m.pricingProvider ? `<span style="color:var(--text-dim);font-size:0.85em">${m.pricingProvider}</span>` : "-";
    const totalTok = m.inputTokens + m.outputTokens + m.reasoningTokens + m.cacheRead + m.cacheWrite;
    const costPer1M = totalTok > 0 && m.apiEquivCost != null ? `$${(m.apiEquivCost / totalTok * 1e6).toFixed(4)}` : "-";
    return `<tr>
      <td><div class="model-cell">${modelIconImg(m.model, 16)}<span class="model-name-text" title="${escapeHtml(m.model)}">${m.model}</span></div></td><td>${m.provider}</td><td>${pricingSrc}</td>
      <td>${m.requests}</td><td>${fmtTokens(m.inputTokens)}</td><td>${fmtTokens(m.outputTokens)}</td>
      <td>${fmtCost(m.reportedCost)}</td><td style="font-weight:600">${apiStr}${estTag}</td><td>${costPer1M}</td>
    </tr>`;
  }).join("\n");
  const totalApi = apiCost.totalApiCost ?? 0;
  const reported = apiCost.reportedCost;
  const diff = totalApi - reported;
  const diffStr = diff > 1e-3 ? `<span style="color:var(--missing)">+${fmtCost(diff)}</span>` : `<span style="color:var(--cache)">${fmtCost(diff)}</span>`;
  return `
  <div class="section">
    <div class="section-title">API Equivalent Cost Analysis</div>
    <p style="font-size:12px;color:var(--text-dim);padding:4px 0 8px">
      For providers that don't report cost, API equivalent cost is estimated using official model pricing (models.dev) &times; token usage.
      <span style="color:var(--missing)">~</span> = MISSING model estimated at 94% hit rate.
    </p>
    <div class="kpi-row" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
      <div class="kpi-card"><div class="kpi-label">Reported Cost</div><div class="kpi-value" style="color:var(--tps)">${fmtCost(reported)}</div></div>
      <div class="kpi-card"><div class="kpi-label">API Equiv. Total</div><div class="kpi-value" style="color:var(--missing)">${apiCost.totalApiCost != null ? fmtCost(totalApi) : "-"}</div></div>
      <div class="kpi-card"><div class="kpi-label">Difference</div><div class="kpi-value">${diffStr}</div></div>
    </div>
    <table id="api-cost-table" class="data-table">
      <thead><tr><th>Model</th><th>Provider</th><th>Pricing Source</th><th>Req</th><th>Input</th><th>Output</th><th>Reported</th><th>API Equiv.</th><th>Cost/1M</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>`;
}
function renderProviderCards(data) {
  const sorted = [...data.providers].sort((a, b) => b.totalTokens - a.totalTokens);
  const top = sorted.slice(0, 12);
  const remaining = sorted.length - 12;
  const totalTokens = sorted.reduce((s, p) => s + p.totalTokens, 0);
  const cards = top.map((p) => {
    const modelCount = data.models.filter((m) => m.provider === p.provider).length;
    const sharePct = totalTokens > 0 ? (p.totalTokens / totalTokens * 100).toFixed(1) : "0";
    return `
    <div class="provider-card" style="border-color:${providerBorderColor(p.provider)}">
      <div class="provider-name">${p.provider}</div>
      <div class="provider-stat"><span class="stat-label">Tokens</span><span>${fmtTokens(p.totalTokens)} <span style="color:var(--text-faint)">(${sharePct}%)</span></span></div>
      <div class="provider-stat"><span class="stat-label">Cost</span><span>${fmtCost(p.totalCost)}</span></div>
      <div class="provider-stat"><span class="stat-label">Requests</span><span>${p.requests}</span></div>
      <div class="provider-stat"><span class="stat-label">Sessions</span><span>${p.sessions}</span></div>
      <div class="provider-stat"><span class="stat-label">Models</span><span>${modelCount}</span></div>
      <div style="height:3px;border-radius:2px;background:var(--border);margin-top:8px;overflow:hidden">
        <div style="height:100%;width:${sharePct}%;background:${providerBorderColor(p.provider)};border-radius:2px"></div>
      </div>
    </div>`;
  }).join("\n");
  const moreHint = remaining > 0 ? `<div class="provider-more">+ ${remaining} more provider${remaining > 1 ? "s" : ""} not shown</div>` : "";
  return cards + moreHint;
}
function renderModelAnalyticsSection(data) {
  const usageRows = sortModelsByUsage(data.models).map((m) => {
    const isMissing = isMissingCache(m.requests, m.cacheRead);
    const hitRate = cacheHitRate(m.inputTokens, m.cacheRead);
    const hitColor = isMissing ? "var(--missing)" : hitRate >= 0.85 ? "var(--cache)" : hitRate >= 0.7 ? "var(--tps)" : "var(--danger)";
    const hitDisplay = isMissing ? "MISSING" : fmtPercent(hitRate);
    const apiItem = data.apiCost?.byModel.find((a) => a.provider === m.provider && a.model === m.model);
    const apiCostStr = apiItem?.apiEquivCost != null ? apiItem.estimated ? `<span style="color:var(--missing)">~${fmtCost(apiItem.apiEquivCost)}</span>` : fmtCost(apiItem.apiEquivCost) : "-";
    const costPer1M = m.totalTokens > 0 && m.totalCost > 0 ? `$${(m.totalCost / m.totalTokens * 1e6).toFixed(4)}` : "-";
    return `<tr>
      <td><div class="model-cell">${modelIconImg(m.model, 16)}<span class="model-name-text" title="${escapeHtml(m.model)}">${m.model}</span></div></td>
      <td>${m.provider}</td>
      <td>${m.requests}</td>
      <td>${m.sessions}</td>
      <td>${fmtTokens(m.totalTokens)}</td>
      <td>${fmtTokens(m.inputTokens)}</td>
      <td>${fmtTokens(m.outputTokens)}</td>
      <td>${fmtTokens(m.reasoningTokens)}</td>
      <td>${fmtTokens(m.cacheRead)}</td>
      <td>${fmtTokens(m.cacheWrite)}</td>
      <td style="color:${hitColor};font-weight:600">${hitDisplay}</td>
      <td>${fmtCost(m.totalCost)}</td>
      <td>${apiCostStr}</td>
      <td>${costPer1M}</td>
    </tr>`;
  }).join("\n");
  const errors = data.errors;
  const hasErrors = !!(errors && errors.failedCount > 0);
  let errorTabBtn = "";
  let errorTabContent = "";
  if (hasErrors) {
    const errorRatePct = (errors.errorRate * 100).toFixed(2) + "%";
    const rateColor = errors.errorRate >= 0.05 ? "var(--danger)" : "var(--tps)";
    const cellColor = errors.errorRate >= 0.05 ? "var(--danger)" : "var(--tps)";
    const errorRows = errors.byModel.filter((m) => m.failed > 0).map((m) => {
      const modelRate = m.total > 0 ? (m.failed / m.total * 100).toFixed(1) + "%" : "-";
      return `<tr>
          <td>${m.provider}</td>
          <td><div class="model-cell">${modelIconImg(m.model, 16)}<span class="model-name-text" title="${escapeHtml(m.model)}">${escapeHtml(m.model)}</span></div></td>
          <td>${m.total}</td>
          <td style="color:var(--danger)">${m.failed}</td>
          <td style="color:var(--tps)">${m.total - m.failed}</td>
          <td style="color:${cellColor}">${modelRate}</td>
        </tr>`;
    }).join("\n");
    errorTabBtn = `
      <button class="tab-btn" data-mtab="errors" onclick="switchModelTab('errors')">
        Failed Requests <span style="color:var(--danger);margin-left:4px;font-size:0.85em">(${errors.failedCount})</span>
      </button>`;
    errorTabContent = `
    <div id="model-tab-errors" class="tab-content">
      <p style="font-size:12px;color:${rateColor};padding:8px 0 6px">
        Overall error rate: <strong>${errorRatePct}</strong> &mdash;
        ${errors.failedCount} failed / ${errors.successCount + errors.failedCount} total
      </p>
      <table id="errors-table" class="data-table">
        <thead><tr>
          <th>Provider</th><th>Model</th><th class="sortable">Total</th>
          <th class="sortable">Failed</th><th class="sortable">Success</th><th class="sortable">Error Rate</th>
        </tr></thead>
        <tbody>${errorRows}</tbody>
      </table>
      <div class="pagination-ctrl" id="errors-table-ctrl">
        <button class="page-btn" id="errors-table-prev">Prev</button>
        <span class="page-info" id="errors-table-info"></span>
        <button class="page-btn" id="errors-table-next">Next</button>
      </div>
    </div>`;
  }
  return `
  <div class="section">
    <div class="section-title">Model Analytics</div>
    <div class="tab-bar">
      <button class="tab-btn active" data-mtab="usage" onclick="switchModelTab('usage')">Usage Breakdown</button>
      ${errorTabBtn}
    </div>

    <div id="model-tab-usage" class="tab-content active">
      <table id="usage-table" class="data-table">
        <thead><tr>
          <th>Model</th><th>Provider</th><th class="sortable">Req</th><th class="sortable">Sess</th><th class="sortable">Total</th>
          <th class="sortable">Input</th><th class="sortable">Output</th><th class="sortable">Reasoning</th><th class="sortable">Cache R</th><th class="sortable">Cache W</th>
          <th class="sortable">Hit Rate</th><th class="sortable">Cost</th><th>API Cost</th><th class="sortable">Cost/1M</th>
        </tr></thead>
        <tbody>${usageRows}</tbody>
      </table>
      <div class="pagination-ctrl" id="usage-table-ctrl">
        <button class="page-btn" id="usage-table-prev">Prev</button>
        <span class="page-info" id="usage-table-info"></span>
        <button class="page-btn" id="usage-table-next">Next</button>
      </div>
    </div>

    ${errorTabContent}
  </div>`;
}
function renderSessionTable(data) {
  const rows = data.sessions.map((s) => {
    return `<tr>
      <td>${s.day}</td>
      <td>${s.provider}</td>
      <td><div class="model-cell">${modelIconImg(s.model, 16)}<span class="model-name-text" title="${escapeHtml(s.model)}">${s.model}</span></div></td>
      <td>${s.requests}</td>
      <td>${fmtTokens(s.totalTokens)}</td>
      <td>${fmtTokens(s.inputTokens)}</td>
      <td>${fmtTokens(s.outputTokens)}</td>
      <td>${fmtTokens(s.cacheRead)}</td>
      <td>${fmtCost(s.totalCost)}</td>
      <td>${escapeHtml(s.title)}</td>
    </tr>`;
  }).join("\n");
  return `
  <div class="section">
    <div class="section-title">Recent Sessions <span class="sub">(${data.sessions.length} sessions, click headers to sort)</span></div>
    <table id="sessions-table" class="data-table">
      <thead><tr>
        <th class="sortable">Day</th><th>Provider</th><th>Model</th><th class="sortable">Req</th><th class="sortable">Total</th>
        <th class="sortable">Input</th><th class="sortable">Output</th><th class="sortable">Cache</th><th class="sortable">Cost</th><th>Title</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="pagination-ctrl" id="sessions-table-ctrl">
      <button class="page-btn" id="sessions-table-prev">Prev</button>
      <span class="page-info" id="sessions-table-info"></span>
      <button class="page-btn" id="sessions-table-next">Next</button>
    </div>
  </div>`;
}
function renderDailyTrendInit(data) {
  const days = data.daily.slice().reverse().map((d) => d.day);
  const tokens = data.daily.slice().reverse().map((d) => d.totalTokens);
  const costs = data.daily.slice().reverse().map((d) => d.totalCost);
  const requests = data.daily.slice().reverse().map((d) => d.requests);
  const ma7 = tokens.map((_, i) => {
    const start = Math.max(0, i - 6);
    const slice = tokens.slice(start, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
  let cumCost = 0;
  const cumCosts = costs.map((c) => {
    cumCost += c;
    return cumCost;
  });
  return `
var dailyDays = ${JSON.stringify(days)};
var dailyTokens = ${JSON.stringify(tokens)};
var dailyCosts = ${JSON.stringify(costs)};
var dailyRequests = ${JSON.stringify(requests)};
var dailyMA7 = ${JSON.stringify(ma7)};
var dailyCumCost = ${JSON.stringify(cumCosts)};

function initDailyChart() {
  var el = document.getElementById('daily-chart');
  if (!el) return;
  var chart = echarts.init(el);
  window.__charts = window.__charts || {};
  window.__charts.daily = chart;
  var option = {
    tooltip: { trigger: 'axis', formatter: function(params) {
      var html = '<b>' + params[0].axisValue + '</b><br/>';
      params.forEach(function(p) {
        if (p.seriesName === 'Cost') html += p.marker + ' ' + p.seriesName + ': ' + fmtCost(p.value) + '<br/>';
        else if (p.seriesName === 'Cum. Cost') html += p.marker + ' ' + p.seriesName + ': ' + fmtCost(p.value) + '<br/>';
        else html += p.marker + ' ' + p.seriesName + ': ' + fmt(p.value) + '<br/>';
      });
      return html;
    }},
    legend: { data: ['Tokens', 'MA(7)', 'Requests', 'Cost', 'Cum. Cost'], textStyle: { color: '#8888A0' }, top: 5, type: 'scroll' },
    grid: { left: 60, right: 70, bottom: 80, top: 50 },
    xAxis: { type: 'category', data: dailyDays, axisLabel: { color: '#8888A0', rotate: window.innerWidth < 700 ? 0 : 45, interval: window.innerWidth < 700 ? Math.max(0, Math.ceil(dailyDays.length / 6) - 1) : 0, fontSize: 10, hideOverlap: true }, axisLine: { lineStyle: { color: '#232330' } } },
    yAxis: [
      { type: 'value', name: 'Tokens', nameTextStyle: { color: '#8888A0' }, axisLabel: { color: '#8888A0', formatter: fmt }, splitLine: { lineStyle: { color: '#232330', type: 'dashed' } } },
      { type: 'value', name: 'Cost', nameTextStyle: { color: '#FFB800' }, axisLabel: { color: '#FFB800', formatter: function(v) { return '$' + v.toFixed(2); } }, splitLine: { show: false } }
    ],
    dataZoom: [{ type: 'slider', bottom: 5, height: 20, borderColor: '#232330', fillerColor: 'rgba(0,213,255,0.08)', handleStyle: { color: '#00D1FF' }, textStyle: { color: '#8888A0' } }],
    series: [
      { name: 'Tokens', type: 'line', data: dailyTokens, smooth: true, symbol: 'none', lineStyle: { color: '#00D1FF', width: 2 }, areaStyle: { color: 'rgba(0,209,255,0.1)' } },
      { name: 'MA(7)', type: 'line', data: dailyMA7, smooth: true, symbol: 'none', lineStyle: { color: '#00F593', width: 2.5, opacity: 0.8 } },
      { name: 'Requests', type: 'line', data: dailyRequests, smooth: true, symbol: 'none', lineStyle: { color: '#B545FF', width: 1.5, opacity: 0.5 } },
      { name: 'Cost', type: 'line', yAxisIndex: 1, data: dailyCosts, smooth: true, symbol: 'none', lineStyle: { color: '#FFB800', width: 2 }, areaStyle: { color: 'rgba(255,184,0,0.08)' } },
      { name: 'Cum. Cost', type: 'line', yAxisIndex: 1, data: dailyCumCost, smooth: true, symbol: 'none', lineStyle: { color: '#FF8C00', width: 1.5, type: 'dashed' } }
    ]
  };
  chart.setOption(option);
  chart.resize();
}`;
}
function renderHeatmapInit(data) {
  const days = data.daily.slice().reverse();
  const heatData = days.map((d) => [d.day, d.totalTokens]);
  const minDate = days.length > 0 ? days[0].day : "";
  const maxDate = days.length > 0 ? days[days.length - 1].day : "";
  return `
var heatData = ${JSON.stringify(heatData)};
function initHeatmapChart() {
  var el = document.getElementById('heatmap-chart');
  if (!el) return;
  var chart = echarts.init(el);
  window.__charts = window.__charts || {};
  window.__charts.heatmap = chart;
  var option = {
    tooltip: { formatter: function(params) { var val = params.value; return '<b>' + val[0] + '</b><br/>Tokens: ' + fmt(Math.round(val[1])); }},
    visualMap: { min: 0, max: 200000000, calculable: true, orient: 'horizontal', left: 'center', bottom: 8, itemWidth: 10, itemHeight: 160,
      formatter: function(v) { return fmt(v); }, textStyle: { color: '#b9a5d8', fontSize: 10 },
      inRange: { color: ['rgba(202,184,232,0)', 'rgba(202,184,232,1)', '#ad87d6', '#8454b7', '#5b2d8e'] } },
    calendar: { left: 30, right: 30, top: 20, bottom: 60, range: ['${minDate}', '${maxDate}'], splitLine: { lineStyle: { color: '#232330' } }, dayLabel: { color: '#8888A0' }, monthLabel: { color: '#8888A0' }, yearLabel: { color: '#8888A0' }, itemStyle: { color: '#111116', borderColor: '#08080B', borderWidth: 2 } },
    series: [{ type: 'heatmap', coordinateSystem: 'calendar', data: heatData }]
  };
  chart.setOption(option);
  chart.resize();
}`;
}
function renderHourlyHeatmapInit(data) {
  const heatmap = data.hourlyHeatmap ?? [];
  const heatData = [];
  let maxVal = 0;
  for (const h of heatmap) {
    heatData.push([h.hour, h.dow, h.totalTokens]);
    if (h.totalTokens > maxVal) maxVal = h.totalTokens;
  }
  const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hours = [];
  for (let i = 0; i < 24; i++) hours.push(i);
  return `
var hourlyData = ${JSON.stringify(heatData)};
var hourlyMax = ${maxVal};
var hourLabels = ${JSON.stringify(hours)};
var dowLabels = ${JSON.stringify(dowNames)};
function initHourlyHeatmap() {
  var el = document.getElementById('hourly-heatmap');
  if (!el) return;
  var chart = echarts.init(el);
  window.__charts = window.__charts || {};
  window.__charts.hourly = chart;
  var option = {
    tooltip: { formatter: function(params) {
      var d = params.value;
       var rawTokens = d[2];
      var reqs = hourlyDataRaw[d[1]] && hourlyDataRaw[d[1]][d[0]] ? hourlyDataRaw[d[1]][d[0]].requests : 0;
      return '<b>' + dowLabels[d[1]] + ' ' + d[0] + ':00</b><br/>Tokens: ' + fmt(Math.round(rawTokens)) + '<br/>Requests: ' + reqs;
    }},
    grid: { left: 60, right: 20, bottom: 34, top: 58 },
    xAxis: { type: 'category', data: hourLabels, name: 'Hour', nameTextStyle: { color: '#8888A0' }, axisLabel: { color: '#8888A0', fontSize: 10 }, axisLine: { lineStyle: { color: '#232330' } }, splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,0.005)', 'rgba(255,255,255,0)'] } } },
    yAxis: { type: 'category', data: dowLabels, axisLabel: { color: '#8888A0', fontSize: 10 }, axisLine: { lineStyle: { color: '#232330' } } },
    visualMap: { min: 0, max: 100000000, calculable: true, orient: 'horizontal', right: 20, top: 8, itemWidth: 10, itemHeight: 150,
      formatter: function(v) { return fmt(v); }, textStyle: { color: '#b9a5d8', fontSize: 10 },
      inRange: { color: ['rgba(202,184,232,0)', 'rgba(202,184,232,1)', '#ad87d6', '#8454b7', '#5b2d8e'] } },
    series: [{ type: 'heatmap', data: hourlyData, label: { show: false }, itemStyle: { borderColor: '#111116', borderWidth: 1 }, emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,245,147,0.5)' } } }]
  };

  // Build raw lookup for tooltip
  var hourlyDataRaw = {};
  ${heatmap.map((h) => `if(!hourlyDataRaw[${h.dow}])hourlyDataRaw[${h.dow}]={};hourlyDataRaw[${h.dow}][${h.hour}]={requests:${h.requests},tokens:${h.totalTokens}};`).join("")}

  chart.setOption(option);
  chart.resize();
}`;
}
function renderCostTrendInit(data) {
  const days = data.daily.slice().reverse().map((d) => d.day);
  const costs = data.daily.slice().reverse().map((d) => d.totalCost);
  let cumCost = 0;
  const cumCosts = costs.map((c) => {
    cumCost += c;
    return cumCost;
  });
  return `
var costDays = ${JSON.stringify(days)};
var dailyCostArr = ${JSON.stringify(costs)};
var cumCostArr = ${JSON.stringify(cumCosts)};
function initCostTrend() {
  var el = document.getElementById('cost-trend-chart');
  if (!el) return;
  var chart = echarts.init(el);
  window.__charts = window.__charts || {};
  window.__charts.costTrend = chart;
  var option = {
    tooltip: { trigger: 'axis', formatter: function(params) {
      var html = '<b>' + params[0].axisValue + '</b><br/>';
      params.forEach(function(p) { html += p.marker + ' ' + p.seriesName + ': ' + fmtCost(p.value) + '<br/>'; });
      return html;
    }},
    legend: { data: ['Daily Cost', 'Cumulative Cost'], textStyle: { color: '#8888A0' }, top: 5 },
    grid: { left: 70, right: 70, bottom: 80, top: 40 },
    xAxis: { type: 'category', data: costDays, axisLabel: { color: '#8888A0', rotate: window.innerWidth < 700 ? 0 : 45, interval: window.innerWidth < 700 ? Math.max(0, Math.ceil(costDays.length / 6) - 1) : 0, fontSize: 10, hideOverlap: true }, axisLine: { lineStyle: { color: '#232330' } } },
    yAxis: [
      { type: 'value', name: 'Daily', nameTextStyle: { color: '#FFB800' }, axisLabel: { color: '#FFB800', formatter: function(v) { return '$' + v.toFixed(2); } }, splitLine: { lineStyle: { color: '#232330', type: 'dashed' } } },
      { type: 'value', name: 'Cumulative', nameTextStyle: { color: '#FF8C00' }, axisLabel: { color: '#FF8C00', formatter: function(v) { return '$' + v.toFixed(1); } }, splitLine: { show: false } }
    ],
    dataZoom: [{ type: 'slider', bottom: 5, height: 20, borderColor: '#232330', fillerColor: 'rgba(255,184,0,0.08)', handleStyle: { color: '#FFB800' }, textStyle: { color: '#8888A0' } }],
    series: [
      { name: 'Daily Cost', type: 'bar', data: dailyCostArr, barMaxWidth: 30, itemStyle: { color: '#FFB800', borderRadius: [3, 3, 0, 0] } },
      { name: 'Cumulative Cost', type: 'line', yAxisIndex: 1, data: cumCostArr, smooth: true, symbol: 'none', lineStyle: { color: '#FF8C00', width: 2.5 }, areaStyle: { color: 'rgba(255,140,0,0.06)' } }
    ]
  };
  chart.setOption(option);
  chart.resize();
}`;
}
function generateTotalUsageHtml(data) {
  const metaStr = renderMeta(data);
  const kpiStr = renderKpiCards2(data);
  const modelChartVisible = data.models.filter((m) => m.totalTokens > 0).length > 0;
  const modelChartJs = modelChartVisible ? renderModelChartInit(data) : "";
  const providerStr = renderProviderCards(data);
  const providerDonutJs = data.providers.length > 0 ? renderProviderDonutInit(data) : "";
  const apiCostStr = renderApiCostSection2(data);
  const modelAnalyticsStr = renderModelAnalyticsSection(data);
  const sessionTableStr = renderSessionTable(data);
  const dailyChartJs = renderDailyTrendInit(data);
  const heatmapJs = renderHeatmapInit(data);
  const hourlyHeatmapJs = (data.hourlyHeatmap ?? []).length > 0 ? renderHourlyHeatmapInit(data) : "";
  const costTrendJs = data.daily.length > 0 ? renderCostTrendInit(data) : "";
  const jsonData = JSON.stringify(data);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Usage Stat Report - Cumulative</title>
${HTML_HEAD_SHARED}
<style>
${BG_ANIMATION_CSS}
${SHARED_CSS}
  .view-btn-bar { display: flex; gap: 6px; margin-bottom: 8px; }
  .view-btn { background: var(--bg-card); border: 1px solid var(--border); color: var(--text-dim); padding: 4px 14px; border-radius: var(--radius-sm); cursor: pointer; font-size: 12px; font-family: 'Inter', sans-serif; transition: all 0.2s var(--ease); }
  .view-btn:hover { border-color: var(--input); color: var(--text); }
  .view-btn.active { background: var(--border); color: var(--input); border-color: var(--input); }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 768px) { .two-col { grid-template-columns: 1fr; } }
</style>
</head>
<body>
${BG_ANIMATION_HTML}
<div class="container">
  <div class="header">
    <div class="header-left">
      <h1><span>Usage Stat</span> Cumulative Report</h1>
    </div>
    <div class="meta">${metaStr}</div>
  </div>

  ${kpiStr}

  <div class="section">
    <div class="section-title">Model Comparison Matrix</div>
    ${modelChartVisible ? `
    <div class="view-btn-bar">
      <button class="view-btn active" data-view="tokens" onclick="switchModelView('tokens')">Tokens</button>
      <button class="view-btn" data-view="cost" onclick="switchModelView('cost')">Cost</button>
      <button class="view-btn" data-view="requests" onclick="switchModelView('requests')">Requests</button>
    </div>
    <div class="chart-box" id="model-chart" style="height:520px"></div>` : '<div class="empty-state">No model usage data in this period.</div>'}
  </div>

  <div class="section">
    <div class="section-title">Usage Timeline</div>
    <div class="tab-bar">
      <button class="tab-btn active" data-tab="daily" onclick="switchTab('daily')">Daily Trend</button>
      <button class="tab-btn" data-tab="heatmap" onclick="switchTab('heatmap')">Calendar Heatmap</button>
      ${hourlyHeatmapJs ? `<button class="tab-btn" data-tab="hourly" onclick="switchTab('hourly')">Activity Hours</button>` : ""}
      ${costTrendJs ? `<button class="tab-btn" data-tab="cost" onclick="switchTab('cost')">Cost Trend</button>` : ""}
    </div>
    <div id="tab-daily" class="tab-content active">
      <div class="chart-box" id="daily-chart"></div>
    </div>
    <div id="tab-heatmap" class="tab-content">
      <div class="chart-box" id="heatmap-chart"></div>
    </div>
    ${hourlyHeatmapJs ? `<div id="tab-hourly" class="tab-content"><div class="chart-box" id="hourly-heatmap" style="height:300px"></div></div>` : ""}
    ${costTrendJs ? `<div id="tab-cost" class="tab-content"><div class="chart-box" id="cost-trend-chart"></div></div>` : ""}
  </div>

  <div class="two-col" style="margin-bottom:28px">
    <div class="section" style="margin-bottom:0">
      <div class="section-title">Provider Summary</div>
      <div class="provider-row">${providerStr}</div>
    </div>
    <div class="section" style="margin-bottom:0">
      <div class="section-title">Cost Share by Provider</div>
      ${data.providers.length > 0 ? '<div class="chart-box" id="provider-donut" style="height:280px"></div>' : '<div class="empty-state">No provider data.</div>'}
    </div>
  </div>

  ${modelAnalyticsStr}

  ${apiCostStr}

  ${sessionTableStr}

  <div class="footer">
    Generated by opencode-usage-stat &middot; Data: OpenCode V2 API &middot; Export:
    <a href="javascript:void(0)" onclick="downloadJSON()">JSON</a>
  </div>
</div>

<script id="report-data" type="application/json">${jsonData}</script>

<script>
${SHARED_JS}

${BG_PARTICLE_JS}

window.switchTab = function(name) {
  document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.tab-btn[data-tab]').forEach(function(el) { el.classList.remove('active'); });
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelector('[data-tab="' + name + '"]').classList.add('active');
  setTimeout(function() {
    if (name === 'daily' && window.__charts && window.__charts.daily) window.__charts.daily.resize();
    if (name === 'heatmap' && window.__charts && window.__charts.heatmap) window.__charts.heatmap.resize();
    if (name === 'hourly' && window.__charts && window.__charts.hourly) window.__charts.hourly.resize();
    if (name === 'cost' && window.__charts && window.__charts.costTrend) window.__charts.costTrend.resize();
  }, 50);
};

window.switchModelTab = function(name) {
  document.querySelectorAll('[data-mtab]').forEach(function(el) { el.classList.remove('active'); });
  ['model-tab-usage', 'model-tab-errors'].forEach(function(id) { var el = document.getElementById(id); if (el) el.classList.remove('active'); });
  var activeTab = document.getElementById('model-tab-' + name);
  if (activeTab) activeTab.classList.add('active');
  var activeBtn = document.querySelector('[data-mtab="' + name + '"]');
  if (activeBtn) activeBtn.classList.add('active');
};

window.downloadJSON = function() {
  var d = document.getElementById('report-data'); if (!d) return;
  var b = new Blob([d.textContent], { type: 'application/json' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'usage-stat-data.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 100);
};

${modelChartJs}
${providerDonutJs}
${dailyChartJs}
${heatmapJs}
${hourlyHeatmapJs}
${costTrendJs}

document.addEventListener('DOMContentLoaded', function() {
  initDashboardMotion();
  initCountUp();
  ${modelChartVisible ? "initModelChart();" : ""}
  ${data.providers.length > 0 ? "initProviderDonut();" : ""}
  initDailyChart();
  initHeatmapChart();
  ${hourlyHeatmapJs ? "initHourlyHeatmap();" : ""}
  ${costTrendJs ? "initCostTrend();" : ""}
  makeSortable('usage-table');
  makeSortable('errors-table');
  makeSortable('sessions-table');
  makeSortable('api-cost-table');
  initPaginator('usage-table', 15);
  initPaginator('errors-table', 15);
  initPaginator('sessions-table', 15);
  initPaginator('api-cost-table', 15);
});
</script>
</body>
</html>`;
}

// src/commands.tsx
import { execSync as execSync2, spawn } from "node:child_process";
import { existsSync as existsSync7, mkdirSync, writeFileSync as writeFileSync4, readdirSync, statSync as statSync2, unlinkSync } from "node:fs";
import { join as join7 } from "node:path";
import { homedir as homedir5 } from "node:os";
var REPORT_PREFIX = "usage-stat-";
function ensureReportDir() {
  const dir = join7(homedir5(), ".opencode", "reports");
  if (!existsSync7(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
function openInBrowser(filePath) {
  try {
    const platform = process.platform;
    if (platform === "win32") {
      try {
        spawn("explorer.exe", [filePath], { detached: true, stdio: "ignore" }).unref();
        return;
      } catch {
      }
      try {
        execSync2(`start "" "${filePath}"`, { timeout: 5e3 });
      } catch {
      }
    } else if (platform === "darwin") {
      execSync2(`open "${filePath}"`, { timeout: 5e3 });
    } else {
      execSync2(`xdg-open "${filePath}"`, { timeout: 5e3 });
    }
  } catch {
  }
}
var MAX_REPORTS = 50;
function cleanupOldReports(dir) {
  try {
    const files = readdirSync(dir).filter((f) => f.startsWith(REPORT_PREFIX) && f.endsWith(".html")).map((f) => ({ name: f, path: join7(dir, f), mtime: statSync2(join7(dir, f)).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
    if (files.length > MAX_REPORTS) {
      for (const f of files.slice(MAX_REPORTS)) {
        try {
          unlinkSync(f.path);
        } catch {
        }
      }
    }
  } catch {
  }
}
function dateTimeStamp() {
  const d = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}
function nowString2() {
  const d = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function currentSessionId(context) {
  try {
    const route = context.ui.router.current();
    if (route?.type === "session") return route.sessionID;
  } catch {
  }
  return void 0;
}
async function buildCombinedData(context, filters = {}) {
  const report = await getUsageReport(filters);
  const hourlyHeatmap = await getHourlyHeatmap(filters);
  const logs = readLogs(200);
  const perfSummary = readPersistedStats();
  const meta = {
    generatedAt: nowString2(),
    dateRange: {
      start: report.daily.length > 0 ? report.daily[report.daily.length - 1].day : "\u2014",
      end: report.daily.length > 0 ? report.daily[0].day : "\u2014"
    }
  };
  const apiCostByModel = report.models.map((m) => {
    const est = estimateApiCost(
      m.provider,
      m.model,
      m.requests,
      m.inputTokens,
      m.outputTokens,
      m.reasoningTokens,
      m.cacheRead,
      m.cacheWrite
    );
    return {
      provider: m.provider,
      model: m.model,
      requests: m.requests,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      reasoningTokens: m.reasoningTokens,
      cacheRead: m.cacheRead,
      cacheWrite: m.cacheWrite,
      reportedCost: m.totalCost,
      apiEquivCost: est.cost,
      estimated: est.estimated,
      pricingProvider: est.pricingProvider
    };
  });
  const apiTotal = apiCostByModel.reduce((sum, m) => sum + (m.apiEquivCost ?? 0), 0);
  const apiCost = {
    totalApiCost: apiTotal > 0 ? apiTotal : null,
    reportedCost: report.summary.totalCost,
    byModel: apiCostByModel
  };
  return {
    ...report,
    meta,
    apiCost,
    errors: report.errors,
    hourlyHeatmap,
    perfLogs: logs,
    perfSummary
  };
}
async function showHtmlReport(context, filters = {}) {
  try {
    const data = await buildCombinedData(context, filters);
    const html = generateTotalUsageHtml(data);
    const dir = ensureReportDir();
    const filePath = join7(dir, `${REPORT_PREFIX}total-${dateTimeStamp()}.html`);
    writeFileSync4(filePath, html, "utf-8");
    cleanupOldReports(dir);
    context.ui.toast.show({ message: `Report: ${filePath}`, variant: "info" });
    openInBrowser(filePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    context.ui.toast.show({ message: `Error: ${msg}`, variant: "error" });
  }
}
async function showHtmlSessionReport(context) {
  const sessionId = currentSessionId(context);
  try {
    if (!sessionId) {
      context.ui.toast.show({ message: "No active session. Open a session first.", variant: "error" });
      return;
    }
    const childIds = await getChildSessionIds(sessionId);
    const allIds = [sessionId, ...childIds];
    const filters = { sessionIds: allIds };
    const [summary, models, messages, errors, sessionTitle] = await Promise.all([
      getSummary(filters),
      getModelBreakdown(filters),
      getMessageDetails(sessionId),
      getErrorStats(filters),
      getSessionTitle(sessionId)
    ]);
    const data = await buildSessionReportData(sessionId, sessionTitle, childIds.length, summary, models, messages, errors);
    const html = generateSessionUsageHtml(data);
    const dir = ensureReportDir();
    const filePath = join7(dir, `${REPORT_PREFIX}session-${dateTimeStamp()}.html`);
    writeFileSync4(filePath, html, "utf-8");
    cleanupOldReports(dir);
    context.ui.toast.show({ message: `Report: ${filePath}`, variant: "info" });
    openInBrowser(filePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    context.ui.toast.show({ message: `Error: ${msg}`, variant: "error" });
  }
}
async function showJsonExport(context) {
  try {
    const data = await buildCombinedData(context, {});
    const dir = ensureReportDir();
    const filePath = join7(dir, `${REPORT_PREFIX}data-${dateTimeStamp()}.json`);
    writeFileSync4(filePath, JSON.stringify(data, null, 2), "utf-8");
    context.ui.toast.show({ message: `JSON: ${filePath}`, variant: "info" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    context.ui.toast.show({ message: `Error: ${msg}`, variant: "error" });
  }
}
async function showHtmlReportRangeMenu(context) {
  const choice = await context.ui.dialog.select({
    title: t("cmdTitleHtml"),
    placeholder: "Select date range...",
    options: [
      { title: `\u{1F4C4} ${t("menuToday")}`, value: "today" },
      { title: `\u{1F4C4} ${t("menu7d")}`, value: "7d" },
      { title: `\u{1F4C4} ${t("menu30d")}`, value: "30d" },
      { title: `\u{1F4C4} ${t("menuAll")}`, value: "all" }
    ]
  });
  if (!choice) return;
  const d = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  switch (choice) {
    case "today":
      await showHtmlReport(context, { startDate: today, endDate: today });
      break;
    case "7d":
      await showHtmlReport(context, getPresetRange("7d"));
      break;
    case "30d":
      await showHtmlReport(context, getPresetRange("30d"));
      break;
    default:
      await showHtmlReport(context, getPresetRange("all"));
      break;
  }
}
async function showUsageMenu(context) {
  try {
    const lang = await loadLanguageFromStorage(context);
    if (lang) setLanguage(lang);
  } catch {
  }
  const choice = await context.ui.dialog.select({
    title: t("panelTitle"),
    placeholder: "Select an action...",
    options: [
      { title: `\u{1F5C2} ${t("menuCurrentSession")}`, value: "session", description: "Current session + subagents HTML dashboard" },
      { title: `\u{1F4C4} ${t("cmdTitleHtml")} \u25B8`, value: "html", description: t("cmdDescHtml") },
      { title: t("cmdTitleJson"), value: "json", description: t("cmdDescJson") },
      { title: `${t("cmdTitleSettings")} \u25B8`, value: "settings", description: t("cmdDescSettings") }
    ]
  });
  switch (choice) {
    case "session":
      await showHtmlSessionReport(context);
      break;
    case "html":
      await showHtmlReportRangeMenu(context);
      break;
    case "json":
      await showJsonExport(context);
      break;
    case "settings":
      await showSettingsDialog(context);
      break;
  }
}
var DEFAULT_SETTINGS = { showPerformance: true, showPricing: true, showTrend: true };
async function loadSidebarSettings(context) {
  try {
    const [store] = context.storage.store("usage-stat-config", { initial: DEFAULT_SETTINGS });
    return { ...DEFAULT_SETTINGS, ...store };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
async function loadLanguageFromStorage(context) {
  try {
    const [store] = context.storage.store("usage-stat-config", { initial: { language: "auto" } });
    return store.language ?? null;
  } catch {
    return null;
  }
}
async function showSettingsDialog(context) {
  const cfg = await loadSidebarSettings(context);
  const choice = await context.ui.dialog.select({
    title: t("settingsTitle"),
    placeholder: t("settingsPlaceholder"),
    options: [
      { title: `${cfg.showPerformance ? "\u2713 " : "  "}${t("showPerformance")}`, value: "showPerformance", description: t("descShowPerformance") },
      { title: `${cfg.showPricing ? "\u2713 " : "  "}${t("showPricing")}`, value: "showPricing", description: t("descShowPricing") },
      { title: `${cfg.showTrend ? "\u2713 " : "  "}${t("showTrend")}`, value: "showTrend", description: t("descShowTrend") },
      { title: `${t("settingsLanguage")} \u25B8`, value: "language", description: t("descSettingsLanguage") },
      { title: t("done"), value: "done", description: t("closeSettings") }
    ]
  });
  if (!choice) return;
  try {
    const [, mutate] = context.storage.store("usage-stat-config", { initial: DEFAULT_SETTINGS });
    if (choice === "language") {
      await showLanguageMenu(context);
    } else if (choice !== "done") {
      await mutate((d) => {
        d[choice] = !d[choice];
      });
      await showSettingsDialog(context);
    }
  } catch {
  }
}
async function showLanguageMenu(context) {
  let current = "auto";
  try {
    current = await loadLanguageFromStorage(context) ?? "auto";
  } catch {
  }
  const choice = await context.ui.dialog.select({
    title: t("settingsLanguage"),
    placeholder: t("settingsLanguage"),
    options: [
      { title: `${current === "auto" ? "\u2713 " : "  "}${t("langAuto")}`, value: "auto" },
      { title: `${current === "zh" ? "\u2713 " : "  "}\u4E2D\u6587`, value: "zh" },
      { title: `${current === "en" ? "\u2713 " : "  "}English`, value: "en" }
    ]
  });
  if (!choice) return;
  setLanguage(choice);
  try {
    const [, mutate] = context.storage.store("usage-stat-config", { initial: { language: "auto" } });
    await mutate((d) => {
      d.language = choice;
    });
  } catch {
  }
}
function registerCommands(context) {
  try {
    setV2Client(context.client);
  } catch {
  }
  context.keymap.layer(() => ({
    mode: "base",
    commands: [
      {
        id: "usage-stat.usage",
        title: "Usage Stat",
        description: "Token use dashboards, provider balances, exports and settings",
        group: "Stats",
        palette: true,
        slash: { name: "usage" },
        run: () => {
          void showUsageMenu(context);
        }
      },
      {
        id: "usage-stat.session-usage",
        title: "Session Usage",
        description: "Generate the current session's HTML usage report locally",
        group: "Stats",
        palette: true,
        slash: { name: "session-usage" },
        run: () => {
          void showHtmlSessionReport(context);
        }
      },
      {
        id: "usage-stat.total-usage",
        title: "Total Usage",
        description: "Generate a cumulative HTML usage report (all time) locally",
        group: "Stats",
        palette: true,
        slash: { name: "total-usage" },
        run: () => {
          void showHtmlReport(context, getPresetRange("all"));
        }
      }
    ]
  }));
}

// src/sidebar.tsx
var DEFAULT_CONFIG = {
  sidebar: { showPerformance: true, showPricing: true, showTrend: true },
  language: "auto"
};
function progressBarWidth(percent, width) {
  if (percent >= 100) return width;
  return Math.floor(percent / 100 * width);
}
function progressFilled(percent, width) {
  return "\u2588".repeat(Math.max(0, progressBarWidth(percent, width)));
}
function progressRemaining(percent, width) {
  return "\u2591".repeat(Math.max(0, width - progressBarWidth(percent, width)));
}
function getVisualWidth(str) {
  let w = 0;
  for (const c of str) {
    const code = c.codePointAt(0) ?? 0;
    if (code >= 19968 && code <= 40959 || code >= 12352 && code <= 12543 || code >= 44032 && code <= 55203 || code >= 4352 && code <= 4607 || code >= 11904 && code <= 12031) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}
function centerAlign(text, width) {
  const visualW = getVisualWidth(text);
  if (visualW >= width) return text;
  const left = Math.floor((width - visualW) / 2);
  const right = width - visualW - left;
  return " ".repeat(left) + text + " ".repeat(right);
}
function hitRateColor(rate) {
  if (rate >= 85) return RGBA3.fromInts(76, 175, 80, 255);
  if (rate >= 70) return RGBA3.fromInts(255, 193, 7, 255);
  return RGBA3.fromInts(244, 67, 54, 255);
}
var COLLAPSE_INITIAL = { global: false, models: {} };
function loadConfig(context) {
  const base = { sidebar: { ...DEFAULT_CONFIG.sidebar }, language: DEFAULT_CONFIG.language };
  try {
    const pluginCfg = context.options;
    if (pluginCfg?.sidebar) Object.assign(base.sidebar, pluginCfg.sidebar);
    if (pluginCfg?.language) base.language = pluginCfg.language;
  } catch {
  }
  return base;
}
function UsageStatPanel(props) {
  const { context, perfTracker } = props;
  registerCommands(context);
  const [config, setConfig] = createSignal2(loadConfig(context));
  setLanguage(config().language);
  createEffect2(() => setLanguage(config().language));
  const t2 = (key) => {
    void config().language;
    return t(key);
  };
  const isEnglish = (str) => /^[a-zA-Z\s\.\/]+$/.test(str);
  const [collapse, setCollapse] = createSignal2(COLLAPSE_INITIAL);
  let collapseMutate = () => Promise.resolve();
  try {
    const [store, mutate] = context.storage.store("usage-stat-collapse", { initial: COLLAPSE_INITIAL });
    const read = () => store;
    createEffect2(() => {
      const s = read();
      setCollapse({ ...s });
    });
    collapseMutate = mutate;
  } catch {
  }
  const [panelWidth, setPanelWidth] = createSignal2(38);
  let outerBoxRef = null;
  const colors = resolveThemeColors(context.theme);
  const primaryColor = () => colors.primary;
  const mutedColor = () => colors.muted;
  const dimColor = () => colors.dim;
  const greenColor = () => colors.green;
  const borderColor = () => colors.border;
  const missingColor = () => colors.purple;
  const modelStats = createMemo(() => {
    const map = /* @__PURE__ */ new Map();
    const msgs = props.allTokenMessages();
    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      const key = `${msg.providerID}/${msg.modelID}`;
      let e = map.get(key);
      if (!e) {
        e = { providerID: msg.providerID, modelID: msg.modelID, totalInput: 0, totalOutput: 0, totalReasoning: 0, cacheRead: 0, cacheWrite: 0, totalCost: 0, requestCount: 0, lastMessageIndex: -1 };
        map.set(key, e);
      }
      e.totalInput += msg.inputTokens;
      e.totalOutput += msg.outputTokens;
      e.totalReasoning += msg.reasoningTokens;
      e.cacheRead += msg.cacheRead;
      e.cacheWrite += msg.cacheWrite;
      e.totalCost += msg.cost;
      e.requestCount++;
      e.lastMessageIndex = i;
    }
    return Array.from(map.entries()).filter(([, s]) => s.totalInput + s.totalOutput + s.totalReasoning + s.cacheRead + s.cacheWrite > 0).sort((a, b) => b[1].lastMessageIndex - a[1].lastMessageIndex);
  });
  const sessionTotals = createMemo(() => {
    let i = 0, o = 0, ir = 0, cr = 0, cw = 0, r = 0, c = 0;
    for (const [, s] of modelStats()) {
      i += s.totalInput;
      o += s.totalOutput;
      ir += s.totalReasoning;
      cr += s.cacheRead;
      cw += s.cacheWrite;
      r += s.requestCount;
      c += s.totalCost;
    }
    return { totalInput: i, totalOutput: o, totalReasoning: ir, totalCacheRead: cr, totalCacheWrite: cw, totalRequests: r, totalCost: c, totalTokens: i + o + ir + cr + cw };
  });
  const globalHitRate = createMemo(() => {
    let i = 0, cr = 0;
    for (const [, s] of modelStats()) {
      if (isMissingCache(s.requestCount, s.cacheRead)) continue;
      i += s.totalInput;
      cr += s.cacheRead;
    }
    const denom = i + cr;
    return denom > 0 ? cr / denom * 100 : -1;
  });
  const modelHitRate = createMemo(() => {
    return modelStats().map(([key, stat]) => {
      const denom = stat.totalInput + stat.cacheRead;
      if (denom === 0) return { key, rate: 0, msgs: [] };
      const msgs = [];
      for (const msg of props.allTokenMessages()) {
        if (`${msg.providerID}/${msg.modelID}` !== key) continue;
        msgs.push(msg);
      }
      return { key, rate: stat.cacheRead / denom * 100, msgs };
    });
  });
  const modelTrend = createMemo(() => {
    return modelHitRate().map(({ key, msgs }) => {
      if (msgs.length < 6) return { key, trend: null };
      const sumSlice = (start, end) => {
        let sumCache = 0, sumTotal = 0;
        for (let i = start; i < end && i < msgs.length; i++) {
          sumCache += msgs[i].cacheRead;
          sumTotal += msgs[i].inputTokens + msgs[i].cacheRead;
        }
        return { sumCache, sumTotal };
      };
      const n = msgs.length;
      const recent = sumSlice(n - 3, n);
      const prev = sumSlice(n - 6, n - 3);
      const rateRecent = recent.sumTotal > 0 ? recent.sumCache / recent.sumTotal * 100 : 0;
      const ratePrev = prev.sumTotal > 0 ? prev.sumCache / prev.sumTotal * 100 : 0;
      return { key, trend: rateRecent - ratePrev };
    });
  });
  const [partVersion, setPartVersion] = createSignal2(0);
  const perfStats = createMemo(() => {
    void props.allTokenMessages();
    void partVersion();
    void props.revision();
    return perfTracker.getSessionStats();
  });
  onCleanup2(() => {
  });
  const innerWidth = () => panelWidth() - 2;
  const barWidth = () => Math.max(8, innerWidth() - 19);
  const divider = () => {
    const w = innerWidth();
    if (w <= 2) return "\u2500".repeat(w);
    return " " + "\u2500".repeat(w - 2) + " ";
  };
  const toggle = {
    global: () => {
      const next = !collapse().global;
      setCollapse((current) => ({ ...current, global: next }));
      void collapseMutate((draft) => {
        draft.global = next;
      });
    },
    model: (key) => {
      const next = collapse().models[key] !== true;
      setCollapse((current) => ({ ...current, models: { ...current.models, [key]: next } }));
      void collapseMutate((draft) => {
        draft.models[key] = next;
      });
    }
  };
  return <box
    ref={(el) => {
      outerBoxRef = el;
    }}
    onSizeChange={() => {
      if (outerBoxRef) setPanelWidth(outerBoxRef.width);
    }}
    flexDirection="column"
    border={true}
    borderStyle="rounded"
    borderColor={borderColor()}
  >
      {
    /* Header */
  }
      <box flexDirection="row" justifyContent="space-between" onMouseDown={toggle.global} paddingX={1}>
        <text fg={primaryColor()}>{collapse().global ? "\u25B6" : "\u25BE"} {t2("panelTitle")}</text>
        <text fg={mutedColor()}>
          {collapse().global ? <>{formatTokens(sessionTotals().totalTokens)}
              {globalHitRate() >= 0 ? <span style={{ fg: hitRateColor(globalHitRate()) }}>{` (${globalHitRate().toFixed(1)}% hit)`}</span> : ""}
            </> : globalHitRate() >= 0 ? <span style={{ fg: hitRateColor(globalHitRate()) }}>{`${globalHitRate().toFixed(1)}% hit`}</span> : ""}
        </text>
      </box>

      {
    /* Provider Usage reveals collapsed after quota changes in this TUI session. */
  }
      <ProviderUsageBlocks context={context} />

      <Show2 when={!collapse().global}>
        <text fg={borderColor()}>{divider()}</text>

        {
    /* Global stats */
  }
        <box flexDirection="row" paddingX={1}>
          <For2 each={[
    { val: formatTokens(sessionTotals().totalTokens), lbl: t2("total") },
    { val: sessionTotals().totalRequests.toString(), lbl: t2("requests") },
    { val: formatTokens(sessionTotals().totalInput), lbl: t2("input") },
    { val: formatTokens(sessionTotals().totalOutput), lbl: t2("output") }
  ]}>
            {(item, idx) => {
    const colW = () => {
      const totalW = panelWidth() - 4;
      const base = Math.floor(totalW / 4);
      return idx() === 3 ? totalW - base * 3 : base;
    };
    return <box width={colW()} flexDirection="column">
                  <text fg={primaryColor()}>{centerAlign(item.val, colW())}</text>
                  <text fg={dimColor()}>{centerAlign(isEnglish(item.lbl) ? item.lbl.toUpperCase() : item.lbl, colW())}</text>
                </box>;
  }}
          </For2>
        </box>

        <Show2 when={config().sidebar.showPricing && sessionTotals().totalCost > 0}>
          <box flexDirection="row" justifyContent="center" marginTop={1}>
            <text fg={mutedColor()}>{t2("cost")}: <span style={{ fg: greenColor() }}>{formatCost(sessionTotals().totalCost)}</span></text>
          </box>
        </Show2>

        {
    /* Model blocks */
  }
        <For2 each={modelStats()}>
          {([key, stat]) => {
    const isExpanded = () => collapse().models[key] !== true;
    const hitDenom = stat.totalInput + stat.cacheRead;
    const hitRate = hitDenom > 0 ? stat.cacheRead / hitDenom * 100 : 0;
    const isMissing = isMissingCache(stat.requestCount, stat.cacheRead);
    const modelTotalTokens = stat.totalInput + stat.totalOutput + stat.totalReasoning + stat.cacheRead + stat.cacheWrite;
    const trendStr = () => {
      if (!config().sidebar.showTrend) return "";
      const td = modelTrend().find((h) => h.key === key);
      if (!td?.trend || td.trend === 0) return "";
      return td.trend > 0 ? ` ${t2("trendUp")}${td.trend.toFixed(1)}%` : ` ${t2("trendDown")}${Math.abs(td.trend).toFixed(1)}%`;
    };
    const trendColor = () => (modelTrend().find((h) => h.key === key)?.trend ?? 0) >= 0 ? RGBA3.fromInts(63, 185, 80, 255) : RGBA3.fromInts(244, 67, 54, 255);
    const MAX_PROVIDER_LEN = 12;
    let providerDisplay = stat.providerID;
    if (providerDisplay.length > MAX_PROVIDER_LEN) providerDisplay = providerDisplay.slice(0, MAX_PROVIDER_LEN - 1) + "\u2026";
    let fullTitle = `${providerDisplay}/${stat.modelID}`;
    if (fullTitle.length > 22) {
      const parts = fullTitle.split("/");
      if (parts.length >= 3) fullTitle = `${parts[0]}/${parts[parts.length - 1]}`;
    }
    const maxNameLen = Math.max(8, innerWidth() - 12);
    const shortTitle = fullTitle.length > maxNameLen ? fullTitle.slice(0, maxNameLen - 1) + "\u2026" : fullTitle;
    const modelHeaderRight = () => isExpanded() ? `\xD7${stat.requestCount} \u25BE` : `${formatTokens(modelTotalTokens)} \u25B6`;
    const targetW = () => Math.max(getVisualWidth(`${t2("cache")}:`), getVisualWidth(`${t2("cost")}:`));
    const paddedCachePrefix = () => {
      const label = `${t2("cache")}:`;
      return label + " ".repeat(targetW() - getVisualWidth(label));
    };
    const paddedCostPrefix = () => {
      const label = `${t2("cost")}:`;
      return label + " ".repeat(targetW() - getVisualWidth(label));
    };
    const modelBarWidth = () => Math.max(8, panelWidth() - 4 - targetW() - 11);
    return <box flexDirection="column" marginTop={1}>
                <box flexDirection="row" justifyContent="space-between" onMouseDown={() => toggle.model(key)} paddingX={1}>
                  <text fg={mutedColor()}>
                    <span style={{ fg: isMissing ? missingColor() : hitRateColor(hitRate) }}>●</span>{" "}
                    <span style={{ fg: primaryColor() }}>{shortTitle}</span>
                  </text>
                  <text fg={mutedColor()}>{modelHeaderRight()}</text>
                </box>

                <Show2 when={isExpanded()}>
                  <box flexDirection="column" paddingX={1}>
                    <box flexDirection="column" border={true} borderStyle="rounded" borderColor={borderColor()}>
                      <box flexDirection="row">
                        <For2 each={[
      { val: formatTokens(modelTotalTokens), lbl: t2("total") },
      { val: formatTokens(stat.totalInput), lbl: t2("input") },
      { val: formatTokens(stat.totalOutput), lbl: t2("output") }
    ]}>
                          {(item, idx) => {
      const colW = () => {
        const totalW = panelWidth() - 6;
        const base = Math.floor(totalW / 3);
        return idx() === 2 ? totalW - base * 2 : base;
      };
      return <box width={colW()} flexDirection="column">
                                <text fg={primaryColor()}>{centerAlign(item.val, colW())}</text>
                                <text fg={dimColor()}>{centerAlign(isEnglish(item.lbl) ? item.lbl.toUpperCase() : item.lbl, colW())}</text>
                              </box>;
    }}
                        </For2>
                      </box>
                    </box>

                    <text fg={mutedColor()}>
                      {paddedCachePrefix()}
                      {isMissing ? <span style={{ fg: missingColor() }}>{progressRemaining(0, modelBarWidth())}{" "}{t2("missing")}</span> : <span style={{ fg: hitRateColor(hitRate) }}>
                          {progressFilled(hitRate, modelBarWidth())}{progressRemaining(hitRate, modelBarWidth())}{" "}{hitRate.toFixed(0)}%
                        </span>}
                      {trendStr() ? <span style={{ fg: trendColor() }}>{trendStr()}</span> : null}
                    </text>

                    <Show2 when={config().sidebar.showPerformance && !!perfStats().models[key]}>
                      <text fg={mutedColor()} marginTop={1}>
                        {t2("ttft")} <span style={{ fg: primaryColor() }}>{formatDuration(perfStats().models[key]?.avgTTFT ?? null)}</span>
                        {"  "}{t2("tps")} <span style={{ fg: primaryColor() }}>{perfStats().models[key]?.avgTPS?.toFixed(1) ?? "\u2014"}</span>
                        {"  "}{t2("lat")} <span style={{ fg: primaryColor() }}>{formatDuration(perfStats().models[key]?.avgLatency ?? null)}</span>
                      </text>
                    </Show2>

                    <Show2 when={config().sidebar.showPricing && stat.totalCost > 0}>
                      <text fg={mutedColor()}>{paddedCostPrefix()}{formatCost(stat.totalCost)}</text>
                    </Show2>
                  </box>
                </Show2>
              </box>;
  }}
        </For2>
      </Show2>
    </box>;
}

// src/tui.tsx
function messageToTokenMessage(msg, sessionID) {
  if (!msg || msg?.type !== "assistant") return null;
  const tokens = msg?.tokens;
  if (!tokens || typeof tokens !== "object") return null;
  if ((tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0) === 0) return null;
  return {
    id: msg.id,
    sessionID,
    providerID: msg.model?.providerID ?? "unknown",
    modelID: msg.model?.id ?? msg.model?.modelID ?? "unknown",
    inputTokens: tokens.input ?? 0,
    outputTokens: tokens.output ?? 0,
    reasoningTokens: tokens.reasoning ?? 0,
    cacheRead: tokens.cache?.read ?? 0,
    cacheWrite: tokens.cache?.write ?? 0,
    cost: msg.cost ?? 0
  };
}
var plugin = Plugin.define({
  id: "opencode-usage-stat",
  setup: async (context) => {
    const perfTracker = createPerfTracker();
    const [sidebarRevision, setSidebarRevision] = createSignal3(0);
    const [allTokenMessages, setAllTokenMessages] = createSignal3([]);
    let currentSessionID = "";
    let currentFamily = [];
    const cleanups = [];
    const knownCompleted = /* @__PURE__ */ new Map();
    const unsubInboxEnqueued = context.data.on("session.inbox.enqueued", (event) => {
      perfTracker.handleInboxEnqueued(event);
    });
    cleanups.push(unsubInboxEnqueued);
    const unsubInboxDelivered = context.data.on("session.inbox.delivered", (event) => {
      perfTracker.handleInboxDelivered(event);
    });
    cleanups.push(unsubInboxDelivered);
    const unsubStepStarted = context.data.on("session.step.started", (event) => {
      perfTracker.handleStepStarted(event);
    });
    cleanups.push(unsubStepStarted);
    const unsubPart = context.data.on("session.text.started", (event) => {
      perfTracker.handlePartUpdated({
        message_id: event?.data?.assistantMessageID,
        session_id: event?.data?.sessionID,
        type: "text",
        time: { start: event?.created }
      });
    });
    cleanups.push(unsubPart);
    const unsubReasoning = context.data.on("session.reasoning.started", (event) => {
      perfTracker.handlePartUpdated({
        message_id: event?.data?.assistantMessageID,
        session_id: event?.data?.sessionID,
        type: "reasoning",
        time: { start: event?.created }
      });
    });
    cleanups.push(unsubReasoning);
    const unsubTextEnded = context.data.on("session.text.ended", (event) => {
      perfTracker.handlePartEnded({
        message_id: event?.data?.assistantMessageID,
        type: "text",
        time: { start: event?.created }
      });
    });
    cleanups.push(unsubTextEnded);
    const unsubReasoningEnded = context.data.on("session.reasoning.ended", (event) => {
      perfTracker.handlePartEnded({
        message_id: event?.data?.assistantMessageID,
        type: "reasoning",
        time: { start: event?.created }
      });
    });
    cleanups.push(unsubReasoningEnded);
    const unsubUsage = context.data.on("session.usage.updated", (event) => {
      const sessionID = event?.data?.sessionID;
      if (sessionID && currentFamily.includes(sessionID)) void refreshSession(sessionID, true);
      setSidebarRevision((v) => v + 1);
    });
    cleanups.push(unsubUsage);
    function familyFor(sessionID) {
      if (!sessionID) return [];
      const session = context.data.session.get(sessionID);
      if (session?.parentID) return [sessionID];
      const family = context.data.session.family(sessionID);
      return family.length > 0 ? [...family] : [sessionID];
    }
    function updateTokenMessages() {
      const seen = /* @__PURE__ */ new Set();
      const messages = [];
      for (const sessionID of currentFamily) {
        for (const message of context.data.session.message.list(sessionID) ?? []) {
          const tokenMessage = messageToTokenMessage(message, sessionID);
          if (tokenMessage && !seen.has(tokenMessage.id)) {
            seen.add(tokenMessage.id);
            messages.push(tokenMessage);
          }
        }
      }
      setAllTokenMessages(messages);
    }
    function processNewCompletions(sessionID, messages) {
      const known = knownCompleted.get(sessionID) ?? /* @__PURE__ */ new Set();
      knownCompleted.set(sessionID, known);
      for (const msg of messages) {
        if (msg?.type !== "assistant" || !msg?.time?.completed || known.has(msg.id)) continue;
        known.add(msg.id);
        const tokens = msg.tokens;
        if (!tokens) continue;
        perfTracker.handleMessageUpdated({
          properties: {
            info: {
              id: msg.id,
              sessionID,
              role: "assistant",
              providerID: msg.model?.providerID ?? "unknown",
              modelID: msg.model?.id ?? "unknown",
              tokens: {
                input: tokens.input ?? 0,
                output: tokens.output ?? 0,
                reasoning: tokens.reasoning ?? 0,
                cache: { read: tokens.cache?.read ?? 0, write: tokens.cache?.write ?? 0 }
              },
              cost: msg.cost ?? 0,
              time: { created: msg.time.created, completed: msg.time.completed }
            }
          }
        });
      }
    }
    async function refreshSession(sessionID, trackNew) {
      await context.data.session.message.sync(sessionID).catch(() => {
      });
      const messages = context.data.session.message.list(sessionID) ?? [];
      if (trackNew) {
        processNewCompletions(sessionID, messages);
      } else {
        knownCompleted.set(sessionID, new Set(
          messages.filter((message) => message?.type === "assistant" && message?.time?.completed).map((message) => message.id)
        ));
      }
      if (currentFamily.includes(sessionID)) updateTokenMessages();
      setSidebarRevision((value) => value + 1);
    }
    async function syncFamilyTree(rootID) {
      const visited = /* @__PURE__ */ new Set([rootID]);
      const queue = [rootID];
      while (queue.length > 0 && visited.size < 200) {
        const sessionID = queue.shift();
        await context.data.session.sync(sessionID, { children: true }).catch(() => {
        });
        for (const member of context.data.session.family(sessionID)) {
          if (member && !visited.has(member)) {
            visited.add(member);
            queue.push(member);
          }
        }
      }
      if (rootID !== currentSessionID) return;
      currentFamily = familyFor(rootID);
      perfTracker.loadSessions(currentFamily);
      await Promise.all(currentFamily.map((sessionID) => refreshSession(sessionID, false)));
      updateTokenMessages();
    }
    const unsubExec = context.data.on("session.execution.succeeded", (event) => {
      void refreshSession(event.data.sessionID, true);
    });
    cleanups.push(unsubExec);
    const unsubExecFailed = context.data.on("session.execution.failed", (event) => {
      void refreshSession(event.data.sessionID, true);
    });
    cleanups.push(unsubExecFailed);
    const unsubCreated = context.data.on("session.created", (event) => {
      const sessionID = event?.data?.sessionID;
      const parentID = event?.data?.parentID;
      if (!sessionID || !parentID || !currentFamily.includes(parentID) || currentFamily.includes(sessionID)) return;
      currentFamily = [...currentFamily, sessionID];
      void refreshSession(sessionID, false);
    });
    cleanups.push(unsubCreated);
    const disposeSlot = context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => {
        sidebarRevision();
        if (sessionID && sessionID !== currentSessionID) {
          currentSessionID = sessionID;
          currentFamily = familyFor(sessionID);
          perfTracker.loadSessions(currentFamily);
          setAllTokenMessages([]);
          void syncFamilyTree(sessionID);
        }
        return <UsageStatPanel
          context={context}
          perfTracker={perfTracker}
          sessionID={sessionID}
          revision={sidebarRevision}
          allTokenMessages={allTokenMessages}
        />;
      }
    });
    cleanups.push(disposeSlot);
    return () => {
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch {
        }
      }
    };
  }
});
var tui_default = plugin;
export {
  tui_default as default,
  messageToTokenMessage,
  plugin
};
