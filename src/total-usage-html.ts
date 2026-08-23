// total-usage-html.ts - Cumulative usage HTML report
// Enhanced dashboard with model chart view toggle, provider donut chart,
// hourly activity heatmap, cost trend, and animated background.

import type { CombinedReportData, ModelBreakdownItem } from "./formatter.js"
import { isMissingCache, cacheHitRate } from "./formatter.js"
import {
  fmtTokens, fmtCost, fmtPercent, escapeHtml, jsonForScript,
  HTML_HEAD_SHARED, BG_ANIMATION_HTML, BG_ANIMATION_CSS, BG_PARTICLE_JS, SHARED_CSS, SHARED_JS,
} from "./html-common.js"
import { modelIconImg, getModelIconDataUri } from "./model-icons.js"

function sortModelsByUsage(models: ModelBreakdownItem[]): ModelBreakdownItem[] {
  return [...models].filter(m => m.totalTokens > 0).sort((a, b) => b.totalTokens - a.totalTokens)
}

function renderMeta(data: CombinedReportData): string {
  const m = data.meta
  return `Usage Stat Report &middot; ${m.dateRange.start} \u2192 ${m.dateRange.end} &middot; generated ${m.generatedAt}`
}

function avgDailyUsageColor(tokens: number): string {
  const light = [202, 184, 232]
  const deep = [91, 45, 142]
  if (tokens <= 50_000_000) {
    const alpha = Math.max(0, tokens / 50_000_000)
    return `rgba(${light.join(",")},${alpha.toFixed(3)})`
  }
  const t = Math.min(1, (tokens - 50_000_000) / 150_000_000)
  const rgb = light.map((value, i) => Math.round(value + (deep[i] - value) * t))
  return `rgb(${rgb.join(",")})`
}

function renderKpiCards(data: CombinedReportData): string {
  const s = data.summary
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

  const apiCostTotal = data.apiCost?.totalApiCost ?? null

  const errors = data.errors
  const errorRatePct = errors ? (errors.errorRate * 100).toFixed(1) + '%' : '-'
  const errorColor = errors && errors.errorRate >= 0.05 ? 'var(--danger)'
    : errors && errors.errorRate > 0 ? 'var(--tps)' : 'var(--cache)'

  // Derived metrics
  const dailyCount = data.daily.length
  const avgDailyTokens = dailyCount > 0 ? s.totalTokens / dailyCount : 0
  const avgDailyColor = avgDailyUsageColor(avgDailyTokens)
  const totalSessions = data.totalSessions ?? data.sessions.length
  const costPerSession = totalSessions > 0 ? s.totalCost / totalSessions : 0

  return `
    <div class="kpi-row cols-9" style="grid-template-columns:repeat(9,1fr)">
      <div class="kpi-card">
        <div class="kpi-label">Total Tokens</div>
        <div class="kpi-value" data-countup="${fmtTokens(s.totalTokens)}">${fmtTokens(s.totalTokens)}</div>
      </div>
      <div class="kpi-card${isHighCache ? ' kpi-glow' : ''}">
        <div class="kpi-label">Cache Hit Rate</div>
        <div class="kpi-value" style="color:${kpiHitColor}" data-countup="${hitRatePct}">${hitRatePct}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Requests</div>
        <div class="kpi-value" data-countup="${s.requestCount}">${s.requestCount}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Sessions</div>
        <div class="kpi-value" data-countup="${totalSessions}">${totalSessions}</div>
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
      <div class="kpi-card${apiCostTotal != null && apiCostTotal > s.totalCost ? ' kpi-glow' : ''}">
        <div class="kpi-label">API Equiv. Cost</div>
        <div class="kpi-value" style="color:var(--missing)" data-countup="${apiCostTotal != null ? fmtCost(apiCostTotal) : '-'}">${apiCostTotal != null ? fmtCost(apiCostTotal) : '-'}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Models Used</div>
        <div class="kpi-value" data-countup="${data.models.length}">${data.models.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Error Rate</div>
        <div class="kpi-value" style="color:${errorColor}" data-countup="${errorRatePct}">${errorRatePct}</div>
        <div class="kpi-sub">${errors ? errors.failedCount + ' failed' : ''}</div>
      </div>
    </div>`
}

function renderModelChartInit(data: CombinedReportData): string {
  // Top 15 models by total tokens + "Others" aggregate, displayed as horizontal
  // bars (sorted desc, biggest on top) with model icons in y-axis labels.
  const allSorted = sortModelsByUsage(data.models)
  const top = allSorted.slice(0, 15)
  const rest = allSorted.slice(15)
  const restTotalTokens = rest.reduce((s, m) => s + m.totalTokens, 0)
  const restTotalCost = rest.reduce((s, m) => s + m.totalCost, 0)
  const restTotalReq = rest.reduce((s, m) => s + m.requests, 0)

  const displayModels = [...top]
  if (rest.length > 0) {
    displayModels.push({
      model: `Others (${rest.length})`, provider: "", requests: restTotalReq, sessions: 0,
      inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheRead: 0, cacheWrite: 0,
      totalTokens: restTotalTokens, totalCost: restTotalCost,
    } as ModelBreakdownItem)
  }

  // ECharts renders bottom-up for category axis, so reverse for biggest-on-top
  const rev = [...displayModels].reverse()
  const names = rev.map(m => m.model)
  const inputData = rev.map(m => m.inputTokens)
  const outputData = rev.map(m => m.outputTokens)
  const cacheData = rev.map(m => m.cacheRead)
  const reasoningData = rev.map(m => m.reasoningTokens)
  const costData = rev.map(m => m.totalCost)
  const apiCostData = rev.map(m => {
    if (m.model.startsWith("Others (")) {
      return rest.reduce((sum, item) => {
        const api = data.apiCost?.byModel.find(a => a.provider === item.provider && a.model === item.model)
        return sum + (api?.apiEquivCost ?? 0)
      }, 0)
    }
    const api = data.apiCost?.byModel.find(a => a.provider === m.provider && a.model === m.model)
    return api?.apiEquivCost ?? 0
  })
  const requestData = rev.map(m => m.requests)

  // Build icon data URI map + ECharts rich-text config (one icon token per index)
  const iconUris = rev.map(m => getModelIconDataUri(m.model))
  const richEntries = iconUris.map((uri, i) =>
    `i${i}:{backgroundColor:{image:${jsonForScript(uri)}},width:14,height:14,align:'center',verticalAlign:'middle'}`
  ).join(",")

  return `var modelNames = ${jsonForScript(names)};
var modelInput = ${jsonForScript(inputData)};
var modelOutput = ${jsonForScript(outputData)};
var modelCache = ${jsonForScript(cacheData)};
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
};`
}

function providerBorderColor(provider: string): string {
  const shades = ["#f2f2ef", "#d0d0cd", "#ababaf", "#85858d", "#66666f"]
  let hash = 0
  for (let i = 0; i < provider.length; i++) hash = ((hash << 5) - hash + provider.charCodeAt(i)) | 0
  return shades[Math.abs(hash) % shades.length]
}

function renderProviderDonutInit(data: CombinedReportData): string {
  const sorted = [...data.providers].sort((a, b) => b.totalCost - a.totalCost)
  const top = sorted.slice(0, 8)
  const restCost = sorted.slice(8).reduce((s, p) => s + p.totalCost, 0)
  const items = top.map(p => ({ name: p.provider, value: p.totalCost }))
  if (restCost > 0) items.push({ name: 'Other', value: restCost })
  const colors = ['#FFB800', '#00D1FF', '#00F593', '#B545FF', '#FF8C00', '#4FC3F7', '#FF6B6B', '#B478FF', '#555568']

  return `var provDonutData = ${jsonForScript(items)};
var provDonutColors = ${jsonForScript(colors)};
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
}`
}

function renderApiCostSection(data: CombinedReportData): string {
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
    const totalTok = m.inputTokens + m.outputTokens + m.reasoningTokens + m.cacheRead + m.cacheWrite
    const costPer1M = totalTok > 0 && m.apiEquivCost != null ? `$${((m.apiEquivCost / totalTok) * 1000000).toFixed(4)}` : '-'
    return `<tr>
      <td><div class="model-cell">${modelIconImg(m.model, 16)}<span class="model-name-text" title="${escapeHtml(m.model)}">${escapeHtml(m.model)}</span></div></td><td>${escapeHtml(m.provider)}</td><td>${pricingSrc}</td>
      <td>${m.requests}</td><td>${fmtTokens(m.inputTokens)}</td><td>${fmtTokens(m.outputTokens)}</td>
      <td>${fmtCost(m.reportedCost)}</td><td style="font-weight:600">${apiStr}${estTag}</td><td>${costPer1M}</td>
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
      <span style="color:var(--missing)">~</span> = MISSING model estimated at 94% hit rate.
    </p>
    <div class="kpi-row" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
      <div class="kpi-card"><div class="kpi-label">Reported Cost</div><div class="kpi-value" style="color:var(--tps)">${fmtCost(reported)}</div></div>
      <div class="kpi-card"><div class="kpi-label">API Equiv. Total</div><div class="kpi-value" style="color:var(--missing)">${apiCost.totalApiCost != null ? fmtCost(totalApi) : '-'}</div></div>
      <div class="kpi-card"><div class="kpi-label">Difference</div><div class="kpi-value">${diffStr}</div></div>
    </div>
    <table id="api-cost-table" class="data-table">
      <thead><tr><th>Model</th><th>Provider</th><th>Pricing Source</th><th>Req</th><th>Input</th><th>Output</th><th>Reported</th><th>API Equiv.</th><th>Cost/1M</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>`
}

function renderProviderCards(data: CombinedReportData): string {
  const sorted = [...data.providers].sort((a, b) => b.totalTokens - a.totalTokens)
  const top = sorted.slice(0, 12)
  const remaining = sorted.length - 12
  const totalTokens = sorted.reduce((s, p) => s + p.totalTokens, 0)

  const cards = top.map(p => {
    const modelCount = data.models.filter(m => m.provider === p.provider).length
    const sharePct = totalTokens > 0 ? (p.totalTokens / totalTokens * 100).toFixed(1) : '0'
    return `
    <div class="provider-card" style="border-color:${providerBorderColor(p.provider)}">
      <div class="provider-name">${escapeHtml(p.provider)}</div>
      <div class="provider-stat"><span class="stat-label">Tokens</span><span>${fmtTokens(p.totalTokens)} <span style="color:var(--text-faint)">(${sharePct}%)</span></span></div>
      <div class="provider-stat"><span class="stat-label">Cost</span><span>${fmtCost(p.totalCost)}</span></div>
      <div class="provider-stat"><span class="stat-label">Requests</span><span>${p.requests}</span></div>
      <div class="provider-stat"><span class="stat-label">Sessions</span><span>${p.sessions}</span></div>
      <div class="provider-stat"><span class="stat-label">Models</span><span>${modelCount}</span></div>
      <div style="height:3px;border-radius:2px;background:var(--border);margin-top:8px;overflow:hidden">
        <div style="height:100%;width:${sharePct}%;background:${providerBorderColor(p.provider)};border-radius:2px"></div>
      </div>
    </div>`
  }).join("\n")

  const moreHint = remaining > 0
    ? `<div class="provider-more">+ ${remaining} more provider${remaining > 1 ? 's' : ''} not shown</div>`
    : ''

  return cards + moreHint
}

function renderModelAnalyticsSection(data: CombinedReportData): string {
  const usageRows = sortModelsByUsage(data.models).map(m => {
    const isMissing = isMissingCache(m.requests, m.cacheRead)
    const hitRate = cacheHitRate(m.inputTokens, m.cacheRead)
    const hitColor = isMissing ? 'var(--missing)' : hitRate >= 0.85 ? 'var(--cache)' : hitRate >= 0.70 ? 'var(--tps)' : 'var(--danger)'
    const hitDisplay = isMissing ? 'MISSING' : fmtPercent(hitRate)
    const apiItem = data.apiCost?.byModel.find(a => a.provider === m.provider && a.model === m.model)
    const apiCostStr = apiItem?.apiEquivCost != null
      ? (apiItem.estimated ? `<span style="color:var(--missing)">~${fmtCost(apiItem.apiEquivCost)}</span>` : fmtCost(apiItem.apiEquivCost))
      : '-'
    const costPer1M = m.totalTokens > 0 && m.totalCost > 0 ? `$${((m.totalCost / m.totalTokens) * 1000000).toFixed(4)}` : '-'
    return `<tr>
      <td><div class="model-cell">${modelIconImg(m.model, 16)}<span class="model-name-text" title="${escapeHtml(m.model)}">${escapeHtml(m.model)}</span></div></td>
      <td>${escapeHtml(m.provider)}</td>
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
    </tr>`
  }).join("\n")

  const errors = data.errors
  const hasErrors = !!(errors && errors.failedCount > 0)

  let errorTabBtn = ''
  let errorTabContent = ''
  if (hasErrors) {
    const errorRatePct = (errors!.errorRate * 100).toFixed(2) + '%'
    const rateColor = errors!.errorRate >= 0.05 ? 'var(--danger)' : 'var(--tps)'
    const cellColor = errors!.errorRate >= 0.05 ? 'var(--danger)' : 'var(--tps)'
    const errorRows = errors!.byModel
      .filter(m => m.failed > 0)
      .map(m => {
        const modelRate = m.total > 0 ? (m.failed / m.total * 100).toFixed(1) + '%' : '-'
        return `<tr>
          <td>${escapeHtml(m.provider)}</td>
          <td><div class="model-cell">${modelIconImg(m.model, 16)}<span class="model-name-text" title="${escapeHtml(m.model)}">${escapeHtml(m.model)}</span></div></td>
          <td>${m.total}</td>
          <td style="color:var(--danger)">${m.failed}</td>
          <td style="color:var(--tps)">${m.total - m.failed}</td>
          <td style="color:${cellColor}">${modelRate}</td>
        </tr>`
      }).join('\n')

    errorTabBtn = `
      <button class="tab-btn" data-mtab="errors" onclick="switchModelTab('errors')">
        Failed Requests <span style="color:var(--danger);margin-left:4px;font-size:0.85em">(${errors!.failedCount})</span>
      </button>`

    errorTabContent = `
    <div id="model-tab-errors" class="tab-content">
      <p style="font-size:12px;color:${rateColor};padding:8px 0 6px">
        Overall error rate: <strong>${errorRatePct}</strong> &mdash;
        ${errors!.failedCount} failed / ${errors!.successCount + errors!.failedCount} total
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
    </div>`
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
  </div>`
}

function renderSessionTable(data: CombinedReportData): string {
  const rows = data.sessions.map(s => {
    return `<tr>
      <td>${escapeHtml(s.day)}</td>
      <td>${escapeHtml(s.provider)}</td>
      <td><div class="model-cell">${modelIconImg(s.model, 16)}<span class="model-name-text" title="${escapeHtml(s.model)}">${escapeHtml(s.model)}</span></div></td>
      <td>${s.requests}</td>
      <td>${fmtTokens(s.totalTokens)}</td>
      <td>${fmtTokens(s.inputTokens)}</td>
      <td>${fmtTokens(s.outputTokens)}</td>
      <td>${fmtTokens(s.cacheRead)}</td>
      <td>${fmtCost(s.totalCost)}</td>
      <td>${escapeHtml(s.title)}</td>
    </tr>`
  }).join("\n")

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
  </div>`
}

function renderDailyTrendInit(data: CombinedReportData): string {
  const days = data.daily.slice().reverse().map(d => d.day)
  const tokens = data.daily.slice().reverse().map(d => d.totalTokens)
  const costs = data.daily.slice().reverse().map(d => d.totalCost)
  const requests = data.daily.slice().reverse().map(d => d.requests)

  // 7-day moving average for tokens
  const ma7 = tokens.map((_, i) => {
    const start = Math.max(0, i - 6)
    const slice = tokens.slice(start, i + 1)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })

  // Cumulative cost
  let cumCost = 0
  const cumCosts = costs.map(c => { cumCost += c; return cumCost })

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
}`
}

function renderHeatmapInit(data: CombinedReportData): string {
  const days = data.daily.slice().reverse()
  const heatData = days.map(d => [d.day, d.totalTokens])
  const minDate = days.length > 0 ? days[0].day : ''
  const maxDate = days.length > 0 ? days[days.length - 1].day : ''

  return `
var heatData = ${jsonForScript(heatData)};
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
}`
}

function renderHourlyHeatmapInit(data: CombinedReportData): string {
  const heatmap = data.hourlyHeatmap ?? []
  // dow: 0=Sunday..6=Saturday, hour: 0-23
  // Build data as [hour, dow, raw tokens] so the visual thresholds map
  // precisely to 25M and 100M rather than to logarithmic values.
  const heatData: (number | string)[][] = []
  let maxVal = 0
  for (const h of heatmap) {
    heatData.push([h.hour, h.dow, h.totalTokens])
    if (h.totalTokens > maxVal) maxVal = h.totalTokens
  }

  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const hours: number[] = []
  for (let i = 0; i < 24; i++) hours.push(i)

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
    xAxis: { type: 'category', data: hourLabels, name: 'Hour', nameTextStyle: { color: '#8888A0' }, axisLabel: { color: '#8888A0', fontSize: 10 }, axisLine: { lineStyle: { color: '#232330' } }, splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,0.005)', 'rgba(255,255,255,0)'] } } },
    yAxis: { type: 'category', data: dowLabels, axisLabel: { color: '#8888A0', fontSize: 10 }, axisLine: { lineStyle: { color: '#232330' } } },
    visualMap: { min: 0, max: 100000000, calculable: true, orient: 'horizontal', right: 20, top: 8, itemWidth: 10, itemHeight: 150,
      formatter: function(v) { return fmt(v); }, textStyle: { color: '#b9a5d8', fontSize: 10 },
      inRange: { color: ['rgba(202,184,232,0)', 'rgba(202,184,232,1)', '#ad87d6', '#8454b7', '#5b2d8e'] } },
    series: [{ type: 'heatmap', data: hourlyData, label: { show: false }, itemStyle: { borderColor: '#111116', borderWidth: 1 }, emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,245,147,0.5)' } } }]
  };

  // Build raw lookup for tooltip
  var hourlyDataRaw = {};
  ${heatmap.map(h => `if(!hourlyDataRaw[${h.dow}])hourlyDataRaw[${h.dow}]={};hourlyDataRaw[${h.dow}][${h.hour}]={requests:${h.requests},tokens:${h.totalTokens}};`).join('')}

  chart.setOption(option);
  chart.resize();
}`
}

function renderCostTrendInit(data: CombinedReportData): string {
  const days = data.daily.slice().reverse().map(d => d.day)
  const costs = data.daily.slice().reverse().map(d => d.totalCost)
  let cumCost = 0
  const cumCosts = costs.map(c => { cumCost += c; return cumCost })

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
}`
}

export function generateTotalUsageHtml(data: CombinedReportData): string {
  const metaStr = renderMeta(data)
  const kpiStr = renderKpiCards(data)
  const modelChartVisible = data.models.filter(m => m.totalTokens > 0).length > 0
  const modelChartJs = modelChartVisible ? renderModelChartInit(data) : ""
  const providerStr = renderProviderCards(data)
  const providerDonutJs = data.providers.length > 0 ? renderProviderDonutInit(data) : ""
  const apiCostStr = renderApiCostSection(data)
  const modelAnalyticsStr = renderModelAnalyticsSection(data)
  const sessionTableStr = renderSessionTable(data)
  const dailyChartJs = renderDailyTrendInit(data)
  const heatmapJs = renderHeatmapInit(data)
  const hourlyHeatmapJs = (data.hourlyHeatmap ?? []).length > 0 ? renderHourlyHeatmapInit(data) : ""
  const costTrendJs = data.daily.length > 0 ? renderCostTrendInit(data) : ""
  const jsonData = jsonForScript(data)

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
      ${hourlyHeatmapJs ? '<button class="tab-btn" data-tab="hourly" onclick="switchTab(\'hourly\')">Activity Hours</button>' : ''}
      ${costTrendJs ? '<button class="tab-btn" data-tab="cost" onclick="switchTab(\'cost\')">Cost Trend</button>' : ''}
    </div>
    <div id="tab-daily" class="tab-content active">
      <div class="chart-box" id="daily-chart"></div>
    </div>
    <div id="tab-heatmap" class="tab-content">
      <div class="chart-box" id="heatmap-chart"></div>
    </div>
    ${hourlyHeatmapJs ? `<div id="tab-hourly" class="tab-content"><div class="chart-box" id="hourly-heatmap" style="height:300px"></div></div>` : ''}
    ${costTrendJs ? `<div id="tab-cost" class="tab-content"><div class="chart-box" id="cost-trend-chart"></div></div>` : ''}
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
  ${modelChartVisible ? 'initModelChart();' : ''}
  ${data.providers.length > 0 ? 'initProviderDonut();' : ''}
  initDailyChart();
  initHeatmapChart();
  ${hourlyHeatmapJs ? 'initHourlyHeatmap();' : ''}
  ${costTrendJs ? 'initCostTrend();' : ''}
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
</html>`
}
