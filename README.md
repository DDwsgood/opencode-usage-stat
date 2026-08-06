# opencode-usage-stat

Interactive token usage dashboards for [OpenCode](https://opencode.ai/) and OpenChamber.

`opencode-usage-stat` adds two slash commands that analyze the local OpenCode database and generate polished, offline-first HTML reports. Reports include model logos, usage and cost comparisons, cache diagnostics, request latency, error analysis, calendar and hourly heatmaps, and API-equivalent pricing estimates.

The generated report is a **single self-contained HTML file**. ECharts, the geometric background, model icons, report data, styles, and animations are embedded directly in the document.

## Features

### `/session-usage`

Generates a report for the current session, including child/subagent sessions.

- Token, request, cache, latency, cost, and error KPIs
- Smart insights for peak usage, slow responses, cache streaks, and failures
- Per-model cards with embedded model logos and token composition bars
- Model distribution, request trend, latency, and cache-hit charts
- Per-request table with sorting and pagination
- Reported cost and API-equivalent cost analysis

### `/total-usage [days]`

Generates a cumulative report. Pass an optional number of days to limit the date range, for example `/total-usage 30`.

- Cumulative tokens, requests, sessions, costs, cache rate, and errors
- Model comparison views for tokens, requests, and costs
- Actual cost versus API-equivalent cost for every model
- Daily trend, calendar heatmap, and weekday/hour activity heatmap
- Provider summaries and cost share
- Model analytics, failed requests, and recent sessions
- Sortable and paginated tables
- Embedded JSON export

## Dashboard design

- High-contrast graphite surfaces with a light/dark visual hierarchy
- Low-saturation semantic colors for cache, input, output, reasoning, cost, and errors
- Purple usage-density scales with explicit token thresholds
- Embedded model-family icons, including OpenAI, Anthropic, DeepSeek, Gemini, Qwen, GLM, Kimi, Hy3, and fallback icons
- Pointer spotlights, reveal animations, count-up KPIs, animated background lighting, and scroll progress
- High-DPI ECharts rendering for crisp labels and thin lines
- `prefers-reduced-motion` support

## Requirements

- OpenCode CLI `>= 1.18.0`
- Node.js `>= 18`
- npm
- An OpenCode installation with the `opencode db` command

## Installation

Clone and build the plugin:

```bash
git clone https://github.com/DDwsgood/opencode-usage-stat.git
cd opencode-usage-stat
npm install
npm run build
```

Add the built plugin to your OpenCode configuration. The global configuration file is:

- Windows: `%USERPROFILE%/.config/opencode/opencode.json`
- macOS/Linux: `~/.config/opencode/opencode.json`

Reference the plugin package directory itself. OpenCode resolves the package entry from `package.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///absolute/path/to/opencode-usage-stat"
  ]
}
```

Windows example:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///C:/Users/you/projects/opencode-usage-stat"
  ]
}
```

Quit and restart OpenCode or OpenChamber after changing plugin configuration.

## Usage

Run either command in OpenCode:

```text
/session-usage
/total-usage
/total-usage 7
/total-usage 30
```

Reports are written to:

```text
~/.opencode/reports/
```

The newest report opens in the default browser automatically. Up to 50 reports of each type are retained.

## Data and privacy

- Usage data is read locally through `opencode db`.
- Reports are generated locally and are not uploaded by this plugin.
- Model pricing metadata is fetched from [models.dev](https://models.dev/) and cached locally for 24 hours.
- API-equivalent cost is an estimate. It may differ from provider billing because of caching, discounts, free tiers, rounding, or missing upstream usage fields.
- A reported cost of zero is shown as `MISSING` in the cost comparison when no cost was reported.

## Development

```bash
npm install
npm run typecheck
npm run build
```

Project structure:

```text
src/
  index.ts                 Plugin commands and report lifecycle
  queries.ts               OpenCode database queries
  formatter.ts             Report data types and aggregation
  pricing.ts               models.dev pricing and estimates
  html-common.ts           Shared visual system and interactions
  model-icons.ts           Model icon resolution and embedding
  session-usage-html.ts    Session report generator
  total-usage-html.ts      Cumulative report generator
assets/                    Embedded dashboard background
icons/                     Embedded model icons
vendor/                    Embedded ECharts runtime
```

`dist/` is committed so the repository can also be referenced directly after cloning. Run `npm run build` after modifying TypeScript sources.

## License

Project code is available under the [MIT License](LICENSE). Bundled third-party software, model logos, and provider marks remain subject to their own licenses and trademark terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
