// commands.tsx - Usage Stat V2 keymap slash commands.
//
// Uses the real V2 TUI API: `context.keymap.layer(() => ({ commands: [...] }))`
// to register /usage, /session-usage and /total-usage. Each slash `run` opens a
// LOCAL dialog (context.ui.dialog) / writes files — never sends the slash to the
// LLM. Adapted from opencode-usage-stat (MIT) and opencode-tokenwatch (MIT).

import type { Context } from "@opencode-ai/plugin/tui/context"
import {
  getUsageReport,
  getHourlyHeatmap,
  getMessageDetails,
  getSessionTitle,
  getChildSessionIds,
  getErrorStats,
  getSummary,
  getModelBreakdown,
  setV2Client,
} from "./queries.js"
import type { UsageFilters, ApiCostAnalysis, ApiCostModelItem, CombinedReportData, HtmlReportMeta, SessionTokenData, ModelBreakdownItem, MessageRow, ErrorStats } from "./formatter.js"
import { getPresetRange, parseDaysFilter } from "./formatter.js"
import { estimateApiCost } from "./pricing.js"
import { readLogs } from "./perf-tracker.js"
import { readPersistedStats } from "./stats-store.js"
import { t, setLanguage } from "./i18n.js"
import type { SupportedLanguage } from "./i18n.js"
import { getSettingsStore, migrateLegacySettings, DEFAULT_SETTINGS } from "./settings.js"
import type { UsageStatSettings } from "./settings.js"
import { generateSessionUsageHtml, buildSessionReportData } from "./session-usage-html.js"
import { generateTotalUsageHtml } from "./total-usage-html.js"
import { execSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const REPORT_PREFIX = "usage-stat-"

function ensureReportDir(): string {
  const dir = join(homedir(), ".opencode", "reports")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function openInBrowser(filePath: string): void {
  try {
    const platform = process.platform
    if (platform === "win32") {
      try {
        spawn("explorer.exe", [filePath], { detached: true, stdio: "ignore" }).unref()
        return
      } catch { /* fall through */ }
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

const MAX_REPORTS = 50

function cleanupOldReports(dir: string): void {
  try {
    const files = readdirSync(dir)
      .filter(f => f.startsWith(REPORT_PREFIX) && f.endsWith(".html"))
      .map(f => ({ name: f, path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    if (files.length > MAX_REPORTS) {
      for (const f of files.slice(MAX_REPORTS)) {
        try { unlinkSync(f.path) } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

function dateTimeStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`
}

function nowString(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Current session id from the V2 router when on a session screen. */
function currentSessionId(context: Context): string | undefined {
  try {
    const route = context.ui.router.current()
    if (route?.type === "session") return route.sessionID
  } catch { /* ignore */ }
  return undefined
}

async function buildCombinedData(context: Context, filters: UsageFilters = {}): Promise<CombinedReportData> {
  const report = await getUsageReport(filters)
  const hourlyHeatmap = await getHourlyHeatmap(filters)
  const logs = readLogs(200)
  const perfSummary = readPersistedStats()

  const meta: HtmlReportMeta = {
    generatedAt: nowString(),
    dateRange: {
      start: report.daily.length > 0 ? report.daily[report.daily.length - 1].day : "—",
      end: report.daily.length > 0 ? report.daily[0].day : "—",
    },
  }

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

  return {
    ...report,
    meta,
    apiCost,
    errors: report.errors,
    hourlyHeatmap,
    perfLogs: logs,
    perfSummary,
  }
}

async function showHtmlReport(context: Context, filters: UsageFilters = {}): Promise<void> {
  try {
    const data = await buildCombinedData(context, filters)
    const html = generateTotalUsageHtml(data)
    const dir = ensureReportDir()
    const filePath = join(dir, `${REPORT_PREFIX}total-${dateTimeStamp()}.html`)
    writeFileSync(filePath, html, "utf-8")
    cleanupOldReports(dir)
    context.ui.toast.show({ message: `Report: ${filePath}`, variant: "info" })
    openInBrowser(filePath)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    context.ui.toast.show({ message: `Error: ${msg}`, variant: "error" })
  }
}

async function showHtmlSessionReport(context: Context): Promise<void> {
  const sessionId = currentSessionId(context)
  try {
    if (!sessionId) {
      context.ui.toast.show({ message: "No active session. Open a session first.", variant: "error" })
      return
    }
    const childIds = await getChildSessionIds(sessionId)
    const allIds = [sessionId, ...childIds]
    const filters: UsageFilters = { sessionIds: allIds }

    const [summary, models, messages, errors, sessionTitle] = await Promise.all([
      getSummary(filters) as Promise<SessionTokenData>,
      getModelBreakdown(filters) as Promise<ModelBreakdownItem[]>,
      getMessageDetails(sessionId) as Promise<MessageRow[]>,
      getErrorStats(filters) as Promise<ErrorStats>,
      getSessionTitle(sessionId) as Promise<string>,
    ])

    const data = await buildSessionReportData(sessionId, sessionTitle, childIds.length, summary, models, messages, errors)
    const html = generateSessionUsageHtml(data)
    const dir = ensureReportDir()
    const filePath = join(dir, `${REPORT_PREFIX}session-${dateTimeStamp()}.html`)
    writeFileSync(filePath, html, "utf-8")
    cleanupOldReports(dir)
    context.ui.toast.show({ message: `Report: ${filePath}`, variant: "info" })
    openInBrowser(filePath)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    context.ui.toast.show({ message: `Error: ${msg}`, variant: "error" })
  }
}

async function showJsonExport(context: Context): Promise<void> {
  try {
    const data = await buildCombinedData(context, {})
    const dir = ensureReportDir()
    const filePath = join(dir, `${REPORT_PREFIX}data-${dateTimeStamp()}.json`)
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8")
    context.ui.toast.show({ message: `JSON: ${filePath}`, variant: "info" })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    context.ui.toast.show({ message: `Error: ${msg}`, variant: "error" })
  }
}

async function showHtmlReportRangeMenu(context: Context): Promise<void> {
  const choice = await context.ui.dialog.select<string>({
    title: t("cmdTitleHtml"),
    placeholder: "Select date range...",
    options: [
      { title: `📄 ${t("menuToday")}`, value: "today" },
      { title: `📄 ${t("menu7d")}`, value: "7d" },
      { title: `📄 ${t("menu30d")}`, value: "30d" },
      { title: `📄 ${t("menuAll")}`, value: "all" },
    ],
  })
  if (!choice) return
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  switch (choice) {
    case "today": await showHtmlReport(context, { startDate: today, endDate: today }); break
    case "7d": await showHtmlReport(context, getPresetRange("7d")); break
    case "30d": await showHtmlReport(context, getPresetRange("30d")); break
    default: await showHtmlReport(context, getPresetRange("all")); break
  }
}

async function showUsageMenu(context: Context): Promise<void> {
  try {
    setLanguage(loadSettings(context).language)
  } catch { /* ignore */ }
  const choice = await context.ui.dialog.select<string>({
    title: t("panelTitle"),
    placeholder: "Select an action...",
    options: [
      { title: `🗂 ${t("menuCurrentSession")}`, value: "session", description: "Current session + subagents HTML dashboard" },
      { title: `📄 ${t("cmdTitleHtml")} ▸`, value: "html", description: t("cmdDescHtml") },
      { title: t("cmdTitleJson"), value: "json", description: t("cmdDescJson") },
      { title: `${t("cmdTitleSettings")} ▸`, value: "settings", description: t("cmdDescSettings") },
    ],
  })
  switch (choice) {
    case "session": await showHtmlSessionReport(context); break
    case "html": await showHtmlReportRangeMenu(context); break
    case "json": await showJsonExport(context); break
    case "settings": await showSettingsDialog(context); break
  }
}

/** Snapshot of the shared settings store (falls back to defaults). */
function loadSettings(context: Context): UsageStatSettings {
  try {
    const [store] = getSettingsStore(context)
    return { ...DEFAULT_SETTINGS, ...store }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

async function mutateSettings(context: Context, mutation: (draft: UsageStatSettings) => void): Promise<void> {
  const [, mutate] = getSettingsStore(context)
  await mutate(mutation)
}

async function showSettingsDialog(context: Context): Promise<void> {
  await migrateLegacySettings(context)
  const cfg = loadSettings(context)
  const displayLabel = cfg.providerUsageDisplay === "remaining" ? `${t("displayRemaining")} (${t("left")})` : t("displayUsed")
  const choice = await context.ui.dialog.select<string>({
    title: t("settingsTitle"),
    placeholder: t("settingsPlaceholder"),
    options: [
      { title: `${cfg.showPerformance ? "✓ " : "  "}${t("showPerformance")}`, value: "showPerformance", description: t("descShowPerformance") },
      { title: `${cfg.showPricing ? "✓ " : "  "}${t("showPricing")}`, value: "showPricing", description: t("descShowPricing") },
      { title: `${cfg.showTrend ? "✓ " : "  "}${t("showTrend")}`, value: "showTrend", description: t("descShowTrend") },
      { title: `${t("settingsDisplayMode")}: ${displayLabel} ▸`, value: "providerUsageDisplay", description: t("descSettingsDisplay") },
      { title: `${t("settingsLanguage")} ▸`, value: "language", description: t("descSettingsLanguage") },
      { title: t("done"), value: "done", description: t("closeSettings") },
    ],
  })
  if (!choice) return
  if (choice === "language") {
    await showLanguageMenu(context)
  } else if (choice === "providerUsageDisplay") {
    await showDisplayModeMenu(context)
  } else if (choice !== "done") {
    try {
      await mutateSettings(context, draft => {
        (draft as unknown as Record<string, unknown>)[choice] =
          !(draft as unknown as Record<string, boolean>)[choice]
      })
      await showSettingsDialog(context)
    } catch { /* storage unavailable */ }
  }
}

async function showDisplayModeMenu(context: Context): Promise<void> {
  const current = loadSettings(context).providerUsageDisplay
  const choice = await context.ui.dialog.select<"used" | "remaining">({
    title: t("settingsDisplayMode"),
    placeholder: t("settingsPlaceholder"),
    options: [
      { title: `${current === "used" ? "✓ " : "  "}${t("displayUsed")}`, value: "used", description: "n% used" },
      { title: `${current === "remaining" ? "✓ " : "  "}${t("displayRemaining")} (${t("left")})`, value: "remaining", description: `${t("displayRemaining")} — n% left` },
    ],
  })
  if (!choice) return
  try {
    await mutateSettings(context, draft => { draft.providerUsageDisplay = choice })
  } catch { /* ignore */ }
}

async function showLanguageMenu(context: Context): Promise<void> {
  const current = loadSettings(context).language
  const choice = await context.ui.dialog.select<SupportedLanguage | "auto">({
    title: t("settingsLanguage"),
    placeholder: t("settingsLanguage"),
    options: [
      { title: `${current === "auto" ? "✓ " : "  "}${t("langAuto")}`, value: "auto" },
      { title: `${current === "zh" ? "✓ " : "  "}中文`, value: "zh" },
      { title: `${current === "en" ? "✓ " : "  "}English`, value: "en" },
    ],
  })
  if (!choice) return
  setLanguage(choice)
  try {
    await mutateSettings(context, draft => { draft.language = choice })
  } catch { /* ignore */ }
}

export { parseDaysFilter } from "./formatter.js"

/** Register the V2 keymap layer with /usage slash commands (never sends to LLM). */
export function registerCommands(context: Context): void {
  try {
    setV2Client(context.client as any)
  } catch { /* non-fatal */ }

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
        run: () => { void showUsageMenu(context) },
      },
      {
        id: "usage-stat.session-usage",
        title: "Session Usage",
        description: "Generate the current session's HTML usage report locally",
        group: "Stats",
        palette: true,
        slash: { name: "session-usage" },
        run: () => { void showHtmlSessionReport(context) },
      },
      {
        id: "usage-stat.total-usage",
        title: "Total Usage",
        description: "Generate a cumulative HTML usage report locally (optionally /total-usage 7 for last 7 days)",
        group: "Stats",
        palette: true,
        slash: { name: "total-usage", arguments: true },
        run: (input?: string) => { void showHtmlReport(context, parseDaysFilter(input)) },
      },
    ],
  }))
}
