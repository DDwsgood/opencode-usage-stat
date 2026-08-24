// session-usage-html.ts - Per-session detailed usage HTML report
// Enhanced dashboard with duration analysis, cache trend,
// auto-generated insights, and animated background.

import type { ModelBreakdownItem, MessageRow, SessionTokenData, ApiCostAnalysis, ApiCostModelItem, ErrorStats } from "./formatter.js"
import { isMissingCache, cacheHitRate } from "./formatter.js"
import { estimateApiCost } from "./pricing.js"
import {
  fmtTokens, fmtCost, fmtPercent, fmtTime, fmtDateTime, fmtDuration, escapeHtml, nowString, percentile, jsonForScript,
  HTML_HEAD_SHARED, BG_ANIMATION_HTML, BG_ANIMATION_CSS, BG_PARTICLE_JS, SHARED_CSS, SHARED_JS,
} from "./html-common.js"
import { modelIconImg } from "./model-icons.js"

interface SessionReportData {
  sessionId: string
  sessionTitle: string
  subagentCount: number
  summary: SessionTokenData
  models: ModelBreakdownItem[]
  messages: MessageRow[]
  apiCost: ApiCostAnalysis
  errors: ErrorStats
  generatedAt: string
  // Computed fields
  sessionDurationMs: number
  firstMessageTime: number | null
  lastMessageTime: number | null
  tps: number
  costPerRequest: number
  p50Duration: number
  p90Duration: number
  maxDuration: number
  avgDuration: number
  peakTokens: number
  peakTokensIndex: number
}

function renderKpiCards(data: SessionReportData): string {
  const s = data.summary

  // Global cache hit rate (excluding MISSING models)
  let kpiInputSum = 0, kpiCacheSum = 0
  for (const m of data.models) {
    if (isMissingCache(m.requests, m.cacheRead)) continue
    kpiInputSum += m.inputTokens
    kpiCacheSum += m.cacheRead
  }
  const kpiHitRate = (kpiInputSum + kpiCacheSum) > 0
    ? kpiCacheSum / (kpiInputSum + kpiCacheSum)
    : 0
  const hitRatePct = (kpiInputSum + kpiCacheSum) > 0 ? fmtPercent(kpiHitRate) : '-'
  const isHighCache = kpiHitRate >= 0.85
  const kpiHitColor = kpiHitRate >= 0.85 ? 'var(--cache)' : kpiHitRate >= 0.70 ? 'var(--tps)' : 'var(--danger)'

  const apiCostTotal = data.apiCost.totalApiCost
  const errorRatePct = (data.errors.errorRate * 100).toFixed(1) + '%'
  const errorColor = data.errors.errorRate >= 0.05 ? 'var(--danger)'
    : data.errors.errorRate >= 0.01 ? 'var(--tps)' : 'var(--cache)'

  const avgTokensPerReq = s.requestCount > 0 ? s.totalTokens / s.requestCount : 0
  const tpsStr = data.tps > 0 ? (data.tps >= 100 ? Math.round(data.tps).toString() : data.tps.toFixed(1)) : '-'
  const cprStr = s.requestCount > 0 ? fmtCost(s.totalCost / s.requestCount) : '-'

  return `
    <div class="kpi-row kpi-session-row">
      <div class="kpi-card kpi-light">
        <div class="kpi-label">Total Tokens</div>
        <div class="kpi-value" data-countup="${fmtTokens(s.totalTokens)}">${fmtTokens(s.totalTokens)}</div>
        <div class="kpi-sub">${s.requestCount} requests</div>
      </div>
      <div class="kpi-card${isHighCache ? ' kpi-glow' : ''}">
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
      <div class="kpi-card${apiCostTotal != null && apiCostTotal > s.totalCost ? ' kpi-glow' : ''}">
        <div class="kpi-label">API Equiv. Cost</div>
        <div class="kpi-value" style="color:var(--missing)" data-countup="${apiCostTotal != null ? fmtCost(apiCostTotal) : '-'}">${apiCostTotal != null ? fmtCost(apiCostTotal) : '-'}</div>
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
    </div>`
}

function renderModelCards(data: SessionReportData): string {
  const sorted = [...data.models].sort((a, b) => b.totalTokens - a.totalTokens)

  const cards = sorted.map(m => {
    const isMissing = isMissingCache(m.requests, m.cacheRead)
    const hitRate = cacheHitRate(m.inputTokens, m.cacheRead)
    const hitColor = isMissing ? 'var(--missing)' : hitRate >= 0.85 ? 'var(--cache)' : hitRate >= 0.70 ? 'var(--tps)' : 'var(--danger)'
    const hitDisplay = isMissing ? 'MISSING' : fmtPercent(hitRate)

    const apiItem = data.apiCost.byModel.find(a => a.provider === m.provider && a.model === m.model)
    const apiCostStr = apiItem?.apiEquivCost != null
      ? (apiItem.estimated ? `~${fmtCost(apiItem.apiEquivCost)}` : fmtCost(apiItem.apiEquivCost))
      : '-'

    // Cost per 1M tokens efficiency
    const costPer1M = m.totalTokens > 0 ? (m.totalCost / m.totalTokens) * 1_000_000 : 0
    const costPer1MStr = costPer1M > 0 ? `$${costPer1M.toFixed(4)}` : '-'

    const total = m.totalTokens || 1
    const inputPct = (m.inputTokens / total * 100).toFixed(1)
    const outputPct = (m.outputTokens / total * 100).toFixed(1)
    const cacheReadPct = (m.cacheRead / total * 100).toFixed(1)
    const cacheWritePct = (m.cacheWrite / total * 100).toFixed(1)
    const reasoningPct = (m.reasoningTokens / total * 100).toFixed(1)

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
    </div>`
  }).join("\n")

  return cards
}

function renderMessageTable(data: SessionReportData): string {
  const rows = data.messages.map((msg, i) => {
    const isMissing = isMissingCache(1, msg.cacheRead)
    const hitRate = cacheHitRate(msg.inputTokens, msg.cacheRead)
    const hitColor = isMissing ? 'var(--missing)' : hitRate >= 0.85 ? 'var(--cache)' : hitRate >= 0.70 ? 'var(--tps)' : 'var(--danger)'
    const hitDisplay = isMissing ? 'MISSING' : fmtPercent(hitRate)

    const duration = msg.timeCompleted ? msg.timeCompleted - msg.timeCreated : null
    const durColor = duration != null && duration > data.p90Duration ? 'var(--danger)' : 'var(--text)'

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
    </tr>`
  }).join("\n")

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
  </div>`
}

function renderTrendChartInit(data: SessionReportData): string {
  const labels = data.messages.map((_, i) => `#${i + 1}`)
  const inputTokens = data.messages.map(m => m.inputTokens)
  const outputTokens = data.messages.map(m => m.outputTokens)
  const cacheReadTokens = data.messages.map(m => m.cacheRead)
  const totalTokens = data.messages.map(m => m.totalTokens)
  const costs = data.messages.map(m => m.cost)

  // Moving average for total tokens (window=5)
  const ma5 = totalTokens.map((_, i) => {
    const start = Math.max(0, i - 4)
    const slice = totalTokens.slice(start, i + 1)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })

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
}`
}

function renderDurationChartInit(data: SessionReportData): string {
  const labels = data.messages.map((_, i) => `#${i + 1}`)
  const durations = data.messages.map(m => {
    if (!m.timeCompleted) return 0
    return (m.timeCompleted - m.timeCreated) / 1000 // seconds
  })
  const p50 = data.p50Duration / 1000
  const p90 = data.p90Duration / 1000

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
}`
}

function renderCacheTrendInit(data: SessionReportData): string {
  const labels = data.messages.map((_, i) => `#${i + 1}`)
  const hitRates = data.messages.map(m => {
    if (isMissingCache(1, m.cacheRead)) return null
    return cacheHitRate(m.inputTokens, m.cacheRead) * 100
  })

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
}`
}

function renderApiCostSection(data: SessionReportData): string {
  const apiCost = data.apiCost
  if (!apiCost || apiCost.byModel.length === 0) return ""

  const rows = apiCost.byModel
    .filter(m => m.apiEquivCost !== null || m.reportedCost === 0)
    .sort((a, b) => (b.apiEquivCost ?? 0) - (a.apiEquivCost ?? 0))

  if (rows.length === 0) return ""

  const tableRows = rows.map(m => {
    const apiStr = m.apiEquivCost != null
      ? (m.estimated ? `<span style="color:var(--missing)">~${fmtCost(m.apiEquivCost)}</span>` : fmtCost(m.apiEquivCost))
      : '<span style="color:var(--text-faint)">N/A</span>'
    const estTag = m.estimated ? ` <span style="color:var(--missing);font-size:0.8em">(est.)</span>` : ''
    const pricingSrc = m.pricingProvider ? `<span style="color:var(--text-dim);font-size:0.85em">${escapeHtml(m.pricingProvider)}</span>` : '-'
    return `<tr>
      <td><div class="model-cell">${modelIconImg(m.model, 16)}<span class="model-name-text" title="${escapeHtml(m.model)}">${escapeHtml(m.model)}</span></div></td><td>${escapeHtml(m.provider)}</td><td>${pricingSrc}</td>
      <td data-sort="${m.requests}">${m.requests}</td><td data-sort="${m.inputTokens}">${fmtTokens(m.inputTokens)}</td><td data-sort="${m.outputTokens}">${fmtTokens(m.outputTokens)}</td>
      <td data-sort="${m.reportedCost}">${fmtCost(m.reportedCost)}</td><td data-sort="${m.apiEquivCost ?? -1}" style="font-weight:600">${apiStr}${estTag}</td>
    </tr>`
  }).join("\n")

  const totalApi = apiCost.totalApiCost ?? 0
  const reported = apiCost.reportedCost
  const diff = totalApi - reported
  const diffStr = diff > 0.001
    ? `<span style="color:var(--missing)">+${fmtCost(diff)}</span>`
    : `<span style="color:var(--cache)">${fmtCost(diff)}</span>`

  return `
  <div class="section">
    <div class="section-title">API Equivalent Cost Analysis</div>
    <p style="font-size:12px;color:var(--text-dim);padding:4px 0 8px">
      For providers that don't report cost, API equivalent cost is estimated using official model pricing (models.dev) &times; token usage.
      <span style="color:var(--missing)">~</span> = MISSING model (upstream no cache data) estimated at 94% hit rate.
    </p>
    <div class="kpi-row" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
      <div class="kpi-card kpi-light"><div class="kpi-label">Reported Cost</div><div class="kpi-value" style="color:var(--tps)">${fmtCost(reported)}</div></div>
      <div class="kpi-card"><div class="kpi-label">API Equiv. Total</div><div class="kpi-value" style="color:var(--missing)">${apiCost.totalApiCost != null ? fmtCost(totalApi) : '-'}</div></div>
      <div class="kpi-card"><div class="kpi-label">Difference</div><div class="kpi-value">${diffStr}</div></div>
    </div>
    <table id="api-cost-table" class="data-table">
      <thead><tr><th>Model</th><th>Provider</th><th>Pricing Source</th><th>Req</th><th>Input</th><th>Output</th><th>Reported</th><th>API Equiv.</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>`
}

function renderInsights(data: SessionReportData): string {
  const insights: { icon: string; bg: string; title: string; value: string }[] = []

  // Most expensive request
  if (data.messages.length > 0) {
    let maxCostIdx = 0
    for (let i = 1; i < data.messages.length; i++) {
      if (data.messages[i].cost > data.messages[maxCostIdx].cost) maxCostIdx = i
    }
    const mostExpensive = data.messages[maxCostIdx]
    if (mostExpensive.cost > 0) {
      insights.push({
        icon: '$', bg: 'rgba(208,183,125,0.15)',
        title: 'Most expensive request',
        value: `<span class="accent">${fmtCost(mostExpensive.cost)}</span> on request #${maxCostIdx + 1} (${escapeHtml(mostExpensive.model)})`,
      })
    }
  }

  // Peak tokens window
  if (data.peakTokensIndex >= 0) {
    insights.push({
      icon: '\u26A1', bg: 'rgba(200,212,227,0.15)',
      title: 'Peak activity',
      value: `Request <span class="accent">#${data.peakTokensIndex + 1}</span> with <span class="accent">${fmtTokens(data.peakTokens)}</span> tokens`,
    })
  }

  // Best cache streak
  let bestStreak = 0, streakStart = -1, bestStart = 0
  for (let i = 0; i < data.messages.length; i++) {
    const m = data.messages[i]
    if (!isMissingCache(1, m.cacheRead) && cacheHitRate(m.inputTokens, m.cacheRead) >= 0.85) {
      if (streakStart === -1) streakStart = i
      const len = i - streakStart + 1
      if (len > bestStreak) { bestStreak = len; bestStart = streakStart }
    } else {
      streakStart = -1
    }
  }
  if (bestStreak > 1) {
    insights.push({
      icon: '\u2713', bg: 'rgba(143,183,162,0.15)',
      title: 'Best cache streak',
      value: `<span class="accent">${bestStreak} requests</span> (#${bestStart + 1}-${bestStart + bestStreak}) above 85% hit rate`,
    })
  }

  // Slowest request
  if (data.messages.length > 0) {
    const slowest = data.messages.reduce((max, m, i) => {
      const dur = m.timeCompleted ? m.timeCompleted - m.timeCreated : 0
      return dur > max.dur ? { dur, i, model: m.model } : max
    }, { dur: 0, i: 0, model: data.messages[0]?.model ?? '' })
    if (slowest.dur > 0) {
      insights.push({
        icon: '\u23F1', bg: 'rgba(223,123,131,0.15)',
        title: 'Slowest response',
        value: `<span class="accent">${fmtDuration(slowest.dur)}</span> on request #${slowest.i + 1} (${escapeHtml(slowest.model)})`,
      })
    }
  }

  // Error insight
  if (data.errors.failedCount > 0) {
    insights.push({
      icon: '!', bg: 'rgba(223,123,131,0.15)',
      title: 'Errors detected',
      value: `<span class="accent">${data.errors.failedCount} failed</span> out of ${data.errors.successCount + data.errors.failedCount} requests`,
    })
  }

  if (insights.length === 0) return ""

  const cards = insights.map(ins => `
    <div class="insight-card">
      <div class="insight-icon" style="background:${ins.bg};color:var(--text)">${ins.icon}</div>
      <div class="insight-body">
        <div class="insight-title">${ins.title}</div>
        <div class="insight-value">${ins.value}</div>
      </div>
    </div>`).join("\n")

  return `
  <div class="section">
    <div class="section-title">Smart Insights</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px">
      ${cards}
    </div>
  </div>`
}

export async function buildSessionReportData(
  sessionId: string,
  sessionTitle: string,
  subagentCount: number,
  summary: SessionTokenData,
  models: ModelBreakdownItem[],
  messages: MessageRow[],
  errors: ErrorStats,
): Promise<SessionReportData> {
  // API equivalent cost analysis
  const apiCostByModel: ApiCostModelItem[] = models.map(m => {
    const est = estimateApiCost(
      m.provider, m.model, m.requests,
      m.inputTokens, m.outputTokens, m.reasoningTokens,
      m.cacheRead, m.cacheWrite,
    )
    return {
      provider: m.provider, model: m.model, requests: m.requests,
      inputTokens: m.inputTokens, outputTokens: m.outputTokens,
      reasoningTokens: m.reasoningTokens,
      cacheRead: m.cacheRead, cacheWrite: m.cacheWrite,
      reportedCost: m.totalCost, apiEquivCost: est.cost,
      estimated: est.estimated, pricingProvider: est.pricingProvider,
    }
  })
  const apiTotal = apiCostByModel.reduce((sum, m) => sum + (m.apiEquivCost ?? 0), 0)
  const apiCost: ApiCostAnalysis = {
    totalApiCost: apiTotal > 0 ? apiTotal : null,
    reportedCost: summary.totalCost,
    byModel: apiCostByModel,
  }

  // Compute session metrics
  const firstMsg = messages.length > 0 ? messages[0].timeCreated : null
  const lastMsg = messages.length > 0 ? messages[messages.length - 1].timeCreated : null
  const sessionDurationMs = firstMsg && lastMsg ? lastMsg - firstMsg : 0
  const durationSec = sessionDurationMs / 1000
  const tps = durationSec > 0 ? summary.totalTokens / durationSec : 0
  const costPerRequest = summary.requestCount > 0 ? summary.totalCost / summary.requestCount : 0

  // Duration statistics
  const durations = messages
    .map(m => m.timeCompleted ? m.timeCompleted - m.timeCreated : null)
    .filter((d): d is number => d !== null && d > 0)
    .sort((a, b) => a - b)
  const p50Duration = percentile(durations, 0.5)
  const p90Duration = percentile(durations, 0.9)
  const maxDuration = durations.length > 0 ? durations[durations.length - 1] : 0
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0

  // Peak tokens (max tokens in a single request)
  let peakTokens = 0, peakTokensIndex = -1
  messages.forEach((m, i) => {
    if (m.totalTokens > peakTokens) { peakTokens = m.totalTokens; peakTokensIndex = i }
  })

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
    peakTokensIndex,
  }
}

export function generateSessionUsageHtml(data: SessionReportData): string {
  const kpiStr = renderKpiCards(data)
  const modelCardsStr = renderModelCards(data)
  const messageTableStr = renderMessageTable(data)
  const apiCostStr = renderApiCostSection(data)
  const insightsStr = renderInsights(data)
  const trendJs = data.messages.length > 0 ? renderTrendChartInit(data) : ""
  const durationJs = data.messages.length > 0 ? renderDurationChartInit(data) : ""
  const cacheJs = data.messages.length > 0 ? renderCacheTrendInit(data) : ""
  const hasMessages = data.messages.length > 0

  const showDates = data.sessionDurationMs >= 86400000
  const firstTimeStr = data.firstMessageTime ? (showDates ? fmtDateTime(data.firstMessageTime) : fmtTime(data.firstMessageTime)) : '-'
  const lastTimeStr = data.lastMessageTime ? (showDates ? fmtDateTime(data.lastMessageTime) : fmtTime(data.lastMessageTime)) : '-'
  const durationStr = fmtDuration(data.sessionDurationMs)

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
      <div class="session-info">Session: ${escapeHtml(data.sessionId)} &middot; ${escapeHtml(data.sessionTitle)}${data.subagentCount > 0 ? ` &middot; <span style="color:var(--input)">+${data.subagentCount} subagent${data.subagentCount > 1 ? 's' : ''}</span>` : ''}</div>
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
  </div>` : ''}

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
  ${hasMessages ? 'initTrendChart(); initDurationChart(); initCacheTrendChart();' : ''}
  makeSortable('messages-table');
  initPaginator('messages-table', 20);
  initPaginator('api-cost-table', 15);
});
</script>
</body>
</html>`
}
