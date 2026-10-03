// commands.tsx - Usage Stat V2 keymap slash commands.
//
// Uses the real V2 TUI API: `context.keymap.layer(() => ({ commands: [...] }))`
// to register the unified /usage command. Each slash `run` opens a LOCAL dialog
// (context.ui.dialog) / writes files — never sends the slash to the LLM.
// /session-usage and /total-usage are kept as slash aliases for compatibility.
// Adapted from opencode-usage-stat (MIT) and opencode-tokenwatch (MIT).
//
// The layer must be mode "global": mode-scoped layers are unreachable while
// the composer pushes its own keymap mode, so a "base" layer's slash command
// never shows up in prompt completion.

import type { Context } from "@opencode-ai/plugin/tui/context"
import { getSessionReportInput, setV2Client } from "./queries.js"
import type { ProgressFn } from "./queries.js"
import type { CombinedReportData } from "./formatter.js"
import { t, setLanguage } from "./i18n.js"
import type { SupportedLanguage } from "./i18n.js"
import { getSettingsStore, migrateLegacySettings, DEFAULT_SETTINGS } from "./settings.js"
import type { UsageStatSettings } from "./settings.js"
import { generateSessionUsageHtml, buildSessionReportData } from "./session-usage-html.js"
import { generateTotalUsageHtml } from "./total-usage-html.js"
import type { ReportFormat, ReportScope, SessionReportView } from "./report-formats.js"
import {
  buildCombinedData,
  buildRecentHoursReportData,
  getDateRangeForScope,
  renderPeriodTextReport,
  renderSessionTextReport,
  toPeriodJsonReport,
  toSessionJsonReport,
} from "./report-formats.js"
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
      .filter(f => f.startsWith(REPORT_PREFIX) && /\.(html|txt|json)$/.test(f))
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

/** Current session id from the V2 router when on a session screen. */
function currentSessionId(context: Context): string | undefined {
  try {
    const route = context.ui.router.current()
    if (route?.type === "session") return route.sessionID
  } catch { /* ignore */ }
  return undefined
}

/** t() returns the key itself when a translation is missing. */
function tr(key: string, fallback: string): string {
  const value = t(key)
  return value === key ? fallback : value
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

let reportRunning = false
const PROGRESS_TOAST_INTERVAL_MS = 3_000

/**
 * Single-flight wrapper for every report: immediate "generating" toast, a
 * throttled progress toast (only the API fallback reports progress), and a
 * busy toast when a report is already running.
 */
async function runReport(context: Context, task: (onProgress: ProgressFn) => Promise<void>): Promise<void> {
  if (reportRunning) {
    context.ui.toast.show({ message: tr("reportBusy", "A report is already being generated"), variant: "warning" })
    return
  }
  reportRunning = true
  context.ui.toast.show({ message: tr("reportGenerating", "Generating report…"), variant: "info" })
  let lastToast = Date.now()
  const onProgress: ProgressFn = (done, total) => {
    const now = Date.now()
    if (done >= total || now - lastToast < PROGRESS_TOAST_INTERVAL_MS) return
    lastToast = now
    const message = tr("reportProgress", "Read {done}/{total} sessions")
      .replace("{done}", String(done))
      .replace("{total}", String(total))
    context.ui.toast.show({ message, variant: "info" })
  }
  try {
    await task(onProgress)
  } catch (err) {
    context.ui.toast.show({ message: `Error: ${errorMessage(err)}`, variant: "error" })
  } finally {
    reportRunning = false
  }
}

async function buildSessionData(context: Context, onProgress?: ProgressFn, sessionID?: string): Promise<SessionReportView> {
  const sessionId = sessionID ?? currentSessionId(context)
  if (!sessionId) throw new Error("No active session. Open a session first.")
  const input = await getSessionReportInput(sessionId, onProgress)
  return await buildSessionReportData(input)
}

function writeReportFile(context: Context, kind: string, ext: "html" | "txt" | "json", content: string, label: string, open = false): void {
  const dir = ensureReportDir()
  const filePath = join(dir, `${REPORT_PREFIX}${kind}-${dateTimeStamp()}.${ext}`)
  writeFileSync(filePath, content, "utf-8")
  cleanupOldReports(dir)
  context.ui.toast.show({ message: `${label}: ${filePath}`, variant: "info" })
  if (open) openInBrowser(filePath)
}

function writeSessionReport(context: Context, data: SessionReportView, format: ReportFormat): void {
  if (format === "html") writeReportFile(context, "session", "html", generateSessionUsageHtml(data), "Report", true)
  else if (format === "text") writeReportFile(context, "session", "txt", renderSessionTextReport(data), "Text report")
  else writeReportFile(context, "session", "json", JSON.stringify(toSessionJsonReport(data), null, 2), "JSON")
}

/** Generate and open the HTML report for the current (or given) session. Re-entrant calls only toast. */
export async function generateSessionHtmlReport(context: Context, sessionID?: string): Promise<void> {
  await runReport(context, async onProgress => {
    const data = await buildSessionData(context, onProgress, sessionID)
    writeSessionReport(context, data, "html")
  })
}

async function showRangeMenu(context: Context): Promise<ReportScope | undefined> {
  const choice = await context.ui.dialog.select<ReportScope["kind"]>({
    title: t("scopeTitle"),
    placeholder: t("scopePlaceholder"),
    options: [
      { title: `🗂 ${t("menuCurrentSession")}`, value: "session", description: "Current session + subagents" },
      { title: `🕐 ${t("menu5h")}`, value: "5h", description: "Last 5 hours" },
      { title: `📆 ${t("menu7d")}`, value: "7d", description: "Last 7 days" },
      { title: `📅 ${t("menu30d")}`, value: "30d", description: "Last 30 days" },
      { title: `♾ ${t("menuAll")}`, value: "all", description: "Entire history (/usage 0)" },
    ],
  })
  if (!choice) return undefined
  const labels: Record<ReportScope["kind"], string> = {
    session: t("menuCurrentSession"),
    "5h": t("menu5h"),
    "7d": t("menu7d"),
    "30d": t("menu30d"),
    all: t("menuAll"),
    days: `${choice} days`,
  }
  return { kind: choice, label: labels[choice] }
}

async function showFormatMenu(context: Context): Promise<ReportFormat | undefined> {
  const choice = await context.ui.dialog.select<ReportFormat>({
    title: t("formatTitle"),
    placeholder: t("formatPlaceholder"),
    options: [
      { title: `📄 ${t("cmdTitleHtml")}`, value: "html", description: t("cmdDescHtml") },
      { title: `📝 ${t("cmdTitleText")}`, value: "text", description: t("cmdDescText") },
      { title: `🧾 ${t("cmdTitleJson")}`, value: "json", description: t("cmdDescJson") },
    ],
  })
  return choice
}

function writePeriodReportData(context: Context, data: CombinedReportData, format: ReportFormat): void {
  if (format === "html") writeReportFile(context, "total", "html", generateTotalUsageHtml(data), "Report", true)
  else if (format === "text") writeReportFile(context, "text", "txt", renderPeriodTextReport(data), "Text report")
  else writeReportFile(context, "json", "json", JSON.stringify(toPeriodJsonReport(data), null, 2), "JSON")
}

async function generatePeriodReport(context: Context, scope: ReportScope, format: ReportFormat): Promise<void> {
  await runReport(context, async onProgress => {
    const data = scope.kind === "5h"
      ? await buildRecentHoursReportData(context, 5, onProgress)
      : await buildCombinedData(context, getDateRangeForScope(scope), onProgress)
    writePeriodReportData(context, data, format)
  })
}

async function generateSessionReport(context: Context, format: ReportFormat): Promise<void> {
  await runReport(context, async onProgress => {
    const data = await buildSessionData(context, onProgress)
    writeSessionReport(context, data, format)
  })
}

async function showUsageMenu(context: Context): Promise<void> {
  try {
    setLanguage(loadSettings(context).language)
  } catch { /* ignore */ }
  const scope = await showRangeMenu(context)
  if (!scope) return
  const format = await showFormatMenu(context)
  if (!format) return
  if (scope.kind === "session") {
    await generateSessionReport(context, format)
  } else {
    await generatePeriodReport(context, scope, format)
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

function parseNumericDays(input: string | undefined): number | undefined {
  const raw = (input ?? "").trim()
  if (!/^\d+$/.test(raw)) return undefined
  const days = Number(raw)
  if (!Number.isFinite(days) || days < 1 || days > 3650) return undefined
  return days
}

async function runUsageCommand(context: Context, input?: string): Promise<void> {
  try {
    setLanguage(loadSettings(context).language)
  } catch { /* ignore */ }

  const raw = (input ?? "").trim()
  if (raw === "settings" || raw === "config") {
    await showSettingsDialog(context)
    return
  }

  // "/usage 0" (or "all") is the full-history total report.
  if (raw === "0" || raw === "all") {
    const format = await showFormatMenu(context)
    if (!format) return
    await generatePeriodReport(context, { kind: "all", label: t("menuAll") }, format)
    return
  }

  const days = parseNumericDays(raw)
  if (days != null) {
    const format = await showFormatMenu(context)
    if (!format) return
    const scope: ReportScope = { kind: "days", label: `${days} days`, days }
    await generatePeriodReport(context, scope, format)
    return
  }

  await showUsageMenu(context)
}

export { parseDaysFilter } from "./formatter.js"

/** Register the V2 keymap layer with the unified /usage slash command (never sends to LLM). */
export function registerCommands(context: Context): void {
  try {
    setV2Client(context.client as any)
  } catch { /* non-fatal */ }

  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "usage-stat.usage",
        title: "Usage Stat",
        description: "Generate local usage reports (current session, 5h/7d/30d, all via /usage 0, or N days) as HTML, text, or JSON",
        group: "Stats",
        palette: true,
        slash: {
          name: "usage",
          arguments: true,
          aliases: ["session-usage", "total-usage"],
        },
        run: (input?: string) => { void runUsageCommand(context, input) },
      },
    ],
  }))
}
