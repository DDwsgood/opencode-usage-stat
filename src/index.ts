// index.ts - opencode-usage-stat server plugin
// Registers /session-usage and /total-usage commands that generate HTML reports.
//
// /session-usage  - Shows all models' token usage in the current session + per-request breakdown
// /total-usage    - Shows cumulative usage across all sessions (same as tokenwatch's /usage HTML report)

import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { execSync, spawn } from "node:child_process"
import { HttpServerResponse } from "effect/unstable/http"
import {
  getUsageReport,
  getSummary,
  getModelBreakdown,
  getMessageDetails,
  getSessionTitle,
  getErrorStats,
  getHourlyHeatmap,
  getChildSessionIds,
} from "./queries.js"
import type {
  ApiCostAnalysis,
  ApiCostModelItem,
  CombinedReportData,
  HtmlReportMeta,
  UsageFilters,
} from "./formatter.js"
import { estimateApiCost } from "./pricing.js"
import { generateTotalUsageHtml } from "./total-usage-html.js"
import { buildSessionReportData, generateSessionUsageHtml } from "./session-usage-html.js"

const SESSION_USAGE_COMMAND = "session-usage"
const TOTAL_USAGE_COMMAND = "total-usage"

function ensureReportDir(): string {
  const dir = join(homedir(), ".opencode", "reports")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function openInBrowser(filePath: string): void {
  try {
    const platform = process.platform
    if (platform === "win32") {
      // On Windows, try multiple strategies since the Electron process may not
      // have cmd.exe in PATH. Use spawn (non-blocking) instead of execSync.
      // Strategy 1: explorer.exe (always available, opens with default browser)
      try {
        spawn("explorer.exe", [filePath], { detached: true, stdio: "ignore" }).unref()
        return
      } catch { /* fall through */ }
      // Strategy 2: cmd.exe start
      try {
        execSync(`start "" "${filePath}"`, { timeout: 5000 })
      } catch { /* fall through */ }
    } else if (platform === "darwin") {
      execSync(`open "${filePath}"`, { timeout: 5000 })
    } else {
      execSync(`xdg-open "${filePath}"`, { timeout: 5000 })
    }
  } catch { /* silently fail */ }
}

function dateTimeStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`
}

const MAX_REPORTS = 50

function cleanupOldReports(dir: string, prefix: string): void {
  try {
    const files = readdirSync(dir)
      .filter(f => f.startsWith(prefix) && f.endsWith(".html"))
      .map(f => ({ name: f, path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)

    if (files.length > MAX_REPORTS) {
      for (const f of files.slice(MAX_REPORTS)) {
        try { unlinkSync(f.path) } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

/** Parse a days argument from command input. Returns null for all-time. */
function parseDaysArg(args: string | undefined): number | null {
  if (!args) return null
  const trimmed = args.trim()
  if (!trimmed) return null
  const n = parseInt(trimmed, 10)
  if (isNaN(n) || n <= 0) return null
  return n
}

function dateNDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - (days - 1))
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function generateSessionUsageReport(sessionId: string): Promise<string> {
  // Include subagent (child) sessions
  const childIds = await getChildSessionIds(sessionId)
  const allIds = [sessionId, ...childIds]
  const filters = { sessionIds: allIds }

  const [summary, models, messages, errors, sessionTitle] = await Promise.all([
    getSummary(filters),
    getModelBreakdown(filters),
    getMessageDetails(sessionId),
    getErrorStats(filters),
    getSessionTitle(sessionId),
  ])

  const data = await buildSessionReportData(sessionId, sessionTitle, childIds.length, summary, models, messages, errors)
  return generateSessionUsageHtml(data)
}

async function generateTotalUsageReport(days: number | null = null): Promise<string> {
  const filters: UsageFilters = { limit: 90 }
  if (days != null) {
    filters.startDate = dateNDaysAgo(days)
  }
  const [report, hourlyHeatmap] = await Promise.all([
    getUsageReport(filters),
    getHourlyHeatmap(filters),
  ])

  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const meta: HtmlReportMeta = {
    generatedAt: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    dateRange: {
      start: report.daily.length > 0 ? report.daily[report.daily.length - 1].day : "-",
      end: report.daily.length > 0 ? report.daily[0].day : "-",
    },
  }

  // API equivalent cost analysis
  const apiCostByModel: ApiCostModelItem[] = report.models.map(m => {
    const est = estimateApiCost(
      m.provider, m.model, m.requests,
      m.inputTokens, m.outputTokens, m.reasoningTokens,
      m.cacheRead, m.cacheWrite,
    )
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
      pricingProvider: est.pricingProvider,
    }
  })
  const apiTotal = apiCostByModel.reduce((sum, m) => sum + (m.apiEquivCost ?? 0), 0)
  const apiCost: ApiCostAnalysis = {
    totalApiCost: apiTotal > 0 ? apiTotal : null,
    reportedCost: report.summary.totalCost,
    byModel: apiCostByModel,
  }

  const data: CombinedReportData = {
    summary: report.summary,
    models: report.models,
    providers: report.providers,
    daily: report.daily,
    sessions: report.sessions,
    meta,
    apiCost,
    errors: report.errors,
    hourlyHeatmap,
  }

  return generateTotalUsageHtml(data)
}

const server: Plugin = async () => {
  return {
    config: async config => {
      config.command ??= {}
      config.command[SESSION_USAGE_COMMAND] = {
        template: " ",
        description: "Generate an HTML report showing token usage for the current session",
      }
      config.command[TOTAL_USAGE_COMMAND] = {
        template: " ",
        description: "Generate an HTML report showing cumulative token usage. Usage: /total-usage [days?]  (e.g. /total-usage 7 for last 7 days; omit for all time)",
      }
    },

    "command.execute.before": async (input, output) => {
      if (input.command !== SESSION_USAGE_COMMAND && input.command !== TOTAL_USAGE_COMMAND) return

      const dir = ensureReportDir()
      const stamp = dateTimeStamp()
      let filePath: string

      if (input.command === SESSION_USAGE_COMMAND) {
        if (!input.sessionID) {
          output.parts = [{ type: "text", text: "No active session found. Open a session first." } as any]
          throw HttpServerResponse.empty({ status: 204 })
        }
        const html = await generateSessionUsageReport(input.sessionID)
        filePath = join(dir, `session-usage-${stamp}.html`)
        writeFileSync(filePath, html, "utf-8")
        cleanupOldReports(dir, "session-usage-")
      } else {
        const days = parseDaysArg(input.arguments)
        const html = await generateTotalUsageReport(days)
        filePath = join(dir, `total-usage-${stamp}.html`)
        writeFileSync(filePath, html, "utf-8")
        cleanupOldReports(dir, "total-usage-")
      }

      openInBrowser(filePath)

      // Prevent the command from reaching the LLM by returning a 204 response.
      // This is a workaround for opencode v1.17.5+ where throwing a normal Error
      // becomes a Die (defect) that bypasses Effect.mapError and causes HTTP 500.
      // See: https://github.com/anomalyco/opencode/issues/32253
      throw HttpServerResponse.empty({ status: 204 })
    },
  }
}

export default server
