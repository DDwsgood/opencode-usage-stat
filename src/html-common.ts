// html-common.ts - Shared CSS, background animation JS, and utility functions
// for both session-usage and total-usage HTML reports.

import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ErrorStats, OverheadStats, ReportSourceMeta } from "./formatter.js"
import { percentileSorted } from "./formatter.js"

export function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B"
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return String(n)
}

export function fmtCost(n: number): string {
  if (n === 0) return "$0.00"
  if (n < 0.01) return "$" + n.toFixed(6)
  return "$" + n.toFixed(2)
}

export function fmtPercent(n: number): string {
  return (n * 100).toFixed(1) + "%"
}

export function fmtTime(ts: number | null): string {
  if (!ts) return "-"
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function fmtDateTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fmtDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return "-"
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms >= 86400000) {
    const d = Math.floor(ms / 86400000)
    const h = Math.floor((ms % 86400000) / 3600000)
    return `${d}d ${h}h`
  }
  if (ms >= 3600000) {
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    return `${h}h ${m}m`
  }
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}m ${s}s`
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

/** JSON for inline <script>: escapes "<" so embedded strings can never close the tag or inject markup. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c")
}

export function nowString(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

/** Percentile of a sorted numeric array (linear interpolation, shared impl). */
export function percentile(sortedAsc: number[], p: number): number {
  return percentileSorted(sortedAsc, p)
}

/** Middle-truncate (e.g. long directory paths). The tail gets the larger share because it names the project. */
export function middleEllipsis(s: string, max: number): string {
  const chars = Array.from(s)
  if (chars.length <= max) return s
  if (max < 3) return chars.slice(0, Math.max(0, max)).join("")
  const keep = max - 1
  const tail = Math.ceil(keep * 0.6)
  const head = keep - tail
  return chars.slice(0, head).join("") + "\u2026" + chars.slice(chars.length - tail).join("")
}

/** Replace a leading home directory with "~". */
export function shortenHome(path: string, home: string): string {
  if (!home) return path
  const h = home.replace(/[\\/]+$/, "")
  if (!h) return path
  if (path === h) return "~"
  if (path.startsWith(h + "/") || path.startsWith(h + "\\")) return "~" + path.slice(h.length)
  return path
}

/** Last non-empty segment of a / or \ separated path. */
export function pathBasename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : path
}

export type ChangeDirection = "up" | "down" | "flat"
export interface ChangeInfo { direction: ChangeDirection; text: string }

/** Relative change vs. the previous period, e.g. "↑ 12.3%". null when there is no baseline. */
export function relativeChange(current: number, previous: number | null | undefined): ChangeInfo | null {
  if (previous == null || !Number.isFinite(previous) || !Number.isFinite(current)) return null
  if (previous <= 0) return current > 0 ? { direction: "up", text: "\u2191 new" } : { direction: "flat", text: "\u2192 0.0%" }
  const pct = (current - previous) / previous * 100
  const abs = Math.abs(pct)
  if (abs < 0.05) return { direction: "flat", text: "\u2192 0.0%" }
  const num = abs >= 1000 ? Math.round(abs).toString() : abs.toFixed(1)
  return { direction: pct > 0 ? "up" : "down", text: `${pct > 0 ? "\u2191" : "\u2193"} ${num}%` }
}

/** Change of a 0..1 ratio in percentage points, e.g. "↓ 1.2 pp". */
export function pointChange(current: number | null | undefined, previous: number | null | undefined): ChangeInfo | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return null
  const pp = (current - previous) * 100
  const abs = Math.abs(pp)
  if (abs < 0.05) return { direction: "flat", text: "\u2192 0.0 pp" }
  return { direction: pp > 0 ? "up" : "down", text: `${pp > 0 ? "\u2191" : "\u2193"} ${abs.toFixed(1)} pp` }
}

/** "2026-09-01 → 2026-09-30" shortened to "09-01 → 09-30" when both ends share the year. */
export function fmtRangeShort(start: string, end: string): string {
  const ys = /^(\d{4})-(\d{2}-\d{2})/.exec(start)
  const ye = /^(\d{4})-(\d{2}-\d{2})/.exec(end)
  if (ys && ye && ys[1] === ye[1]) return `${ys[2]} \u2192 ${ye[2]}`
  return `${start} \u2192 ${end}`
}

export function sourceLabel(source: ReportSourceMeta | undefined): string {
  if (!source) return "OpenCode V2 API"
  return source.source === "sqlite" ? "SQLite (read-only)" : "OpenCode V2 API"
}

/** Footer fragment: data source and build time. */
export function footerSourceHtml(source: ReportSourceMeta | undefined): string {
  const built = source && Number.isFinite(source.elapsedMs) && source.elapsedMs >= 0
    ? ` &middot; Built in ${source.elapsedMs < 1 ? "<1ms" : fmtDuration(source.elapsedMs)}`
    : ""
  return `Data: ${escapeHtml(sourceLabel(source))}${built}`
}

// ---------------------------------------------------------------------------
// Shared HTML building blocks (panels, bar lists, section nav)
// ---------------------------------------------------------------------------

export type BarTone = "default" | "danger" | "warn" | "good" | "muted" | "accent"

export interface BarItem {
  label: string
  /** Secondary line under the label (plain text). */
  sub?: string
  /** Full text for the hover tooltip (plain text). */
  title?: string
  value: number
  display: string
  meta?: string
  tone?: BarTone
}

/** Horizontal bar list; all text is escaped here. Bars scale to the largest value. */
export function barListHtml(items: BarItem[], ariaLabel: string): string {
  if (items.length === 0) return ""
  const max = Math.max(...items.map(i => i.value), 0)
  const rows = items.map(item => {
    const w = max > 0 && item.value > 0 ? Math.max(1.5, item.value / max * 100) : 0
    const title = item.title ?? item.label
    return `<li class="bar-row">
        <div class="bar-label" title="${escapeHtml(title)}"><span class="bar-name">${escapeHtml(item.label)}</span>${item.sub ? `<span class="bar-sub">${escapeHtml(item.sub)}</span>` : ""}</div>
        <div class="bar-value">${escapeHtml(item.display)}${item.meta ? `<span class="bar-meta">${escapeHtml(item.meta)}</span>` : ""}</div>
        <div class="bar-track" aria-hidden="true"><span class="bar-fill tone-${item.tone ?? "default"}" style="width:${w.toFixed(1)}%"></span></div>
      </li>`
  }).join("")
  return `<ul class="bar-list" aria-label="${escapeHtml(ariaLabel)}">${rows}</ul>`
}

export interface PanelOptions {
  sub?: string
  /** Small tag next to the title, e.g. "Estimate". */
  badge?: string
  badgeTitle?: string
  className?: string
}

/** Card container; `title`/`sub`/`badge` are plain text, `body` is trusted HTML. */
export function panelHtml(title: string, body: string, opts: PanelOptions = {}): string {
  const badge = opts.badge
    ? `<span class="badge"${opts.badgeTitle ? ` title="${escapeHtml(opts.badgeTitle)}"` : ""}>${escapeHtml(opts.badge)}</span>`
    : ""
  return `<div class="panel${opts.className ? " " + opts.className : ""}">
      <div class="panel-head"><div class="panel-title">${escapeHtml(title)}${badge}</div>${opts.sub ? `<div class="panel-sub">${escapeHtml(opts.sub)}</div>` : ""}</div>
      ${body}
    </div>`
}

export interface NavItem { id: string; label: string }

export function sectionNavHtml(items: NavItem[]): string {
  if (items.length < 2) return ""
  const links = items.map(i => `<a href="#${escapeHtml(i.id)}">${escapeHtml(i.label)}</a>`).join("")
  return `<nav class="section-nav" aria-label="Report sections">${links}</nav>`
}

const FINISH_REASON_META: Record<string, { label: string; tone: BarTone; hint?: string }> = {
  "stop": { label: "stop", tone: "good", hint: "Model finished normally" },
  "tool-calls": { label: "tool-calls", tone: "accent", hint: "Turn ended to run tools" },
  "length": { label: "length \u00b7 truncated", tone: "warn", hint: "Output hit the max-token limit and was cut off" },
  "error": { label: "error", tone: "danger", hint: "Request ended with an error" },
  "content-filter": { label: "content-filter", tone: "warn", hint: "Output blocked by the provider's content filter" },
  "unknown": { label: "unknown", tone: "muted" },
  "none": { label: "none", tone: "muted", hint: "No finish reason recorded" },
}

export function finishReasonMeta(reason: string): { label: string; tone: BarTone; hint?: string } {
  return FINISH_REASON_META[reason] ?? { label: reason, tone: "muted" }
}

/** Count of a finish reason, 0 when the breakdown is missing. */
export function finishReasonCount(errors: ErrorStats | undefined, reason: string): number {
  return errors?.finishReasons?.find(r => r.reason === reason)?.count ?? 0
}

export function abortedCountOf(errors: ErrorStats | undefined): number {
  if (!errors) return 0
  if (typeof errors.abortedCount === "number") return errors.abortedCount
  return errors.byType?.find(t => t.type === "aborted")?.count ?? 0
}

/** Error-type distribution; "aborted" is shown on its own line and never as an error bar. Empty when no breakdown. */
export function errorTypesPanelHtml(errors: ErrorStats | undefined): string {
  if (!errors || !Array.isArray(errors.byType)) return ""
  const failedTypes = errors.byType.filter(t => t.type !== "aborted" && t.count > 0)
  const aborted = abortedCountOf(errors)
  if (failedTypes.length === 0 && aborted === 0 && errors.failedCount === 0) return ""
  const failedSum = failedTypes.reduce((s, t) => s + t.count, 0)
  const body = failedTypes.length > 0
    ? barListHtml(failedTypes.slice(0, 10).map(t => ({
        label: t.type,
        value: t.count,
        display: String(t.count),
        meta: failedSum > 0 ? fmtPercent(t.count / failedSum) : undefined,
        tone: "danger" as const,
      })), "Error types")
    : `<div class="panel-empty">${errors.failedCount > 0 ? `${errors.failedCount} failed, type breakdown unavailable` : "No failed requests"}</div>`
  const abortedLine = aborted > 0
    ? `<div class="panel-note"><span class="note-dot" aria-hidden="true"></span>User aborted <strong>${aborted}</strong> <span class="note-faint">&middot; interrupted by the user, not counted as errors</span></div>`
    : ""
  const done = errors.successCount + errors.failedCount
  return panelHtml("Error Types", body + abortedLine, {
    sub: `${errors.failedCount} failed${done > 0 ? ` \u00b7 ${fmtPercent(errors.errorRate)} of ${done}` : ""}`,
  })
}

/** Finish-reason distribution ("length" = output truncated). Empty when no breakdown. */
export function finishReasonsPanelHtml(errors: ErrorStats | undefined): string {
  const reasons = (errors?.finishReasons ?? []).filter(r => r.count > 0)
  if (reasons.length === 0) return ""
  const total = reasons.reduce((s, r) => s + r.count, 0)
  const sorted = [...reasons].sort((a, b) => b.count - a.count)
  const aborted = abortedCountOf(errors)
  const body = barListHtml(sorted.map(r => {
    const meta = finishReasonMeta(r.reason)
    // finish = "error" also covers user aborts, which are not counted as failures elsewhere.
    const label = r.reason === "error" && aborted > 0 ? `error \u00b7 incl. ${aborted} aborted` : meta.label
    return {
      label,
      title: meta.hint ? `${r.reason}: ${meta.hint}` : r.reason,
      value: r.count,
      display: String(r.count),
      meta: fmtPercent(r.count / total),
      tone: meta.tone,
    }
  }), "Finish reasons")
  const truncated = finishReasonCount(errors, "length")
  const note = truncated > 0
    ? `<div class="panel-note warn"><span class="note-dot" aria-hidden="true"></span><strong>${truncated}</strong> response${truncated > 1 ? "s" : ""} hit the output limit <span class="note-faint">&middot; finish = length</span></div>`
    : ""
  return panelHtml("Finish Reasons", body + note, { sub: `${total} completed requests` })
}

/** Title-generation / compaction usage card. Empty when missing or zero. */
export function overheadPanelHtml(overhead: OverheadStats | undefined, opts: { showSessions?: boolean } = {}): string {
  if (!overhead || (overhead.totalTokens <= 0 && overhead.cost <= 0)) return ""
  const stat = (label: string, value: string) =>
    `<div class="stat-item"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`
  const body = `
      <div class="panel-figure">${fmtTokens(overhead.totalTokens)}<span class="panel-figure-sub">tokens &middot; ${fmtCost(overhead.cost)}</span></div>
      <div class="mini-stats">
        ${stat("Input", fmtTokens(overhead.inputTokens))}
        ${stat("Output", fmtTokens(overhead.outputTokens))}
        ${stat("Reasoning", fmtTokens(overhead.reasoningTokens))}
        ${stat("Cache R", fmtTokens(overhead.cacheRead))}
        ${stat("Cache W", fmtTokens(overhead.cacheWrite))}
        ${opts.showSessions ? stat("Sessions", String(overhead.sessions)) : ""}
      </div>
      <div class="panel-note"><span class="note-faint">Title generation, compaction and other usage not attached to assistant messages: session totals minus the sum of assistant messages, floored at 0.</span></div>`
  return panelHtml("Overhead", body, {
    sub: "title / compaction",
    badge: "Derived",
    badgeTitle: "Derived value: computed by subtraction, not reported directly",
  })
}

// ---------------------------------------------------------------------------
// Shared <head> elements: fonts, echarts, CSS
// ---------------------------------------------------------------------------

function embeddedEChartsScript(): string {
  const candidates = [
    join(dirname(fileURLToPath(import.meta.url)), "..", "vendor", "echarts.min.js"),
    join(process.cwd(), "vendor", "echarts.min.js"),
    join(process.cwd(), "dist", "..", "vendor", "echarts.min.js"),
  ]
  for (const path of candidates) {
    if (!existsSync(path)) continue
    const source = readFileSync(path, "utf8").replace(/<\/script/gi, "<\\/script")
    return `<script>${source}</script>`
  }
  return `<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>`
}

export const HTML_HEAD_SHARED = embeddedEChartsScript()

// ---------------------------------------------------------------------------
// Background animation: monochrome canvas particle starfield + gradient orbs
// + a cursor-following spotlight. Pure JS/CSS, no image assets, GPU-cheap:
// all motion is transform-only and pauses when the tab is hidden.
// ---------------------------------------------------------------------------

export const BG_ANIMATION_HTML = `
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
</div>`

export const BG_ANIMATION_CSS = `
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
  @media (prefers-reduced-motion:reduce) { .bg-orb,.bg-noise,.bg-spot,.bg-halo{animation:none!important} .bg-canvas canvas{display:none} }`

export const BG_PARTICLE_JS = `
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
})();`

// ---------------------------------------------------------------------------
// Shared CSS for KPI cards, sections, tables, pagination, charts
// ---------------------------------------------------------------------------

export const SHARED_CSS = `
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
  .chart-box,.model-card,.provider-card,.insight-card,.empty-state,.panel{--mx:-999px;--my:-999px;background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.012) 42%,rgba(0,0,0,.14)),var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:inset 0 1px 0 rgba(255,255,255,.05),var(--shadow-md);position:relative;overflow:hidden}
  .chart-box::before,.model-card::before,.provider-card::before,.insight-card::before,.panel::before{content:'';position:absolute;inset:0;pointer-events:none;z-index:0;background:radial-gradient(360px circle at var(--mx) var(--my),rgba(255,255,255,.075),transparent 70%)}
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

  .section[id],.anchor[id]{scroll-margin-top:64px}
  .kpi-api-row{grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:16px}
  .data-table td.session-title{max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .two-col{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
  .two-col>.section,.two-col>.panel{margin-bottom:0}
  .panel-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));gap:12px}
  .provider-layout{grid-template-columns:minmax(0,2fr) minmax(0,1fr)}
  .provider-share{display:flex;flex-direction:column}
  .provider-share .chart-box{flex:1;height:auto;min-height:300px}

  .section-nav{position:sticky;top:10px;z-index:50;display:flex;gap:2px;width:max-content;max-width:100%;overflow-x:auto;scrollbar-width:none;margin:0 0 22px;padding:4px;background:rgba(17,17,20,.86);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 40px -24px rgba(0,0,0,.9)}
  .section-nav::-webkit-scrollbar{display:none}
  .section-nav a{flex-shrink:0;padding:6px 12px;border-radius:8px;color:var(--text-dim);text-decoration:none;font-size:10px;font-family:var(--font-mono);letter-spacing:.07em;text-transform:uppercase;transition:color .25s,background .25s}
  .section-nav a:hover{color:var(--text);background:rgba(255,255,255,.05)}
  .section-nav a.active{color:#111114;background:#e7e7e4}

  .kpi-delta{display:flex;flex-wrap:wrap;gap:2px 6px;align-items:baseline;margin-top:6px}
  .kpi-sub+.kpi-delta{margin-top:4px}
  .kpi-delta .delta-range{color:var(--text-faint)}
  .delta-good{color:var(--success)} .delta-bad{color:var(--danger)} .delta-neutral{color:var(--text-dim)}
  .kpi-card.kpi-light .delta-good{color:#2c6a4c} .kpi-card.kpi-light .delta-bad{color:#9c2f3a} .kpi-card.kpi-light .delta-neutral{color:#4a4a52} .kpi-card.kpi-light .delta-range{color:#55555d}

  .panel{padding:18px 18px 16px;transition:border-color .4s var(--ease)}
  .panel:hover{border-color:var(--border-light)}
  .panel>*{position:relative;z-index:1}
  .panel-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--border)}
  .panel-title{display:flex;align-items:center;gap:8px;font-size:10px;font-family:var(--font-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--text)}
  .panel-sub{font-size:10px;font-family:var(--font-mono);color:var(--text-faint);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .panel-figure{font-family:var(--font-mono);font-size:30px;line-height:1;letter-spacing:-.05em;color:var(--text);font-variant-numeric:tabular-nums;margin:2px 0 14px;display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px}
  .panel-figure-sub{font-size:11px;letter-spacing:.02em;color:var(--text-dim)}
  .panel-note{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 6px;margin-top:12px;padding-top:10px;border-top:1px dashed rgba(255,255,255,.08);font-size:11px;color:var(--text-dim);line-height:1.45}
  .panel-note strong{color:var(--text);font-weight:600;font-family:var(--font-mono)}
  .panel-note .note-faint{color:var(--text-faint)}
  .panel-note .note-dot{width:6px;height:6px;border-radius:50%;background:var(--missing);align-self:center;flex-shrink:0}
  .panel-note.warn .note-dot{background:var(--tps)}
  .panel-empty{padding:18px 0;text-align:center;color:var(--text-faint);font-family:var(--font-mono);font-size:11px}
  .badge{display:inline-block;padding:2px 7px;border-radius:99px;border:1px solid rgba(208,183,125,.4);color:var(--tps);font-size:8.5px;letter-spacing:.1em;text-transform:uppercase;background:rgba(208,183,125,.07);cursor:help}
  .mini-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:10px 12px}

  .bar-list{list-style:none;display:flex;flex-direction:column;gap:11px}
  .bar-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 14px;align-items:end}
  .bar-label{min-width:0;display:flex;flex-direction:column}
  .bar-name{font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bar-sub{font-size:10px;color:var(--text-faint);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
  .bar-value{font-family:var(--font-mono);font-size:12px;color:var(--text);font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
  .bar-meta{color:var(--text-faint);font-size:10px;margin-left:8px}
  .bar-track{grid-column:1/-1;height:5px;border-radius:99px;background:rgba(255,255,255,.05);overflow:hidden}
  .bar-fill{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#6f6f78,#e7e7e4);transition:width .8s var(--ease)}
  .bar-fill.tone-danger{background:linear-gradient(90deg,#7d4248,#df7b83)}
  .bar-fill.tone-warn{background:linear-gradient(90deg,#76663f,#d0b77d)}
  .bar-fill.tone-good{background:linear-gradient(90deg,#4b6b5b,#8fb7a2)}
  .bar-fill.tone-accent{background:linear-gradient(90deg,#5d6979,#c8d4e3)}
  .bar-fill.tone-muted{background:linear-gradient(90deg,#3d3d45,#77777f)}

  .split-bar{display:flex;height:10px;border-radius:99px;overflow:hidden;background:rgba(255,255,255,.05);margin:6px 0 10px}
  .split-seg{height:100%}
  .split-seg.root{background:linear-gradient(90deg,#bfbfc4,#ededea)} .split-seg.child{background:linear-gradient(90deg,#5d6979,#c8d4e3)}
  .split-legend{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .split-legend .legend-dot.root{background:#e7e7e4} .split-legend .legend-dot.child{background:var(--input)}
  .split-key{display:flex;align-items:center;gap:6px;font-size:10px;font-family:var(--font-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px}
  .split-val{font-family:var(--font-mono);font-size:12px;color:var(--text);font-variant-numeric:tabular-nums}
  .split-val span{color:var(--text-faint);font-size:10px}
  .split-row-label{font-size:9px;font-family:var(--font-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--text-faint);margin-top:8px}

  .range-cell{min-width:140px}
  .range-track{position:relative;height:6px;border-radius:99px;background:rgba(255,255,255,.05)}
  .range-fill{position:absolute;top:0;bottom:0;left:0;border-radius:99px;background:linear-gradient(90deg,rgba(200,212,227,.25),rgba(223,123,131,.55))}
  .range-p50{position:absolute;top:-2px;bottom:-2px;width:2px;margin-left:-1px;border-radius:1px;background:#8fb7a2}
  .data-table td.cell-left,.data-table th.cell-left{text-align:left}
  .data-table th.cell-num{text-align:right}
  .data-table td.cell-num{text-align:right;font-family:var(--font-mono);color:#cdcdd3}
  .path-cell{display:flex;flex-direction:column;min-width:0;max-width:420px}
  .path-cell .path-name{color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .path-cell .path-full{font-family:var(--font-mono);font-size:10px;color:var(--text-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .status-chip{display:inline-block;padding:1px 7px;border-radius:99px;font-size:9.5px;font-family:var(--font-mono);border:1px solid var(--border);color:var(--text-dim);white-space:nowrap}
  .status-chip.tone-danger{color:var(--danger);border-color:rgba(223,123,131,.4)} .status-chip.tone-warn{color:var(--tps);border-color:rgba(208,183,125,.4)} .status-chip.tone-muted{color:var(--text-faint)}

  @media(max-width:1200px){.kpi-hero-row,.kpi-session-row{grid-template-columns:repeat(3,1fr)}.kpi-minor-row{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:1100px){.provider-layout{grid-template-columns:minmax(0,1fr)}.provider-share .chart-box{flex:none;height:300px}}
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
    .two-col{grid-template-columns:minmax(0,1fr);gap:18px}
    .kpi-api-row{grid-template-columns:minmax(0,1fr)}
    .kpi-api-row .kpi-card{min-height:0;padding:14px}
    .kpi-api-row .kpi-label{margin-bottom:8px}
    .section-nav{top:6px;margin-bottom:16px}
    .section-nav a{padding:6px 10px}
    .panel{padding:15px 14px 13px}
    .panel-head{flex-direction:column;align-items:flex-start;gap:3px}
    .panel-sub{text-align:left;white-space:normal}
    .panel-figure{font-size:26px}
    .section-title{flex-wrap:wrap;row-gap:2px}
  }
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}.reveal-item{opacity:1!important;transform:none!important}}
  `

/** Shared JS: number count-up, table sort, paginator, resize handler */
export const SHARED_JS = `
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

  document.querySelectorAll('.kpi-card, .chart-box, .model-card, .provider-card, .insight-card, .panel').forEach(function(el) {
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

  if (!reduced) document.querySelectorAll('.token-seg, .bar-fill').forEach(function(seg) {
    var target = seg.style.width;
    seg.style.width = '0%';
    requestAnimationFrame(function() { requestAnimationFrame(function() { seg.style.width = target; }); });
  });

  initSectionNav();

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

// Highlights the nav link of the section crossing the upper third of the viewport.
function initSectionNav() {
  var nav = document.querySelector('.section-nav');
  if (!nav || !('IntersectionObserver' in window)) return;
  var links = Array.from(nav.querySelectorAll('a[href^="#"]'));
  var byId = {};
  links.forEach(function(a) { byId[a.getAttribute('href').slice(1)] = a; });
  var obs = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (!entry.isIntersecting) return;
      var a = byId[entry.target.id];
      if (!a) return;
      links.forEach(function(l) { l.classList.remove('active'); l.removeAttribute('aria-current'); });
      a.classList.add('active');
      a.setAttribute('aria-current', 'location');
      // Scroll only the nav strip; scrollIntoView would interrupt the page's smooth scroll.
      if (nav.scrollWidth > nav.clientWidth) nav.scrollLeft = a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2;
    });
  }, { rootMargin: '-30% 0px -65% 0px' });
  Object.keys(byId).forEach(function(id) { var el = document.getElementById(id); if (el) obs.observe(el); });
}

window.addEventListener('resize', function() {
  if (window.__charts) Object.values(window.__charts).forEach(function(c) { if (c && c.resize) c.resize(); });
});`
