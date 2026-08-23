# opencode-usage-stat

Token usage statistics and polished offline HTML dashboards for **OpenCode V2** (opencode2).

`opencode-usage-stat` is the V2 rebuild that merges:

- the real-time **TUI sidebar** (token / cache / performance stats for the current session) from the tokenwatch lineage, and
- the **polished self-contained session & cumulative HTML dashboards** (model logos, ECharts, interactive background) from the original usage-stat.

It also adds an opt-in **Provider Usage** sidebar block for **OpenCode Go**, **DeepSeek**, and **Codex** quota/balance endpoints (~15 s timeout, auto-refresh every 2 minutes). Each enabled provider appears collapsed immediately.

Everything runs locally. V2 has no `opencode db` CLI, so all aggregation uses the V2 client (`@opencode-ai/client` OpenCodeClient, exposed as `context.client`) — sessions and messages are fetched through the V2 API (cursor-paginated `session.list` / `message.list`) and folded into the same report contract the dashboards expect.

## Features

### `/usage` (TUI menu — no LLM round trip)

Opens a local menu:

- **Current Session** — session + child/subagent HTML dashboard
- **HTML Report ▸** — cumulative dashboard for Today / Last 7 days / Last 30 days / All time
- **JSON Export** — raw usage data
- **Settings** — sidebar toggles, language

`/session-usage` and `/total-usage` remain as compatible entrypoints that open the same local dashboards.

### TUI sidebar (current session, real-time)

- Per-model token totals, cache hits / MISSING, cost, trend
- Performance: TTFT, TPS, latency (per model, avg/min/max/percentiles)
  - TTFT currently means **local OpenCode prompt enqueue → first reasoning/text event**. OpenCode V2 does not expose a transport-neutral “provider request sent” timestamp, so this value is an upper bound that includes local queueing and request preparation. It is recorded only for user/subagent prompt first steps; tool continuations and automatic retries show no TTFT sample.
  - Latency means **local prompt enqueue → final reasoning/text event** for the same first step, excluding later tool execution. Tool continuations and retries without a prompt start have no latency sample.
  - TPS uses `(visible output + reasoning tokens) / (final output event − first output event)`, so reasoning models and tool settlement time do not distort generation speed.
- Pricing estimates
- **Provider Usage** block:
  - **OpenCode Go** — rolling / weekly / monthly windows with percent + reset time
  - **DeepSeek** — account balance (USD preferred, then CNY)
  - **Codex** — rate-limit windows (primary/secondary) and credits / spend limit
  - Each enabled provider appears collapsed immediately and refreshes independently every 2 minutes with a ~15 s timeout.

### Session / total dashboards

Single self-contained HTML files (ECharts, background, icons, styles embedded). Written to `~/.opencode/reports/` and opened in the default browser. Up to 50 reports are retained.

- Token, request, cache, latency, cost, and error KPIs
- Model distribution, request trends, latency, cache-hit charts
- Calendar / hourly heatmaps, provider summaries, cost share
- Reported cost vs API-equivalent cost estimates
- Sortable, paginated tables; embedded JSON export

## Requirements

- OpenCode V2 (`opencode2`), plugin SDK `@opencode-ai/plugin` (V2 `Plugin.define` entrypoints)
- Node.js `>= 18`
- npm

## Installation

After the package is published, install and configure both entrypoints globally:

```bash
opencode2 plugin add opencode-usage-stat@2.1.2
```

Or clone and build from source:

```bash
git clone https://github.com/DDwsgood/opencode-usage-stat.git
cd opencode-usage-stat
npm install
npm run build
```

Add the package directory to your OpenCode V2 plugin config (e.g. `opencode.json` or the project `.opencode/opencode.json`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "file:///absolute/path/to/opencode-usage-stat"
  ]
}
```

The plugin exposes three entries: `.` / `./server` (V2 server definition via `Plugin.define({ id: "opencode-usage-stat", tui: true, setup })`) and `./tui` (V2 TUI module via `@opencode-ai/plugin/tui` `Plugin.define`). Restart opencode2 after changing plugin configuration.

## Provider credentials

Provider usage checks are disabled by default. Enable them explicitly in the TUI plugin entry; credentials remain outside configuration:

```jsonc
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-usage-stat/dist/tui.jsx",
      "options": {
        "providerUsage": {
          "opencode-go": true,
          "deepseek": false,
          "codex": true,
          "claude": true,
          "kimi-for-coding": false,
          "zai-coding-plan": false,
          "zhipuai-coding-plan": false,
          "minimax-coding-plan": false,
          "minimax-cn-coding-plan": false,
          "openrouter": true,
          "ollama-cloud": false,
          "github-copilot": false,
          "github-copilot-addon": false,
          "google": false,
          "xai": false,
          "cursor": false
        },
        "providerUsageDisplay": "used"
      }
    }
  ]
}
```

Only providers set to `true` are queried. The plugin reads credentials **at runtime only** and never prints, logs, or writes secrets.

### Supported providers

| Provider id | Name | Credential |
|---|---|---|
| `opencode-go` | OpenCode Go | API key |
| `deepseek` | DeepSeek | API key |
| `codex` | Codex / ChatGPT | OAuth access token (+ optional account id) |
| `claude` | Claude Pro/Max | Claude Code OAuth access token (auth.json) |
| `kimi-for-coding` | Kimi for Coding | API key |
| `zai-coding-plan` | z.ai Coding Plan | API key |
| `zhipuai-coding-plan` | Zhipu AI Coding Plan | API key |
| `minimax-coding-plan` | MiniMax Coding Plan (intl) | API key |
| `minimax-cn-coding-plan` | MiniMax Coding Plan (CN) | API key |
| `openrouter` | OpenRouter | API key |
| `ollama-cloud` | Ollama Cloud | session cookie (secure JSON file) |
| `github-copilot` / `github-copilot-addon` | GitHub Copilot | OAuth access token |
| `google` | Google Gemini / Antigravity | OAuth refresh token (auth.json / antigravity-accounts.json) |
| `xai` | xAI / Grok | OAuth access + refresh token (auth.json) |
| `cursor` | Cursor | access token (secure JSON file) |

While collapsed, each provider row shows the short-form usage `n%/m%` where
*n* is the 5-hour/session window and *m* the weekly/7-day window (monthly or
billing-cycle totals are only shown when expanded). Expanding a row lists every
quota window with reset times. The display mode — used vs remaining percentage —
can be switched via `/usage ▸ Settings ▸ Provider Usage Display Mode`, or set
with the `providerUsageDisplay: "used" | "remaining"` plugin option.

Resolution order (per provider):

1. **OpenCode V2 credential database** — `~/.local/share/opencode/opencode.db` (respects `XDG_DATA_HOME` and `OPENCODE_DB`)
2. **OpenCode OAuth auth file** — `~/.local/share/opencode/auth.json` (Claude, Codex, Copilot, Gemini/Antigravity, xAI)
3. **Environment variables**:
   - OpenCode Go: `OPENCODE_GO_API_KEY` or `OPENCODE_API_KEY`
   - DeepSeek: `DEEPSEEK_API_KEY`
   - Kimi: `KIMI_FOR_CODING_API_KEY` or `KIMI_API_KEY`
   - z.ai: `ZAI_API_KEY`; Zhipu: `ZHIPUAI_CODING_PLAN_API_KEY` / `ZHIPU_API_KEY`
   - MiniMax: `MINIMAX_CODING_PLAN_API_KEY`; MiniMax CN: `MINIMAX_CN_CODING_PLAN_API_KEY`
   - OpenRouter: `OPENROUTER_API_KEY`
4. **Secure per-provider JSON files** (0600-style local secrets):
   - Ollama Cloud cookie: `~/.config/openchamber/quota/ollama-cloud.json` (`{"cookie": "..."}`) or `~/.config/opencode/usage-stat/ollama-cloud.json`
   - Cursor access token: `~/.config/openchamber/quota/cursor.json` (`{"accessToken": "..."}`) or `~/.config/opencode/usage-stat/cursor.json`
5. **Safe `.env` parse** (no shell evaluation): `~/.env`, then ancestor directories of the working directory, then an inferred WSL Windows home `.env` — no hardcoded user paths.

**Codex note:** Codex quota uses the OpenCode V2 **OAuth access token** from SQLite/auth.json (with optional `ChatGPT-Account-Id` header) — **not a cookie**. Do not hardcode API keys in plugin configuration or source.

**Claude note:** Claude subscription quota uses the same Anthropic OAuth endpoint as Claude Code (`api.anthropic.com/api/oauth/usage`). It requires an OAuth token from `auth.json`; plain API keys will not work.

**Google note:** refreshing the Gemini/Antigravity access token needs a Google **installed-application** OAuth client supplied via `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (e.g. the Gemini CLI's public client credentials). Without them the `google` provider reports a configuration error instead of querying quotas.

## Usage

In the TUI type `/usage` and pick an action. Reports are written to `~/.opencode/reports/` and the newest report opens automatically.

## Data and privacy

- Sessions/messages are read locally through the V2 plugin client.
- Provider quota checks call the official/known endpoints for each enabled provider with credentials resolved at runtime. Claude uses the Anthropic OAuth usage endpoint; Ollama Cloud scrapes the settings page with a user-supplied session cookie; xAI uses a gRPC-web billing RPC; Google uses the Gemini CLI/Antigravity internal quota RPCs. These are undocumented endpoints and may change without notice.
- Reports are generated locally and are not uploaded by this plugin.
- API-equivalent cost is an estimate; it may differ from provider billing because of caching, discounts, free tiers, rounding, or missing upstream usage fields.

## Development

```bash
npm install
npm run typecheck
npm run test      # bundles + runs offline unit tests (no network, no real credentials)
npm run build     # declarations + dist/server.js + dist/tui.jsx
```

Project structure:

```text
src/
  server.ts                V2 server entry (Plugin.define, id, tui:true, command.transform)
  tui.tsx                  V2 TUI entry (Plugin.define, data.on, ui.slot, keymap.layer)
  commands.tsx             /usage keymap slash commands → local dialogs/dashboards
  sidebar.tsx              TokenWatch-style panel + Provider Usage blocks
  provider-usage.ts        OpenCode Go / DeepSeek / Codex checks
  provider-usage-blocks.tsx TUI Provider Usage UI (default collapsed)
  provider-collapse.ts     Pure collapse-state helpers (tested)
  credentials.ts           Secure credential resolution (V2 SQLite, env, safe .env)
  queries.ts               V2 client aggregation (cursor pagination) → dashboard contract
  formatter.ts             Report + perf types & formatting
  pricing.ts               models.dev pricing & API-equivalent estimates
  html-common.ts           Shared visual system (self-contained ECharts/background)
  model-icons.ts           Model icon embedding
  session-usage-html.ts    Session dashboard generator
  total-usage-html.ts      Cumulative dashboard generator
  perf-tracker.ts          TTFT/TPS/latency tracker (first-output-aware)
  stats-store.ts           Persisted aggregate stats
  theme-map.ts             ResolvedTheme → panel colors
assets/  icons/  vendor/   Embedded dashboard assets
test/                      Offline unit tests (mocked client/fetch, no network)
```

`dist/` is committed so the repository can also be referenced directly after cloning; run `npm run build` after modifying TypeScript sources.

## License

Project code is available under the [MIT License](LICENSE). Bundled third-party software, model logos, and provider marks remain subject to their own licenses and trademark terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
