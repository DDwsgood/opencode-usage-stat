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

// Tiny inline SVG sparkline for hero KPI cards.
function renderSparkline(values: number[], color: string): string {
  if (values.length < 2) return ""
  const w = 120, h = 26
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = Math.max(max - min, 1e-9)
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`)
    .join(" ")
  return `<svg class="kpi-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`
}

// Monochrome "heat": higher daily usage reads as brighter white.
function avgDailyUsageColor(tokens: number): string {
  if (tokens <= 0) return "rgba(242,242,239,0.2)"
  if (tokens <= 50_000_000) {
    const alpha = 0.25 + 0.5 * (tokens / 50_000_000)
    return `rgba(242,242,239,${alpha.toFixed(3)})`
  }
  const t = Math.min(1, (tokens - 50_000_000) / 150_000_000)
  const alpha = 0.75 + 0.25 * t
  return `rgba(255,255,255,${alpha.toFixed(3)})`
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
    : errors && errors.errorRate >= 0.01 ? 'var(--tps)' : 'var(--cache)'

  // Derived metrics
  const dailyCount = data.daily.length
  const avgDailyTokens = dailyCount > 0 ? s.totalTokens / dailyCount : 0
  const avgDailyColor = avgDailyUsageColor(avgDailyTokens)
  const totalSessions = data.totalSessions ?? data.sessions.length
  const costPerSession = totalSessions > 0 ? s.totalCost / totalSessions : 0

  // daily is newest-first; sparklines read left(oldest) -> right(newest)
  const dailyTokensAsc = [...data.daily].reverse().map(d => d.totalTokens)
  const dailyCostsAsc = [...data.daily].reverse().map(d => d.totalCost)

  return `
    <div class="kpi-row kpi-hero-row">
      <div class="kpi-card kpi-light">
        <div class="kpi-label">Total Tokens</div>
        <div class="kpi-value" data-countup="${fmtTokens(s.totalTokens)}">${fmtTokens(s.totalTokens)}</div>
        ${renderSparkline(dailyTokensAsc, "#3f4a5c")}
      </div>
      <div class="kpi-card${isHighCache ? ' kpi-glow' : ''}">
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
        <div class="kpi-sub">${errors ? errors.failedCount + ' failed' : ''}</div>
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
      <div class="kpi-card kpi-minor${apiCostTotal != null && apiCostTotal > s.totalCost ? ' kpi-glow' : ''}">
        <div class="kpi-label">API Equiv. Cost</div>
        <div class="kpi-value" style="color:var(--missing)" data-countup="${apiCostTotal != null ? fmtCost(apiCostTotal) : '-'}">${apiCostTotal != null ? fmtCost(apiCostTotal) : '-'}</div>
      </div>
      <div class="kpi-card kpi-minor">
        <div class="kpi-label">Models Used</div>
        <div class="kpi-value" data-countup="${data.models.length}">${data.models.length}</div>
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
    // Others keeps its real cacheWrite so the stacked bar always sums to
    // totalTokens; the other segments intentionally stay 0 as before.
    displayModels.push({
      model: `Others (${rest.length})`, provider: "", requests: restTotalReq, sessions: 0,
      inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
      cacheRead: 0, cacheWrite: rest.reduce((s, m) => s + m.cacheWrite, 0),
      totalTokens: restTotalTokens, totalCost: restTotalCost,
    } as ModelBreakdownItem)
  }

  // ECharts renders bottom-up for category axis, so reverse for biggest-on-top
  const rev = [...displayModels].reverse()
  const names = rev.map(m => m.model)
  const inputData = rev.map(m => m.inputTokens)
  const outputData = rev.map(m => m.outputTokens)
  const cacheData = rev.map(m => m.cacheRead)
  const cacheWriteData = rev.map(m => m.cacheWrite)
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
};`
}

function providerBorderColor(provider: string): string {
  const shades = ["#f2f2ef", "#d0d0cd", "#ababaf", "#85858d", "#66666f"]
  let hash = 0
  for (let i = 0; i < provider.length; i++) hash = ((hash << 5) - hash + provider.charCodeAt(i)) | 0
  return shades[Math.abs(hash) % shades.length]
}

function renderProviderDonutInit(data: CombinedReportData): string {
  // Cost view only includes providers that actually reported cost, so a
  // period of mostly-zero-cost providers no longer collapses into a
  // single-color ring with a misleading legend.
  const byCost = [...data.providers].filter(p => p.totalCost > 0).sort((a, b) => b.totalCost - a.totalCost)
  const byTokens = [...data.providers].filter(p => p.totalTokens > 0).sort((a, b) => b.totalTokens - a.totalTokens)

  const buildItems = (rows: typeof byCost, pick: (p: typeof rows[number]) => number) => {
    const top = rows.slice(0, 8).map(p => ({ name: p.provider, value: pick(p) }))
    const rest = rows.slice(8).reduce((s, p) => s + pick(p), 0)
    if (rest > 0) top.push({ name: 'Other', value: rest })
    return top
  }
  const costItems = buildItems(byCost, p => p.totalCost)
  const tokenItems = buildItems(byTokens, p => p.totalTokens)
  const costTotal = byCost.reduce((s, p) => s + p.totalCost, 0)
  const tokenTotal = byTokens.reduce((s, p) => s + p.totalTokens, 0)

  return `var provCostData = ${jsonForScript(costItems)};
var provTokenData = ${jsonForScript(tokenItems)};
var provCostTotal = ${jsonForScript(fmtCost(costTotal))};
var provTokenTotal = ${jsonForScript(fmtTokens(tokenTotal))};
var provView = ${jsonForScript(costItems.length > 0 ? 'cost' : 'tokens')};
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
};`
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
    const costPer1MRaw = totalTok > 0 && m.apiEquivCost != null ? (m.apiEquivCost / totalTok) * 1_000_000 : null
    const costPer1M = costPer1MRaw != null ? `$${costPer1MRaw.toFixed(4)}` : '-'
    return `<tr>
      <td><div class="model-cell">${modelIconImg(m.model, 16)}<span class="model-name-text" title="${escapeHtml(m.model)}">${escapeHtml(m.model)}</span></div></td><td>${escapeHtml(m.provider)}</td><td>${pricingSrc}</td>
      <td data-sort="${m.requests}">${m.requests}</td><td data-sort="${m.inputTokens}">${fmtTokens(m.inputTokens)}</td><td data-sort="${m.outputTokens}">${fmtTokens(m.outputTokens)}</td>
      <td data-sort="${m.reportedCost}">${fmtCost(m.reportedCost)}</td><td data-sort="${m.apiEquivCost ?? -1}" style="font-weight:600">${apiStr}${estTag}</td><td data-sort="${costPer1MRaw ?? -1}">${costPer1M}</td>
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
      <div class="kpi-card kpi-light"><div class="kpi-label">Reported Cost</div><div class="kpi-value" style="color:var(--tps)">${fmtCost(reported)}</div></div>
      <div class="kpi-card"><div class="kpi-label">API Equiv. Total</div><div class="kpi-value" style="color:var(--missing)">${apiCost.totalApiCost != null ? fmtCost(totalApi) : '-'}</div></div>
      <div class="kpi-card"><div class="kpi-label">Difference</div><div class="kpi-value">${diffStr}</div></div>
    </div>
    <table id="api-cost-table" class="data-table">
      <thead><tr><th>Model</th><th>Provider</th><th>Pricing Source</th><th>Req</th><th>Input</th><th>Output</th><th>Reported</th><th title="Official pricing × token usage (estimate)">API Equiv.</th><th title="API equivalent per 1M total tokens (incl. cache)">Cost/1M</th></tr></thead>
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
    const costPer1MRaw = m.totalTokens > 0 && m.totalCost > 0 ? (m.totalCost / m.totalTokens) * 1_000_000 : null
    const costPer1M = costPer1MRaw != null ? `$${costPer1MRaw.toFixed(4)}` : '-'
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
          <td data-sort="${m.total}">${m.total}</td>
          <td data-sort="${m.failed}" style="color:var(--danger)">${m.failed}</td>
          <td data-sort="${m.total - m.failed}" style="color:var(--tps)">${m.total - m.failed}</td>
          <td data-sort="${m.total > 0 ? m.failed / m.total : -1}" style="color:${cellColor}">${modelRate}</td>
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
          <th class="sortable" title="Cache Read / (Input + Cache Read)">Hit Rate</th><th class="sortable">Cost</th><th title="Official pricing × token usage (estimate)">API Cost</th><th class="sortable" title="Reported cost per 1M total tokens (incl. cache)">Cost/1M</th>
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
      <td data-sort="${s.requests}">${s.requests}</td>
      <td data-sort="${s.totalTokens}">${fmtTokens(s.totalTokens)}</td>
      <td data-sort="${s.inputTokens}">${fmtTokens(s.inputTokens)}</td>
      <td data-sort="${s.outputTokens}">${fmtTokens(s.outputTokens)}</td>
      <td data-sort="${s.cacheRead}">${fmtTokens(s.cacheRead)}</td>
      <td data-sort="${s.totalCost}">${fmtCost(s.totalCost)}</td>
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
}`
}

function renderHeatmapInit(data: CombinedReportData): string {
  const days = data.daily.slice().reverse()
  const heatData = days.map(d => [d.day, d.totalTokens])
  const minDate = days.length > 0 ? days[0].day : ''
  const maxDate = days.length > 0 ? days[days.length - 1].day : ''
  // Data-driven scale: a hardcoded max would crush short/low-usage ranges
  // into a uniformly dark map.
  const heatMax = Math.max(1, ...days.map(d => d.totalTokens))

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
    xAxis: { type: 'category', data: hourLabels, name: 'Hour', nameTextStyle: { color: '#a3a3ac' }, axisLabel: { color: '#a3a3ac', fontSize: 10 }, axisLine: { lineStyle: { color: '#303035' } }, splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,0.005)', 'rgba(255,255,255,0)'] } } },
    yAxis: { type: 'category', data: dowLabels, axisLabel: { color: '#a3a3ac', fontSize: 10 }, axisLine: { lineStyle: { color: '#303035' } } },
    visualMap: { min: 0, max: Math.max(1, hourlyMax), calculable: true, orient: 'horizontal', right: 20, top: 8, itemWidth: 10, itemHeight: 150,
      formatter: function(v) { return fmt(v); }, textStyle: { color: '#9d9da6', fontSize: 10 },
      inRange: { color: ['rgba(255,255,255,0)', '#2b2b33', '#565661', '#8f8f98', '#f2f2ef'] } },
    series: [{ type: 'heatmap', data: hourlyData, label: { show: false }, itemStyle: { borderColor: '#131316', borderWidth: 1 }, emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(242,242,239,0.4)' } } }]
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
}`
}

function renderInsightsSection(data: CombinedReportData): string {
  const insights: { icon: string; title: string; value: string }[] = []

  // Saved vs official API pricing
  const apiTotal = data.apiCost?.totalApiCost
  const reported = data.apiCost?.reportedCost ?? data.summary.totalCost
  if (apiTotal != null && apiTotal > reported) {
    const pct = ((apiTotal - reported) / apiTotal * 100).toFixed(1)
    insights.push({
      icon: '$',
      title: 'Saved vs. official API pricing',
      value: `<span class="accent">${fmtCost(apiTotal - reported)}</span> (${pct}% below API equivalent)`,
    })
  }

  // Peak activity hour
  const hm = data.hourlyHeatmap ?? []
  if (hm.length > 0) {
    const peak = hm.reduce((a, b) => (a.totalTokens > b.totalTokens ? a : b))
    const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    insights.push({
      icon: '\u26A1',
      title: 'Peak activity hour',
      value: `<span class="accent">${dowNames[peak.dow]} ${String(peak.hour).padStart(2, '0')}:00</span> · ${fmtTokens(peak.totalTokens)} tokens · ${peak.requests} reqs`,
    })
  }

  // Top model share
  const top = sortModelsByUsage(data.models)[0]
  if (top) {
    const total = data.summary.totalTokens
    const sharePct = total > 0 ? (top.totalTokens / total * 100).toFixed(1) : '0'
    insights.push({
      icon: '\u2605',
      title: 'Top model',
      value: `<span class="accent">${escapeHtml(top.model)}</span> · ${fmtTokens(top.totalTokens)} (${sharePct}% of tokens)`,
    })
  }

  if (insights.length === 0) return ""
  const cards = insights.map(ins => `
    <div class="insight-card">
      <div class="insight-icon" style="background:rgba(255,255,255,.05);color:var(--text)">${ins.icon}</div>
      <div class="insight-body">
        <div class="insight-title">${ins.title}</div>
        <div class="insight-value">${ins.value}</div>
      </div>
    </div>`).join("\n")
  return `
  <div class="section">
    <div class="section-title">Insights</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px">
      ${cards}
    </div>
  </div>`
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
  // Short ranges (<=45 days) waste the whole calendar frame — skip it there.
  const daySpan = data.daily.length > 0
    ? Math.round((Date.parse(data.daily[0].day) - Date.parse(data.daily[data.daily.length - 1].day)) / 86400000) + 1
    : 0
  const calendarVisible = daySpan > 45
  const heatmapJs = calendarVisible ? renderHeatmapInit(data) : ""
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
      ${calendarVisible ? '<button class="tab-btn" data-tab="heatmap" onclick="switchTab(\'heatmap\')">Calendar Heatmap</button>' : ''}
      ${hourlyHeatmapJs ? '<button class="tab-btn" data-tab="hourly" onclick="switchTab(\'hourly\')">Activity Hours</button>' : ''}
      ${costTrendJs ? '<button class="tab-btn" data-tab="cost" onclick="switchTab(\'cost\')">Cost Trend</button>' : ''}
    </div>
    <div id="tab-daily" class="tab-content active">
      <div class="chart-box" id="daily-chart"></div>
    </div>
    ${calendarVisible ? '<div id="tab-heatmap" class="tab-content"><div class="chart-box" id="heatmap-chart"></div></div>' : ''}
    ${hourlyHeatmapJs ? `<div id="tab-hourly" class="tab-content"><div class="chart-box" id="hourly-heatmap" style="height:300px"></div></div>` : ''}
    ${costTrendJs ? `<div id="tab-cost" class="tab-content"><div class="chart-box" id="cost-trend-chart"></div></div>` : ''}
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
        <button class="view-btn${data.providers.some(p => p.totalCost > 0) ? ' active' : ''}" data-pview="cost" onclick="switchProviderView('cost')">Cost</button>
        <button class="view-btn${data.providers.some(p => p.totalCost > 0) ? '' : ' active'}" data-pview="tokens" onclick="switchProviderView('tokens')">Tokens</button>
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
  ${calendarVisible ? "if (name === 'heatmap') initHeatmapChart();" : ''}
  ${hourlyHeatmapJs ? "if (name === 'hourly') initHourlyHeatmap();" : ''}
  ${costTrendJs ? "if (name === 'cost') initCostTrend();" : ''}
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
  ${modelChartVisible ? 'initModelChart();' : ''}
  ${data.providers.length > 0 ? 'initProviderDonut();' : ''}
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
</html>`
}
