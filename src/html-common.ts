// html-common.ts - Shared CSS, background animation JS, and utility functions
// for both session-usage and total-usage HTML reports.

import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

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
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export function nowString(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

/** Percentile of a sorted numeric array */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  const idx = Math.min(Math.floor(sortedAsc.length * p), sortedAsc.length - 1)
  return sortedAsc[idx]
}

// ---------------------------------------------------------------------------
// Shared <head> elements: fonts, echarts, CSS
// ---------------------------------------------------------------------------

function embeddedEChartsScript(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(moduleDir, "..", "vendor", "echarts.min.js"),
    join(process.cwd(), "vendor", "echarts.min.js"),
    "C:/Users/34177/AIGC/opencode-local-plugins/opencode-usage-stat/vendor/echarts.min.js",
  ]
  for (const path of candidates) {
    if (!existsSync(path)) continue
    const source = readFileSync(path, "utf8").replace(/<\/script/gi, "<\\/script")
    return `<script>${source}</script>`
  }
  return `<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>`
}

export const HTML_HEAD_SHARED = embeddedEChartsScript()

function embeddedBackgroundTexture(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(moduleDir, "..", "assets", "bg-texture.jpg"),
    join(process.cwd(), "assets", "bg-texture.jpg"),
    "C:/Users/34177/AIGC/opencode-local-plugins/opencode-usage-stat/assets/bg-texture.jpg",
  ]
  for (const path of candidates) {
    if (existsSync(path)) {
      const image = readFileSync(path)
      const mime = image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png" : "image/jpeg"
      return `data:${mime};base64,` + image.toString("base64")
    }
  }
  return ""
}

const BACKGROUND_TEXTURE_URI = embeddedBackgroundTexture()

// ---------------------------------------------------------------------------
// Background animation: canvas particle starfield + gradient orbs + noise overlay
// Inspired by the Kimi intro starfield/noise aesthetic, adapted for data dashboards.
// ---------------------------------------------------------------------------

export const BG_ANIMATION_HTML = `
<div class="scroll-progress" aria-hidden="true"><span id="scroll-progress-bar"></span></div>
<div class="bg-canvas" aria-hidden="true">
  <div class="bg-texture" style="background-image:url('${BACKGROUND_TEXTURE_URI}')"></div>
  <div class="bg-orb bg-orb-1"></div>
  <div class="bg-orb bg-orb-2"></div>
  <div class="bg-orb bg-orb-3"></div>
  <div class="bg-grid"></div>
  <div class="bg-noise"></div>
</div>`

export const BG_ANIMATION_CSS = `
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
  @media (prefers-reduced-motion:reduce) { .bg-orb,.bg-noise,.bg-texture{animation:none!important} .bg-canvas canvas{display:none} }`

export const BG_PARTICLE_JS = `
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
});`
