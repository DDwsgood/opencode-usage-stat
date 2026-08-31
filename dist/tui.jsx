/** @jsxImportSource @opentui/solid */

// src/tui.tsx
import { memo as _$memo3 } from "@opentui/solid";
import { createComponent as _$createComponent3 } from "@opentui/solid";
import { createSignal as createSignal3, createEffect as createEffect2 } from "solid-js";

// node_modules/@opencode-ai/plugin/dist/tui/plugin.js
function define(plugin2) {
  return plugin2;
}

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
function formatResetDuration(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return "now";
  const mins = Math.round(diff / 6e4);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
function percentileSorted(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = Math.min(Math.max(p, 0), 1) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
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
function formatDateOnly(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function parseDaysFilter(input) {
  const days = Math.floor(Number((input ?? "").trim().split(/\s+/)[0] ?? ""));
  if (!Number.isFinite(days) || days < 1 || days > 3650) return getPresetRange("all");
  const end = /* @__PURE__ */ new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1));
  return { startDate: formatDateOnly(start), endDate: formatDateOnly(end) };
}
function formatFilters(filters) {
  const parts = [];
  if (filters.sessionId) parts.push(`session=${filters.sessionId}`);
  if (filters.provider) parts.push(`provider=${filters.provider}`);
  if (filters.model) parts.push(`model=${filters.model}`);
  if (filters.startDate || filters.endDate) {
    parts.push(`date=${filters.startDate ?? "..."}..${filters.endDate ?? "..."}`);
  }
  return parts.length ? parts.join(" | ") : "scope=all local sessions";
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
var CURRENT_VERSION = 2;
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
  if (entry.schema !== 2) return;
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
      tpsTotalTokens: 0,
      tpsTotalTimeMs: 0,
      avgLatency: null,
      maxLatency: null,
      minLatency: null,
      ttftReservoir: [],
      latencyReservoir: [],
      tpsReservoir: []
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
  if (entry.tps != null && entry.tpsTokens != null && entry.tpsWindowMs != null && entry.tpsWindowMs > 0) {
    s.tpsCount++;
    s.tpsTotalTokens += entry.tpsTokens;
    s.tpsTotalTimeMs += entry.tpsWindowMs;
    s.avgTPS = s.tpsTotalTokens / s.tpsTotalTimeMs * 1e3;
    s.maxTPS = s.maxTPS != null ? Math.max(s.maxTPS, entry.tps) : entry.tps;
    s.minTPS = s.minTPS != null ? Math.min(s.minTPS, entry.tps) : entry.tps;
    s.tpsReservoir = reservoirAdd(s.tpsReservoir, entry.tps, s.tpsCount);
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
        if (entry.schema === 2 && entry.model && entry.ts) {
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
      const tpsArr = [...s.tpsReservoir].sort((a, b) => a - b);
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
        p50TPS: percentile(tpsArr, 50),
        p95TPS: percentile(tpsArr, 95),
        p99TPS: percentile(tpsArr, 99),
        tpsTotalTokens: s.tpsTotalTokens,
        tpsTotalTimeMs: s.tpsTotalTimeMs,
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
var FIRST_OUTPUT_PART_TYPES = /* @__PURE__ */ new Set(["text", "reasoning", "tool"]);
var MIN_TPS_WINDOW_MS = 50;
var PerfTracker = class {
  steps = /* @__PURE__ */ new Map();
  inboxStarts = /* @__PURE__ */ new Map();
  promptStarts = /* @__PURE__ */ new Map();
  messagePromptStarts = /* @__PURE__ */ new Map();
  promptAssociationAttempted = /* @__PURE__ */ new Set();
  settledMessages = /* @__PURE__ */ new Set();
  statsMap = /* @__PURE__ */ new Map();
  /** 原始样本串，用于分位数计算，不持久化 */
  ttftSamples = /* @__PURE__ */ new Map();
  tpsSamples = /* @__PURE__ */ new Map();
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
    const sessionID = event.data?.sessionID;
    const startedAt = event.created;
    if (!messageID || !sessionID || typeof startedAt !== "number") return;
    this.associatePrompt(messageID, sessionID);
    this.steps.set(messageID, {
      sessionID,
      providerID: event.data?.model?.providerID ?? "unknown",
      modelID: event.data?.model?.id ?? "unknown",
      startedAt,
      streamedAt: null,
      firstOutputAt: null
    });
  }
  handlePartUpdated(event) {
    if (!event.time?.start || !event.message_id) return;
    const type = event.type ?? "";
    if (!FIRST_OUTPUT_PART_TYPES.has(type)) return;
    this.associatePrompt(event.message_id, event.session_id);
    const step = this.steps.get(event.message_id);
    if (!step) return;
    step.firstOutputAt = step.firstOutputAt === null ? event.time.start : Math.min(step.firstOutputAt, event.time.start);
  }
  handleStepStreamed(event) {
    const messageID = event.data?.assistantMessageID;
    const streamedAt = event.created;
    if (!messageID || typeof streamedAt !== "number") return;
    const step = this.steps.get(messageID);
    if (!step || streamedAt < step.startedAt) return;
    step.streamedAt = streamedAt;
  }
  handleStepTerminal(event) {
    const messageID = event.data?.assistantMessageID;
    if (!messageID) return;
    const step = this.steps.get(messageID);
    if (!step) return;
    const settledKey = `${step.sessionID}/${messageID}`;
    if (this.settledMessages.has(settledKey)) {
      this.clearMessage(messageID);
      return;
    }
    const tokens = event.data?.tokens;
    const inputTokens = tokens?.input ?? 0;
    const outputTokens = tokens?.output ?? 0;
    const reasoningTokens = tokens?.reasoning ?? 0;
    const cacheRead = tokens?.cache?.read ?? 0;
    const cacheWrite = tokens?.cache?.write ?? 0;
    const cost = event.data?.cost ?? 0;
    if (inputTokens + outputTokens + reasoningTokens + cacheRead + cacheWrite === 0) {
      this.clearMessage(messageID);
      return;
    }
    const promptStart = this.messagePromptStarts.get(messageID) ?? null;
    const ttftMs = step.firstOutputAt !== null && promptStart !== null && step.firstOutputAt >= promptStart ? step.firstOutputAt - promptStart : null;
    const latencyMs = step.streamedAt !== null && promptStart !== null && step.streamedAt >= promptStart ? step.streamedAt - promptStart : null;
    const bodyMs = step.streamedAt !== null ? step.streamedAt - step.startedAt : null;
    const generatedTokens = outputTokens + reasoningTokens;
    const tps = bodyMs !== null && bodyMs >= MIN_TPS_WINDOW_MS && generatedTokens > 0 ? generatedTokens / bodyMs * 1e3 : null;
    this.settledMessages.add(settledKey);
    this.clearMessage(messageID);
    const providerID = step.providerID;
    const modelID = step.modelID;
    const model = `${providerID}/${modelID}`;
    const entry = {
      schema: 2,
      ts: (/* @__PURE__ */ new Date()).toISOString(),
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
      tpsWindowMs: tps === null ? void 0 : bodyMs ?? void 0,
      latency_ms: latencyMs,
      latency_source: "inbox-to-step-streamed",
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
  clearMessage(messageID) {
    this.steps.delete(messageID);
    this.messagePromptStarts.delete(messageID);
    this.promptAssociationAttempted.delete(messageID);
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
    if (mid) this.clearMessage(mid);
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
    if (entry.tps !== null && entry.tpsTokens != null && entry.tpsWindowMs != null && entry.tpsWindowMs > 0) {
      stats.tpsCount++;
      stats.tpsTotalTokens += entry.tpsTokens;
      stats.tpsTotalTimeMs += entry.tpsWindowMs;
      stats.avgTPS = stats.tpsTotalTokens / stats.tpsTotalTimeMs * 1e3;
      stats.maxTPS = stats.maxTPS !== null ? Math.max(stats.maxTPS, entry.tps) : entry.tps;
      stats.minTPS = stats.minTPS !== null ? Math.min(stats.minTPS, entry.tps) : entry.tps;
      const tpsArr = this.tpsSamples.get(model) ?? [];
      tpsArr.push(entry.tps);
      this.tpsSamples.set(model, tpsArr);
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
      const tpsArr = [...this.tpsSamples.get(model) ?? []].sort((a, b) => a - b);
      s.p50TPS = this.percentile(tpsArr, 50);
      s.p95TPS = this.percentile(tpsArr, 95);
      s.p99TPS = this.percentile(tpsArr, 99);
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
      for (let i = lines.length - 1; i >= 0 && entries.length < last; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.schema !== 2 || entry.tps_source !== "step-body-window") continue;
          entries.push({
            ...entry,
            ttft_ms: entry.ttft_source === "inbox-enqueued" ? entry.ttft_ms : null,
            tps: entry.schema === 2 && entry.tps_source === "step-body-window" ? entry.tps : null,
            latency_ms: entry.schema === 2 && entry.latency_source === "inbox-to-step-streamed" ? entry.latency_ms : null
          });
        } catch {
        }
      }
      return entries.reverse();
    } catch {
      return [];
    }
  }
  reset() {
    this.steps.clear();
    this.inboxStarts.clear();
    this.promptStarts.clear();
    this.messagePromptStarts.clear();
    this.promptAssociationAttempted.clear();
    this.settledMessages.clear();
    this.statsMap.clear();
    this.ttftSamples.clear();
    this.tpsSamples.clear();
    this.latencySamples.clear();
  }
  loadSession(sessionID) {
    this.loadSessions(sessionID ? [sessionID] : []);
  }
  loadSessions(sessionIDs) {
    this.steps.clear();
    this.inboxStarts.clear();
    this.promptStarts.clear();
    this.messagePromptStarts.clear();
    this.promptAssociationAttempted.clear();
    this.settledMessages.clear();
    this.statsMap.clear();
    this.ttftSamples.clear();
    this.tpsSamples.clear();
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
          if (entry.schema !== 2 || entry.tps_source !== "step-body-window") continue;
          if (entry.messageID) this.settledMessages.add(`${entry.sessionID}/${entry.messageID}`);
          if (ids.has(entry.sessionID)) {
            this.updateStats(entry.model, {
              ...entry,
              ttft_ms: entry.ttft_source === "inbox-enqueued" ? entry.ttft_ms : null,
              tps: entry.tps,
              latency_ms: entry.latency_source === "inbox-to-step-streamed" ? entry.latency_ms : null
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
import { effect as _$effect2 } from "@opentui/solid";
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { createTextNode as _$createTextNode2 } from "@opentui/solid";
import { insertNode as _$insertNode2 } from "@opentui/solid";
import { insert as _$insert2 } from "@opentui/solid";
import { memo as _$memo2 } from "@opentui/solid";
import { setProp as _$setProp2 } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { createElement as _$createElement2 } from "@opentui/solid";
import { createSignal as createSignal2, createMemo, createEffect, For as For2, Show as Show2, onCleanup as onCleanup2 } from "solid-js";
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
  pricing: "\u5B9A\u4EF7",
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
  sessionAccumulated: "\u4F1A\u8BDD\u7D2F\u8BA1",
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
  scopeTitle: "\u9009\u62E9\u62A5\u544A\u8303\u56F4",
  scopePlaceholder: "\u9009\u62E9\u8303\u56F4...",
  formatTitle: "\u9009\u62E9\u62A5\u544A\u683C\u5F0F",
  formatPlaceholder: "\u9009\u62E9\u683C\u5F0F...",
  menu5h: "\u6700\u8FD1 5 \u5C0F\u65F6",
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
  providerEnableHint: "\u901A\u8FC7\u63D2\u4EF6\u914D\u7F6E\u542F\u7528\uFF1AproviderUsage.<id> = true",
  displayUsed: "\u5DF2\u7528",
  displayRemaining: "\u5269\u4F59",
  left: "\u5269\u4F59",
  settingsDisplayMode: "Provider \u7528\u91CF\u663E\u793A\u6A21\u5F0F",
  descSettingsDisplay: "\u5207\u6362 Provider \u914D\u989D\u6309\u201C\u5DF2\u7528\u201D\u6216\u201C\u5269\u4F59\u201D\u767E\u5206\u6BD4\u663E\u793A",
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
  scopeTitle: "Select Report Scope",
  scopePlaceholder: "Select a scope...",
  formatTitle: "Select Report Format",
  formatPlaceholder: "Select a format...",
  menu5h: "Last 5 Hours",
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
  providerEnableHint: "enable via plugin config: providerUsage.<id> = true",
  displayUsed: "used",
  displayRemaining: "remaining",
  left: "left",
  settingsDisplayMode: "Provider Usage Display Mode",
  descSettingsDisplay: "Show provider quota percentages as used or remaining",
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
import { effect as _$effect } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createSignal, onCleanup, For, Show } from "solid-js";
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
function getConfigHome() {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.trim()) return xdg.trim();
  return join3(homedir3(), ".config");
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
    const expiresRaw = entry.expires;
    let expires;
    if (typeof expiresRaw === "number" && Number.isFinite(expiresRaw)) {
      expires = expiresRaw;
    } else if (typeof expiresRaw === "string" && expiresRaw.trim() !== "" && Number.isFinite(Number(expiresRaw))) {
      expires = Number(expiresRaw);
    }
    if (expires != null && expires > 0 && expires < 1e12) {
      expires *= 1e3;
    }
    return {
      type: text(entry.type),
      key: text(entry.key),
      token: text(entry.token),
      access: text(entry.access),
      refresh: text(entry.refresh),
      expires,
      accountId: accountId ?? null
    };
  } catch {
    return null;
  }
}
function authJsonPath() {
  return join3(getDataHome(), "opencode", "auth.json");
}
function readAuthJson() {
  try {
    const file = authJsonPath();
    if (!existsSync3(file)) return {};
    const content = readFileSync3(file, "utf8").trim();
    if (!content) return {};
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}
function normalizeAuthEntry(entry) {
  if (!entry) return null;
  if (typeof entry === "string") return parseCredentialValue(JSON.stringify({ token: entry }));
  if (typeof entry === "object") {
    if (entry.oauth && typeof entry.oauth === "object") {
      return parseCredentialValue(entry.oauth);
    }
    return parseCredentialValue(entry);
  }
  return null;
}
function authJsonEntry(aliases) {
  if (aliases.length === 0) return null;
  const auth = readAuthJson();
  for (const alias of aliases) {
    const raw = auth[alias];
    const entry = raw ? normalizeAuthEntry(raw) : null;
    if (entry && isNonEmpty(entry.key ?? entry.token ?? entry.access ?? entry.refresh)) return entry;
  }
  return null;
}
function readSecureProviderJson(providerId) {
  const candidates = [
    join3(getConfigHome(), "openchamber", "quota", `${providerId}.json`),
    join3(getConfigHome(), "opencode", "usage-stat", `${providerId}.json`)
  ];
  for (const file of candidates) {
    try {
      if (!existsSync3(file)) continue;
      const content = readFileSync3(file, "utf8").trim();
      if (!content) continue;
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
    }
  }
  return null;
}
function sqliteCredential(aliases) {
  if (aliases.length === 0) return null;
  const path = credentialDatabasePath();
  if (!existsSync3(path)) return null;
  const placeholders = aliases.map(() => "?").join(",");
  const sql = `SELECT integration_id, value, time_updated FROM credential WHERE integration_id IN (${placeholders})`;
  let database;
  try {
    const require2 = createRequire(join3(homedir3(), ".opencode", "usage-stat-require.cjs"));
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
      return {
        value,
        accountId: isNonEmpty(entry.accountId) ? entry.accountId : null,
        refresh: isNonEmpty(entry.refresh) ? entry.refresh : null,
        expires: typeof entry.expires === "number" ? entry.expires : null,
        source: "sqlite"
      };
    }
  }
  const authEntry = authJsonEntry(opts.aliases);
  if (authEntry) {
    const value = authEntry.key ?? authEntry.token ?? authEntry.access ?? null;
    if (isNonEmpty(value)) {
      return {
        value,
        accountId: isNonEmpty(authEntry.accountId) ? authEntry.accountId : null,
        refresh: isNonEmpty(authEntry.refresh) ? authEntry.refresh : null,
        expires: typeof authEntry.expires === "number" ? authEntry.expires : null,
        source: "auth"
      };
    }
  }
  for (const key of opts.envKeys) {
    const v = process.env[key];
    if (isNonEmpty(v)) {
      return { value: v, accountId: null, refresh: null, expires: null, source: "env" };
    }
  }
  const dot = loadDotEnv();
  for (const key of opts.envKeys) {
    const v = dot[key];
    if (isNonEmpty(v)) {
      return { value: v, accountId: null, refresh: null, expires: null, source: "dotenv" };
    }
  }
  return { value: null, accountId: null, refresh: null, expires: null, source: null };
}

// src/provider-usage.ts
import { existsSync as existsSync4, readFileSync as readFileSync4 } from "node:fs";
import { join as join4 } from "node:path";
import { homedir as homedir4 } from "node:os";
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
async function errorFrom(response, label, authMessage) {
  if ((response.status === 401 || response.status === 403) && authMessage) return new Error(authMessage);
  const body = await response.text().catch(() => "");
  const parsed = parseError(body);
  return new Error(parsed ?? `${label} API error: ${response.status}`);
}
function fmtNum(n) {
  if (!Number.isFinite(n)) return "0";
  return String(n);
}
function clampPct(n) {
  return Math.min(100, Math.max(0, n));
}
function pct(used, total) {
  const u = toNumber(used);
  const t2 = toNumber(total);
  if (u == null || t2 == null || t2 <= 0) return null;
  return clampPct(u / t2 * 100);
}
function fmtMoney(value) {
  if (value === null || !Number.isFinite(value)) return null;
  return value.toFixed(2);
}
function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}
function asObject(value) {
  return value && typeof value === "object" ? value : null;
}
function nonEmptyString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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
function windowLabelFromSeconds(seconds) {
  if (seconds == null) return "Window";
  const hours = seconds / 3600;
  if (hours >= 24 && hours % 24 === 0) return `${hours / 24}d`;
  if (hours >= 1) return `${hours}h`;
  return `${seconds}s`;
}
function windowLabel(duration, unit) {
  const d = toNumber(duration);
  if (d == null) return "limit";
  if (unit === "TIME_UNIT_MINUTE") return `${d}m`;
  if (unit === "TIME_UNIT_HOUR") return `${d}h`;
  if (unit === "TIME_UNIT_DAY") return `${d}d`;
  return "limit";
}
function windowSeconds(duration, unit) {
  const d = toNumber(duration);
  if (d == null) return null;
  if (unit === "TIME_UNIT_MINUTE") return d * 60;
  if (unit === "TIME_UNIT_HOUR") return d * 3600;
  if (unit === "TIME_UNIT_DAY") return d * 86400;
  return null;
}
function percentWindow(label, percent, resetMs, valueLabel = null) {
  const pctValue = toNumber(percent);
  return { label, percent: pctValue != null ? clampPct(pctValue) : null, resetsAt: toResetTimestamp(resetMs), valueLabel };
}
var OPENCODE_GO_ALIASES = ["opencode-go", "opencode", "zen"];
var OPENCODE_GO_ENV_KEYS = ["OPENCODE_GO_API_KEY", "OPENCODE_API_KEY"];
var OPENCODE_GO_URL = "https://opencode.ai/zen/go/v1/usage";
function parseOpenCodeGoUsage(payload) {
  const usage = asObject(asObject(payload)?.usage);
  if (!usage) return [];
  const out = [];
  const order = [
    ["rolling", "Rolling"],
    ["weekly", "Weekly"],
    ["monthly", "Monthly"]
  ];
  for (const [key, label] of order) {
    const entry = asObject(usage[key]);
    if (!entry) continue;
    const percent = entry.percent;
    if (typeof percent !== "number" || !Number.isFinite(percent)) continue;
    const resetsAt = typeof entry.resetsAt === "string" ? entry.resetsAt : null;
    if (resetsAt != null && !Number.isFinite(new Date(resetsAt).getTime())) continue;
    out.push({
      label,
      percent: clampPct(percent),
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
  const infos = Array.isArray(asObject(payload)?.balance_infos) ? payload.balance_infos : [];
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
    throw await errorFrom(response, "DeepSeek", "DeepSeek session expired \u2014 re-authenticate");
  }
  const windows = parseDeepSeekBalance(await response.json().catch(() => null));
  if (windows.length === 0) throw new Error("DeepSeek balance data could not be parsed");
  return windows;
}
var CODEX_ALIASES = ["openai", "codex", "chatgpt"];
var CODEX_ENV_KEYS = [];
var CODEX_URL = "https://chatgpt.com/backend-api/wham/usage";
function parseCodexUsage(payload) {
  const data = asObject(payload);
  if (!data) return [];
  const out = [];
  const primary = data.rate_limit?.primary_window;
  if (primary) {
    const percent = toNumber(primary.used_percent);
    const seconds = toNumber(primary.limit_window_seconds);
    out.push(percentWindow(
      windowLabelFromSeconds(seconds),
      percent,
      primary.reset_at,
      percent != null ? `${percent.toFixed(1)}% used` : null
    ));
  }
  const secondary = data.rate_limit?.secondary_window;
  if (secondary) {
    const percent = toNumber(secondary.used_percent);
    const seconds = toNumber(secondary.limit_window_seconds);
    out.push(percentWindow(
      windowLabelFromSeconds(seconds),
      percent,
      secondary.reset_at,
      percent != null ? `${percent.toFixed(1)}% used` : null
    ));
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
    out.push(percentWindow(
      "Spend Limit",
      sl.used_percent,
      null,
      used != null && limit != null ? `${fmtNum(used)} / ${fmtNum(limit)} used` : null
    ));
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
    throw await errorFrom(response, "Codex", "Codex session expired \u2014 re-authenticate with OpenAI");
  }
  const windows = parseCodexUsage(await response.json().catch(() => null));
  if (windows.length === 0) throw new Error("Codex usage data could not be parsed");
  return windows;
}
var CLAUDE_ALIASES = ["anthropic", "claude"];
var CLAUDE_ENV_KEYS = [];
var CLAUDE_URL = "https://api.anthropic.com/api/oauth/usage";
function parseClaudeUsage(payload) {
  const data = asObject(payload);
  if (!data) return [];
  const out = [];
  const limits = Array.isArray(data.limits) ? data.limits : [];
  for (const limit of limits) {
    const item = asObject(limit);
    if (!item) continue;
    const percent = toNumber(item.percent);
    const resetAt = item.resets_at;
    if (item.kind === "session") {
      out.push(percentWindow("5h", percent, resetAt));
    } else if (item.kind === "weekly_all") {
      out.push(percentWindow("7d", percent, resetAt));
    } else if (item.kind === "weekly_scoped") {
      const scopeModel = asObject(asObject(item.scope)?.model);
      const model = nonEmptyString(scopeModel?.display_name ?? item.scope);
      if (model) out.push(percentWindow(`7d \xB7 ${model}`, percent, resetAt));
    }
  }
  if (!limits.length) {
    const fiveHour = asObject(data.five_hour);
    const sevenDay = asObject(data.seven_day);
    if (fiveHour) out.push(percentWindow("5h", fiveHour.utilization, fiveHour.resets_at));
    if (sevenDay) out.push(percentWindow("7d", sevenDay.utilization, sevenDay.resets_at));
  }
  const spend = asObject(data.spend);
  if (spend?.enabled === true) {
    const usedMoney = asObject(spend.used);
    const limitMoney = asObject(spend.limit);
    const usedMinor = toNumber(usedMoney?.amount_minor);
    const limitMinor = toNumber(limitMoney?.amount_minor);
    const exponent = toNumber(usedMoney?.exponent) ?? 2;
    const currency = nonEmptyString(usedMoney?.currency);
    const prefix = currency === "USD" || !currency ? "$" : `${currency} `;
    const used = usedMinor === null ? null : usedMinor / 10 ** exponent;
    const limit = limitMinor === null ? null : limitMinor / 10 ** (toNumber(limitMoney?.exponent) ?? 2);
    out.push(percentWindow(
      "Extra Usage",
      spend.percent,
      null,
      used === null ? null : `${prefix}${fmtMoney(used)}${limit === null ? "" : ` / ${prefix}${fmtMoney(limit)}`}`
    ));
  }
  return out.filter((w, i) => out.findIndex((o) => o.label === w.label) === i);
}
async function fetchClaudeUsage(accessToken, fetchImpl = fetch) {
  const response = await fetchWithTimeout(CLAUDE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      Accept: "application/json"
    }
  }, fetchImpl);
  if (response.status === 429) throw new Error("Claude rate limited \u2014 retrying later");
  if (!response.ok) {
    throw await errorFrom(response, "Anthropic", "Claude session expired \u2014 re-authenticate with Claude Code");
  }
  const windows = parseClaudeUsage(await response.json().catch(() => null));
  if (windows.length === 0) throw new Error("Claude usage data could not be parsed");
  return windows;
}
var KIMI_ALIASES = ["kimi-for-coding", "kimi"];
var KIMI_ENV_KEYS = ["KIMI_FOR_CODING_API_KEY", "KIMI_API_KEY"];
var KIMI_URL = "https://api.kimi.com/coding/v1/usages";
function computeKimiUsedPercent(total, used, remaining) {
  const t2 = toNumber(total);
  if (t2 == null || t2 <= 0) return null;
  const u = toNumber(used);
  if (u != null) return clampPct(u / t2 * 100);
  const r = toNumber(remaining);
  if (r != null) return clampPct(100 - r / t2 * 100);
  return null;
}
function parseKimiUsage(payload) {
  const data = asObject(payload);
  if (!data) return [];
  const out = [];
  const usage = asObject(data.usage);
  if (usage) {
    out.push(percentWindow("Weekly", computeKimiUsedPercent(usage.limit, usage.used, usage.remaining), usage.resetTime));
  }
  const limits = Array.isArray(data.limits) ? data.limits : [];
  for (const raw of limits) {
    const limit = asObject(raw);
    if (!limit) continue;
    const win = asObject(limit.window);
    const detail = asObject(limit.detail);
    const seconds = windowSeconds(win?.duration, win?.timeUnit);
    const rawLabel = windowLabel(win?.duration, win?.timeUnit);
    const label = seconds === 5 * 3600 ? `Rate Limit (${rawLabel})` : rawLabel;
    out.push(percentWindow(label, computeKimiUsedPercent(detail?.limit, detail?.used, detail?.remaining), detail?.resetTime));
  }
  return out.filter((w) => w.percent != null || w.resetsAt != null);
}
async function fetchKimiUsage(apiKey, fetchImpl = fetch) {
  const response = await fetchWithTimeout(KIMI_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
  }, fetchImpl);
  if (!response.ok) {
    throw await errorFrom(response, "Kimi", "Kimi session expired \u2014 check your coding plan API key");
  }
  const windows = parseKimiUsage(await response.json().catch(() => null));
  if (windows.length === 0) throw new Error("Kimi usage data could not be parsed");
  return windows;
}
var ZAI_ALIASES = ["zai-coding-plan", "zai", "z.ai"];
var ZAI_ENV_KEYS = ["ZAI_API_KEY", "Z_AI_API_KEY"];
var ZAI_URL = "https://api.z.ai/api/monitor/usage/quota/limit";
var ZAI_TOKEN_WINDOW_SECONDS = {
  3: 3600,
  6: 7 * 86400
};
function zaiWindowSeconds(limit) {
  const number = toNumber(limit.number);
  const unitSeconds = ZAI_TOKEN_WINDOW_SECONDS[Number(limit.unit)];
  if (number == null || unitSeconds == null) return null;
  return unitSeconds * number;
}
function shortWindowLabel(seconds) {
  if (!seconds) return "tokens";
  if (seconds % 86400 === 0) {
    const days = seconds / 86400;
    return days === 7 ? "weekly" : `${days}d`;
  }
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  return `${seconds}s`;
}
function formatCreditAmount(value) {
  if (value < 1e3) return Math.round(value).toLocaleString("en-US");
  return `${Math.round(value / 100) / 10}k`;
}
function zaiCreditValueLabel(limit) {
  const used = toNumber(limit.currentValue);
  const total = toNumber(limit.usage);
  if (used == null || total == null) return null;
  return `${formatCreditAmount(used)} / ${formatCreditAmount(total)} credits`;
}
function parseZaiStyleUsage(payload, options) {
  const data = asObject(payload)?.data;
  const limits = Array.isArray(data?.limits) ? data.limits : [];
  const windows = [];
  for (const limit of limits) {
    const type = limit?.type;
    if (type !== "TOKENS_LIMIT" && type !== "CREDIT_LIMIT") continue;
    const seconds = zaiWindowSeconds(limit);
    windows.push(percentWindow(shortWindowLabel(seconds), limit.percentage, limit.nextResetTime, zaiCreditValueLabel(limit)));
  }
  const mcp = limits.find((l) => l?.type === "TIME_LIMIT");
  if (mcp) {
    windows.push(percentWindow("MCP Tools", mcp.percentage, mcp.nextResetTime));
  }
  void options;
  return { windows, planLabel: nonEmptyString(data?.level) };
}
async function fetchZaiUsage(apiKey, fetchImpl = fetch) {
  const response = await fetchWithTimeout(ZAI_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
  }, fetchImpl);
  if (!response.ok) {
    throw await errorFrom(response, "z.ai", "z.ai session expired \u2014 check your coding plan API key");
  }
  const parsed = parseZaiStyleUsage(await response.json().catch(() => null), { tokensLabel: "tokens" });
  if (parsed.windows.length === 0) throw new Error("z.ai usage data could not be parsed");
  return parsed;
}
var ZHIPUAI_ALIASES = ["zhipuai-coding-plan", "zhipu-coding-plan"];
var ZHIPUAI_ENV_KEYS = ["ZHIPUAI_CODING_PLAN_API_KEY", "ZHIPU_API_KEY"];
var ZHIPUAI_URL = "https://open.bigmodel.cn/api/monitor/usage/quota/limit";
function parseZhipuaiUsage(payload) {
  const data = asObject(payload)?.data;
  const limits = Array.isArray(data?.limits) ? data.limits : [];
  const out = [];
  const tokens = limits.find((l) => l?.type === "TOKENS_LIMIT");
  if (tokens) {
    out.push(percentWindow("Tokens", tokens.percentage, tokens.nextResetTime));
  }
  const mcp = limits.find((l) => l?.type === "TIME_LIMIT");
  if (mcp) {
    out.push(percentWindow("MCP Tools", mcp.percentage, mcp.nextResetTime));
  }
  return out;
}
async function fetchZhipuaiUsage(apiKey, fetchImpl = fetch) {
  const response = await fetchWithTimeout(ZHIPUAI_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
  }, fetchImpl);
  if (!response.ok) {
    throw await errorFrom(response, "Zhipu", "Zhipu session expired \u2014 check your coding plan API key");
  }
  const windows = parseZhipuaiUsage(await response.json().catch(() => null));
  if (windows.length === 0) throw new Error("Zhipu usage data could not be parsed");
  return windows;
}
var MINIMAX_ALIASES = ["minimax-coding-plan", "minimax"];
var MINIMAX_ENV_KEYS = ["MINIMAX_CODING_PLAN_API_KEY", "MINIMAX_API_KEY"];
var MINIMAX_CN_ALIASES = ["minimax-cn-coding-plan"];
var MINIMAX_CN_ENV_KEYS = ["MINIMAX_CN_CODING_PLAN_API_KEY", "MINIMAX_CN_API_KEY"];
function parseMiniMaxUsage(payload, usageFieldsAreRemaining) {
  const data = asObject(payload);
  const baseResp = asObject(data?.base_resp);
  if (baseResp && toNumber(baseResp.status_code) !== 0) return [];
  const remains = Array.isArray(data?.model_remains) ? data.model_remains : [];
  const model = asObject(remains[0]);
  if (!model) return [];
  let intervalTotal = toNumber(model.current_interval_total_count);
  let intervalValue = toNumber(model.current_interval_usage_count);
  let weeklyTotal = toNumber(model.current_weekly_total_count);
  let weeklyValue = toNumber(model.current_weekly_usage_count);
  if (usageFieldsAreRemaining) {
    intervalValue = intervalTotal != null && intervalValue != null ? intervalTotal - intervalValue : intervalValue;
    weeklyValue = weeklyTotal != null && weeklyValue != null ? weeklyTotal - weeklyValue : weeklyValue;
  }
  const out = [];
  const intervalPercent = pct(intervalValue, intervalTotal);
  const intervalStart = toNumber(model.start_time);
  const intervalEnd = toNumber(model.end_time);
  out.push(percentWindow("5h", intervalPercent, intervalEnd, intervalPercent != null ? `${intervalPercent.toFixed(0)}% used` : null));
  void intervalStart;
  const weeklyPercent = pct(weeklyValue, weeklyTotal);
  out.push(percentWindow("weekly", weeklyPercent, model.weekly_end_time, weeklyPercent != null ? `${weeklyPercent.toFixed(0)}% used` : null));
  void weeklyTotal;
  return out;
}
function miniMaxFetcher(providerId, endpoint, usageFieldsAreRemaining) {
  return async (apiKey, fetchImpl = fetch) => {
    const response = await fetchWithTimeout(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
    }, fetchImpl);
    if (!response.ok) {
      throw await errorFrom(response, "MiniMax", "MiniMax session expired \u2014 check your coding plan API key");
    }
    const payload = await response.json().catch(() => null);
    const baseResp = asObject(asObject(payload)?.base_resp);
    if (baseResp && toNumber(baseResp.status_code) !== 0) {
      throw new Error(nonEmptyString(baseResp.status_msg) ?? `MiniMax API error: ${toNumber(baseResp.status_code)}`);
    }
    const windows = parseMiniMaxUsage(payload, usageFieldsAreRemaining);
    if (windows.every((w) => w.percent == null)) throw new Error("MiniMax usage data could not be parsed");
    return windows;
  };
}
var OPENROUTER_ALIASES = ["openrouter"];
var OPENROUTER_ENV_KEYS = ["OPENROUTER_API_KEY"];
var OPENROUTER_URL = "https://openrouter.ai/api/v1/credits";
function parseOpenRouterCredits(payload) {
  const credits = asObject(asObject(payload)?.data);
  const totalCredits = toNumber(credits?.total_credits);
  const totalUsage = toNumber(credits?.total_usage);
  if (totalCredits == null && totalUsage == null) return [];
  const remaining = totalCredits != null && totalUsage != null ? Math.max(0, totalCredits - totalUsage) : null;
  const valueLabel = remaining != null && totalUsage != null ? `$${fmtMoney(remaining)} left \xB7 $${fmtMoney(totalUsage)} spent` : null;
  return [{ label: "Credits", percent: null, resetsAt: null, valueLabel }];
}
async function fetchOpenRouterCredits(apiKey, fetchImpl = fetch) {
  const response = await fetchWithTimeout(OPENROUTER_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
  }, fetchImpl);
  if (!response.ok) {
    throw await errorFrom(response, "OpenRouter", "OpenRouter authentication failed");
  }
  const windows = parseOpenRouterCredits(await response.json().catch(() => null));
  if (windows.length === 0) throw new Error("OpenRouter credit data could not be parsed");
  return windows;
}
var OLLAMA_CLOUD_ALIASES = ["ollama-cloud", "ollama"];
var OLLAMA_CLOUD_ENV_KEYS = [];
function resolveOllamaCloudCookie() {
  const data = readSecureProviderJson("ollama-cloud");
  const cookie = nonEmptyString(data?.cookie ?? data?.session);
  return cookie ?? null;
}
function parseOllamaSettingsHtml(html) {
  const out = [];
  const sessionMatch = html.match(/Session\s+usage[^0-9]*([0-9.]+)%/i);
  if (sessionMatch) out.push(percentWindow("Session", toNumber(sessionMatch[1]), null));
  const weeklyMatch = html.match(/Weekly\s+usage[^0-9]*([0-9.]+)%/i);
  if (weeklyMatch) out.push(percentWindow("Weekly", toNumber(weeklyMatch[1]), null));
  const premiumMatch = html.match(/Premium[^0-9]*([0-9]+)\s*\/\s*([0-9]+)/i);
  if (premiumMatch) {
    const used = toNumber(premiumMatch[1]) ?? 0;
    const total = toNumber(premiumMatch[2]) ?? 0;
    out.push(percentWindow("Premium", total > 0 ? Math.min(100, used / total * 100) : null, null, `${used} / ${total}`));
  }
  return out;
}
async function fetchOllamaCloudUsage(cookie, fetchImpl = fetch) {
  const response = await fetchWithTimeout("https://ollama.com/settings", {
    method: "GET",
    headers: {
      Cookie: cookie,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept-Encoding": "identity"
    }
  }, fetchImpl);
  if (!response.ok) {
    throw await errorFrom(response, "Ollama Cloud", response.status === 403 || response.status === 401 ? "Ollama Cloud cookie expired \u2014 update the saved session cookie" : void 0);
  }
  const windows = parseOllamaSettingsHtml(await response.text());
  if (windows.length === 0) throw new Error("Ollama Cloud usage data could not be parsed");
  return windows;
}
var COPILOT_ALIASES = ["github-copilot", "copilot", "github"];
var COPILOT_ENV_KEYS = [];
function buildCopilotWindows(payload) {
  const data = asObject(payload);
  const quota = asObject(data?.quota_snapshots);
  if (!quota) return [];
  const resetAt = data?.quota_reset_date;
  const add = (label, snapshotRaw) => {
    const snapshot2 = asObject(snapshotRaw);
    if (!snapshot2) return null;
    const entitlement = toNumber(snapshot2.entitlement);
    const remaining = toNumber(snapshot2.remaining);
    const percent = entitlement != null && entitlement > 0 && remaining != null ? clampPct(100 - remaining / entitlement * 100) : null;
    return percentWindow(
      label,
      percent,
      resetAt,
      entitlement != null && remaining != null ? `${remaining.toFixed(0)} / ${entitlement.toFixed(0)} left` : null
    );
  };
  const windows = [
    add("chat", quota.chat),
    add("completions", quota.completions),
    add("premium", quota.premium_interactions)
  ].filter((w) => w !== null);
  return windows;
}
async function fetchCopilotUsage(accessToken, addonOnly, fetchImpl = fetch) {
  const response = await fetchWithTimeout("https://api.github.com/copilot_internal/user", {
    method: "GET",
    headers: {
      Authorization: `token ${accessToken}`,
      Accept: "application/json",
      "Editor-Version": "vscode/1.96.2",
      "X-Github-Api-Version": "2025-04-01",
      "Accept-Encoding": "identity"
    }
  }, fetchImpl);
  if (!response.ok) {
    throw await errorFrom(response, "Copilot", "Copilot session expired \u2014 re-authenticate with GitHub");
  }
  let windows = buildCopilotWindows(await response.json().catch(() => null));
  if (addonOnly) {
    const premium = windows.filter((w) => w.label === "premium");
    if (premium.length > 0) windows = premium;
  }
  if (windows.length === 0) throw new Error("Copilot usage data could not be parsed");
  return windows;
}
var GOOGLE_ALIASES = ["google", "google.oauth"];
var GOOGLE_ENV_KEYS = [];
var DEFAULT_PROJECT_ID = "rising-fact-p41fc";
var GOOGLE_PRIMARY_ENDPOINT = "https://cloudcode-pa.googleapis.com";
var GOOGLE_ENDPOINTS = [
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
  "https://autopush-cloudcode-pa.sandbox.googleapis.com",
  GOOGLE_PRIMARY_ENDPOINT
];
var GOOGLE_HEADERS = {
  "User-Agent": "antigravity/1.11.5 windows/amd64",
  "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "Client-Metadata": '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}'
};
function splitGoogleRefreshToken(raw) {
  const value = nonEmptyString(raw);
  if (!value) return { refreshToken: null, projectId: null, managedProjectId: null };
  const [token = "", project = "", managedProject = ""] = value.split("|");
  return {
    refreshToken: nonEmptyString(token),
    projectId: nonEmptyString(project),
    managedProjectId: nonEmptyString(managedProject)
  };
}
function readGoogleAuthSources() {
  const sources = [];
  const entry = authJsonEntry(GOOGLE_ALIASES);
  if (entry) {
    const refreshParts = splitGoogleRefreshToken(entry.refresh);
    sources.push({
      sourceLabel: "Gemini",
      accessToken: entry.access ?? entry.token ?? void 0,
      expires: entry.expires ?? null,
      refreshToken: refreshParts.refreshToken,
      projectId: refreshParts.projectId ?? refreshParts.managedProjectId
    });
  }
  const configDir = process.env.XDG_CONFIG_HOME?.trim() || join4(homedir4(), ".config");
  const dataDir = process.env.XDG_DATA_HOME?.trim() || join4(homedir4(), ".local", "share");
  for (const filePath of [
    join4(configDir, "opencode", "antigravity-accounts.json"),
    join4(dataDir, "opencode", "antigravity-accounts.json")
  ]) {
    try {
      if (!existsSync4(filePath)) continue;
      const data = JSON.parse(readFileSync4(filePath, "utf8"));
      const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
      if (accounts.length === 0) continue;
      const index = typeof data.activeIndex === "number" ? data.activeIndex : 0;
      const account = accounts[index] ?? accounts[0];
      if (!account?.refreshToken) continue;
      const refreshParts = splitGoogleRefreshToken(account.refreshToken);
      sources.push({
        sourceLabel: "Antigravity",
        refreshToken: refreshParts.refreshToken,
        projectId: nonEmptyString(account.projectId) ?? nonEmptyString(account.managedProjectId) ?? refreshParts.projectId ?? refreshParts.managedProjectId
      });
      break;
    } catch {
    }
  }
  return sources;
}
function resolveGoogleOAuthClient() {
  const clientId = nonEmptyString(process.env.GOOGLE_CLIENT_ID);
  const clientSecret = nonEmptyString(process.env.GOOGLE_CLIENT_SECRET);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}
async function refreshGoogleAccessToken(refreshToken, clientId, clientSecret, fetchImpl) {
  try {
    const response = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" })
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    return nonEmptyString(asObject(data)?.access_token);
  } catch {
    return null;
  }
}
async function postGoogleRpc(url, accessToken, projectId, fetchImpl, extraHeaders = {}) {
  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(projectId ? { project: projectId } : {})
    }, fetchImpl);
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    return asObject(payload);
  } catch {
    return null;
  }
}
function googleWindowLabel(resetAtMs) {
  if (resetAtMs != null) {
    const remainingHours = (resetAtMs - Date.now()) / 36e5;
    if (remainingHours > 10) return "daily";
  }
  return "5h";
}
async function fetchGoogleUsage(fetchImpl = fetch) {
  const sources = readGoogleAuthSources();
  if (sources.length === 0) throw new Error("Not configured");
  const windows = [];
  let lastError = null;
  for (const source of sources) {
    const isGemini = source.sourceLabel === "Gemini";
    let accessToken = source.accessToken;
    const expired = accessToken != null && typeof source.expires === "number" && source.expires <= Date.now();
    if (!accessToken || expired) {
      if (!source.refreshToken) {
        lastError = `${source.sourceLabel}: missing refresh token`;
        continue;
      }
      const oauthClient = resolveGoogleOAuthClient();
      if (!oauthClient) {
        lastError = `${source.sourceLabel}: Google OAuth client not configured \u2014 set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET`;
        continue;
      }
      accessToken = await refreshGoogleAccessToken(
        source.refreshToken,
        oauthClient.clientId,
        oauthClient.clientSecret,
        fetchImpl
      ) ?? void 0;
      if (!accessToken) {
        lastError = `${source.sourceLabel}: failed to refresh OAuth token`;
        continue;
      }
    }
    const projectId = source.projectId ?? DEFAULT_PROJECT_ID;
    let merged = false;
    if (isGemini) {
      const quotaPayload = await postGoogleRpc(`${GOOGLE_PRIMARY_ENDPOINT}/v1internal:retrieveUserQuota`, accessToken, projectId, fetchImpl);
      const buckets = Array.isArray(quotaPayload?.buckets) ? quotaPayload.buckets : [];
      for (const bucket of buckets) {
        const modelId = nonEmptyString(bucket.modelId);
        if (!modelId) continue;
        const remainingFraction = toNumber(bucket.remainingFraction);
        const usedPercent = remainingFraction != null ? clampPct(100 - Math.round(remainingFraction * 100)) : null;
        const resetIso = toResetTimestamp(bucket.resetTime);
        const resetMs = resetIso ? Date.parse(resetIso) : NaN;
        windows.push(percentWindow(`${modelId} (${googleWindowLabel(Number.isFinite(resetMs) ? resetMs : null)})`, usedPercent, resetIso));
        merged = true;
      }
    }
    for (const endpoint of GOOGLE_ENDPOINTS) {
      const payload = await postGoogleRpc(`${endpoint}/v1internal:fetchAvailableModels`, accessToken, projectId, fetchImpl, GOOGLE_HEADERS);
      const models = asObject(payload?.models);
      if (!models) continue;
      for (const [modelName, modelDataRaw] of Object.entries(models)) {
        const modelData = asObject(modelDataRaw);
        const quotaInfo = asObject(modelData?.quotaInfo);
        if (!quotaInfo) continue;
        const remainingFraction = toNumber(quotaInfo.remainingFraction);
        const usedPercent = remainingFraction != null ? clampPct(100 - Math.round(remainingFraction * 100)) : null;
        const resetIso = toResetTimestamp(quotaInfo.resetTime);
        const resetMs = resetIso ? Date.parse(resetIso) : NaN;
        windows.push(percentWindow(`${modelName} (${googleWindowLabel(Number.isFinite(resetMs) ? resetMs : null)})`, usedPercent, resetIso));
        merged = true;
      }
      if (merged) break;
    }
    if (!merged) lastError = `${source.sourceLabel}: failed to fetch models`;
  }
  if (windows.length === 0) throw new Error(lastError ?? "Google usage data could not be parsed");
  return windows;
}
var XAI_ALIASES = ["xai", "grok"];
var XAI_ENV_KEYS = [];
var XAI_USAGE_ENDPOINT = "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig";
var XAI_TOKEN_ENDPOINT = "https://auth.x.ai/oauth2/token";
var XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
var XAI_REFRESH_SKEW_MS = 12e4;
var XAI_DEFAULT_EXPIRES_IN_SECONDS = 3600;
function readXaiVarint(bytes, index) {
  let result = 0n;
  for (let shift = 0n; index.value < bytes.length && shift < 64n; shift += 7n) {
    const byte = bytes[index.value++];
    if (shift === 63n && (byte & 126) !== 0) return null;
    result |= BigInt(byte & 127) << shift;
    if ((byte & 128) === 0) return result;
  }
  return null;
}
function scanXaiProtobuf(bytes, depth, pathPrefix, scan) {
  const index = { value: 0 };
  while (index.value < bytes.length) {
    const fieldKey = readXaiVarint(bytes, index);
    if (fieldKey === null || fieldKey === 0n) return false;
    const fieldNumber = Number(fieldKey >> 3n);
    const wireType = Number(fieldKey & 0x07n);
    if (fieldNumber < 1 || fieldNumber > 536870911) return false;
    const fieldPath = [...pathPrefix, fieldNumber];
    if (wireType === 0) {
      const value = readXaiVarint(bytes, index);
      if (value === null) return false;
      scan.varintFields.push({ path: fieldPath, value });
      continue;
    }
    if (wireType === 1) {
      if (index.value + 8 > bytes.length) return false;
      index.value += 8;
      continue;
    }
    if (wireType === 2) {
      const length = readXaiVarint(bytes, index);
      if (length === null || length > BigInt(bytes.length - index.value)) return false;
      const start = index.value;
      index.value += Number(length);
      if (depth >= 4 && length !== 0n) return false;
      if (depth < 4) {
        const nestedScan = { fixed32Fields: [], varintFields: [], nextOrder: scan.nextOrder };
        if (!scanXaiProtobuf(bytes.subarray(start, index.value), depth + 1, fieldPath, nestedScan)) return false;
        scan.fixed32Fields.push(...nestedScan.fixed32Fields);
        scan.varintFields.push(...nestedScan.varintFields);
        scan.nextOrder = nestedScan.nextOrder;
      }
      continue;
    }
    if (wireType === 5) {
      if (index.value + 4 > bytes.length) return false;
      const value = new DataView(bytes.buffer, bytes.byteOffset + index.value, 4).getFloat32(0, true);
      scan.fixed32Fields.push({ path: fieldPath, value, order: scan.nextOrder++ });
      index.value += 4;
      continue;
    }
    return false;
  }
  return true;
}
function samePath(left, right) {
  return left.length === right.length && left.every((v, i) => v === right[i]);
}
function parseXaiGrpcTrailerStatus(frame) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(frame);
  } catch {
    return null;
  }
  let status = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const separator2 = line.indexOf(":");
    if (separator2 <= 0) return null;
    const key = line.slice(0, separator2).trim().toLowerCase();
    if (!key || key !== "grpc-status") continue;
    if (status !== null) return null;
    const rawStatus = line.slice(separator2 + 1).trim();
    if (!/^\d+$/.test(rawStatus)) return null;
    status = Number(rawStatus);
    if (!Number.isSafeInteger(status)) return null;
  }
  return status;
}
function parseXaiGrpcFrames(bytes) {
  if (bytes.length < 5 || (bytes[0] & 127) !== 0) return null;
  const payloads = [];
  const trailerStatuses = [];
  let index = 0;
  let sawTrailer = false;
  while (index < bytes.length) {
    if (index + 5 > bytes.length) return false;
    const flags = bytes[index++];
    if ((flags & 127) !== 0) return false;
    const length = bytes[index++] * 16777216 + (bytes[index++] << 16) + (bytes[index++] << 8) + bytes[index++];
    if (length > bytes.length - index) return false;
    const frame = bytes.subarray(index, index + length);
    index += length;
    if (flags & 128) {
      sawTrailer = true;
      const status = parseXaiGrpcTrailerStatus(frame);
      if (status === null) return false;
      trailerStatuses.push(status);
    } else {
      if (sawTrailer) return false;
      payloads.push(frame);
    }
  }
  return { payloads, trailerStatuses };
}
function looksLikeXaiProtobuf(bytes) {
  if (!bytes.length) return false;
  const fieldNumber = Math.floor(bytes[0] / 8);
  const wireType = bytes[0] % 8;
  return fieldNumber > 0 && [0, 1, 2, 5].includes(wireType);
}
function parseXaiUsage(bytes) {
  const frames = parseXaiGrpcFrames(bytes);
  if (frames === false) throw new Error("xAI returned malformed gRPC-web framing");
  const payloads = frames === null ? looksLikeXaiProtobuf(bytes) ? [bytes] : [] : frames.payloads;
  if (frames) {
    for (const status of frames.trailerStatuses) {
      if (status !== 0) throw new Error(`xAI billing RPC failed with status ${status}`);
    }
  }
  if (payloads.length === 0) throw new Error("xAI returned an empty protobuf response");
  const scan = { fixed32Fields: [], varintFields: [], nextOrder: 0 };
  for (const payload of payloads) {
    if (!scanXaiProtobuf(payload, 0, [], scan)) throw new Error("xAI returned malformed protobuf data");
  }
  const percentField = scan.fixed32Fields.filter((f) => (samePath(f.path, [1]) || samePath(f.path, [1, 1])) && Number.isFinite(f.value) && f.value >= 0 && f.value <= 100).sort((a, b) => a.path.length - b.path.length || a.order - b.order)[0];
  const resetCandidates = scan.varintFields.filter((f) => f.value >= 1700000000n && f.value <= 2100000000n).map((f) => ({ path: f.path, timestamp: Number(f.value) * 1e3 })).filter((f) => f.timestamp > Date.now()).sort((a, b) => a.timestamp - b.timestamp);
  const preferredReset = resetCandidates.find((f) => samePath(f.path, [1, 5, 1])) ?? resetCandidates[0];
  const resetAt = preferredReset?.timestamp ?? null;
  if (!percentField) {
    const hasUsagePeriod = scan.varintFields.some((f) => f.path.length >= 2 && f.path[0] === 1 && f.path[1] === 6 || samePath(f.path, [1, 8, 1]) && (f.value === 1n || f.value === 2n));
    if (hasUsagePeriod && scan.fixed32Fields.length === 0 && resetAt !== null) return { usedPercent: 0, resetAt };
    throw new Error("xAI billing response did not contain usable current-period data");
  }
  return { usedPercent: percentField.value, resetAt };
}
function jwtExpiryMilliseconds(accessToken) {
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof decoded.exp === "number" ? decoded.exp * 1e3 : null;
  } catch {
    return null;
  }
}
async function resolveXaiAccessToken(material, fetchImpl) {
  const deadline = Date.now() + XAI_REFRESH_SKEW_MS;
  const needsRefresh = !material.accessToken || material.expires != null && material.expires <= deadline || jwtExpiryMilliseconds(material.accessToken) != null && jwtExpiryMilliseconds(material.accessToken) <= deadline;
  if (!needsRefresh) return material.accessToken;
  const refreshToken = material.refreshToken;
  if (!refreshToken) return material.accessToken;
  const response = await fetchImpl(XAI_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: XAI_CLIENT_ID, refresh_token: refreshToken, grant_type: "refresh_token" })
  }).catch(() => null);
  if (!response || !response.ok) return material.accessToken;
  const data = asObject(await response.json().catch(() => null));
  const access = nonEmptyString(data?.access_token);
  if (!access) return material.accessToken;
  const expiresIn = toNumber(data?.expires_in) ?? XAI_DEFAULT_EXPIRES_IN_SECONDS;
  void expiresIn;
  return access;
}
async function fetchXaiUsage(material, fetchImpl = fetch) {
  const accessToken = await resolveXaiAccessToken(material, fetchImpl);
  if (!accessToken) throw new Error("Not configured");
  const response = await fetchWithTimeout(XAI_USAGE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Origin: "https://grok.com",
      Referer: "https://grok.com/?_s=usage",
      Accept: "*/*",
      "Content-Type": "application/grpc-web+proto",
      "x-grpc-web": "1",
      "x-user-agent": "connect-es/2.1.1",
      "User-Agent": "opencode-usage-stat"
    },
    body: new Uint8Array([0, 0, 0, 0, 0])
  }, fetchImpl);
  const grpcStatus = response.headers.get("grpc-status");
  if (grpcStatus !== null && /^\d+$/.test(grpcStatus.trim()) && Number(grpcStatus.trim()) !== 0) {
    throw new Error(`xAI billing RPC failed with status ${Number(grpcStatus.trim())}`);
  }
  if (!response.ok) {
    throw await errorFrom(response, "xAI", "xAI session expired \u2014 re-authenticate with Grok");
  }
  const parsed = parseXaiUsage(new Uint8Array(await response.arrayBuffer()));
  return [percentWindow("Billing Cycle", parsed.usedPercent, parsed.resetAt)];
}
var CURSOR_ALIASES = ["cursor"];
var CURSOR_ENV_KEYS = [];
function resolveCursorCredential(resolved) {
  const data = readSecureProviderJson("cursor");
  const token = nonEmptyString(data?.accessToken ?? data?.access_token ?? data?.token);
  return token ?? resolved.value;
}
function parseCursorUsage(payload) {
  const data = asObject(payload);
  const plan = asObject(data?.planUsage);
  if (!data || !plan) return [];
  return [percentWindow("Billing Cycle", plan.totalPercentUsed, data.billingCycleEnd)];
}
async function fetchCursorUsage(accessToken, fetchImpl = fetch) {
  const response = await fetchWithTimeout("https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Connect-Protocol-Version": "1"
    },
    body: "{}"
  }, fetchImpl);
  if (!response.ok) {
    throw await errorFrom(response, "Cursor", response.status === 401 ? "Cursor session expired" : void 0);
  }
  const windows = parseCursorUsage(await response.json().catch(() => null));
  if (windows.length === 0) throw new Error("Cursor usage data could not be parsed");
  return windows;
}
var COMMAND_CODE_ALIASES = ["command-code", "commandcode"];
var COMMAND_CODE_ENV_KEYS = ["COMMAND_CODE_API_KEY", "COMMANDCODE_API_KEY"];
var COMMAND_CODE_API_BASE = "https://api.commandcode.ai";
var COMMAND_CODE_PLAN_NAMES = {
  "individual-go": "Go",
  "individual-goat": "GOAT",
  "individual-pro": "Pro",
  "individual-pro-v1": "Pro",
  "individual-provider": "Provider",
  "individual-max": "Max",
  "individual-ultra": "Ultra",
  "teams-pro": "Teams Pro"
};
function commandCodeMoney(value) {
  return `$${value.toFixed(2)}`;
}
function parseCommandCodeUsage(data) {
  const creditsResponse = asObject(data.credits);
  const balances = asObject(creditsResponse?.credits);
  const limits = asObject(creditsResponse?.windowLimits);
  const subscription = asObject(asObject(data.subscription)?.data);
  const summary = asObject(data.summary);
  const windows = [];
  if (limits?.limited !== false) {
    for (const [key, label] of [["fiveHour", "5h"], ["weekly", "7d"]]) {
      const limit = asObject(limits?.[key]);
      const used = toNumber(limit?.used);
      const cap = toNumber(limit?.cap);
      if (used == null && cap == null) continue;
      windows.push({
        label,
        percent: used != null && cap != null && cap > 0 ? clampPct(used / cap * 100) : null,
        resetsAt: toResetTimestamp(limit?.resetAt),
        valueLabel: used != null && cap != null ? `${commandCodeMoney(used)} / ${commandCodeMoney(cap)}` : null
      });
    }
  }
  const creditParts = [balances?.monthlyCredits, balances?.purchasedCredits, balances?.freeCredits].map(toNumber).filter((value) => value !== null);
  const remaining = creditParts.length > 0 ? creditParts.reduce((sum, value) => sum + value, 0) : null;
  const spent = toNumber(summary?.totalCost);
  if (spent != null && remaining != null) {
    const total = spent + remaining;
    windows.push({
      label: "Monthly",
      percent: total > 0 ? clampPct(spent / total * 100) : null,
      resetsAt: toResetTimestamp(subscription?.currentPeriodEnd),
      valueLabel: `${commandCodeMoney(spent)} / ${commandCodeMoney(total)}`
    });
  }
  if (remaining != null) {
    windows.push({ label: "Credits", percent: null, resetsAt: null, valueLabel: `${commandCodeMoney(remaining)} left` });
  }
  const planId = nonEmptyString(subscription?.planId) ?? nonEmptyString(balances?.planId);
  return { windows, planLabel: planId ? COMMAND_CODE_PLAN_NAMES[planId] ?? planId : null };
}
function resolveCommandCodeCredential(resolved) {
  if (resolved.value && resolved.source !== "dotenv") return resolved.value;
  try {
    const authPath = join4(homedir4(), ".commandcode", "auth.json");
    if (existsSync4(authPath)) {
      const apiKey = nonEmptyString(asObject(JSON.parse(readFileSync4(authPath, "utf8")))?.apiKey);
      if (apiKey) return apiKey;
    }
  } catch {
  }
  return resolved.value;
}
async function fetchCommandCodeJson(path, apiKey, fetchImpl) {
  const response = await fetchWithTimeout(`${COMMAND_CODE_API_BASE}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "opencode-usage-stat"
    }
  }, fetchImpl);
  if (!response.ok) {
    throw await errorFrom(response, "Command Code", response.status === 401 || response.status === 403 ? "Command Code session expired \u2014 re-authenticate with cmd auth login" : void 0);
  }
  return response.json().catch(() => null);
}
async function fetchCommandCodeUsage(apiKey, fetchImpl = fetch) {
  const whoami = asObject(await fetchCommandCodeJson("/alpha/whoami", apiKey, fetchImpl));
  const orgId = nonEmptyString(asObject(whoami?.org)?.id);
  if (!orgId) throw new Error("Command Code account organization could not be resolved");
  const orgQuery = new URLSearchParams({ orgId }).toString();
  const [credits, subscription] = await Promise.all([
    fetchCommandCodeJson(`/alpha/billing/credits?${orgQuery}`, apiKey, fetchImpl),
    fetchCommandCodeJson(`/alpha/billing/subscriptions?${orgQuery}`, apiKey, fetchImpl)
  ]);
  const currentPeriodStart = nonEmptyString(asObject(asObject(subscription)?.data)?.currentPeriodStart);
  const summaryQuery = new URLSearchParams({ orgId, ...currentPeriodStart ? { since: currentPeriodStart } : {} }).toString();
  const summary = await fetchCommandCodeJson(`/alpha/usage/summary?${summaryQuery}`, apiKey, fetchImpl);
  const parsed = parseCommandCodeUsage({ credits, subscription, summary });
  if (parsed.windows.length === 0) throw new Error("Command Code usage data could not be parsed");
  return parsed;
}
var PROVIDERS = [
  { id: "opencode-go", name: "OpenCode Go", aliases: OPENCODE_GO_ALIASES, envKeys: OPENCODE_GO_ENV_KEYS },
  { id: "deepseek", name: "DeepSeek", aliases: DEEPSEEK_ALIASES, envKeys: DEEPSEEK_ENV_KEYS },
  { id: "codex", name: "Codex", aliases: CODEX_ALIASES, envKeys: CODEX_ENV_KEYS },
  { id: "claude", name: "Claude", aliases: CLAUDE_ALIASES, envKeys: CLAUDE_ENV_KEYS },
  { id: "kimi-for-coding", name: "Kimi for Coding", aliases: KIMI_ALIASES, envKeys: KIMI_ENV_KEYS },
  { id: "zai-coding-plan", name: "z.ai", aliases: ZAI_ALIASES, envKeys: ZAI_ENV_KEYS },
  { id: "zhipuai-coding-plan", name: "Zhipu AI Coding Plan", aliases: ZHIPUAI_ALIASES, envKeys: ZHIPUAI_ENV_KEYS },
  { id: "minimax-coding-plan", name: "MiniMax Coding Plan", aliases: MINIMAX_ALIASES, envKeys: MINIMAX_ENV_KEYS },
  { id: "minimax-cn-coding-plan", name: "MiniMax Coding Plan (CN)", aliases: MINIMAX_CN_ALIASES, envKeys: MINIMAX_CN_ENV_KEYS },
  { id: "openrouter", name: "OpenRouter", aliases: OPENROUTER_ALIASES, envKeys: OPENROUTER_ENV_KEYS },
  { id: "ollama-cloud", name: "Ollama Cloud", aliases: OLLAMA_CLOUD_ALIASES, envKeys: OLLAMA_CLOUD_ENV_KEYS },
  { id: "github-copilot", name: "GitHub Copilot", aliases: COPILOT_ALIASES, envKeys: COPILOT_ENV_KEYS },
  { id: "github-copilot-addon", name: "Copilot Add-on", aliases: COPILOT_ALIASES, envKeys: COPILOT_ENV_KEYS },
  { id: "google", name: "Google Gemini", aliases: GOOGLE_ALIASES, envKeys: GOOGLE_ENV_KEYS },
  { id: "xai", name: "xAI", aliases: XAI_ALIASES, envKeys: XAI_ENV_KEYS },
  { id: "cursor", name: "Cursor", aliases: CURSOR_ALIASES, envKeys: CURSOR_ENV_KEYS },
  { id: "command-code", name: "Command Code", aliases: COMMAND_CODE_ALIASES, envKeys: COMMAND_CODE_ENV_KEYS }
];
var USAGE_STAT_PROVIDER_IDS = PROVIDERS.map((p) => p.id);
var defaultCredentialResolver = (spec) => resolveCredential(spec);
function collapsedSummary(windows, mode) {
  if (!windows || windows.length === 0) return null;
  const shown = (win) => {
    if (win.percent == null) return null;
    return Math.round(mode === "remaining" ? 100 - win.percent : win.percent);
  };
  const isSessionWin = (label) => /(^|\b)(5h|session|rolling)\b/i.test(label);
  const isWeeklyWin = (label) => /(^|\b)(weekly|7d)\b/i.test(label);
  const session = windows.find((w) => isSessionWin(w.label));
  const weekly = windows.find((w) => isWeeklyWin(w.label));
  const n = session ? shown(session) : null;
  const m = weekly ? shown(weekly) : null;
  if (n != null && m != null) return `${n}%/5h ${m}%/7d`;
  if (n != null) return `${n}%/5h`;
  if (m != null) return `${m}%/7d`;
  const firstPercent = windows.map(shown).find((v) => v != null);
  if (firstPercent != null) return `${firstPercent}%`;
  return windows.find((w) => w.valueLabel)?.valueLabel ?? null;
}
async function checkProviderUsage(providerId, fetchImpl = fetch, getCredential = defaultCredentialResolver) {
  const spec = PROVIDERS.find((p) => p.id === providerId);
  if (!spec) return { providerId, providerName: providerId, configured: false, ok: false, status: "Unknown provider" };
  const finishError = (configured, message) => ({
    providerId: spec.id,
    providerName: spec.name,
    configured,
    ok: false,
    status: message.startsWith(spec.name) ? message : `${spec.name} \u2014 ${message}`,
    error: message
  });
  if (spec.id === "ollama-cloud") {
    const cookie = resolveOllamaCloudCookie();
    if (!cookie) return finishError(false, `${spec.name} \u2014 not configured (no saved cookie)`);
    try {
      const windows = await fetchOllamaCloudUsage(cookie, fetchImpl);
      return { providerId: spec.id, providerName: spec.name, configured: true, ok: true, status: summarize(spec.name, windows), windows };
    } catch (err) {
      return finishError(true, err instanceof Error ? err.message : "Request failed");
    }
  }
  if (spec.id === "google") {
    try {
      const windows = await fetchGoogleUsage(fetchImpl);
      return { providerId: spec.id, providerName: spec.name, configured: true, ok: true, status: summarize(spec.name, windows), windows };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      return finishError(message !== "Not configured", message);
    }
  }
  const resolved = getCredential({ aliases: spec.aliases, envKeys: spec.envKeys });
  if (spec.id === "xai") {
    const material = { accessToken: resolved.value, refreshToken: resolved.refresh, expires: resolved.expires };
    if (!material.accessToken && !material.refreshToken) {
      return finishError(false, "not configured");
    }
    try {
      const windows = await fetchXaiUsage(material, fetchImpl);
      return { providerId: spec.id, providerName: spec.name, configured: true, ok: true, status: summarize(spec.name, windows), windows };
    } catch (err) {
      return finishError(true, err instanceof Error ? err.message : "Request failed");
    }
  }
  const secret = spec.id === "command-code" ? resolveCommandCodeCredential(resolved) : resolved.value;
  if (!secret) {
    return finishError(false, "not configured");
  }
  try {
    let windows;
    let planLabel = null;
    switch (spec.id) {
      case "opencode-go":
        windows = await fetchOpenCodeGoUsage(secret, fetchImpl);
        break;
      case "deepseek":
        windows = await fetchDeepSeekBalance(secret, fetchImpl);
        break;
      case "codex":
        windows = await fetchCodexUsage(secret, resolved.accountId, fetchImpl);
        break;
      case "claude":
        windows = await fetchClaudeUsage(secret, fetchImpl);
        break;
      case "kimi-for-coding":
        windows = await fetchKimiUsage(secret, fetchImpl);
        break;
      case "zai-coding-plan": {
        const parsed = await fetchZaiUsage(secret, fetchImpl);
        windows = parsed.windows;
        planLabel = parsed.planLabel;
        break;
      }
      case "zhipuai-coding-plan":
        windows = await fetchZhipuaiUsage(secret, fetchImpl);
        break;
      case "minimax-coding-plan":
        windows = await miniMaxFetcher(spec.id, "https://api.minimax.io/v1/api/openplatform/coding_plan/remains", false)(secret, fetchImpl);
        break;
      case "minimax-cn-coding-plan":
        windows = await miniMaxFetcher(spec.id, "https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains", true)(secret, fetchImpl);
        break;
      case "openrouter":
        windows = await fetchOpenRouterCredits(secret, fetchImpl);
        break;
      case "github-copilot":
        windows = await fetchCopilotUsage(secret, false, fetchImpl);
        break;
      case "github-copilot-addon":
        windows = await fetchCopilotUsage(secret, true, fetchImpl);
        break;
      case "cursor": {
        const token = resolveCursorCredential(resolved);
        if (!token) return finishError(false, "Not configured (no saved access token)");
        windows = await fetchCursorUsage(token, fetchImpl);
        break;
      }
      case "command-code": {
        const parsed = await fetchCommandCodeUsage(secret, fetchImpl);
        windows = parsed.windows;
        planLabel = parsed.planLabel;
        break;
      }
    }
    return {
      providerId: spec.id,
      providerName: spec.name,
      configured: true,
      ok: true,
      status: summarize(spec.name, windows),
      windows,
      planLabel
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    return finishError(true, message);
  }
}
function summarize(name, windows) {
  const first = windows[0];
  if (!first) return `${name} \u2014 no data`;
  if (first.valueLabel) {
    if (first.resetsAt) return `${name} \u2014 ${first.valueLabel} \xB7 resets ${formatResetDuration(first.resetsAt)}`;
    return `${name} \u2014 ${first.valueLabel}`;
  }
  if (first.percent != null) {
    const suffix = first.resetsAt ? ` \xB7 resets ${formatResetDuration(first.resetsAt)}` : "";
    return `${name} \u2014 ${first.percent.toFixed(0)}%${suffix}`;
  }
  return name;
}
function resolveProviderUsageConfig(options) {
  const source = options && typeof options === "object" ? options.providerUsage : null;
  const value = source && typeof source === "object" ? source : {};
  const out = {};
  for (const id of USAGE_STAT_PROVIDER_IDS) {
    out[id] = value[id] === true;
  }
  return out;
}

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

// src/settings.ts
var SETTINGS_KEY = "usage-stat-settings";
var LEGACY_KEY = "usage-stat-config";
var DEFAULT_SETTINGS = {
  showPerformance: true,
  showPricing: true,
  showTrend: true,
  providerUsageDisplay: "used",
  language: "auto"
};
function optionsToSettings(options) {
  const out = {};
  try {
    const cfg = options && typeof options === "object" ? options : {};
    if (cfg?.sidebar && typeof cfg.sidebar === "object") {
      if (typeof cfg.sidebar.showPerformance === "boolean") out.showPerformance = cfg.sidebar.showPerformance;
      if (typeof cfg.sidebar.showPricing === "boolean") out.showPricing = cfg.sidebar.showPricing;
      if (typeof cfg.sidebar.showTrend === "boolean") out.showTrend = cfg.sidebar.showTrend;
    }
    if (cfg?.language === "zh" || cfg?.language === "en" || cfg?.language === "auto") out.language = cfg.language;
    if (cfg?.providerUsageDisplay === "used" || cfg?.providerUsageDisplay === "remaining") {
      out.providerUsageDisplay = cfg.providerUsageDisplay;
    }
  } catch {
  }
  return out;
}
function getSettingsStore(context) {
  return context.storage.store(SETTINGS_KEY, {
    initial: { ...DEFAULT_SETTINGS, ...optionsToSettings(context.options) }
  });
}
var migrationDone = false;
async function migrateLegacySettings(context) {
  if (migrationDone) return;
  try {
    const [settings, mutate] = getSettingsStore(context);
    const [legacy] = context.storage.store(LEGACY_KEY, { initial: {} });
    const patch = {};
    for (const key of ["showPerformance", "showPricing", "showTrend", "providerUsageDisplay", "language"]) {
      const value = legacy?.[key];
      if (value !== void 0 && value !== null && settings[key] !== value && settings[key] === DEFAULT_SETTINGS[key]) {
        patch[key] = value;
      }
    }
    if (Object.keys(patch).length > 0) {
      await mutate((draft) => Object.assign(draft, patch));
    }
    migrationDone = true;
  } catch {
  }
}

// src/provider-usage-blocks.tsx
var REFRESH_MS = 2 * 60 * 1e3;
var PROVIDER_NAMES = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.name]));
var FALLBACK_COLOR = RGBA2.fromInts(80, 190, 255, 255);
var PROVIDER_COLORS = {
  "opencode-go": RGBA2.fromInts(80, 190, 255, 255),
  deepseek: RGBA2.fromInts(78, 140, 255, 255),
  codex: RGBA2.fromInts(205, 130, 255, 255),
  claude: RGBA2.fromInts(217, 119, 87, 255),
  "kimi-for-coding": RGBA2.fromInts(125, 110, 255, 255),
  "zai-coding-plan": RGBA2.fromInts(255, 190, 80, 255),
  "zhipuai-coding-plan": RGBA2.fromInts(70, 130, 246, 255),
  "minimax-coding-plan": RGBA2.fromInts(255, 100, 140, 255),
  "minimax-cn-coding-plan": RGBA2.fromInts(230, 90, 130, 255),
  openrouter: RGBA2.fromInts(150, 120, 255, 255),
  "ollama-cloud": RGBA2.fromInts(160, 168, 178, 255),
  "github-copilot": RGBA2.fromInts(110, 150, 235, 255),
  "github-copilot-addon": RGBA2.fromInts(130, 165, 250, 255),
  google: RGBA2.fromInts(120, 185, 95, 255),
  xai: RGBA2.fromInts(225, 225, 235, 255),
  cursor: RGBA2.fromInts(200, 200, 210, 255),
  "command-code": RGBA2.fromInts(235, 190, 90, 255)
};
function ProviderUsageBlocks(props) {
  const {
    context
  } = props;
  const enabledIds = USAGE_STAT_PROVIDER_IDS.filter((id) => resolveProviderUsageConfig(context.options)[id]);
  const colors = resolveThemeColors(context.theme);
  const primaryColor = () => colors.primary;
  const mutedColor = () => colors.muted;
  const dimColor = () => colors.dim;
  const greenColor = () => colors.green;
  const redColor = () => colors.red;
  const amberColor = () => colors.amber;
  let storedCollapse = null;
  let collapseMutate = null;
  try {
    const [store, mutate] = context.storage.store("usage-stat-provider-collapse", {
      initial: {}
    });
    storedCollapse = store;
    collapseMutate = mutate;
  } catch (err) {
    console.warn("[opencode-usage-stat] storage unavailable, provider collapse will not persist:", err);
  }
  const [localCollapse, setLocalCollapse] = createSignal({});
  let settingsStore = null;
  try {
    const [store] = getSettingsStore(context);
    settingsStore = store;
  } catch {
  }
  const displayMode = () => settingsStore?.providerUsageDisplay === "remaining" ? "remaining" : "used";
  const isCollapsed = (id) => {
    const override = localCollapse()[id];
    if (override !== void 0) return override;
    return storedCollapse?.[id] !== false;
  };
  const [states, setStates] = createSignal(enabledIds.map((id) => ({
    id,
    loading: false,
    result: null
  })));
  async function refreshOne(id) {
    setStates((prev) => prev.map((s) => s.id === id ? {
      ...s,
      loading: true
    } : s));
    const result = await checkProviderUsage(id);
    setStates((prev) => prev.map((state) => {
      if (state.id !== id) return state;
      return {
        ...state,
        loading: false,
        result
      };
    }));
  }
  if (enabledIds.length > 0) {
    for (const id of enabledIds) {
      void refreshOne(id);
    }
    const timers = [];
    for (const id of enabledIds) {
      timers.push(setInterval(() => {
        void refreshOne(id);
      }, REFRESH_MS));
    }
    onCleanup(() => {
      for (const timer of timers) clearInterval(timer);
    });
  }
  function toggle(id) {
    const next = !isCollapsed(id);
    setLocalCollapse((prev) => ({
      ...prev,
      [id]: next
    }));
    if (collapseMutate) void collapseMutate((draft) => {
      draft[id] = next;
    }).catch(() => {
    });
  }
  function statusColor(s) {
    if (s.loading) return mutedColor();
    if (!s.result) return dimColor();
    if (!s.result.ok) return redColor();
    const first = s.result.windows?.find((w) => w.percent != null);
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
  return _$createComponent(Show, {
    get when() {
      return states().length > 0;
    },
    get children() {
      var _el$ = _$createElement("box");
      _$setProp(_el$, "flexDirection", "column");
      _$setProp(_el$, "marginTop", 1);
      _$setProp(_el$, "paddingX", 1);
      _$insert(_el$, _$createComponent(For, {
        get each() {
          return states();
        },
        children: (state) => {
          const isOpen = () => !isCollapsed(state.id);
          const color = () => statusColor(state);
          const dot = () => {
            if (state.loading && !state.result) return "\u25CC";
            if (!state.result) return "\u25CB";
            if (!state.result.ok) return "\u25CF";
            if (state.result.windows?.[0]?.percent == null) return "\u25C6";
            return "\u25CF";
          };
          const headerText = () => {
            if (state.loading && !state.result) return `${t("providerRefreshing")}\u2026`;
            const summary = collapsedSummary(state.result?.windows, displayMode());
            if (state.result?.ok && summary != null) return summary;
            const status = state.result?.status ?? t("providerNotConfigured");
            const prefix = `${PROVIDER_NAMES[state.id]} \u2014 `;
            return status.startsWith(prefix) ? status.slice(prefix.length) : status;
          };
          return (() => {
            var _el$2 = _$createElement("box"), _el$3 = _$createElement("box"), _el$4 = _$createElement("text"), _el$5 = _$createElement("span"), _el$6 = _$createTextNode(` `), _el$7 = _$createElement("span"), _el$8 = _$createElement("text");
            _$insertNode(_el$2, _el$3);
            _$setProp(_el$2, "flexDirection", "column");
            _$insertNode(_el$3, _el$4);
            _$insertNode(_el$3, _el$8);
            _$setProp(_el$3, "flexDirection", "row");
            _$setProp(_el$3, "justifyContent", "space-between");
            _$setProp(_el$3, "gap", 1);
            _$setProp(_el$3, "onMouseDown", () => toggle(state.id));
            _$setProp(_el$3, "paddingX", 0);
            _$insertNode(_el$4, _el$5);
            _$insertNode(_el$4, _el$6);
            _$insertNode(_el$4, _el$7);
            _$insert(_el$5, dot);
            _$insert(_el$7, () => PROVIDER_NAMES[state.id]);
            _$insert(_el$4, () => isOpen() ? " \u25BE" : " \u25B8", null);
            _$insert(_el$8, (() => {
              var _c$ = _$memo(() => headerText().length > 32);
              return () => _c$() ? headerText().slice(0, 31) + "\u2026" : headerText();
            })());
            _$insert(_el$2, _$createComponent(Show, {
              get when() {
                return isOpen();
              },
              get children() {
                var _el$9 = _$createElement("box");
                _$setProp(_el$9, "flexDirection", "column");
                _$setProp(_el$9, "paddingX", 1);
                _$setProp(_el$9, "marginTop", 0);
                _$insert(_el$9, _$createComponent(Show, {
                  get when() {
                    return _$memo(() => !!state.loading)() && !state.result;
                  },
                  get children() {
                    var _el$0 = _$createElement("text"), _el$1 = _$createTextNode(`\u2026`);
                    _$insertNode(_el$0, _el$1);
                    _$insert(_el$0, () => t("providerRefreshing"), _el$1);
                    _$effect((_$p) => _$setProp(_el$0, "fg", mutedColor(), _$p));
                    return _el$0;
                  }
                }), null);
                _$insert(_el$9, _$createComponent(Show, {
                  get when() {
                    return _$memo(() => !!!state.loading)() && !state.result;
                  },
                  get children() {
                    var _el$10 = _$createElement("text");
                    _$insertNode(_el$10, _$createTextNode(`\u2014`));
                    _$effect((_$p) => _$setProp(_el$10, "fg", mutedColor(), _$p));
                    return _el$10;
                  }
                }), null);
                _$insert(_el$9, _$createComponent(Show, {
                  get when() {
                    return _$memo(() => state.result !== null)() && !state.result.ok;
                  },
                  get children() {
                    return [(() => {
                      var _el$12 = _$createElement("text");
                      _$insert(_el$12, () => state.result?.status ?? "");
                      _$effect((_$p) => _$setProp(_el$12, "fg", redColor(), _$p));
                      return _el$12;
                    })(), _$createComponent(Show, {
                      get when() {
                        return _$memo(() => state.result !== null)() && !state.result?.configured;
                      },
                      get children() {
                        var _el$13 = _$createElement("text");
                        _$insert(_el$13, () => t("providerEnableHint"));
                        _$effect((_$p) => _$setProp(_el$13, "fg", dimColor(), _$p));
                        return _el$13;
                      }
                    })];
                  }
                }), null);
                _$insert(_el$9, _$createComponent(Show, {
                  get when() {
                    return _$memo(() => !!(state.result !== null && state.result.ok))() && state.result.windows;
                  },
                  get children() {
                    return _$createComponent(For, {
                      get each() {
                        return state.result?.windows ?? [];
                      },
                      children: (win) => {
                        const label = win.label ? win.label + ": " : "";
                        if (win.percent != null) {
                          const shownPercent = () => displayMode() === "remaining" ? 100 - win.percent : win.percent;
                          return (() => {
                            var _el$14 = _$createElement("text"), _el$15 = _$createElement("span"), _el$16 = _$createTextNode(` `), _el$17 = _$createTextNode(`%`);
                            _$insertNode(_el$14, _el$15);
                            _$insert(_el$14, label, _el$15);
                            _$insertNode(_el$15, _el$16);
                            _$insertNode(_el$15, _el$17);
                            _$insert(_el$15, () => percentBar(shownPercent(), 12), _el$16);
                            _$insert(_el$15, () => Math.round(shownPercent()), _el$17);
                            _$insert(_el$15, (() => {
                              var _c$2 = _$memo(() => displayMode() === "remaining");
                              return () => _c$2() ? ` ${t("left")}` : "";
                            })(), null);
                            _$insert(_el$14, (() => {
                              var _c$3 = _$memo(() => !!win.resetsAt);
                              return () => _c$3() ? (() => {
                                var _el$18 = _$createElement("span"), _el$19 = _$createTextNode(` \xB7 `), _el$20 = _$createTextNode(` `);
                                _$insertNode(_el$18, _el$19);
                                _$insertNode(_el$18, _el$20);
                                _$insert(_el$18, () => t("providerResets"), _el$20);
                                _$insert(_el$18, () => formatResetDuration(win.resetsAt), null);
                                _$effect((_$p) => _$setProp(_el$18, "style", {
                                  fg: dimColor()
                                }, _$p));
                                return _el$18;
                              })() : null;
                            })(), null);
                            _$effect((_p$) => {
                              var _v$5 = mutedColor(), _v$6 = {
                                fg: color()
                              };
                              _v$5 !== _p$.e && (_p$.e = _$setProp(_el$14, "fg", _v$5, _p$.e));
                              _v$6 !== _p$.t && (_p$.t = _$setProp(_el$15, "style", _v$6, _p$.t));
                              return _p$;
                            }, {
                              e: void 0,
                              t: void 0
                            });
                            return _el$14;
                          })();
                        }
                        if (win.valueLabel) {
                          return (() => {
                            var _el$21 = _$createElement("text"), _el$22 = _$createElement("span");
                            _$insertNode(_el$21, _el$22);
                            _$insert(_el$21, label, _el$22);
                            _$insert(_el$22, () => win.valueLabel);
                            _$effect((_p$) => {
                              var _v$7 = mutedColor(), _v$8 = {
                                fg: greenColor()
                              };
                              _v$7 !== _p$.e && (_p$.e = _$setProp(_el$21, "fg", _v$7, _p$.e));
                              _v$8 !== _p$.t && (_p$.t = _$setProp(_el$22, "style", _v$8, _p$.t));
                              return _p$;
                            }, {
                              e: void 0,
                              t: void 0
                            });
                            return _el$21;
                          })();
                        }
                        return (() => {
                          var _el$23 = _$createElement("text"), _el$24 = _$createTextNode(`\u2014`);
                          _$insertNode(_el$23, _el$24);
                          _$insert(_el$23, label, _el$24);
                          _$effect((_$p) => _$setProp(_el$23, "fg", mutedColor(), _$p));
                          return _el$23;
                        })();
                      }
                    });
                  }
                }), null);
                return _el$9;
              }
            }), null);
            _$effect((_p$) => {
              var _v$ = PROVIDER_COLORS[state.id] ?? FALLBACK_COLOR, _v$2 = {
                fg: color()
              }, _v$3 = {
                fg: primaryColor()
              }, _v$4 = mutedColor();
              _v$ !== _p$.e && (_p$.e = _$setProp(_el$4, "fg", _v$, _p$.e));
              _v$2 !== _p$.t && (_p$.t = _$setProp(_el$5, "style", _v$2, _p$.t));
              _v$3 !== _p$.a && (_p$.a = _$setProp(_el$7, "style", _v$3, _p$.a));
              _v$4 !== _p$.o && (_p$.o = _$setProp(_el$8, "fg", _v$4, _p$.o));
              return _p$;
            }, {
              e: void 0,
              t: void 0,
              a: void 0,
              o: void 0
            });
            return _el$2;
          })();
        }
      }));
      return _el$;
    }
  });
}

// src/sidebar.tsx
var DEFAULT_CONFIG = {
  sidebar: {
    showPerformance: true,
    showPricing: true,
    showTrend: true
  },
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
var COLLAPSE_INITIAL = {
  global: false,
  models: {}
};
function loadConfig(context) {
  const base = {
    sidebar: {
      ...DEFAULT_CONFIG.sidebar
    },
    language: DEFAULT_CONFIG.language
  };
  try {
    const pluginCfg = context.options;
    if (pluginCfg?.sidebar) Object.assign(base.sidebar, pluginCfg.sidebar);
    if (pluginCfg?.language) base.language = pluginCfg.language;
  } catch {
  }
  return base;
}
function UsageStatPanel(props) {
  const {
    context,
    perfTracker
  } = props;
  const optionConfig = loadConfig(context);
  let settings = null;
  try {
    const [store] = getSettingsStore(context);
    settings = store;
    migrateLegacySettings(context);
  } catch (err) {
    console.warn("[opencode-usage-stat] storage unavailable, settings will not persist:", err);
  }
  const showPerformance = () => settings ? settings.showPerformance : optionConfig.sidebar.showPerformance;
  const showPricing = () => settings ? settings.showPricing : optionConfig.sidebar.showPricing;
  const showTrend = () => settings ? settings.showTrend : optionConfig.sidebar.showTrend;
  setLanguage(settings ? settings.language : optionConfig.language);
  createEffect(() => setLanguage(settings ? settings.language : optionConfig.language));
  const t2 = (key) => {
    void settings?.language;
    return t(key);
  };
  const isEnglish = (str) => /^[a-zA-Z\s\.\/]+$/.test(str);
  let storedCollapse = null;
  let collapseMutate = null;
  try {
    const [store, mutate] = context.storage.store("usage-stat-collapse", {
      initial: COLLAPSE_INITIAL
    });
    storedCollapse = store;
    collapseMutate = mutate;
  } catch (err) {
    console.warn("[opencode-usage-stat] storage unavailable, collapse state will not persist:", err);
  }
  const [localCollapse, setLocalCollapse] = createSignal2({});
  function toggleGlobal() {
    const next = !(localCollapse().global ?? storedCollapse?.global ?? false);
    setLocalCollapse((prev) => ({
      ...prev,
      global: next
    }));
    if (collapseMutate) void collapseMutate((draft) => {
      draft.global = next;
    }).catch(() => {
    });
  }
  function toggleModel(key) {
    const current = localCollapse().models?.[key] ?? storedCollapse?.models[key] ?? false;
    const next = !current;
    setLocalCollapse((prev) => ({
      ...prev,
      models: {
        ...prev.models,
        [key]: next
      }
    }));
    if (collapseMutate) void collapseMutate((draft) => {
      draft.models[key] = next;
    }).catch(() => {
    });
  }
  const isPanelCollapsed = () => localCollapse().global ?? storedCollapse?.global ?? false;
  const isModelCollapsed = (key) => (localCollapse().models?.[key] ?? storedCollapse?.models[key] ?? false) === true;
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
        e = {
          providerID: msg.providerID,
          modelID: msg.modelID,
          totalInput: 0,
          totalOutput: 0,
          totalReasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalCost: 0,
          requestCount: 0,
          lastMessageIndex: -1
        };
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
    return {
      totalInput: i,
      totalOutput: o,
      totalReasoning: ir,
      totalCacheRead: cr,
      totalCacheWrite: cw,
      totalRequests: r,
      totalCost: c,
      totalTokens: i + o + ir + cr + cw
    };
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
      if (denom === 0) return {
        key,
        rate: 0,
        msgs: []
      };
      const msgs = [];
      for (const msg of props.allTokenMessages()) {
        if (`${msg.providerID}/${msg.modelID}` !== key) continue;
        msgs.push(msg);
      }
      return {
        key,
        rate: stat.cacheRead / denom * 100,
        msgs
      };
    });
  });
  const modelTrend = createMemo(() => {
    return modelHitRate().map(({
      key,
      msgs
    }) => {
      if (msgs.length < 6) return {
        key,
        trend: null
      };
      const sumSlice = (start, end) => {
        let sumCache = 0, sumTotal = 0;
        for (let i = start; i < end && i < msgs.length; i++) {
          sumCache += msgs[i].cacheRead;
          sumTotal += msgs[i].inputTokens + msgs[i].cacheRead;
        }
        return {
          sumCache,
          sumTotal
        };
      };
      const n = msgs.length;
      const recent = sumSlice(n - 3, n);
      const prev = sumSlice(n - 6, n - 3);
      const rateRecent = recent.sumTotal > 0 ? recent.sumCache / recent.sumTotal * 100 : 0;
      const ratePrev = prev.sumTotal > 0 ? prev.sumCache / prev.sumTotal * 100 : 0;
      return {
        key,
        trend: rateRecent - ratePrev
      };
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
    global: toggleGlobal,
    model: toggleModel
  };
  return (() => {
    var _el$ = _$createElement2("box"), _el$2 = _$createElement2("box"), _el$3 = _$createElement2("text"), _el$4 = _$createTextNode2(` `), _el$5 = _$createElement2("text");
    _$insertNode2(_el$, _el$2);
    _$use((el) => {
      outerBoxRef = el;
    }, _el$);
    _$setProp2(_el$, "onSizeChange", () => {
      if (outerBoxRef) setPanelWidth(outerBoxRef.width);
    });
    _$setProp2(_el$, "flexDirection", "column");
    _$setProp2(_el$, "border", true);
    _$setProp2(_el$, "borderStyle", "rounded");
    _$insertNode2(_el$2, _el$3);
    _$insertNode2(_el$2, _el$5);
    _$setProp2(_el$2, "flexDirection", "row");
    _$setProp2(_el$2, "justifyContent", "space-between");
    _$setProp2(_el$2, "paddingX", 1);
    _$insertNode2(_el$3, _el$4);
    _$insert2(_el$3, () => isPanelCollapsed() ? "\u25B6" : "\u25BE", _el$4);
    _$insert2(_el$3, () => t2("panelTitle"), null);
    _$insert2(_el$5, (() => {
      var _c$ = _$memo2(() => !!isPanelCollapsed());
      return () => _c$() ? formatTokens(sessionTotals().totalTokens) : "";
    })(), null);
    _$insert2(_el$5, (() => {
      var _c$2 = _$memo2(() => globalHitRate() >= 0);
      return () => _c$2() ? (() => {
        var _el$10 = _$createElement2("span");
        _$insert2(_el$10, (() => {
          var _c$3 = _$memo2(() => !!isPanelCollapsed());
          return () => _c$3() ? ` (${globalHitRate().toFixed(1)}% hit)` : `${globalHitRate().toFixed(1)}% hit`;
        })());
        _$effect2((_$p) => _$setProp2(_el$10, "style", {
          fg: hitRateColor(globalHitRate())
        }, _$p));
        return _el$10;
      })() : "";
    })(), null);
    _$insert2(_el$, _$createComponent2(ProviderUsageBlocks, {
      context
    }), null);
    _$insert2(_el$, _$createComponent2(Show2, {
      get when() {
        return !isPanelCollapsed();
      },
      get children() {
        return [(() => {
          var _el$6 = _$createElement2("text");
          _$insert2(_el$6, divider);
          _$effect2((_$p) => _$setProp2(_el$6, "fg", borderColor(), _$p));
          return _el$6;
        })(), (() => {
          var _el$7 = _$createElement2("box");
          _$setProp2(_el$7, "flexDirection", "row");
          _$setProp2(_el$7, "paddingX", 1);
          _$insert2(_el$7, _$createComponent2(For2, {
            get each() {
              return [{
                val: formatTokens(sessionTotals().totalTokens),
                lbl: t2("total")
              }, {
                val: sessionTotals().totalRequests.toString(),
                lbl: t2("requests")
              }, {
                val: formatTokens(sessionTotals().totalInput),
                lbl: t2("input")
              }, {
                val: formatTokens(sessionTotals().totalOutput),
                lbl: t2("output")
              }];
            },
            children: (item, idx) => {
              const colW = () => {
                const totalW = panelWidth() - 4;
                const base = Math.floor(totalW / 4);
                return idx() === 3 ? totalW - base * 3 : base;
              };
              return (() => {
                var _el$11 = _$createElement2("box"), _el$12 = _$createElement2("text"), _el$13 = _$createElement2("text");
                _$insertNode2(_el$11, _el$12);
                _$insertNode2(_el$11, _el$13);
                _$setProp2(_el$11, "flexDirection", "column");
                _$insert2(_el$12, () => centerAlign(item.val, colW()));
                _$insert2(_el$13, () => centerAlign(isEnglish(item.lbl) ? item.lbl.toUpperCase() : item.lbl, colW()));
                _$effect2((_p$) => {
                  var _v$7 = colW(), _v$8 = primaryColor(), _v$9 = dimColor();
                  _v$7 !== _p$.e && (_p$.e = _$setProp2(_el$11, "width", _v$7, _p$.e));
                  _v$8 !== _p$.t && (_p$.t = _$setProp2(_el$12, "fg", _v$8, _p$.t));
                  _v$9 !== _p$.a && (_p$.a = _$setProp2(_el$13, "fg", _v$9, _p$.a));
                  return _p$;
                }, {
                  e: void 0,
                  t: void 0,
                  a: void 0
                });
                return _el$11;
              })();
            }
          }));
          return _el$7;
        })(), _$createComponent2(Show2, {
          get when() {
            return _$memo2(() => !!showPricing())() && sessionTotals().totalCost > 0;
          },
          get children() {
            var _el$8 = _$createElement2("box"), _el$9 = _$createElement2("text"), _el$0 = _$createTextNode2(`: `), _el$1 = _$createElement2("span");
            _$insertNode2(_el$8, _el$9);
            _$setProp2(_el$8, "flexDirection", "row");
            _$setProp2(_el$8, "justifyContent", "center");
            _$setProp2(_el$8, "marginTop", 1);
            _$insertNode2(_el$9, _el$0);
            _$insertNode2(_el$9, _el$1);
            _$insert2(_el$9, () => t2("cost"), _el$0);
            _$insert2(_el$1, () => formatCost(sessionTotals().totalCost));
            _$effect2((_p$) => {
              var _v$ = mutedColor(), _v$2 = {
                fg: greenColor()
              };
              _v$ !== _p$.e && (_p$.e = _$setProp2(_el$9, "fg", _v$, _p$.e));
              _v$2 !== _p$.t && (_p$.t = _$setProp2(_el$1, "style", _v$2, _p$.t));
              return _p$;
            }, {
              e: void 0,
              t: void 0
            });
            return _el$8;
          }
        }), _$createComponent2(For2, {
          get each() {
            return modelStats();
          },
          children: ([key, stat]) => {
            const isExpanded = () => !isModelCollapsed(key);
            const hitDenom = stat.totalInput + stat.cacheRead;
            const hitRate = hitDenom > 0 ? stat.cacheRead / hitDenom * 100 : 0;
            const isMissing = isMissingCache(stat.requestCount, stat.cacheRead);
            const modelTotalTokens = stat.totalInput + stat.totalOutput + stat.totalReasoning + stat.cacheRead + stat.cacheWrite;
            const trendStr = () => {
              if (!showTrend()) return "";
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
            const trendBudget = () => showTrend() ? 7 : 0;
            const modelBarWidth = () => Math.max(8, panelWidth() - 4 - targetW() - 11 - trendBudget());
            return (() => {
              var _el$14 = _$createElement2("box"), _el$15 = _$createElement2("box"), _el$16 = _$createElement2("text"), _el$17 = _$createElement2("span"), _el$19 = _$createTextNode2(` `), _el$20 = _$createElement2("span"), _el$21 = _$createElement2("text");
              _$insertNode2(_el$14, _el$15);
              _$setProp2(_el$14, "flexDirection", "column");
              _$setProp2(_el$14, "marginTop", 1);
              _$insertNode2(_el$15, _el$16);
              _$insertNode2(_el$15, _el$21);
              _$setProp2(_el$15, "flexDirection", "row");
              _$setProp2(_el$15, "justifyContent", "space-between");
              _$setProp2(_el$15, "onMouseDown", () => toggle.model(key));
              _$setProp2(_el$15, "paddingX", 1);
              _$insertNode2(_el$16, _el$17);
              _$insertNode2(_el$16, _el$19);
              _$insertNode2(_el$16, _el$20);
              _$insertNode2(_el$17, _$createTextNode2(`\u25CF`));
              _$insert2(_el$20, shortTitle);
              _$insert2(_el$21, modelHeaderRight);
              _$insert2(_el$14, _$createComponent2(Show2, {
                get when() {
                  return isExpanded();
                },
                get children() {
                  var _el$22 = _$createElement2("box"), _el$23 = _$createElement2("box"), _el$24 = _$createElement2("box"), _el$25 = _$createElement2("text");
                  _$insertNode2(_el$22, _el$23);
                  _$insertNode2(_el$22, _el$25);
                  _$setProp2(_el$22, "flexDirection", "column");
                  _$setProp2(_el$22, "paddingX", 1);
                  _$insertNode2(_el$23, _el$24);
                  _$setProp2(_el$23, "flexDirection", "column");
                  _$setProp2(_el$23, "border", true);
                  _$setProp2(_el$23, "borderStyle", "rounded");
                  _$setProp2(_el$24, "flexDirection", "row");
                  _$insert2(_el$24, _$createComponent2(For2, {
                    get each() {
                      return [{
                        val: formatTokens(modelTotalTokens),
                        lbl: t2("total")
                      }, {
                        val: formatTokens(stat.totalInput),
                        lbl: t2("input")
                      }, {
                        val: formatTokens(stat.totalOutput),
                        lbl: t2("output")
                      }];
                    },
                    children: (item, idx) => {
                      const colW = () => {
                        const totalW = panelWidth() - 6;
                        const base = Math.floor(totalW / 3);
                        return idx() === 2 ? totalW - base * 2 : base;
                      };
                      return (() => {
                        var _el$36 = _$createElement2("box"), _el$37 = _$createElement2("text"), _el$38 = _$createElement2("text");
                        _$insertNode2(_el$36, _el$37);
                        _$insertNode2(_el$36, _el$38);
                        _$setProp2(_el$36, "flexDirection", "column");
                        _$insert2(_el$37, () => centerAlign(item.val, colW()));
                        _$insert2(_el$38, () => centerAlign(isEnglish(item.lbl) ? item.lbl.toUpperCase() : item.lbl, colW()));
                        _$effect2((_p$) => {
                          var _v$18 = colW(), _v$19 = primaryColor(), _v$20 = dimColor();
                          _v$18 !== _p$.e && (_p$.e = _$setProp2(_el$36, "width", _v$18, _p$.e));
                          _v$19 !== _p$.t && (_p$.t = _$setProp2(_el$37, "fg", _v$19, _p$.t));
                          _v$20 !== _p$.a && (_p$.a = _$setProp2(_el$38, "fg", _v$20, _p$.a));
                          return _p$;
                        }, {
                          e: void 0,
                          t: void 0,
                          a: void 0
                        });
                        return _el$36;
                      })();
                    }
                  }));
                  _$insert2(_el$25, paddedCachePrefix, null);
                  _$insert2(_el$25, isMissing ? (() => {
                    var _el$39 = _$createElement2("span"), _el$40 = _$createTextNode2(` `);
                    _$insertNode2(_el$39, _el$40);
                    _$insert2(_el$39, () => progressRemaining(0, modelBarWidth()), _el$40);
                    _$insert2(_el$39, () => t2("missing"), null);
                    _$effect2((_$p) => _$setProp2(_el$39, "style", {
                      fg: missingColor()
                    }, _$p));
                    return _el$39;
                  })() : (() => {
                    var _el$41 = _$createElement2("span"), _el$42 = _$createTextNode2(` `), _el$43 = _$createTextNode2(`%`);
                    _$insertNode2(_el$41, _el$42);
                    _$insertNode2(_el$41, _el$43);
                    _$insert2(_el$41, () => progressFilled(hitRate, modelBarWidth()), _el$42);
                    _$insert2(_el$41, () => progressRemaining(hitRate, modelBarWidth()), _el$42);
                    _$insert2(_el$41, () => hitRate.toFixed(1), _el$43);
                    _$effect2((_$p) => _$setProp2(_el$41, "style", {
                      fg: hitRateColor(hitRate)
                    }, _$p));
                    return _el$41;
                  })(), null);
                  _$insert2(_el$25, (() => {
                    var _c$4 = _$memo2(() => !!trendStr());
                    return () => _c$4() ? (() => {
                      var _el$44 = _$createElement2("span");
                      _$insert2(_el$44, trendStr);
                      _$effect2((_$p) => _$setProp2(_el$44, "style", {
                        fg: trendColor()
                      }, _$p));
                      return _el$44;
                    })() : null;
                  })(), null);
                  _$insert2(_el$22, _$createComponent2(Show2, {
                    get when() {
                      return _$memo2(() => !!showPerformance())() && !!perfStats().models[key];
                    },
                    get children() {
                      var _el$26 = _$createElement2("text"), _el$27 = _$createTextNode2(` `), _el$28 = _$createElement2("span"), _el$29 = _$createTextNode2(`  `), _el$30 = _$createTextNode2(` `), _el$31 = _$createElement2("span"), _el$32 = _$createTextNode2(`  `), _el$33 = _$createTextNode2(` `), _el$34 = _$createElement2("span");
                      _$insertNode2(_el$26, _el$27);
                      _$insertNode2(_el$26, _el$28);
                      _$insertNode2(_el$26, _el$29);
                      _$insertNode2(_el$26, _el$30);
                      _$insertNode2(_el$26, _el$31);
                      _$insertNode2(_el$26, _el$32);
                      _$insertNode2(_el$26, _el$33);
                      _$insertNode2(_el$26, _el$34);
                      _$setProp2(_el$26, "marginTop", 1);
                      _$insert2(_el$26, () => t2("ttft"), _el$27);
                      _$insert2(_el$28, () => formatDuration(perfStats().models[key]?.avgTTFT ?? null));
                      _$insert2(_el$26, () => t2("tps"), _el$30);
                      _$insert2(_el$31, () => perfStats().models[key]?.avgTPS?.toFixed(1) ?? "\u2014");
                      _$insert2(_el$26, () => t2("lat"), _el$33);
                      _$insert2(_el$34, () => formatDuration(perfStats().models[key]?.avgLatency ?? null));
                      _$effect2((_p$) => {
                        var _v$0 = mutedColor(), _v$1 = {
                          fg: primaryColor()
                        }, _v$10 = {
                          fg: primaryColor()
                        }, _v$11 = {
                          fg: primaryColor()
                        };
                        _v$0 !== _p$.e && (_p$.e = _$setProp2(_el$26, "fg", _v$0, _p$.e));
                        _v$1 !== _p$.t && (_p$.t = _$setProp2(_el$28, "style", _v$1, _p$.t));
                        _v$10 !== _p$.a && (_p$.a = _$setProp2(_el$31, "style", _v$10, _p$.a));
                        _v$11 !== _p$.o && (_p$.o = _$setProp2(_el$34, "style", _v$11, _p$.o));
                        return _p$;
                      }, {
                        e: void 0,
                        t: void 0,
                        a: void 0,
                        o: void 0
                      });
                      return _el$26;
                    }
                  }), null);
                  _$insert2(_el$22, _$createComponent2(Show2, {
                    get when() {
                      return _$memo2(() => !!showPricing())() && stat.totalCost > 0;
                    },
                    get children() {
                      var _el$35 = _$createElement2("text");
                      _$insert2(_el$35, paddedCostPrefix, null);
                      _$insert2(_el$35, () => formatCost(stat.totalCost), null);
                      _$effect2((_$p) => _$setProp2(_el$35, "fg", mutedColor(), _$p));
                      return _el$35;
                    }
                  }), null);
                  _$effect2((_p$) => {
                    var _v$12 = borderColor(), _v$13 = mutedColor();
                    _v$12 !== _p$.e && (_p$.e = _$setProp2(_el$23, "borderColor", _v$12, _p$.e));
                    _v$13 !== _p$.t && (_p$.t = _$setProp2(_el$25, "fg", _v$13, _p$.t));
                    return _p$;
                  }, {
                    e: void 0,
                    t: void 0
                  });
                  return _el$22;
                }
              }), null);
              _$effect2((_p$) => {
                var _v$14 = mutedColor(), _v$15 = {
                  fg: isMissing ? missingColor() : hitRateColor(hitRate)
                }, _v$16 = {
                  fg: primaryColor()
                }, _v$17 = mutedColor();
                _v$14 !== _p$.e && (_p$.e = _$setProp2(_el$16, "fg", _v$14, _p$.e));
                _v$15 !== _p$.t && (_p$.t = _$setProp2(_el$17, "style", _v$15, _p$.t));
                _v$16 !== _p$.a && (_p$.a = _$setProp2(_el$20, "style", _v$16, _p$.a));
                _v$17 !== _p$.o && (_p$.o = _$setProp2(_el$21, "fg", _v$17, _p$.o));
                return _p$;
              }, {
                e: void 0,
                t: void 0,
                a: void 0,
                o: void 0
              });
              return _el$14;
            })();
          }
        })];
      }
    }), null);
    _$effect2((_p$) => {
      var _v$3 = borderColor(), _v$4 = toggle.global, _v$5 = primaryColor(), _v$6 = mutedColor();
      _v$3 !== _p$.e && (_p$.e = _$setProp2(_el$, "borderColor", _v$3, _p$.e));
      _v$4 !== _p$.t && (_p$.t = _$setProp2(_el$2, "onMouseDown", _v$4, _p$.t));
      _v$5 !== _p$.a && (_p$.a = _$setProp2(_el$3, "fg", _v$5, _p$.a));
      _v$6 !== _p$.o && (_p$.o = _$setProp2(_el$5, "fg", _v$6, _p$.o));
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0
    });
    return _el$;
  })();
}

// src/queries.ts
var client = null;
function setV2Client(c) {
  client = c;
  clearQueryCache();
}
function getV2Client() {
  return client;
}
function requireClient() {
  if (!client) throw new Error("Usage Stat client is not initialized (setV2Client not called)");
  return client;
}
var SNAPSHOT_TTL_MS = 3e4;
var snapshotPromise = null;
var snapshotAt = 0;
function clearQueryCache() {
  snapshotPromise = null;
  snapshotAt = 0;
}
async function loadSnapshot() {
  const c = requireClient();
  const all = [];
  let cursor;
  for (; ; ) {
    const res = await c.session.list({ limit: 500, cursor });
    const page = res?.data;
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    const next = res?.cursor?.next;
    if (!next) break;
    cursor = next;
  }
  const messages = /* @__PURE__ */ new Map();
  const batchSize = 8;
  for (let i = 0; i < all.length; i += batchSize) {
    const batch = all.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async (s) => {
      try {
        return await fetchAllMessages(s.id);
      } catch (err) {
        console.warn(`[opencode-usage-stat] failed to read messages for ${s.id}:`, err);
        return null;
      }
    }));
    for (let j = 0; j < batch.length; j++) {
      if (results[j]) messages.set(batch[j].id, results[j]);
    }
  }
  return { sessions: all, messages };
}
function snapshot() {
  if (snapshotPromise && snapshotAt && Date.now() - snapshotAt > SNAPSHOT_TTL_MS) {
    snapshotPromise = null;
    snapshotAt = 0;
  }
  if (!snapshotPromise) {
    const pending = loadSnapshot();
    void pending.then(
      (result) => {
        snapshotAt = Date.now();
      },
      () => {
      }
    );
    void pending.catch(() => {
      if (snapshotPromise === pending) {
        snapshotPromise = null;
        snapshotAt = 0;
      }
    });
    snapshotPromise = pending;
  }
  return snapshotPromise;
}
async function fetchAllSessions() {
  return (await snapshot()).sessions;
}
async function loadAssistants(filters = {}) {
  const snap = await snapshot();
  const out = [];
  for (const [sessionID, msgs] of snap.messages) {
    for (const m of msgs) {
      const a = asAssistant(m, sessionID);
      if (!a) continue;
      if (a.tokens.total <= 0) continue;
      if (!matchesFilters(a, filters)) continue;
      out.push(a);
    }
  }
  return out;
}
async function fetchAllMessages(sessionID, limit = 200) {
  const c = requireClient();
  const all = [];
  let cursor;
  for (; ; ) {
    const res = await c.message.list({ sessionID, limit, order: cursor ? void 0 : "asc", cursor });
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
  const snap = await snapshot();
  let successCount = 0;
  let failedCount = 0;
  const byModelMap = /* @__PURE__ */ new Map();
  for (const [sessionID, msgs] of snap.messages) {
    for (const m of msgs) {
      if (m?.type !== "assistant") continue;
      const a = asAssistant(m, sessionID);
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
  const [summary, models, providers, daily, sessions, errors, totalSessions] = await Promise.all([
    getSummary(filters),
    getModelBreakdown(filters),
    getProviderBreakdown(filters),
    getDailyBreakdown(filters),
    getSessionBreakdown(filters),
    getErrorStats(filters),
    getSessionCount(filters)
  ]);
  return { filters, summary, models, providers, daily, sessions, totalSessions, errors };
}
async function getSessionCount(filters = {}) {
  const assistants = await loadAssistants(filters);
  return new Set(assistants.map((a) => a.sessionID)).size;
}

// src/pricing.ts
import { readFileSync as readFileSync5, writeFileSync as writeFileSync3, existsSync as existsSync5 } from "node:fs";
import { join as join5 } from "node:path";
import { homedir as homedir5 } from "node:os";
import { execSync } from "node:child_process";
var PRICING_PATH = join5(homedir5(), ".opencode", "usage-stat-pricing.json");
var MODELS_DEV_URL = "https://models.dev/api.json";
var MISSING_HIT_RATE = 0.94;
var CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
var NON_CACHE_PROVIDERS = /* @__PURE__ */ new Set(["ollama", "ollama-cloud"]);
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
    if (existsSync5(PRICING_PATH)) {
      const content = readFileSync5(PRICING_PATH, "utf-8");
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
  const isMissing = !NON_CACHE_PROVIDERS.has(providerID.toLowerCase()) && isMissingCache(requestCount, cacheRead);
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
import { existsSync as existsSync6, readFileSync as readFileSync6 } from "node:fs";
import { dirname as dirname2, join as join6 } from "node:path";
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
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
function nowString() {
  const now = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}
function percentile2(sortedAsc, p) {
  return percentileSorted(sortedAsc, p);
}
function embeddedEChartsScript() {
  const candidates = [
    join6(dirname2(fileURLToPath(import.meta.url)), "..", "vendor", "echarts.min.js"),
    join6(process.cwd(), "vendor", "echarts.min.js"),
    join6(process.cwd(), "dist", "..", "vendor", "echarts.min.js")
  ];
  for (const path of candidates) {
    if (!existsSync6(path)) continue;
    const source = readFileSync6(path, "utf8").replace(/<\/script/gi, "<\\/script");
    return `<script>${source}</script>`;
  }
  return `<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>`;
}
var HTML_HEAD_SHARED = embeddedEChartsScript();
var BG_ANIMATION_HTML = `
<div class="scroll-progress" aria-hidden="true"><span id="scroll-progress-bar"></span></div>
<div class="bg-canvas" aria-hidden="true">
  <canvas id="bg-particles"></canvas>
  <div class="bg-orb bg-orb-1"></div>
  <div class="bg-orb bg-orb-2"></div>
  <div class="bg-orb bg-orb-3"></div>
  <div class="bg-spot"></div>
  <div class="bg-halo"></div>
  <div class="bg-grid"></div>
  <div class="bg-noise"></div>
</div>`;
var BG_ANIMATION_CSS = `
  .bg-canvas { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  .bg-canvas canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .scroll-progress { position: fixed; inset: 0 0 auto; height: 2px; z-index: 100; background: rgba(255,255,255,.035); pointer-events:none; }
  .scroll-progress span { display:block; width:100%; height:100%; transform:scaleX(0); transform-origin:left; background:linear-gradient(90deg,#77777f,#f2f2ef); box-shadow:0 0 18px rgba(242,242,239,.35); }
  .bg-orb { position: absolute; border-radius: 50%; filter: blur(120px); will-change: transform; }
  .bg-orb-1 { width: 70vw; height: 80vh; background: radial-gradient(circle, rgba(240,240,238,.95), transparent 65%); top: -30vh; left: -10vw; opacity:.13; animation: orbDrift1 26s ease-in-out infinite; }
  .bg-orb-2 { width: 60vw; height: 70vh; background: radial-gradient(circle, rgba(157,157,166,.85), transparent 68%); top:35vh; right:-15vw; opacity:.09; animation: orbDrift2 34s ease-in-out infinite reverse; }
  .bg-orb-3 { width: 55vw; height: 60vh; background: radial-gradient(circle, rgba(200,200,206,.9), transparent 70%); bottom:-25vh; left:25vw; opacity:.07; animation: orbDrift3 42s ease-in-out infinite; }
  /* Slow drift plus a subtle parallax pull towards the cursor (--px/--py in -1..1) */
  @keyframes orbDrift1 { 0%,100%{transform:translate3d(calc(var(--px,0)*22px),calc(var(--py,0)*18px),0) scale(1)} 50%{transform:translate3d(calc(3% + var(--px,0)*22px),calc(-4% + var(--py,0)*18px),0) scale(1.08)} }
  @keyframes orbDrift2 { 0%,100%{transform:translate3d(calc(var(--px,0)*-34px),calc(var(--py,0)*-26px),0) scale(1)} 50%{transform:translate3d(calc(3% + var(--px,0)*-34px),calc(-4% + var(--py,0)*-26px),0) scale(1.08)} }
  @keyframes orbDrift3 { 0%,100%{transform:translate3d(calc(var(--px,0)*-16px),calc(var(--py,0)*12px),0) scale(1)} 50%{transform:translate3d(calc(3% + var(--px,0)*-16px),calc(-4% + var(--py,0)*12px),0) scale(1.08)} }
  /* Cursor spotlight: a wide soft glow with a brighter core, position driven by --mx/--my */
  .bg-spot { position:absolute; left:0; top:0; width:120vmin; height:120vmin; margin:-60vmin 0 0 -60vmin; border-radius:50%; background:radial-gradient(circle, rgba(255,255,255,.075), rgba(255,255,255,.02) 42%, transparent 68%); will-change:transform; }
  .bg-halo { position:absolute; left:0; top:0; width:44vmin; height:44vmin; margin:-22vmin 0 0 -22vmin; border-radius:50%; background:radial-gradient(circle, rgba(255,255,255,.05), transparent 62%); will-change:transform; }
  .bg-grid { position:absolute; inset:0; opacity:.52; background-image:linear-gradient(rgba(255,255,255,.028) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.028) 1px,transparent 1px); background-size:72px 72px; mask-image:radial-gradient(ellipse 100% 70% at 50% 0%,#000 20%,transparent 85%); -webkit-mask-image:radial-gradient(ellipse 100% 70% at 50% 0%,#000 20%,transparent 85%); }
  .bg-canvas::after { content:''; position:absolute; inset:0; background:linear-gradient(rgba(7,7,9,.1),rgba(7,7,9,.28)),radial-gradient(ellipse 95% 76% at 50% 40%,transparent 48%,rgba(0,0,0,.55) 100%); }
  .bg-noise { position:absolute; inset:-50%; width:200%; height:200%; opacity:.018; mix-blend-mode:overlay; background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.5'/%3E%3C/svg%3E"); animation:grain 7s steps(6) infinite; }
  @keyframes grain { 0%,100%{transform:translate(0,0)} 20%{transform:translate(-4%,3%)} 40%{transform:translate(3%,-5%)} 60%{transform:translate(-3%,-2%)} 80%{transform:translate(5%,4%)} }
  @media (prefers-reduced-motion:reduce) { .bg-orb,.bg-noise,.bg-spot,.bg-halo{animation:none!important} .bg-canvas canvas{display:none} }`;
var BG_PARTICLE_JS = `
// Cursor spotlight + orb parallax: smooth lerp follow, transform-only updates.
;(function() {
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var bg = document.querySelector('.bg-canvas');
  var spot = document.querySelector('.bg-spot');
  var halo = document.querySelector('.bg-halo');
  if (!bg || !spot || !halo) return;
  var tx = window.innerWidth / 2, ty = window.innerHeight * 0.35;
  var sx = tx, sy = ty, hx = tx, hy = ty;
  var hidden = false;
  window.addEventListener('pointermove', function(e) { tx = e.clientX; ty = e.clientY; });
  function frame() {
    sx += (tx - sx) * 0.055;
    sy += (ty - sy) * 0.055;
    hx += (tx - hx) * 0.12;
    hy += (ty - hy) * 0.12;
    spot.style.transform = 'translate3d(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px,0)';
    halo.style.transform = 'translate3d(' + hx.toFixed(1) + 'px,' + hy.toFixed(1) + 'px,0)';
    bg.style.setProperty('--px', ((hx / window.innerWidth) * 2 - 1).toFixed(3));
    bg.style.setProperty('--py', ((hy / window.innerHeight) * 2 - 1).toFixed(3));
    if (!hidden) requestAnimationFrame(frame);
  }
  if (!reduced) {
    requestAnimationFrame(frame);
    document.addEventListener('visibilitychange', function() {
      hidden = document.hidden;
      if (!hidden) requestAnimationFrame(frame);
    });
  } else {
    spot.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0)';
    halo.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0)';
  }
})();

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
  /* Graphite Observatory -- the only theme. */
  :root {
    color-scheme: dark;
    --bg:#0c0c0e; --bg-card:#131316; --bg-card-hover:#19191d;
    --border:rgba(255,255,255,.10); --border-light:rgba(255,255,255,.18);
    --text:#f2f2ef; --text-dim:#b0b0b9; --text-faint:#7d7d86;
    --cache:#8fb7a2; --input:#c8d4e3; --output:#b6adc8; --reasoning:#c4a982;
    --tps:#d0b77d; --missing:#a8a0bb; --danger:#df7b83; --success:#8fb7a2;
    --radius:20px; --radius-sm:10px;
    --shadow-md:0 28px 70px -36px rgba(0,0,0,.98);
    --shadow-glow:0 0 34px rgba(143,183,162,.12);
    --ease:cubic-bezier(.16,1,.3,1);
    --font-sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    --font-mono:ui-monospace,"SFMono-Regular",Consolas,"Liberation Mono",monospace;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html{scroll-behavior:smooth}
  body { background: var(--bg); color: var(--text); font-family: var(--font-sans); font-size: 14px; line-height: 1.5; min-height: 100vh; overflow-x: hidden; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
  ::selection{background:#e7e7e4;color:#0c0c0e}
  ::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#2a2a30;border-radius:99px}::-webkit-scrollbar-thumb:hover{background:#3d3d46}
  :focus-visible{outline:2px solid #f2f2ef;outline-offset:3px}
  .container{max-width:1440px;margin:0 auto;padding:30px 24px 56px;position:relative;z-index:1}
  .header{display:flex;justify-content:space-between;align-items:flex-start;padding:24px 4px 30px;margin-bottom:20px;gap:24px;flex-wrap:wrap}
  .header-left h1{font-size:clamp(30px,4vw,54px);line-height:1;font-weight:300;letter-spacing:-.055em;margin-bottom:12px;color:var(--text)}
  .header-left h1 span{color:#8f8f98}
  .header-left .session-info,.header-right,.header .meta{font-size:10px;color:var(--text-dim);font-family:var(--font-mono);letter-spacing:.08em;text-transform:uppercase}
  .header-right,.header .meta{max-width:560px;text-align:right;padding-top:8px}

  .kpi-row{display:grid;gap:12px;margin-bottom:14px}
  .kpi-hero-row{grid-template-columns:repeat(5,1fr)}
  .kpi-minor-row{grid-template-columns:repeat(4,1fr)}
  .kpi-session-row{grid-template-columns:repeat(5,1fr)}
  .kpi-card{--mx:-999px;--my:-999px;background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.014) 48%,rgba(0,0,0,.16)),#131316;color:var(--text);border:1px solid var(--border);border-radius:var(--radius);padding:22px 18px 18px;text-align:left;min-height:126px;position:relative;overflow:hidden;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),var(--shadow-md);transition:transform .5s var(--ease),box-shadow .5s var(--ease),border-color .5s var(--ease)}
  .kpi-card::before{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(300px circle at var(--mx) var(--my),rgba(255,255,255,.12),transparent 68%);opacity:.72}
  .kpi-card:hover{transform:translateY(-5px) scale(1.01);border-color:var(--border-light);box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 34px 74px -34px rgba(0,0,0,.98)}
  .kpi-card.kpi-glow{border-color:rgba(255,255,255,.3);box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 0 0 1px rgba(255,255,255,.12),var(--shadow-md)}
  .kpi-card.kpi-light{background:linear-gradient(165deg,#f3f3f0,#e2e2de 58%,#d2d2cd);color:#131316;border-color:rgba(255,255,255,.55);box-shadow:inset 0 1px 0 rgba(255,255,255,.85),var(--shadow-md)}
  .kpi-card.kpi-light::before{background:radial-gradient(300px circle at var(--mx) var(--my),rgba(255,255,255,.78),transparent 68%)}
  .kpi-card.kpi-light .kpi-label{color:#55555d}
  .kpi-card.kpi-light .kpi-value{color:#111114!important}
  .kpi-card.kpi-light .kpi-sub{color:#65656d}
  .kpi-card.kpi-minor{min-height:96px;padding:15px 14px 11px}
  .kpi-minor .kpi-label{margin-bottom:10px}
  .kpi-minor .kpi-value{font-size:clamp(18px,1.6vw,26px)}
  .kpi-label,.kpi-value,.kpi-sub{position:relative;z-index:1}
  .kpi-label{font-size:9px;color:#9898a1;text-transform:uppercase;margin-bottom:16px;letter-spacing:.22em;font-family:var(--font-mono);font-weight:500}
  .kpi-value{font-size:clamp(25px,2.2vw,36px);line-height:1;font-weight:400;font-family:var(--font-mono);color:var(--text);font-variant-numeric:tabular-nums;letter-spacing:-.055em}
  .kpi-value[data-countup^="$"]{font-size:clamp(22px,2vw,32px)}
  .kpi-value.kpi-avg-daily{color:var(--avg-daily-color)!important}
  .kpi-sub{font-size:9px;color:#8a8a93;margin-top:10px;font-family:var(--font-mono);letter-spacing:.04em}
  .kpi-spark{display:block;width:100%;height:26px;margin-top:10px}

  .section{margin-bottom:18px}
  .section-title{font-size:11px;font-family:var(--font-mono);font-weight:500;text-transform:uppercase;letter-spacing:.17em;color:#cbc9c4;margin-bottom:10px;padding:0 4px;display:flex;align-items:center;gap:10px}
  .section-title::before{content:'';width:7px;height:7px;background:transparent;border:1px solid #d8d8d5;border-radius:50%;box-shadow:0 0 14px rgba(231,231,228,.35)}
  .section-title .sub{font-size:9px;color:var(--text-faint);letter-spacing:.08em;text-transform:none;font-weight:400}
  .chart-box,.model-card,.provider-card,.insight-card,.empty-state{--mx:-999px;--my:-999px;background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.012) 42%,rgba(0,0,0,.14)),var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:inset 0 1px 0 rgba(255,255,255,.05),var(--shadow-md);position:relative;overflow:hidden}
  .chart-box::before,.model-card::before,.provider-card::before,.insight-card::before{content:'';position:absolute;inset:0;pointer-events:none;z-index:0;background:radial-gradient(360px circle at var(--mx) var(--my),rgba(255,255,255,.075),transparent 70%)}
  .chart-box{padding:12px;height:420px}
  .chart-box canvas{position:relative;z-index:1}

  .tab-bar,.view-btn-bar{display:inline-flex;gap:3px;margin-bottom:10px;padding:4px;background:rgba(255,255,255,.035);border:1px solid var(--border);border-radius:12px}
  .tab-btn,.view-btn{background:transparent;border:0;color:var(--text-dim);padding:7px 14px;border-radius:8px;cursor:pointer;font-size:10px;font-family:var(--font-mono);letter-spacing:.07em;transition:all .3s var(--ease)}
  .tab-btn:hover,.view-btn:hover{color:var(--text);background:rgba(255,255,255,.05)}
  .tab-btn.active,.view-btn.active{background:#e7e7e4;color:#111114;box-shadow:0 8px 22px -12px rgba(255,255,255,.35)}
  .tab-content{display:none}
  .tab-content.active{display:block;animation:tabIn .35s var(--ease) both}
  @keyframes tabIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

  .model-card{padding:18px;margin-bottom:12px;transition:transform .4s var(--ease),border-color .4s var(--ease)}
  .model-card:hover,.provider-card:hover,.insight-card:hover{border-color:var(--border-light);transform:translateY(-3px)}
  .model-card>*,.provider-card>*,.insight-card>*{position:relative;z-index:1}
  .model-card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border)}
  .model-name{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:500;color:var(--text);font-family:var(--font-mono)}
  .model-provider{font-size:9px;color:var(--text-dim);background:rgba(255,255,255,.055);padding:4px 9px;border:1px solid var(--border);border-radius:99px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.08em}
  .stat-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px}
  .stat-item{display:flex;flex-direction:column;gap:2px}
  .stat-label{font-size:9px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.13em;font-family:var(--font-mono)}
  .stat-value{font-size:13px;font-family:var(--font-mono);color:var(--text);font-variant-numeric:tabular-nums}

  .token-bar{display:flex;height:7px;border-radius:99px;overflow:hidden;background:rgba(255,255,255,.05);margin-bottom:9px}
  .token-seg{height:100%;transition:width .8s var(--ease),filter .3s;box-shadow:inset 0 1px rgba(255,255,255,.18)}
  .token-seg:hover{filter:brightness(1.45)}
  .token-seg.input{background:var(--input)} .token-seg.cache-read{background:var(--cache)} .token-seg.reasoning{background:var(--reasoning)} .token-seg.output{background:var(--output)} .token-seg.cache-write{background:#8295a8}
  .token-bar-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:11px;color:var(--text-dim)}
  .legend-item{display:flex;align-items:center;gap:4px}
  .legend-dot{width:7px;height:7px;border-radius:50%;display:inline-block;box-shadow:0 0 8px currentColor}
  .legend-dot.input{background:var(--input)} .legend-dot.cache-read{background:var(--cache)} .legend-dot.reasoning{background:var(--reasoning)} .legend-dot.output{background:var(--output)} .legend-dot.cache-write{background:#8295a8}

  .table-scroll{width:100%;overflow:auto;max-height:560px;border-radius:var(--radius);box-shadow:var(--shadow-md)}
  .data-table{width:100%;min-width:760px;border-collapse:separate;border-spacing:0;font-size:11.5px;background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(0,0,0,.1)),var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:inset 0 1px rgba(255,255,255,.04)}
  .data-table th{position:sticky;top:0;z-index:1;background:#191920;color:var(--text-dim);padding:13px 11px;text-align:right;border-bottom:1px solid var(--border);font-size:9px;letter-spacing:.1em;text-transform:uppercase;font-family:var(--font-mono);font-weight:500;white-space:nowrap}
  .data-table th:first-child,.data-table th:nth-child(3){text-align:left}
  .data-table th.sortable{cursor:pointer;user-select:none}
  .data-table th.sortable::after{content:' \\2195';font-size:.8em;opacity:.4}
  .data-table th.sortable:hover{color:var(--text)}
  .data-table th.sortable.asc::after{content:' \\2191';opacity:1;color:var(--text)}
  .data-table th.sortable.desc::after{content:' \\2193';opacity:1;color:var(--text)}
  .data-table td{padding:10px 11px;text-align:right;border-bottom:1px solid rgba(255,255,255,.05);font-family:var(--font-mono);color:#cdcdd3;font-variant-numeric:tabular-nums;transition:background .25s,color .25s,box-shadow .25s}
  .data-table td:first-child,.data-table td:nth-child(3){text-align:left;font-family:var(--font-sans);color:var(--text)}
  .data-table tbody tr:nth-child(even){background:rgba(255,255,255,.012)}
  .data-table tbody tr:hover td{background:rgba(255,255,255,.05);color:#fff}
  .data-table tbody tr:hover td:first-child{box-shadow:inset 2px 0 0 rgba(255,255,255,.28)}
  .data-table tbody tr:last-child td{border-bottom:0}
  .model-cell{display:flex;align-items:center;gap:8px}
  .model-cell .model-icon{flex-shrink:0;background:rgba(255,255,255,.05);padding:2px;border:1px solid rgba(255,255,255,.08);border-radius:6px;box-sizing:content-box;filter:saturate(.78) contrast(1.08)}
  .model-cell .model-name-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px}

  .pagination-ctrl{display:none;align-items:center;gap:14px;justify-content:center;padding:14px 0 4px}
  .page-btn{background:var(--bg-card);border:1px solid var(--border);color:var(--text);padding:7px 16px;border-radius:99px;cursor:pointer;font-size:10px;font-family:var(--font-mono);transition:all .3s var(--ease)}
  .page-btn:hover:not(:disabled){border-color:var(--border-light);background:#e7e7e4;color:#111114;transform:translateY(-2px)}
  .page-btn:disabled{opacity:.35;cursor:not-allowed}
  .page-info{color:var(--text-dim);font-size:10px;font-family:var(--font-mono);min-width:110px;text-align:center}

  .provider-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
  .provider-card{padding:16px;border-top:2px solid var(--prov-color,#8a8a92);transition:transform .4s var(--ease),border-color .4s var(--ease)}
  .provider-name{font-size:13px;font-weight:500;margin-bottom:8px;color:var(--text);font-family:var(--font-mono)}
  .provider-stat{display:flex;justify-content:space-between;font-size:12px;padding:2px 0}
  .provider-stat .stat-label{color:var(--text-dim)}
  .provider-more{color:var(--text-dim);font-size:11px;padding:10px 4px 0;grid-column:1/-1}

  .insight-card{padding:16px;display:flex;align-items:center;gap:12px;transition:transform .4s var(--ease),border-color .4s var(--ease)}
  .insight-icon{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;border:1px solid var(--border-light);font-family:var(--font-mono);flex-shrink:0}
  .insight-body{flex:1;min-width:0}
  .insight-title{font-size:12px;color:var(--text-dim);margin-bottom:2px}
  .insight-value{font-size:14px;font-weight:600;color:var(--text)}
  .insight-value .accent{color:var(--text);text-decoration:underline;text-decoration-color:#666;text-underline-offset:3px}

  .empty-state{padding:48px;text-align:center;color:var(--text-dim);font-family:var(--font-mono);font-size:11px}
  .footer{margin-top:40px;padding:16px 0;border-top:1px solid var(--border);text-align:center;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim);font-family:var(--font-mono)}
  .footer a{color:var(--text);border-bottom:1px solid #555;text-decoration:none}

  .reveal-item{opacity:0;transform:translateY(22px);transition:opacity .65s var(--ease),transform .65s var(--ease);transition-delay:var(--reveal-delay,0ms)}
  .reveal-item.in-view{opacity:1;transform:none}

  @media(max-width:1200px){.kpi-hero-row,.kpi-session-row{grid-template-columns:repeat(3,1fr)}.kpi-minor-row{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:768px){
    .kpi-hero-row,.kpi-minor-row,.kpi-session-row{grid-template-columns:repeat(2,minmax(0,1fr))}
    .stat-grid{grid-template-columns:repeat(2,1fr)}
    .container{padding:16px 10px 36px}
    .header{flex-direction:column}
    .header-right,.header .meta{text-align:left}
    .chart-box{height:300px}
    .kpi-card{min-height:112px;padding:18px 14px}
    .kpi-card.kpi-minor{min-height:96px}
    .kpi-value[data-countup^="$"]{font-size:20px}
    .kpi-sub{font-size:8px;line-height:1.35;overflow-wrap:anywhere}
    .data-table{font-size:11px}
    .data-table th,.data-table td{padding:6px 8px}
    .provider-row{grid-template-columns:1fr}
  }
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}.reveal-item{opacity:1!important;transform:none!important}}
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
    countUp(el, target, 600);
  });
}

// Table sorting. Numeric cells carry data-sort with the raw value so units
// (K/M/B), "$" prefixes and MISSING markers never corrupt the comparison.
function makeSortable(tableId) {
  var table = document.getElementById(tableId);
  if (!table) return;
  var thead = table.querySelector('thead');
  if (!thead) return;
  var ths = thead.querySelectorAll('th.sortable');
  var tbody = table.querySelector('tbody');
  ths.forEach(function(t) { t.setAttribute('aria-sort', 'none'); });
  if (!tbody) return;
  var rows = Array.from(tbody.querySelectorAll('tr'));
  var dir = 1;
  ths.forEach(function(th, colIdx) {
    th.addEventListener('click', function() {
      var actualCol = Array.from(th.parentNode.children).indexOf(th);
      dir = th.classList.contains('asc') ? -1 : 1;
      ths.forEach(function(t) { t.classList.remove('asc','desc'); t.setAttribute('aria-sort', 'none'); });
      th.classList.add(dir === 1 ? 'asc' : 'desc');
      th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
      function cellSortValue(cell) {
        if (!cell) return { n: NaN, s: '' };
        var raw = cell.getAttribute('data-sort');
        if (raw != null && raw !== '') {
          var rn = parseFloat(raw);
          if (!isNaN(rn)) return { n: rn, s: '' };
        }
        var s = cell.textContent.trim();
        var n = parseFloat(s.replace(/[^\\d.\\-]/g, ''));
        return { n: n, s: s };
      }
      rows.sort(function(a, b) {
        var av = cellSortValue(a.children[actualCol]);
        var bv = cellSortValue(b.children[actualCol]);
        if (!isNaN(av.n) && !isNaN(bv.n)) return (av.n - bv.n) * dir;
        return av.s.localeCompare(bv.s) * dir;
      });
      rows.forEach(function(r) { tbody.appendChild(r); });
      // Re-apply pagination so hidden rows don't stay hidden after reordering.
      var pg = window.__paginators && window.__paginators[tableId];
      if (pg) { pg.reset(); } else { rows.forEach(function(r) { r.style.display = ''; }); }
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
  // Register so makeSortable can reset to page 1 after re-sorting rows.
  window.__paginators = window.__paginators || {};
  window.__paginators[tableId] = { reset: function() { cur = 1; render(); } };
  render();
}

// Shared motion layer: scroll reveal, pointer spotlight, progress indicator.
function initDashboardMotion() {
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
import { existsSync as existsSync7, readFileSync as readFileSync7 } from "node:fs";
import { join as join7, dirname as dirname3 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
function resolveIconsDir() {
  const candidates = [];
  try {
    const url = import.meta.url;
    if (url) candidates.push(join7(dirname3(fileURLToPath2(url)), "..", "icons"));
  } catch {
  }
  const cwd = process.cwd();
  for (const base of [cwd, join7(cwd, "dist", "..")]) {
    candidates.push(join7(base, "icons"));
  }
  for (const c of candidates) {
    if (c && existsSync7(join7(c, "_default.svg"))) return c;
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
  const filePath = join7(ICONS_DIR, fileName);
  try {
    const buf = readFileSync7(filePath);
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
  const errorColor = data.errors.errorRate >= 0.05 ? "var(--danger)" : data.errors.errorRate >= 0.01 ? "var(--tps)" : "var(--cache)";
  const avgTokensPerReq = s.requestCount > 0 ? s.totalTokens / s.requestCount : 0;
  const tpsStr = data.tps > 0 ? data.tps >= 100 ? Math.round(data.tps).toString() : data.tps.toFixed(1) : "-";
  const cprStr = s.requestCount > 0 ? fmtCost(s.totalCost / s.requestCount) : "-";
  return `
    <div class="kpi-row kpi-session-row">
      <div class="kpi-card kpi-light">
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
      <div class="kpi-card kpi-light">
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
        <span class="model-name">${modelIconImg(m.model, 18)}${escapeHtml(m.model)}</span>
        <span class="model-provider">${escapeHtml(m.provider)}</span>
      </div>
      <div class="model-card-stats">
        <div class="stat-grid">
          <div class="stat-item"><span class="stat-label">Requests</span><span class="stat-value">${m.requests}</span></div>
          <div class="stat-item"><span class="stat-label">Total Tokens</span><span class="stat-value">${fmtTokens(m.totalTokens)}</span></div>
          <div class="stat-item"><span class="stat-label">Input</span><span class="stat-value" style="color:var(--input)">${fmtTokens(m.inputTokens)}</span></div>
          <div class="stat-item"><span class="stat-label">Output</span><span class="stat-value" style="color:var(--output)">${fmtTokens(m.outputTokens)}</span></div>
          <div class="stat-item"><span class="stat-label">Reasoning</span><span class="stat-value" style="color:#c4a982">${fmtTokens(m.reasoningTokens)}</span></div>
          <div class="stat-item"><span class="stat-label">Cache Read</span><span class="stat-value" style="color:var(--cache)">${fmtTokens(m.cacheRead)}</span></div>
          <div class="stat-item"><span class="stat-label">Cache Write</span><span class="stat-value" style="color:#8295a8">${fmtTokens(m.cacheWrite)}</span></div>
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
      <td data-sort="${i + 1}">${i + 1}</td>
      <td data-sort="${msg.timeCreated}">${fmtTime(msg.timeCreated)}</td>
      <td><div class="model-cell">${modelIconImg(msg.model, 16)}<span class="model-name-text" title="${escapeHtml(msg.model)}">${escapeHtml(msg.model)}</span></div></td>
      <td data-sort="${msg.totalTokens}">${fmtTokens(msg.totalTokens)}</td>
      <td data-sort="${msg.inputTokens}">${fmtTokens(msg.inputTokens)}</td>
      <td data-sort="${msg.outputTokens}">${fmtTokens(msg.outputTokens)}</td>
      <td data-sort="${msg.reasoningTokens}">${fmtTokens(msg.reasoningTokens)}</td>
      <td data-sort="${msg.cacheRead}">${fmtTokens(msg.cacheRead)}</td>
      <td data-sort="${msg.cacheWrite}">${fmtTokens(msg.cacheWrite)}</td>
      <td data-sort="${isMissing ? -1 : hitRate}" style="color:${hitColor};font-weight:600">${hitDisplay}</td>
      <td data-sort="${duration ?? -1}" style="color:${durColor}">${fmtDuration(duration)}</td>
      <td data-sort="${msg.cost}">${fmtCost(msg.cost)}</td>
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
var trendLabels = ${jsonForScript(labels)};
var trendInput = ${jsonForScript(inputTokens)};
var trendOutput = ${jsonForScript(outputTokens)};
var trendCache = ${jsonForScript(cacheReadTokens)};
var trendTotal = ${jsonForScript(totalTokens)};
var trendCost = ${jsonForScript(costs)};
var trendMA5 = ${jsonForScript(ma5)};

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
    legend: { data: ['Total', 'MA(5)', 'Input', 'Cache Read', 'Output', 'Cost'], textStyle: { color: '#a3a3ac' }, top: 5, type: 'scroll' },
    grid: { left: 60, right: 70, bottom: 40, top: 50 },
    xAxis: { type: 'category', data: trendLabels, axisLabel: { color: '#a3a3ac', fontSize: 10 }, axisLine: { lineStyle: { color: '#303035' } } },
    yAxis: [
      { type: 'value', name: 'Tokens', nameTextStyle: { color: '#a3a3ac' }, axisLabel: { color: '#a3a3ac', formatter: fmt }, splitLine: { lineStyle: { color: '#303035', type: 'dashed' } } },
      { type: 'value', name: 'Cost', nameTextStyle: { color: '#d0b77d' }, axisLabel: { color: '#d0b77d', formatter: function(v) { return '$' + v.toFixed(4); } }, splitLine: { show: false } }
    ],
    series: [
      { name: 'Total', type: 'line', data: trendTotal, smooth: true, symbol: 'none', lineStyle: { color: '#f2f2ef', width: 1.5, type: 'dashed' }, itemStyle: { color: '#f2f2ef' } },
      { name: 'MA(5)', type: 'line', data: trendMA5, smooth: true, symbol: 'none', lineStyle: { color: '#d0b77d', width: 2.5 } },
      { name: 'Input', type: 'line', data: trendInput, smooth: true, symbol: 'none', lineStyle: { color: '#c8d4e3', width: 2 }, areaStyle: { color: 'rgba(200,212,227,0.08)' } },
      { name: 'Cache Read', type: 'line', data: trendCache, smooth: true, symbol: 'none', lineStyle: { color: '#8fb7a2', width: 2 }, areaStyle: { color: 'rgba(143,183,162,0.08)' } },
      { name: 'Output', type: 'line', data: trendOutput, smooth: true, symbol: 'none', lineStyle: { color: '#b6adc8', width: 2 } },
      { name: 'Cost', type: 'line', yAxisIndex: 1, data: trendCost, smooth: true, symbol: 'none', lineStyle: { color: '#d0b77d', width: 1.5, opacity: 0.6 } }
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
var durLabels = ${jsonForScript(labels)};
var durData = ${jsonForScript(durations)};
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
    xAxis: { type: 'category', data: durLabels, axisLabel: { color: '#a3a3ac', fontSize: 10 }, axisLine: { lineStyle: { color: '#303035' } } },
    yAxis: { type: 'value', name: 'Seconds', nameTextStyle: { color: '#a3a3ac' }, axisLabel: { color: '#a3a3ac', formatter: '{value}s' }, splitLine: { lineStyle: { color: '#303035', type: 'dashed' } } },
    series: [{
      type: 'bar', data: durData, barMaxWidth: 20,
      itemStyle: { color: function(p) { return p.value > durP90 ? '#df7b83' : p.value > durP50 ? '#d0b77d' : '#c8d4e3'; }, borderRadius: [3, 3, 0, 0] },
      markLine: {
        symbol: 'none', silent: true,
        data: [
          { yAxis: durP50, lineStyle: { color: '#8fb7a2', type: 'dashed', width: 1.5 }, label: { formatter: 'p50 ' + durP50.toFixed(1) + 's', color: '#8fb7a2', position: 'insideEndTop' } },
          { yAxis: durP90, lineStyle: { color: '#df7b83', type: 'dashed', width: 1.5 }, label: { formatter: 'p90 ' + durP90.toFixed(1) + 's', color: '#df7b83', position: 'insideEndBottom' } }
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
var cacheLabels = ${jsonForScript(labels)};
var cacheHitData = ${jsonForScript(hitRates)};

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
    xAxis: { type: 'category', data: cacheLabels, axisLabel: { color: '#a3a3ac', fontSize: 10 }, axisLine: { lineStyle: { color: '#303035' } } },
    yAxis: { type: 'value', max: 100, name: 'Hit %', nameTextStyle: { color: '#a3a3ac' }, axisLabel: { color: '#a3a3ac', formatter: '{value}%' }, splitLine: { lineStyle: { color: '#303035', type: 'dashed' } } },
    series: [{
      type: 'line', data: cacheHitData, smooth: true, symbol: 'circle', symbolSize: 5,
      connectNulls: false,
      lineStyle: { color: '#8fb7a2', width: 2 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(143,183,162,0.25)' }, { offset: 1, color: 'rgba(143,183,162,0.02)' }] } },
      itemStyle: { color: '#8fb7a2' },
      markLine: { symbol: 'none', silent: true, data: [{ yAxis: 85, lineStyle: { color: '#303035', type: 'dotted' } }] }
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
    const pricingSrc = m.pricingProvider ? `<span style="color:var(--text-dim);font-size:0.85em">${escapeHtml(m.pricingProvider)}</span>` : "-";
    return `<tr>
      <td><div class="model-cell">${modelIconImg(m.model, 16)}<span class="model-name-text" title="${escapeHtml(m.model)}">${escapeHtml(m.model)}</span></div></td><td>${escapeHtml(m.provider)}</td><td>${pricingSrc}</td>
      <td data-sort="${m.requests}">${m.requests}</td><td data-sort="${m.inputTokens}">${fmtTokens(m.inputTokens)}</td><td data-sort="${m.outputTokens}">${fmtTokens(m.outputTokens)}</td>
      <td data-sort="${m.reportedCost}">${fmtCost(m.reportedCost)}</td><td data-sort="${m.apiEquivCost ?? -1}" style="font-weight:600">${apiStr}${estTag}</td>
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
      <div class="kpi-card kpi-light"><div class="kpi-label">Reported Cost</div><div class="kpi-value" style="color:var(--tps)">${fmtCost(reported)}</div></div>
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
        bg: "rgba(208,183,125,0.15)",
        title: "Most expensive request",
        value: `<span class="accent">${fmtCost(mostExpensive.cost)}</span> on request #${maxCostIdx + 1} (${escapeHtml(mostExpensive.model)})`
      });
    }
  }
  if (data.peakTokensIndex >= 0) {
    insights.push({
      icon: "\u26A1",
      bg: "rgba(200,212,227,0.15)",
      title: "Peak activity",
      value: `Request <span class="accent">#${data.peakTokensIndex + 1}</span> with <span class="accent">${fmtTokens(data.peakTokens)}</span> tokens`
    });
  }
  let bestStreak = 0, streakStart = -1, bestStart = 0;
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
      bg: "rgba(143,183,162,0.15)",
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
        bg: "rgba(223,123,131,0.15)",
        title: "Slowest response",
        value: `<span class="accent">${fmtDuration(slowest.dur)}</span> on request #${slowest.i + 1} (${escapeHtml(slowest.model)})`
      });
    }
  }
  if (data.errors.failedCount > 0) {
    insights.push({
      icon: "!",
      bg: "rgba(223,123,131,0.15)",
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
function renderSparkline(values, color) {
  if (values.length < 2) return "";
  const w = 120, h = 26;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = Math.max(max - min, 1e-9);
  const pts = values.map((v, i) => `${(i / (values.length - 1) * w).toFixed(1)},${(h - 2 - (v - min) / span * (h - 4)).toFixed(1)}`).join(" ");
  return `<svg class="kpi-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
function avgDailyUsageColor(tokens) {
  if (tokens <= 0) return "rgba(242,242,239,0.2)";
  if (tokens <= 5e7) {
    const alpha2 = 0.25 + 0.5 * (tokens / 5e7);
    return `rgba(242,242,239,${alpha2.toFixed(3)})`;
  }
  const t2 = Math.min(1, (tokens - 5e7) / 15e7);
  const alpha = 0.75 + 0.25 * t2;
  return `rgba(255,255,255,${alpha.toFixed(3)})`;
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
  const errorColor = errors && errors.errorRate >= 0.05 ? "var(--danger)" : errors && errors.errorRate >= 0.01 ? "var(--tps)" : "var(--cache)";
  const dailyCount = data.daily.length;
  const avgDailyTokens = dailyCount > 0 ? s.totalTokens / dailyCount : 0;
  const avgDailyColor = avgDailyUsageColor(avgDailyTokens);
  const totalSessions = data.totalSessions ?? data.sessions.length;
  const costPerSession = totalSessions > 0 ? s.totalCost / totalSessions : 0;
  const dailyTokensAsc = [...data.daily].reverse().map((d) => d.totalTokens);
  const dailyCostsAsc = [...data.daily].reverse().map((d) => d.totalCost);
  return `
    <div class="kpi-row kpi-hero-row">
      <div class="kpi-card kpi-light">
        <div class="kpi-label">Total Tokens</div>
        <div class="kpi-value" data-countup="${fmtTokens(s.totalTokens)}">${fmtTokens(s.totalTokens)}</div>
        ${renderSparkline(dailyTokensAsc, "#3f4a5c")}
      </div>
      <div class="kpi-card${isHighCache ? " kpi-glow" : ""}">
        <div class="kpi-label">Cache Hit Rate</div>
        <div class="kpi-value" style="color:${kpiHitColor}" data-countup="${hitRatePct}">${hitRatePct}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Requests</div>
        <div class="kpi-value" data-countup="${s.requestCount}">${s.requestCount}</div>
      </div>
      <div class="kpi-card kpi-light">
        <div class="kpi-label">Total Cost</div>
        <div class="kpi-value" style="color:var(--tps)" data-countup="${fmtCost(s.totalCost)}">${fmtCost(s.totalCost)}</div>
        <div class="kpi-sub">${fmtCost(costPerSession)}/session</div>
        ${renderSparkline(dailyCostsAsc, "#7a6840")}
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Error Rate</div>
        <div class="kpi-value" style="color:${errorColor}" data-countup="${errorRatePct}">${errorRatePct}</div>
        <div class="kpi-sub">${errors ? errors.failedCount + " failed" : ""}</div>
      </div>
    </div>
    <div class="kpi-row kpi-minor-row">
      <div class="kpi-card kpi-minor">
        <div class="kpi-label">Sessions</div>
        <div class="kpi-value" data-countup="${totalSessions}">${totalSessions}</div>
      </div>
      <div class="kpi-card kpi-minor">
        <div class="kpi-label">Avg Daily Tokens</div>
        <div class="kpi-value kpi-avg-daily" style="--avg-daily-color:${avgDailyColor}" data-countup="${fmtTokens(Math.round(avgDailyTokens))}">${fmtTokens(Math.round(avgDailyTokens))}</div>
        <div class="kpi-sub">${dailyCount} active days</div>
      </div>
      <div class="kpi-card kpi-minor${apiCostTotal != null && apiCostTotal > s.totalCost ? " kpi-glow" : ""}">
        <div class="kpi-label">API Equiv. Cost</div>
        <div class="kpi-value" style="color:var(--missing)" data-countup="${apiCostTotal != null ? fmtCost(apiCostTotal) : "-"}">${apiCostTotal != null ? fmtCost(apiCostTotal) : "-"}</div>
      </div>
      <div class="kpi-card kpi-minor">
        <div class="kpi-label">Models Used</div>
        <div class="kpi-value" data-countup="${data.models.length}">${data.models.length}</div>
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
      cacheWrite: rest.reduce((s, m) => s + m.cacheWrite, 0),
      totalTokens: restTotalTokens,
      totalCost: restTotalCost
    });
  }
  const rev = [...displayModels].reverse();
  const names = rev.map((m) => m.model);
  const inputData = rev.map((m) => m.inputTokens);
  const outputData = rev.map((m) => m.outputTokens);
  const cacheData = rev.map((m) => m.cacheRead);
  const cacheWriteData = rev.map((m) => m.cacheWrite);
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
    (uri, i) => `i${i}:{backgroundColor:{image:${jsonForScript(uri)}},width:14,height:14,align:'center',verticalAlign:'middle'}`
  ).join(",");
  return `var modelNames = ${jsonForScript(names)};
var modelInput = ${jsonForScript(inputData)};
var modelOutput = ${jsonForScript(outputData)};
var modelCache = ${jsonForScript(cacheData)};
var modelCacheWrite = ${jsonForScript(cacheWriteData)};
var modelReasoning = ${jsonForScript(reasoningData)};
var modelCost = ${jsonForScript(costData)};
var modelApiCost = ${jsonForScript(apiCostData)};
var modelReq = ${jsonForScript(requestData)};
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
      legend: { data: ['Input', 'Cache', 'Reasoning', 'Output', 'Cache W'], textStyle: { color: '#a3a3ac' }, top: 5 },
      grid: { left: window.innerWidth < 700 ? 145 : 190, right: window.innerWidth < 700 ? 28 : 60, bottom: 28, top: 40 },
      xAxis: { type: 'value', name: 'Tokens', nameTextStyle: { color: '#a3a3ac' }, axisLabel: { color: '#a3a3ac', formatter: fmt }, splitLine: { lineStyle: { color: '#303035', type: 'dashed' } } },
      yAxis: { type: 'category', data: modelNames, axisLabel: { color: '#d6d6da', fontSize: 12, fontWeight: 500, formatter: labelFormatter, rich: modelIconRich }, axisLine: { lineStyle: { color: '#303035' } } },
      series: [
        { name: 'Input', type: 'bar', stack: 'tokens', data: modelInput, itemStyle: { color: '#c8d4e3' }, barMaxWidth: 22 },
        { name: 'Cache', type: 'bar', stack: 'tokens', data: modelCache, itemStyle: { color: '#8fb7a2' }, barMaxWidth: 22 },
        { name: 'Reasoning', type: 'bar', stack: 'tokens', data: modelReasoning, itemStyle: { color: '#c4a982' }, barMaxWidth: 22 },
        { name: 'Output', type: 'bar', stack: 'tokens', data: modelOutput, itemStyle: { color: '#b6adc8' }, barMaxWidth: 22 },
        { name: 'Cache W', type: 'bar', stack: 'tokens', data: modelCacheWrite, itemStyle: { color: '#8295a8' }, barMaxWidth: 22,
          label: { show: true, position: 'right', formatter: function(p) { var t = modelInput[p.dataIndex] + modelOutput[p.dataIndex] + modelCache[p.dataIndex] + modelCacheWrite[p.dataIndex] + modelReasoning[p.dataIndex]; return t > 0 ? fmt(t) : ''; }, color: '#f2f2ef', fontSize: 11, fontWeight: 600 } }
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
      xAxis: { type: 'value', name: 'Cost (USD)', nameTextStyle: { color: '#a3a3ac' }, axisLabel: { color: '#a3a3ac', formatter: function(v) { return '$' + v.toFixed(2); } }, splitLine: { lineStyle: { color: '#303035', type: 'dashed' } } },
      yAxis: { type: 'category', data: modelNames, axisLabel: { color: '#d6d6da', fontSize: 12, fontWeight: 500, formatter: labelFormatter, rich: modelIconRich }, axisLine: { lineStyle: { color: '#303035' } } },
      series: [
        { name: 'Actual Cost', type: 'bar', data: modelCost, barMaxWidth: 14, itemStyle: { color: '#d0b77d', borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', formatter: function(p) { return p.value > 0 ? '{actual|' + fmtCost(p.value) + '}' : '{missing|MISSING}'; }, fontSize: 11, fontWeight: 600,
            rich: { actual: { color: '#e0c888', fontSize: 11, fontWeight: 600 }, missing: { color: '#888891', fontSize: 10, fontWeight: 500 } } } },
        { name: 'API Equivalent', type: 'bar', data: modelApiCost, barMaxWidth: 14, itemStyle: { color: '#9d83c7', borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', formatter: function(p) { return p.value > 0 ? fmtCost(p.value) : ''; }, color: '#c5b2e4', fontSize: 11, fontWeight: 600 } }
      ]
    };
  } else if (modelView === 'mix') {
    var segs = [['Input', modelInput, '#c8d4e3'], ['Cache', modelCache, '#8fb7a2'], ['Reasoning', modelReasoning, '#c4a982'], ['Output', modelOutput, '#b6adc8'], ['Cache W', modelCacheWrite, '#8295a8']];
    var mixTotals = modelNames.map(function(_, i) { var t = 0; segs.forEach(function(s) { t += s[1][i]; }); return t; });
    option = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: function(params) {
        var i = params[0].dataIndex;
        var html = '<b>' + params[0].axisValue + '</b><br/>';
        params.forEach(function(p) {
          var raw = 0; segs.forEach(function(s) { if (s[0] === p.seriesName) raw = s[1][i]; });
          html += p.marker + ' ' + p.seriesName + ': ' + (mixTotals[i] ? (100 * raw / mixTotals[i]).toFixed(1) : '0.0') + '% (' + fmt(raw) + ')<br/>';
        });
        html += '<b>Total: ' + fmt(mixTotals[i]) + '</b>'; return html;
      }},
      legend: { data: ['Input', 'Cache', 'Reasoning', 'Output', 'Cache W'], textStyle: { color: '#a3a3ac' }, top: 5 },
      grid: { left: window.innerWidth < 700 ? 145 : 190, right: window.innerWidth < 700 ? 28 : 60, bottom: 28, top: 40 },
      xAxis: { type: 'value', max: 100, name: 'Share', nameTextStyle: { color: '#a3a3ac' }, axisLabel: { color: '#a3a3ac', formatter: '{value}%' }, splitLine: { lineStyle: { color: '#303035', type: 'dashed' } } },
      yAxis: { type: 'category', data: modelNames, axisLabel: { color: '#d6d6da', fontSize: 12, fontWeight: 500, formatter: labelFormatter, rich: modelIconRich }, axisLine: { lineStyle: { color: '#303035' } } },
      series: segs.map(function(s) {
        return { name: s[0], type: 'bar', stack: 'mix', barMaxWidth: 22, itemStyle: { color: s[2] },
          data: s[1].map(function(v, i) { return mixTotals[i] ? +(100 * v / mixTotals[i]).toFixed(2) : 0; }) };
      })
    };
  } else {
    option = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: function(p) { return '<b>' + p[0].axisValue + '</b><br/>Requests: ' + p[0].value; }},
      grid: { left: window.innerWidth < 700 ? 145 : 190, right: window.innerWidth < 700 ? 28 : 60, bottom: 28, top: 20 },
      xAxis: { type: 'value', name: 'Requests', nameTextStyle: { color: '#a3a3ac' }, axisLabel: { color: '#a3a3ac' }, splitLine: { lineStyle: { color: '#303035', type: 'dashed' } } },
      yAxis: { type: 'category', data: modelNames, axisLabel: { color: '#d6d6da', fontSize: 12, fontWeight: 500, formatter: labelFormatter, rich: modelIconRich }, axisLine: { lineStyle: { color: '#303035' } } },
      series: [{ type: 'bar', data: modelReq, barMaxWidth: 22, itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: '#c8d4e3' }, { offset: 1, color: '#95a5bd' }] }, borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', formatter: function(p) { return p.value > 0 ? String(p.value) : ''; }, color: '#f2f2ef', fontSize: 11 } }]
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
  const byCost = [...data.providers].filter((p) => p.totalCost > 0).sort((a, b) => b.totalCost - a.totalCost);
  const byTokens = [...data.providers].filter((p) => p.totalTokens > 0).sort((a, b) => b.totalTokens - a.totalTokens);
  const buildItems = (rows, pick) => {
    const top = rows.slice(0, 8).map((p) => ({ name: p.provider, value: pick(p) }));
    const rest = rows.slice(8).reduce((s, p) => s + pick(p), 0);
    if (rest > 0) top.push({ name: "Other", value: rest });
    return top;
  };
  const costItems = buildItems(byCost, (p) => p.totalCost);
  const tokenItems = buildItems(byTokens, (p) => p.totalTokens);
  const costTotal = byCost.reduce((s, p) => s + p.totalCost, 0);
  const tokenTotal = byTokens.reduce((s, p) => s + p.totalTokens, 0);
  return `var provCostData = ${jsonForScript(costItems)};
var provTokenData = ${jsonForScript(tokenItems)};
var provCostTotal = ${jsonForScript(fmtCost(costTotal))};
var provTokenTotal = ${jsonForScript(fmtTokens(tokenTotal))};
var provView = ${jsonForScript(costItems.length > 0 ? "cost" : "tokens")};
var provDonutColors = ['#d0b77d','#c8d4e3','#8fb7a2','#b6adc8','#c4a982','#8295a8','#c38b91','#a8a0bb','#4a4a52'];

function initProviderDonut() {
  var el = document.getElementById('provider-donut');
  if (!el) return;
  var chart = echarts.init(el);
  window.__charts = window.__charts || {};
  window.__charts.providerDonut = chart;
  renderProviderDonut();
}

function renderProviderDonut() {
  var chart = window.__charts.providerDonut;
  if (!chart) return;
  var isCost = provView === 'cost';
  var totalText = isCost ? provCostTotal : provTokenTotal;
  var option = {
    tooltip: { trigger: 'item', formatter: function(p) {
      return '<b>' + p.name + '</b><br/>' + (isCost ? 'Cost: ' + fmtCost(p.value) : 'Tokens: ' + fmt(p.value)) + ' (' + p.percent + '%)';
    }},
    legend: { type: 'scroll', orient: 'vertical', right: 8, top: 'center', textStyle: { color: '#a3a3ac', fontSize: 11 } },
    color: provDonutColors,
    graphic: [
      { type: 'text', left: '35%', top: '43%', silent: true, style: { text: isCost ? 'Total Cost' : 'Total Tokens', textAlign: 'center', fill: '#7d7d86', fontSize: 10, fontFamily: 'ui-monospace, Consolas, monospace' } },
      { type: 'text', left: '35%', top: '50%', silent: true, style: { text: totalText, textAlign: 'center', fill: '#f2f2ef', fontSize: 20, fontWeight: 600, fontFamily: 'ui-monospace, Consolas, monospace' } }
    ],
    series: [{ type: 'pie', radius: ['46%', '70%'], center: ['35%', '50%'], avoidLabelOverlap: false,
      itemStyle: { borderColor: '#131316', borderWidth: 2, borderRadius: 5 },
      label: { show: false }, labelLine: { show: false },
      emphasis: { label: { show: false }, scaleSize: 6 },
      data: isCost ? provCostData : provTokenData }]
  };
  chart.setOption(option, true);
  chart.resize();
}

window.switchProviderView = function(v) {
  provView = v;
  document.querySelectorAll('#prov-view-bar .view-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelector('#prov-view-bar [data-pview="' + v + '"]').classList.add('active');
  renderProviderDonut();
};`;
}
function renderApiCostSection2(data) {
  const apiCost = data.apiCost;
  if (!apiCost || apiCost.byModel.length === 0) return "";
  const rows = apiCost.byModel.filter((m) => m.apiEquivCost !== null || m.reportedCost === 0).sort((a, b) => (b.apiEquivCost ?? 0) - (a.apiEquivCost ?? 0));
  if (rows.length === 0) return "";
  const tableRows = rows.map((m) => {
    const apiStr = m.apiEquivCost != null ? m.estimated ? `<span style="color:var(--missing)">~${fmtCost(m.apiEquivCost)}</span>` : fmtCost(m.apiEquivCost) : '<span style="color:var(--text-faint)">N/A</span>';
    const estTag = m.estimated ? ` <span style="color:var(--missing);font-size:0.8em">(est.)</span>` : "";
    const pricingSrc = m.pricingProvider ? `<span style="color:var(--text-dim);font-size:0.85em">${escapeHtml(m.pricingProvider)}</span>` : "-";
    const totalTok = m.inputTokens + m.outputTokens + m.reasoningTokens + m.cacheRead + m.cacheWrite;
    const costPer1MRaw = totalTok > 0 && m.apiEquivCost != null ? m.apiEquivCost / totalTok * 1e6 : null;
    const costPer1M = costPer1MRaw != null ? `$${costPer1MRaw.toFixed(4)}` : "-";
    return `<tr>
      <td><div class="model-cell">${modelIconImg(m.model, 16)}<span class="model-name-text" title="${escapeHtml(m.model)}">${escapeHtml(m.model)}</span></div></td><td>${escapeHtml(m.provider)}</td><td>${pricingSrc}</td>
      <td data-sort="${m.requests}">${m.requests}</td><td data-sort="${m.inputTokens}">${fmtTokens(m.inputTokens)}</td><td data-sort="${m.outputTokens}">${fmtTokens(m.outputTokens)}</td>
      <td data-sort="${m.reportedCost}">${fmtCost(m.reportedCost)}</td><td data-sort="${m.apiEquivCost ?? -1}" style="font-weight:600">${apiStr}${estTag}</td><td data-sort="${costPer1MRaw ?? -1}">${costPer1M}</td>
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
      <div class="kpi-card kpi-light"><div class="kpi-label">Reported Cost</div><div class="kpi-value" style="color:var(--tps)">${fmtCost(reported)}</div></div>
      <div class="kpi-card"><div class="kpi-label">API Equiv. Total</div><div class="kpi-value" style="color:var(--missing)">${apiCost.totalApiCost != null ? fmtCost(totalApi) : "-"}</div></div>
      <div class="kpi-card"><div class="kpi-label">Difference</div><div class="kpi-value">${diffStr}</div></div>
    </div>
    <table id="api-cost-table" class="data-table">
      <thead><tr><th>Model</th><th>Provider</th><th>Pricing Source</th><th>Req</th><th>Input</th><th>Output</th><th>Reported</th><th title="Official pricing \xD7 token usage (estimate)">API Equiv.</th><th title="API equivalent per 1M total tokens (incl. cache)">Cost/1M</th></tr></thead>
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
    <div class="provider-card" style="--prov-color:${providerBorderColor(p.provider)}">
      <div class="provider-name">${escapeHtml(p.provider)}</div>
      <div class="provider-stat"><span class="stat-label">Tokens</span><span>${fmtTokens(p.totalTokens)} <span style="color:var(--text-faint)">(${sharePct}%)</span></span></div>
      <div class="provider-stat"><span class="stat-label">Cost</span><span>${fmtCost(p.totalCost)}</span></div>
      <div class="provider-stat"><span class="stat-label">Requests</span><span>${p.requests}</span></div>
      <div class="provider-stat"><span class="stat-label">Sessions</span><span>${p.sessions}</span></div>
      <div class="provider-stat"><span class="stat-label">Models</span><span>${modelCount}</span></div>
      <div style="height:3px;border-radius:2px;background:var(--border);margin-top:8px;overflow:hidden">
        <div style="height:100%;width:${sharePct}%;background:var(--prov-color);border-radius:2px"></div>
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
    const costPer1MRaw = m.totalTokens > 0 && m.totalCost > 0 ? m.totalCost / m.totalTokens * 1e6 : null;
    const costPer1M = costPer1MRaw != null ? `$${costPer1MRaw.toFixed(4)}` : "-";
    return `<tr>
      <td><div class="model-cell">${modelIconImg(m.model, 16)}<span class="model-name-text" title="${escapeHtml(m.model)}">${escapeHtml(m.model)}</span></div></td>
      <td>${escapeHtml(m.provider)}</td>
      <td data-sort="${m.requests}">${m.requests}</td>
      <td data-sort="${m.sessions}">${m.sessions}</td>
      <td data-sort="${m.totalTokens}">${fmtTokens(m.totalTokens)}</td>
      <td data-sort="${m.inputTokens}">${fmtTokens(m.inputTokens)}</td>
      <td data-sort="${m.outputTokens}">${fmtTokens(m.outputTokens)}</td>
      <td data-sort="${m.reasoningTokens}">${fmtTokens(m.reasoningTokens)}</td>
      <td data-sort="${m.cacheRead}">${fmtTokens(m.cacheRead)}</td>
      <td data-sort="${m.cacheWrite}">${fmtTokens(m.cacheWrite)}</td>
      <td data-sort="${isMissing ? -1 : hitRate}" style="color:${hitColor};font-weight:600">${hitDisplay}</td>
      <td data-sort="${m.totalCost}">${fmtCost(m.totalCost)}</td>
      <td data-sort="${apiItem?.apiEquivCost ?? -1}">${apiCostStr}</td>
      <td data-sort="${costPer1MRaw ?? -1}">${costPer1M}</td>
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
          <td>${escapeHtml(m.provider)}</td>
          <td><div class="model-cell">${modelIconImg(m.model, 16)}<span class="model-name-text" title="${escapeHtml(m.model)}">${escapeHtml(m.model)}</span></div></td>
          <td data-sort="${m.total}">${m.total}</td>
          <td data-sort="${m.failed}" style="color:var(--danger)">${m.failed}</td>
          <td data-sort="${m.total - m.failed}" style="color:var(--tps)">${m.total - m.failed}</td>
          <td data-sort="${m.total > 0 ? m.failed / m.total : -1}" style="color:${cellColor}">${modelRate}</td>
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
          <th class="sortable" title="Cache Read / (Input + Cache Read)">Hit Rate</th><th class="sortable">Cost</th><th title="Official pricing \xD7 token usage (estimate)">API Cost</th><th class="sortable" title="Reported cost per 1M total tokens (incl. cache)">Cost/1M</th>
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
      <td>${escapeHtml(s.day)}</td>
      <td>${escapeHtml(s.provider)}</td>
      <td><div class="model-cell">${modelIconImg(s.model, 16)}<span class="model-name-text" title="${escapeHtml(s.model)}">${escapeHtml(s.model)}</span></div></td>
      <td data-sort="${s.requests}">${s.requests}</td>
      <td data-sort="${s.totalTokens}">${fmtTokens(s.totalTokens)}</td>
      <td data-sort="${s.inputTokens}">${fmtTokens(s.inputTokens)}</td>
      <td data-sort="${s.outputTokens}">${fmtTokens(s.outputTokens)}</td>
      <td data-sort="${s.cacheRead}">${fmtTokens(s.cacheRead)}</td>
      <td data-sort="${s.totalCost}">${fmtCost(s.totalCost)}</td>
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
var dailyDays = ${jsonForScript(days)};
var dailyTokens = ${jsonForScript(tokens)};
var dailyCosts = ${jsonForScript(costs)};
var dailyRequests = ${jsonForScript(requests)};
var dailyMA7 = ${jsonForScript(ma7)};
var dailyCumCost = ${jsonForScript(cumCosts)};

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
    legend: { data: ['Tokens', 'MA(7)', 'Requests', 'Cost', 'Cum. Cost'], textStyle: { color: '#a3a3ac' }, top: 5, type: 'scroll' },
    grid: { left: 60, right: 70, bottom: 80, top: 50 },
    xAxis: { type: 'category', data: dailyDays, axisLabel: { color: '#a3a3ac', rotate: window.innerWidth < 700 ? 0 : 45, interval: window.innerWidth < 700 ? Math.max(0, Math.ceil(dailyDays.length / 6) - 1) : 0, fontSize: 10, hideOverlap: true }, axisLine: { lineStyle: { color: '#303035' } } },
    yAxis: [
      { type: 'value', name: 'Tokens', nameTextStyle: { color: '#a3a3ac' }, axisLabel: { color: '#a3a3ac', formatter: fmt }, splitLine: { lineStyle: { color: '#303035', type: 'dashed' } } },
      { type: 'value', name: 'Cost', nameTextStyle: { color: '#d0b77d' }, axisLabel: { color: '#d0b77d', formatter: function(v) { return '$' + v.toFixed(2); } }, splitLine: { show: false } }
    ],
    dataZoom: [{ type: 'slider', bottom: 5, height: 20, borderColor: '#303035', fillerColor: 'rgba(200,212,227,0.08)', handleStyle: { color: '#c8d4e3' }, textStyle: { color: '#a3a3ac' } }],
    series: [
      { name: 'Tokens', type: 'line', data: dailyTokens, smooth: true, symbol: 'none', lineStyle: { color: '#c8d4e3', width: 2 }, areaStyle: { color: 'rgba(200,212,227,0.1)' } },
      { name: 'MA(7)', type: 'line', data: dailyMA7, smooth: true, symbol: 'none', lineStyle: { color: '#8fb7a2', width: 2.5, opacity: 0.8 } },
      { name: 'Requests', type: 'line', data: dailyRequests, smooth: true, symbol: 'none', lineStyle: { color: '#b6adc8', width: 1.5, opacity: 0.5 } },
      { name: 'Cost', type: 'line', yAxisIndex: 1, data: dailyCosts, smooth: true, symbol: 'none', lineStyle: { color: '#d0b77d', width: 2 }, areaStyle: { color: 'rgba(208,183,125,0.08)' } },
      { name: 'Cum. Cost', type: 'line', yAxisIndex: 1, data: dailyCumCost, smooth: true, symbol: 'none', lineStyle: { color: '#c4a982', width: 1.5, type: 'dashed' } }
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
  const heatMax = Math.max(1, ...days.map((d) => d.totalTokens));
  return `
var heatData = ${jsonForScript(heatData)};
var heatMax = ${heatMax};
function initHeatmapChart() {
  var el = document.getElementById('heatmap-chart');
  if (!el) return;
  var chart = echarts.init(el);
  window.__charts = window.__charts || {};
  window.__charts.heatmap = chart;
  var option = {
    tooltip: { formatter: function(params) { var val = params.value; return '<b>' + val[0] + '</b><br/>Tokens: ' + fmt(Math.round(val[1])); }},
    visualMap: { min: 0, max: heatMax, calculable: true, orient: 'horizontal', left: 'center', bottom: 8, itemWidth: 10, itemHeight: 160,
      formatter: function(v) { return fmt(v); }, textStyle: { color: '#9d9da6', fontSize: 10 },
      inRange: { color: ['rgba(255,255,255,0)', '#2b2b33', '#565661', '#8f8f98', '#f2f2ef'] } },
    calendar: { left: 30, right: 30, top: 20, bottom: 60, range: ${jsonForScript([minDate, maxDate])}, splitLine: { lineStyle: { color: '#303035' } }, dayLabel: { color: '#a3a3ac' }, monthLabel: { color: '#a3a3ac' }, yearLabel: { color: '#a3a3ac' }, itemStyle: { color: '#131316', borderColor: '#0c0c0e', borderWidth: 2 } },
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
var hourlyData = ${jsonForScript(heatData)};
var hourlyMax = ${maxVal};
var hourLabels = ${jsonForScript(hours)};
var dowLabels = ${jsonForScript(dowNames)};
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
    xAxis: { type: 'category', data: hourLabels, name: 'Hour', nameTextStyle: { color: '#a3a3ac' }, axisLabel: { color: '#a3a3ac', fontSize: 10 }, axisLine: { lineStyle: { color: '#303035' } }, splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,0.005)', 'rgba(255,255,255,0)'] } } },
    yAxis: { type: 'category', data: dowLabels, axisLabel: { color: '#a3a3ac', fontSize: 10 }, axisLine: { lineStyle: { color: '#303035' } } },
    visualMap: { min: 0, max: Math.max(1, hourlyMax), calculable: true, orient: 'horizontal', right: 20, top: 8, itemWidth: 10, itemHeight: 150,
      formatter: function(v) { return fmt(v); }, textStyle: { color: '#9d9da6', fontSize: 10 },
      inRange: { color: ['rgba(255,255,255,0)', '#2b2b33', '#565661', '#8f8f98', '#f2f2ef'] } },
    series: [{ type: 'heatmap', data: hourlyData, label: { show: false }, itemStyle: { borderColor: '#131316', borderWidth: 1 }, emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(242,242,239,0.4)' } } }]
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
var costDays = ${jsonForScript(days)};
var dailyCostArr = ${jsonForScript(costs)};
var cumCostArr = ${jsonForScript(cumCosts)};
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
    legend: { data: ['Daily Cost', 'Cumulative Cost'], textStyle: { color: '#a3a3ac' }, top: 5 },
    grid: { left: 70, right: 70, bottom: 80, top: 40 },
    xAxis: { type: 'category', data: costDays, axisLabel: { color: '#a3a3ac', rotate: window.innerWidth < 700 ? 0 : 45, interval: window.innerWidth < 700 ? Math.max(0, Math.ceil(costDays.length / 6) - 1) : 0, fontSize: 10, hideOverlap: true }, axisLine: { lineStyle: { color: '#303035' } } },
    yAxis: [
      { type: 'value', name: 'Daily', nameTextStyle: { color: '#d0b77d' }, axisLabel: { color: '#d0b77d', formatter: function(v) { return '$' + v.toFixed(2); } }, splitLine: { lineStyle: { color: '#303035', type: 'dashed' } } },
      { type: 'value', name: 'Cumulative', nameTextStyle: { color: '#c4a982' }, axisLabel: { color: '#c4a982', formatter: function(v) { return '$' + v.toFixed(1); } }, splitLine: { show: false } }
    ],
    dataZoom: [{ type: 'slider', bottom: 5, height: 20, borderColor: '#303035', fillerColor: 'rgba(208,183,125,0.08)', handleStyle: { color: '#d0b77d' }, textStyle: { color: '#a3a3ac' } }],
    series: [
      { name: 'Daily Cost', type: 'bar', data: dailyCostArr, barMaxWidth: 30, itemStyle: { color: '#d0b77d', borderRadius: [3, 3, 0, 0] } },
      { name: 'Cumulative Cost', type: 'line', yAxisIndex: 1, data: cumCostArr, smooth: true, symbol: 'none', lineStyle: { color: '#c4a982', width: 2.5 }, areaStyle: { color: 'rgba(196,169,130,0.06)' } }
    ]
  };
  chart.setOption(option);
  chart.resize();
}`;
}
function renderInsightsSection(data) {
  const insights = [];
  const apiTotal = data.apiCost?.totalApiCost;
  const reported = data.apiCost?.reportedCost ?? data.summary.totalCost;
  if (apiTotal != null && apiTotal > reported) {
    const pct2 = ((apiTotal - reported) / apiTotal * 100).toFixed(1);
    insights.push({
      icon: "$",
      title: "Saved vs. official API pricing",
      value: `<span class="accent">${fmtCost(apiTotal - reported)}</span> (${pct2}% below API equivalent)`
    });
  }
  const hm = data.hourlyHeatmap ?? [];
  if (hm.length > 0) {
    const peak = hm.reduce((a, b) => a.totalTokens > b.totalTokens ? a : b);
    const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    insights.push({
      icon: "\u26A1",
      title: "Peak activity hour",
      value: `<span class="accent">${dowNames[peak.dow]} ${String(peak.hour).padStart(2, "0")}:00</span> \xB7 ${fmtTokens(peak.totalTokens)} tokens \xB7 ${peak.requests} reqs`
    });
  }
  const top = sortModelsByUsage(data.models)[0];
  if (top) {
    const total = data.summary.totalTokens;
    const sharePct = total > 0 ? (top.totalTokens / total * 100).toFixed(1) : "0";
    insights.push({
      icon: "\u2605",
      title: "Top model",
      value: `<span class="accent">${escapeHtml(top.model)}</span> \xB7 ${fmtTokens(top.totalTokens)} (${sharePct}% of tokens)`
    });
  }
  if (insights.length === 0) return "";
  const cards = insights.map((ins) => `
    <div class="insight-card">
      <div class="insight-icon" style="background:rgba(255,255,255,.05);color:var(--text)">${ins.icon}</div>
      <div class="insight-body">
        <div class="insight-title">${ins.title}</div>
        <div class="insight-value">${ins.value}</div>
      </div>
    </div>`).join("\n");
  return `
  <div class="section">
    <div class="section-title">Insights</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px">
      ${cards}
    </div>
  </div>`;
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
  const daySpan = data.daily.length > 0 ? Math.round((Date.parse(data.daily[0].day) - Date.parse(data.daily[data.daily.length - 1].day)) / 864e5) + 1 : 0;
  const calendarVisible = daySpan > 45;
  const heatmapJs = calendarVisible ? renderHeatmapInit(data) : "";
  const hourlyHeatmapJs = (data.hourlyHeatmap ?? []).length > 0 ? renderHourlyHeatmapInit(data) : "";
  const costTrendJs = data.daily.length > 0 ? renderCostTrendInit(data) : "";
  const jsonData = jsonForScript(data);
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

  ${renderInsightsSection(data)}

  <div class="section">
    <div class="section-title">Model Comparison Matrix</div>
    ${modelChartVisible ? `
    <div class="view-btn-bar">
      <button class="view-btn active" data-view="tokens" onclick="switchModelView('tokens')">Tokens</button>
      <button class="view-btn" data-view="cost" onclick="switchModelView('cost')">Cost</button>
      <button class="view-btn" data-view="requests" onclick="switchModelView('requests')">Requests</button>
      <button class="view-btn" data-view="mix" onclick="switchModelView('mix')">Mix</button>
    </div>
    <div class="chart-box" id="model-chart" style="height:520px"></div>` : '<div class="empty-state">No model usage data in this period.</div>'}
  </div>

  <div class="section">
    <div class="section-title">Usage Timeline</div>
    <div class="tab-bar">
      <button class="tab-btn active" data-tab="daily" onclick="switchTab('daily')">Daily Trend</button>
      ${calendarVisible ? `<button class="tab-btn" data-tab="heatmap" onclick="switchTab('heatmap')">Calendar Heatmap</button>` : ""}
      ${hourlyHeatmapJs ? `<button class="tab-btn" data-tab="hourly" onclick="switchTab('hourly')">Activity Hours</button>` : ""}
      ${costTrendJs ? `<button class="tab-btn" data-tab="cost" onclick="switchTab('cost')">Cost Trend</button>` : ""}
    </div>
    <div id="tab-daily" class="tab-content active">
      <div class="chart-box" id="daily-chart"></div>
    </div>
    ${calendarVisible ? '<div id="tab-heatmap" class="tab-content"><div class="chart-box" id="heatmap-chart"></div></div>' : ""}
    ${hourlyHeatmapJs ? `<div id="tab-hourly" class="tab-content"><div class="chart-box" id="hourly-heatmap" style="height:300px"></div></div>` : ""}
    ${costTrendJs ? `<div id="tab-cost" class="tab-content"><div class="chart-box" id="cost-trend-chart"></div></div>` : ""}
  </div>

  <div class="two-col" style="margin-bottom:28px">
    <div class="section" style="margin-bottom:0">
      <div class="section-title">Provider Summary</div>
      <div class="provider-row">${providerStr}</div>
    </div>
    <div class="section" style="margin-bottom:0">
      <div class="section-title">Share by Provider</div>
      ${data.providers.length > 0 ? `
      <div class="view-btn-bar" id="prov-view-bar" style="margin-bottom:4px">
        <button class="view-btn${data.providers.some((p) => p.totalCost > 0) ? " active" : ""}" data-pview="cost" onclick="switchProviderView('cost')">Cost</button>
        <button class="view-btn${data.providers.some((p) => p.totalCost > 0) ? "" : " active"}" data-pview="tokens" onclick="switchProviderView('tokens')">Tokens</button>
      </div>
      <div class="chart-box" id="provider-donut" style="height:280px"></div>` : '<div class="empty-state">No provider data.</div>'}
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

// Hidden-tab charts are initialized lazily on first activation so the report
// opens fast with only the visible Daily chart rendered.
var tabChartInited = {};
window.ensureTabChart = function(name) {
  if (tabChartInited[name]) return;
  tabChartInited[name] = true;
  ${calendarVisible ? "if (name === 'heatmap') initHeatmapChart();" : ""}
  ${hourlyHeatmapJs ? "if (name === 'hourly') initHourlyHeatmap();" : ""}
  ${costTrendJs ? "if (name === 'cost') initCostTrend();" : ""}
};

window.switchTab = function(name) {
  document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.tab-btn[data-tab]').forEach(function(el) { el.classList.remove('active'); });
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelector('[data-tab="' + name + '"]').classList.add('active');
  window.ensureTabChart(name);
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

// src/report-formats.ts
function nowString2() {
  const d = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function toLocalDay2(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function getDateRangeForScope(scope) {
  if (scope.kind === "7d") return getPresetRange("7d");
  if (scope.kind === "30d") return getPresetRange("30d");
  if (scope.kind === "days" && scope.days) return parseDaysFilter(String(scope.days));
  return {};
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
async function fetchAllSessions2(client2) {
  const all = [];
  let cursor;
  for (; ; ) {
    const res = await client2.session.list({ limit: 500, cursor });
    const page = res?.data;
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    const next = res?.cursor?.next;
    if (!next) break;
    cursor = next;
  }
  return all;
}
async function fetchAllMessages2(client2, sessionID) {
  const all = [];
  let cursor;
  for (; ; ) {
    const res = await client2.message.list({ sessionID, limit: 200, order: cursor ? void 0 : "asc", cursor });
    const page = res?.data;
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    const next = res?.cursor?.next;
    if (!next) break;
    cursor = next;
  }
  return all;
}
function asAssistant2(m, sessionID) {
  if (!m || typeof m !== "object" || m.type !== "assistant") return null;
  const a = m;
  const tokens = a.tokens;
  if (!tokens || typeof tokens !== "object") return null;
  const input = tokens.input ?? 0;
  const output = tokens.output ?? 0;
  const reasoning = tokens.reasoning ?? 0;
  const cacheRead = tokens.cache?.read ?? 0;
  const cacheWrite = tokens.cache?.write ?? 0;
  const total = input + output + reasoning + cacheRead + cacheWrite;
  return {
    sessionID,
    providerID: a.model?.providerID ?? "unknown",
    modelID: a.model?.id ?? "unknown",
    messageID: a.id,
    created: a.time?.created ?? 0,
    cost: a.cost ?? 0,
    tokens: { input, output, reasoning, cacheRead, cacheWrite, total }
  };
}
async function loadAssistantsSince(sinceMs) {
  const client2 = getV2Client();
  if (!client2) throw new Error("Usage Stat client is not initialized (setV2Client not called)");
  const sessions = await fetchAllSessions2(client2);
  const sessionsById = new Map(sessions.map((s) => [s.id, s]));
  const assistants = [];
  const batchSize = 8;
  for (let i = 0; i < sessions.length; i += batchSize) {
    const batch = sessions.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async (s) => {
      try {
        return await fetchAllMessages2(client2, s.id);
      } catch {
        return null;
      }
    }));
    for (let j = 0; j < batch.length; j++) {
      const msgs = results[j];
      if (!msgs) continue;
      for (const m of msgs) {
        const a = asAssistant2(m, batch[j].id);
        if (!a || a.created < sinceMs) continue;
        assistants.push(a);
      }
    }
  }
  return { assistants, sessionsById };
}
function summarize2(assistants) {
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
function buildModelBreakdown(assistants) {
  const map = /* @__PURE__ */ new Map();
  const sessionSet = /* @__PURE__ */ new Set();
  for (const a of assistants) {
    const key = `${a.providerID}|${a.modelID}`;
    const t2 = a.tokens;
    let item = map.get(key);
    if (!item) {
      item = {
        provider: a.providerID,
        model: a.modelID,
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
function buildProviderBreakdown(assistants) {
  const map = /* @__PURE__ */ new Map();
  const sessionSet = /* @__PURE__ */ new Set();
  for (const a of assistants) {
    const key = a.providerID;
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
function buildDailyBreakdown(assistants) {
  const map = /* @__PURE__ */ new Map();
  const sessionSet = /* @__PURE__ */ new Set();
  for (const a of assistants) {
    const day = toLocalDay2(a.created);
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
  return Array.from(map.values()).sort((a, b) => a.day < b.day ? 1 : -1).slice(0, 90);
}
function buildSessionBreakdown(assistants, sessionsById) {
  const map = /* @__PURE__ */ new Map();
  for (const a of assistants) {
    let item = map.get(a.sessionID);
    if (!item) {
      const s = sessionsById.get(a.sessionID);
      item = {
        sessionId: a.sessionID,
        title: s?.title ?? "(untitled)",
        provider: a.providerID,
        model: a.modelID,
        requests: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheRead: 0,
        totalCost: 0,
        day: toLocalDay2(a.created)
      };
      map.set(a.sessionID, item);
    }
    const t2 = a.tokens;
    item.requests++;
    item.totalTokens += t2.total;
    item.inputTokens += t2.input;
    item.outputTokens += t2.output;
    item.reasoningTokens += t2.reasoning;
    item.cacheRead += t2.cacheRead;
    item.totalCost += a.cost;
    const day = toLocalDay2(a.created);
    if (day > item.day) item.day = day;
  }
  return Array.from(map.values()).sort((a, b) => a.day < b.day ? 1 : -1).slice(0, 15);
}
function buildErrorStats(assistants) {
  let successCount = 0;
  let failedCount = 0;
  const byModelMap = /* @__PURE__ */ new Map();
  for (const a of assistants) {
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
  const byModel = Array.from(byModelMap.values()).sort((a, b) => b.failed - a.failed);
  const errorRate = successCount + failedCount > 0 ? failedCount / (successCount + failedCount) : 0;
  return { successCount, failedCount, errorRate, byModel };
}
function buildHourlyHeatmap(assistants) {
  const map = /* @__PURE__ */ new Map();
  for (const a of assistants) {
    const d = new Date(a.created);
    const key = `${d.getDay()}|${d.getHours()}`;
    let item = map.get(key);
    if (!item) {
      item = { dow: d.getDay(), hour: d.getHours(), requests: 0, totalTokens: 0, totalCost: 0 };
      map.set(key, item);
    }
    item.requests++;
    item.totalTokens += a.tokens.total;
    item.totalCost += a.cost;
  }
  return Array.from(map.values());
}
function buildApiCost(models, reportedCost) {
  const byModel = models.map((m) => {
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
  const totalApiCost = byModel.reduce((sum, m) => sum + (m.apiEquivCost ?? 0), 0);
  return {
    totalApiCost: totalApiCost > 0 ? totalApiCost : null,
    reportedCost,
    byModel
  };
}
async function buildRecentHoursReportData(context, hours) {
  const sinceMs = Date.now() - Math.max(1, hours) * 36e5;
  const { assistants, sessionsById } = await loadAssistantsSince(sinceMs);
  const successful = assistants.filter((a) => a.tokens.total > 0);
  const summary = summarize2(successful);
  const models = buildModelBreakdown(successful);
  const providers = buildProviderBreakdown(successful);
  const daily = buildDailyBreakdown(successful);
  const sessions = buildSessionBreakdown(successful, sessionsById);
  const totalSessions = new Set(successful.map((a) => a.sessionID)).size;
  const errors = buildErrorStats(assistants);
  const hourlyHeatmap = buildHourlyHeatmap(successful);
  const apiCost = buildApiCost(models, summary.totalCost);
  const meta = {
    generatedAt: nowString2(),
    dateRange: {
      start: daily.length > 0 ? daily[daily.length - 1].day : toLocalDay2(sinceMs),
      end: daily.length > 0 ? daily[0].day : toLocalDay2(Date.now())
    }
  };
  return {
    summary,
    models,
    providers,
    daily,
    sessions,
    totalSessions,
    errors,
    meta,
    apiCost,
    hourlyHeatmap,
    perfLogs: readLogs(200),
    perfSummary: readPersistedStats(),
    filters: { startDate: toLocalDay2(sinceMs), endDate: toLocalDay2(Date.now()) }
  };
}
function kpiLine(label, value) {
  return `  ${label}: ${value}`;
}
function separator() {
  return "-".repeat(72);
}
function renderPeriodTextReport(data) {
  const s = data.summary;
  const apiCostTotal = data.apiCost?.totalApiCost ?? null;
  const filters = data.filters ?? {};
  const lines = [];
  lines.push("Usage Stat - Cumulative Report");
  lines.push(`Generated: ${data.meta.generatedAt}`);
  lines.push(`Scope: ${formatFilters(filters)}`);
  if (data.meta.dateRange.start !== "\u2014" && data.meta.dateRange.end !== "\u2014") {
    lines.push(`Date range: ${data.meta.dateRange.start} .. ${data.meta.dateRange.end}`);
  }
  lines.push(separator());
  lines.push("KPI");
  lines.push(kpiLine("Total Tokens", formatTokens(s.totalTokens)));
  lines.push(kpiLine("Requests", String(s.requestCount)));
  lines.push(kpiLine("Sessions", String(data.totalSessions ?? s.modelsUsed.length)));
  lines.push(kpiLine("Input Tokens", formatTokens(s.inputTokens)));
  lines.push(kpiLine("Output Tokens", formatTokens(s.outputTokens)));
  lines.push(kpiLine("Reasoning Tokens", formatTokens(s.reasoningTokens)));
  lines.push(kpiLine("Cache Read", formatTokens(s.cacheRead)));
  lines.push(kpiLine("Cache Write", formatTokens(s.cacheWrite)));
  lines.push(kpiLine("Reported Cost", formatCost(s.totalCost)));
  if (apiCostTotal != null) lines.push(kpiLine("API Equiv Cost", formatCost(apiCostTotal)));
  if (data.errors) {
    const e = data.errors;
    lines.push(kpiLine("Error Rate", `${(e.errorRate * 100).toFixed(2)}% (${e.failedCount} failed / ${e.successCount + e.failedCount} total)`));
  }
  lines.push("");
  lines.push("Models");
  if (data.models.length === 0) {
    lines.push("  (no usage in this period)");
  } else {
    lines.push("  Provider                Model                            Req  Sessions  Tokens      Cost");
    for (const m of data.models) {
      const provider = m.provider.padEnd(24).slice(0, 24);
      const model = m.model.padEnd(29).slice(0, 29);
      lines.push(`  ${provider}  ${model}  ${String(m.requests).padStart(4)}  ${String(m.sessions).padStart(8)}  ${formatTokens(m.totalTokens).padStart(10)}  ${formatCost(m.totalCost).padStart(10)}`);
    }
  }
  lines.push("");
  lines.push("Providers");
  if (data.providers.length === 0) {
    lines.push("  (no usage in this period)");
  } else {
    lines.push("  Provider                Req  Sessions  Tokens      Cost");
    for (const p of data.providers) {
      const provider = p.provider.padEnd(24).slice(0, 24);
      lines.push(`  ${provider}  ${String(p.requests).padStart(4)}  ${String(p.sessions).padStart(8)}  ${formatTokens(p.totalTokens).padStart(10)}  ${formatCost(p.totalCost).padStart(10)}`);
    }
  }
  if (data.daily.length > 0) {
    lines.push("");
    lines.push("Daily");
    lines.push("  Date         Req  Sessions  Tokens      Cost");
    for (const d of data.daily) {
      lines.push(`  ${d.day.padEnd(10)}  ${String(d.requests).padStart(4)}  ${String(d.sessions).padStart(8)}  ${formatTokens(d.totalTokens).padStart(10)}  ${formatCost(d.totalCost).padStart(10)}`);
    }
  }
  lines.push("");
  lines.push(`Report file generated locally by opencode-usage-stat`);
  return lines.join("\n");
}
function renderSessionTextReport(data) {
  const s = data.summary;
  const lines = [];
  lines.push(`Usage Stat - Session Report`);
  lines.push(`Session: ${data.sessionTitle}`);
  lines.push(`Session ID: ${data.sessionId}`);
  lines.push(`Subagents: ${data.subagentCount}`);
  lines.push(`Generated: ${data.generatedAt}`);
  lines.push(separator());
  lines.push("KPI");
  lines.push(kpiLine("Total Tokens", formatTokens(s.totalTokens)));
  lines.push(kpiLine("Requests", String(s.requestCount)));
  lines.push(kpiLine("Input Tokens", formatTokens(s.inputTokens)));
  lines.push(kpiLine("Output Tokens", formatTokens(s.outputTokens)));
  lines.push(kpiLine("Reasoning Tokens", formatTokens(s.reasoningTokens)));
  lines.push(kpiLine("Cache Read", formatTokens(s.cacheRead)));
  lines.push(kpiLine("Cache Write", formatTokens(s.cacheWrite)));
  lines.push(kpiLine("Reported Cost", formatCost(s.totalCost)));
  if (data.apiCost.totalApiCost != null) lines.push(kpiLine("API Equiv Cost", formatCost(data.apiCost.totalApiCost)));
  lines.push(kpiLine("Tokens/s", data.tps > 0 ? data.tps >= 100 ? Math.round(data.tps).toString() : data.tps.toFixed(1) : "-"));
  lines.push(kpiLine("Cost/Request", formatCost(data.costPerRequest)));
  lines.push(kpiLine("Error Rate", `${(data.errors.errorRate * 100).toFixed(2)}% (${data.errors.failedCount} failed / ${data.errors.successCount + data.errors.failedCount} total)`));
  lines.push("");
  lines.push("Models");
  if (data.models.length === 0) {
    lines.push("  (no usage in this session)");
  } else {
    lines.push("  Provider                Model                            Req  Sessions  Tokens      Cost");
    for (const m of data.models) {
      const provider = m.provider.padEnd(24).slice(0, 24);
      const model = m.model.padEnd(29).slice(0, 29);
      lines.push(`  ${provider}  ${model}  ${String(m.requests).padStart(4)}  ${String(m.sessions).padStart(8)}  ${formatTokens(m.totalTokens).padStart(10)}  ${formatCost(m.totalCost).padStart(10)}`);
    }
  }
  lines.push("");
  lines.push(`Report file generated locally by opencode-usage-stat`);
  return lines.join("\n");
}
function toPeriodJsonReport(data) {
  return data;
}
function toSessionJsonReport(data) {
  return data;
}

// src/commands.tsx
import { execSync as execSync2, spawn } from "node:child_process";
import { existsSync as existsSync8, mkdirSync, writeFileSync as writeFileSync4, readdirSync, statSync as statSync2, unlinkSync } from "node:fs";
import { join as join8 } from "node:path";
import { homedir as homedir6 } from "node:os";
var REPORT_PREFIX = "usage-stat-";
function ensureReportDir() {
  const dir = join8(homedir6(), ".opencode", "reports");
  if (!existsSync8(dir)) mkdirSync(dir, {
    recursive: true
  });
  return dir;
}
function openInBrowser(filePath) {
  try {
    const platform = process.platform;
    if (platform === "win32") {
      try {
        spawn("explorer.exe", [filePath], {
          detached: true,
          stdio: "ignore"
        }).unref();
        return;
      } catch {
      }
      try {
        execSync2(`start "" "${filePath}"`, {
          timeout: 5e3
        });
      } catch {
      }
    } else if (platform === "darwin") {
      execSync2(`open "${filePath}"`, {
        timeout: 5e3
      });
    } else {
      execSync2(`xdg-open "${filePath}"`, {
        timeout: 5e3
      });
    }
  } catch {
  }
}
var MAX_REPORTS = 50;
function cleanupOldReports(dir) {
  try {
    const files = readdirSync(dir).filter((f) => f.startsWith(REPORT_PREFIX) && /\.(html|txt|json)$/.test(f)).map((f) => ({
      name: f,
      path: join8(dir, f),
      mtime: statSync2(join8(dir, f)).mtimeMs
    })).sort((a, b) => b.mtime - a.mtime);
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
function currentSessionId(context) {
  try {
    const route = context.ui.router.current();
    if (route?.type === "session") return route.sessionID;
  } catch {
  }
  return void 0;
}
async function buildSessionData(context) {
  const sessionId = currentSessionId(context);
  if (!sessionId) throw new Error("No active session. Open a session first.");
  const childIds = await getChildSessionIds(sessionId);
  const allIds = [sessionId, ...childIds];
  const filters = {
    sessionIds: allIds
  };
  const [summary, models, messages, errors, sessionTitle] = await Promise.all([getSummary(filters), getModelBreakdown(filters), getMessageDetails(sessionId), getErrorStats(filters), getSessionTitle(sessionId)]);
  const data = await buildSessionReportData(sessionId, sessionTitle, childIds.length, summary, models, messages, errors);
  return data;
}
async function showHtmlReport(context, filters = {}) {
  try {
    const data = await buildCombinedData(context, filters);
    const html = generateTotalUsageHtml(data);
    const dir = ensureReportDir();
    const filePath = join8(dir, `${REPORT_PREFIX}total-${dateTimeStamp()}.html`);
    writeFileSync4(filePath, html, "utf-8");
    cleanupOldReports(dir);
    context.ui.toast.show({
      message: `Report: ${filePath}`,
      variant: "info"
    });
    openInBrowser(filePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    context.ui.toast.show({
      message: `Error: ${msg}`,
      variant: "error"
    });
  }
}
async function showTextReport(context, filters = {}) {
  try {
    const data = await buildCombinedData(context, filters);
    const text = renderPeriodTextReport(data);
    const dir = ensureReportDir();
    const filePath = join8(dir, `${REPORT_PREFIX}text-${dateTimeStamp()}.txt`);
    writeFileSync4(filePath, text, "utf-8");
    cleanupOldReports(dir);
    context.ui.toast.show({
      message: `Text report: ${filePath}`,
      variant: "info"
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    context.ui.toast.show({
      message: `Error: ${msg}`,
      variant: "error"
    });
  }
}
async function showJsonReport(context, filters = {}) {
  try {
    const data = await buildCombinedData(context, filters);
    const dir = ensureReportDir();
    const filePath = join8(dir, `${REPORT_PREFIX}json-${dateTimeStamp()}.json`);
    writeFileSync4(filePath, JSON.stringify(toPeriodJsonReport(data), null, 2), "utf-8");
    cleanupOldReports(dir);
    context.ui.toast.show({
      message: `JSON: ${filePath}`,
      variant: "info"
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    context.ui.toast.show({
      message: `Error: ${msg}`,
      variant: "error"
    });
  }
}
async function showHtmlSessionReport(context) {
  try {
    const data = await buildSessionData(context);
    const html = generateSessionUsageHtml(data);
    const dir = ensureReportDir();
    const filePath = join8(dir, `${REPORT_PREFIX}session-${dateTimeStamp()}.html`);
    writeFileSync4(filePath, html, "utf-8");
    cleanupOldReports(dir);
    context.ui.toast.show({
      message: `Report: ${filePath}`,
      variant: "info"
    });
    openInBrowser(filePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    context.ui.toast.show({
      message: `Error: ${msg}`,
      variant: "error"
    });
  }
}
async function showTextSessionReport(context) {
  try {
    const data = await buildSessionData(context);
    const text = renderSessionTextReport(data);
    const dir = ensureReportDir();
    const filePath = join8(dir, `${REPORT_PREFIX}session-${dateTimeStamp()}.txt`);
    writeFileSync4(filePath, text, "utf-8");
    cleanupOldReports(dir);
    context.ui.toast.show({
      message: `Text report: ${filePath}`,
      variant: "info"
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    context.ui.toast.show({
      message: `Error: ${msg}`,
      variant: "error"
    });
  }
}
async function showJsonSessionReport(context) {
  try {
    const data = await buildSessionData(context);
    const dir = ensureReportDir();
    const filePath = join8(dir, `${REPORT_PREFIX}session-${dateTimeStamp()}.json`);
    writeFileSync4(filePath, JSON.stringify(toSessionJsonReport(data), null, 2), "utf-8");
    cleanupOldReports(dir);
    context.ui.toast.show({
      message: `JSON: ${filePath}`,
      variant: "info"
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    context.ui.toast.show({
      message: `Error: ${msg}`,
      variant: "error"
    });
  }
}
async function showRangeMenu(context) {
  const choice = await context.ui.dialog.select({
    title: t("scopeTitle"),
    placeholder: t("scopePlaceholder"),
    options: [{
      title: `\u{1F5C2} ${t("menuCurrentSession")}`,
      value: "session",
      description: "Current session + subagents"
    }, {
      title: `\u{1F550} ${t("menu5h")}`,
      value: "5h",
      description: "Last 5 hours"
    }, {
      title: `\u{1F4C6} ${t("menu7d")}`,
      value: "7d",
      description: "Last 7 days"
    }, {
      title: `\u{1F4C5} ${t("menu30d")}`,
      value: "30d",
      description: "Last 30 days"
    }, {
      title: `\u267E ${t("menuAll")}`,
      value: "all",
      description: "Entire history (/usage 0)"
    }]
  });
  if (!choice) return void 0;
  const labels = {
    session: t("menuCurrentSession"),
    "5h": t("menu5h"),
    "7d": t("menu7d"),
    "30d": t("menu30d"),
    all: t("menuAll"),
    days: `${choice} days`
  };
  return {
    kind: choice,
    label: labels[choice]
  };
}
async function showFormatMenu(context) {
  const choice = await context.ui.dialog.select({
    title: t("formatTitle"),
    placeholder: t("formatPlaceholder"),
    options: [{
      title: `\u{1F4C4} ${t("cmdTitleHtml")}`,
      value: "html",
      description: t("cmdDescHtml")
    }, {
      title: `\u{1F4DD} ${t("cmdTitleText")}`,
      value: "text",
      description: t("cmdDescText")
    }, {
      title: `\u{1F9FE} ${t("cmdTitleJson")}`,
      value: "json",
      description: t("cmdDescJson")
    }]
  });
  return choice;
}
async function writePeriodReportData(context, data, format) {
  if (format === "html") {
    const html = generateTotalUsageHtml(data);
    const dir2 = ensureReportDir();
    const filePath2 = join8(dir2, `${REPORT_PREFIX}total-${dateTimeStamp()}.html`);
    writeFileSync4(filePath2, html, "utf-8");
    cleanupOldReports(dir2);
    context.ui.toast.show({
      message: `Report: ${filePath2}`,
      variant: "info"
    });
    openInBrowser(filePath2);
    return;
  }
  if (format === "text") {
    const text = renderPeriodTextReport(data);
    const dir2 = ensureReportDir();
    const filePath2 = join8(dir2, `${REPORT_PREFIX}text-${dateTimeStamp()}.txt`);
    writeFileSync4(filePath2, text, "utf-8");
    cleanupOldReports(dir2);
    context.ui.toast.show({
      message: `Text report: ${filePath2}`,
      variant: "info"
    });
    return;
  }
  const dir = ensureReportDir();
  const filePath = join8(dir, `${REPORT_PREFIX}json-${dateTimeStamp()}.json`);
  writeFileSync4(filePath, JSON.stringify(toPeriodJsonReport(data), null, 2), "utf-8");
  cleanupOldReports(dir);
  context.ui.toast.show({
    message: `JSON: ${filePath}`,
    variant: "info"
  });
}
async function generatePeriodReport(context, scope, format) {
  try {
    if (scope.kind === "5h") {
      const data = await buildRecentHoursReportData(context, 5);
      await writePeriodReportData(context, data, format);
      return;
    }
    const filters = getDateRangeForScope(scope);
    if (format === "html") {
      await showHtmlReport(context, filters);
    } else if (format === "text") {
      await showTextReport(context, filters);
    } else {
      await showJsonReport(context, filters);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    context.ui.toast.show({
      message: `Error: ${msg}`,
      variant: "error"
    });
  }
}
async function generateSessionReport(context, format) {
  if (format === "html") await showHtmlSessionReport(context);
  else if (format === "text") await showTextSessionReport(context);
  else await showJsonSessionReport(context);
}
async function showUsageMenu(context) {
  try {
    setLanguage(loadSettings(context).language);
  } catch {
  }
  const scope = await showRangeMenu(context);
  if (!scope) return;
  const format = await showFormatMenu(context);
  if (!format) return;
  if (scope.kind === "session") {
    await generateSessionReport(context, format);
  } else {
    await generatePeriodReport(context, scope, format);
  }
}
function loadSettings(context) {
  try {
    const [store] = getSettingsStore(context);
    return {
      ...DEFAULT_SETTINGS,
      ...store
    };
  } catch {
    return {
      ...DEFAULT_SETTINGS
    };
  }
}
async function mutateSettings(context, mutation) {
  const [, mutate] = getSettingsStore(context);
  await mutate(mutation);
}
async function showSettingsDialog(context) {
  await migrateLegacySettings(context);
  const cfg = loadSettings(context);
  const displayLabel = cfg.providerUsageDisplay === "remaining" ? `${t("displayRemaining")} (${t("left")})` : t("displayUsed");
  const choice = await context.ui.dialog.select({
    title: t("settingsTitle"),
    placeholder: t("settingsPlaceholder"),
    options: [{
      title: `${cfg.showPerformance ? "\u2713 " : "  "}${t("showPerformance")}`,
      value: "showPerformance",
      description: t("descShowPerformance")
    }, {
      title: `${cfg.showPricing ? "\u2713 " : "  "}${t("showPricing")}`,
      value: "showPricing",
      description: t("descShowPricing")
    }, {
      title: `${cfg.showTrend ? "\u2713 " : "  "}${t("showTrend")}`,
      value: "showTrend",
      description: t("descShowTrend")
    }, {
      title: `${t("settingsDisplayMode")}: ${displayLabel} \u25B8`,
      value: "providerUsageDisplay",
      description: t("descSettingsDisplay")
    }, {
      title: `${t("settingsLanguage")} \u25B8`,
      value: "language",
      description: t("descSettingsLanguage")
    }, {
      title: t("done"),
      value: "done",
      description: t("closeSettings")
    }]
  });
  if (!choice) return;
  if (choice === "language") {
    await showLanguageMenu(context);
  } else if (choice === "providerUsageDisplay") {
    await showDisplayModeMenu(context);
  } else if (choice !== "done") {
    try {
      await mutateSettings(context, (draft) => {
        draft[choice] = !draft[choice];
      });
      await showSettingsDialog(context);
    } catch {
    }
  }
}
async function showDisplayModeMenu(context) {
  const current = loadSettings(context).providerUsageDisplay;
  const choice = await context.ui.dialog.select({
    title: t("settingsDisplayMode"),
    placeholder: t("settingsPlaceholder"),
    options: [{
      title: `${current === "used" ? "\u2713 " : "  "}${t("displayUsed")}`,
      value: "used",
      description: "n% used"
    }, {
      title: `${current === "remaining" ? "\u2713 " : "  "}${t("displayRemaining")} (${t("left")})`,
      value: "remaining",
      description: `${t("displayRemaining")} \u2014 n% left`
    }]
  });
  if (!choice) return;
  try {
    await mutateSettings(context, (draft) => {
      draft.providerUsageDisplay = choice;
    });
  } catch {
  }
}
async function showLanguageMenu(context) {
  const current = loadSettings(context).language;
  const choice = await context.ui.dialog.select({
    title: t("settingsLanguage"),
    placeholder: t("settingsLanguage"),
    options: [{
      title: `${current === "auto" ? "\u2713 " : "  "}${t("langAuto")}`,
      value: "auto"
    }, {
      title: `${current === "zh" ? "\u2713 " : "  "}\u4E2D\u6587`,
      value: "zh"
    }, {
      title: `${current === "en" ? "\u2713 " : "  "}English`,
      value: "en"
    }]
  });
  if (!choice) return;
  setLanguage(choice);
  try {
    await mutateSettings(context, (draft) => {
      draft.language = choice;
    });
  } catch {
  }
}
function parseNumericDays(input) {
  const raw = (input ?? "").trim();
  if (!/^\d+$/.test(raw)) return void 0;
  const days = Number(raw);
  if (!Number.isFinite(days) || days < 1 || days > 3650) return void 0;
  return days;
}
async function runUsageCommand(context, input) {
  try {
    setLanguage(loadSettings(context).language);
  } catch {
  }
  const raw = (input ?? "").trim();
  if (raw === "settings" || raw === "config") {
    await showSettingsDialog(context);
    return;
  }
  if (raw === "0" || raw === "all") {
    const format = await showFormatMenu(context);
    if (!format) return;
    await generatePeriodReport(context, {
      kind: "all",
      label: t("menuAll")
    }, format);
    return;
  }
  const days = parseNumericDays(raw);
  if (days != null) {
    const format = await showFormatMenu(context);
    if (!format) return;
    const scope = {
      kind: "days",
      label: `${days} days`,
      days
    };
    await generatePeriodReport(context, scope, format);
    return;
  }
  await showUsageMenu(context);
}
function registerCommands(context) {
  try {
    setV2Client(context.client);
  } catch {
  }
  context.keymap.layer(() => ({
    mode: "global",
    commands: [{
      id: "usage-stat.usage",
      title: "Usage Stat",
      description: "Generate local usage reports (current session, 5h/7d/30d, all via /usage 0, or N days) as HTML, text, or JSON",
      group: "Stats",
      palette: true,
      slash: {
        name: "usage",
        arguments: true,
        aliases: ["session-usage", "total-usage"]
      },
      run: (input) => {
        void runUsageCommand(context, input);
      }
    }]
  }));
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
var plugin = define({
  id: "opencode-usage-stat",
  setup: async (context) => {
    const perfTracker = createPerfTracker();
    const [sidebarRevision, setSidebarRevision] = createSignal3(0);
    const [allTokenMessages, setAllTokenMessages] = createSignal3([]);
    let currentSessionID = "";
    let currentFamily = [];
    const cleanups = [];
    const onEvent = context.data.on;
    const unsubInboxEnqueued = context.data.on("session.inbox.enqueued", (event) => {
      perfTracker.handleInboxEnqueued(event);
    });
    cleanups.push(unsubInboxEnqueued);
    const unsubInboxDelivered = context.data.on("session.inbox.delivered", (event) => {
      perfTracker.handleInboxDelivered(event);
    });
    cleanups.push(unsubInboxDelivered);
    const unsubStepStarted = onEvent("session.step.started", (event) => {
      perfTracker.handleStepStarted(event);
    });
    cleanups.push(unsubStepStarted);
    const unsubPart = onEvent("session.text.started", (event) => {
      perfTracker.handlePartUpdated({
        message_id: event?.data?.assistantMessageID,
        session_id: event?.data?.sessionID,
        type: "text",
        time: {
          start: event?.created
        }
      });
    });
    cleanups.push(unsubPart);
    const unsubReasoning = onEvent("session.reasoning.started", (event) => {
      perfTracker.handlePartUpdated({
        message_id: event?.data?.assistantMessageID,
        session_id: event?.data?.sessionID,
        type: "reasoning",
        time: {
          start: event?.created
        }
      });
    });
    cleanups.push(unsubReasoning);
    const unsubToolInput = onEvent("session.tool.input.started", (event) => {
      perfTracker.handlePartUpdated({
        message_id: event?.data?.assistantMessageID,
        session_id: event?.data?.sessionID,
        type: "tool",
        time: {
          start: event?.created
        }
      });
    });
    cleanups.push(unsubToolInput);
    const unsubStepStreamed = onEvent("session.step.streamed", (event) => {
      perfTracker.handleStepStreamed(event);
    });
    cleanups.push(unsubStepStreamed);
    const settleStep = (event) => {
      perfTracker.handleStepTerminal(event);
      setSidebarRevision((value) => value + 1);
    };
    const unsubStepEnded = onEvent("session.step.ended", settleStep);
    const unsubStepFailed = onEvent("session.step.failed", settleStep);
    cleanups.push(unsubStepEnded, unsubStepFailed);
    const unsubUsage = context.data.on("session.usage.updated", (event) => {
      const sessionID = event?.data?.sessionID;
      if (sessionID && currentFamily.includes(sessionID)) void refreshSession(sessionID);
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
    async function refreshSession(sessionID) {
      await context.data.session.message.sync(sessionID).catch(() => {
      });
      if (currentFamily.includes(sessionID)) updateTokenMessages();
      setSidebarRevision((value) => value + 1);
    }
    async function syncFamilyTree(rootID) {
      const visited = /* @__PURE__ */ new Set([rootID]);
      const queue = [rootID];
      while (queue.length > 0 && visited.size < 200) {
        const sessionID = queue.shift();
        await context.data.session.sync(sessionID, {
          children: true
        }).catch(() => {
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
      await Promise.all(currentFamily.map((sessionID) => refreshSession(sessionID)));
      updateTokenMessages();
    }
    const unsubExec = context.data.on("session.execution.succeeded", (event) => {
      void refreshSession(event.data.sessionID);
    });
    cleanups.push(unsubExec);
    const unsubExecFailed = context.data.on("session.execution.failed", (event) => {
      void refreshSession(event.data.sessionID);
    });
    cleanups.push(unsubExecFailed);
    const unsubCreated = context.data.on("session.created", (event) => {
      const sessionID = event?.data?.sessionID;
      const parentID = event?.data?.parentID;
      if (!sessionID || !parentID || !currentFamily.includes(parentID) || currentFamily.includes(sessionID)) return;
      currentFamily = [...currentFamily, sessionID];
      void refreshSession(sessionID);
    });
    cleanups.push(unsubCreated);
    function CommandsMount(props) {
      registerCommands(props.context);
      return null;
    }
    const disposeCommandsSlot = context.ui.slot({
      append: "app",
      render: () => _$createComponent3(CommandsMount, {
        context
      })
    });
    cleanups.push(disposeCommandsSlot);
    const disposeSlot = context.ui.slot({
      append: "sidebar.content",
      render: (slotProps) => {
        createEffect2(() => {
          const sessionID = slotProps.sessionID;
          sidebarRevision();
          if (sessionID && sessionID !== currentSessionID) {
            currentSessionID = sessionID;
            currentFamily = familyFor(sessionID);
            perfTracker.loadSessions(currentFamily);
            setAllTokenMessages([]);
            void syncFamilyTree(sessionID);
          }
        });
        return _$createComponent3(UsageStatPanel, {
          context,
          perfTracker,
          get sessionID() {
            return slotProps.sessionID ?? "";
          },
          revision: sidebarRevision,
          allTokenMessages
        });
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
