// queries.ts - SQL query layer via `opencode db` CLI
// Adapted from opencode-tokenwatch (MIT, (c) TTWK)
import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
/**
 * Resolve the `opencode` CLI binary path.
 * In OpenChamber (desktop app), the bundled `opencode.exe` is not in PATH.
 * We try common locations as fallback.
 */
function resolveOpencodeCli() {
    // On Windows, try to find the bundled OpenChamber binary first
    if (process.platform === "win32") {
        const candidates = [
            join(homedir(), "AppData", "Local", "Programs", "@openchamberelectron", "resources", "opencode-cli", "opencode.exe"),
            join(homedir(), "AppData", "Roaming", "npm", "opencode.cmd"),
            join(homedir(), "AppData", "Roaming", "npm", "opencode.exe"),
            "opencode.exe",
        ];
        for (const c of candidates) {
            if (existsSync(c))
                return c;
        }
    }
    // Fallback: just use `opencode` and let the shell resolve it
    // (works in TUI where npm global bin is in PATH)
    return "opencode";
}
function execAsync(cmd) {
    // Replace leading "opencode " with resolved path
    const resolved = resolveOpencodeCli();
    const finalCmd = cmd.startsWith("opencode ") ? `${JSON.stringify(resolved)} ${cmd.slice("opencode ".length)}` : cmd;
    return new Promise((resolve, reject) => {
        exec(finalCmd, { windowsHide: true, timeout: 30000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error)
                reject(Object.assign(error, { stderr }));
            else
                resolve({ stdout, stderr });
        });
    });
}
async function queryDb(sql) {
    const flatSql = sql.replace(/\s+/g, " ").trim();
    const { stdout, stderr } = await execAsync(`opencode db ${JSON.stringify(flatSql)} --format json`);
    if (stderr)
        throw new Error(stderr.trim());
    const parsed = JSON.parse(stdout.trim());
    return Array.isArray(parsed) ? parsed : parsed.data ?? [];
}
function escapeSql(value) {
    return value.replace(/'/g, "''");
}
function isValidDate(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function messageWhere(filters) {
    const where = [
        "json_extract(m.data, '$.role') = 'assistant'",
        "coalesce(json_extract(m.data, '$.tokens.total'), 0) > 0",
    ];
    if (filters.sessionIds && filters.sessionIds.length > 0) {
        const ids = filters.sessionIds.map(id => `'${escapeSql(id)}'`).join(", ");
        where.push(`m.session_id IN (${ids})`);
    }
    else if (filters.sessionId) {
        where.push(`m.session_id = '${escapeSql(filters.sessionId)}'`);
    }
    if (filters.provider)
        where.push(`coalesce(json_extract(m.data, '$.providerID'), '') = '${escapeSql(filters.provider)}'`);
    if (filters.model)
        where.push(`coalesce(json_extract(m.data, '$.modelID'), '') = '${escapeSql(filters.model)}'`);
    if (filters.startDate && isValidDate(filters.startDate)) {
        where.push(`date(m.time_created / 1000, 'unixepoch', 'localtime') >= '${filters.startDate}'`);
    }
    if (filters.endDate && isValidDate(filters.endDate)) {
        where.push(`date(m.time_created / 1000, 'unixepoch', 'localtime') <= '${filters.endDate}'`);
    }
    return where.join(" AND ");
}
function parseList(value) {
    if (!value)
        return [];
    return value.split(",").map((item) => item.trim()).filter(Boolean);
}
function toSessionTokenData(row) {
    const models = parseList(row?.models_used);
    const providers = parseList(row?.providers_used);
    return {
        model: models.length === 1 ? models[0] : "",
        provider: providers.length === 1 ? providers[0] : "",
        modelsUsed: models,
        totalTokens: row?.total_tokens ?? 0,
        inputTokens: row?.input_tokens ?? 0,
        outputTokens: row?.output_tokens ?? 0,
        reasoningTokens: row?.reasoning_tokens ?? 0,
        cacheRead: row?.cache_read ?? 0,
        cacheWrite: row?.cache_write ?? 0,
        totalCost: row?.total_cost ?? 0,
        requestCount: row?.request_count ?? 0,
    };
}
export async function getSummary(filters = {}) {
    const sql = `
SELECT
  group_concat(distinct coalesce(json_extract(m.data, '$.modelID'), 'unknown')) as models_used,
  group_concat(distinct coalesce(json_extract(m.data, '$.providerID'), 'unknown')) as providers_used,
  count(*) as request_count,
  sum(coalesce(json_extract(m.data, '$.tokens.total'), 0)) as total_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.input'), 0)) as input_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.output'), 0)) as output_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.reasoning'), 0)) as reasoning_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.cache.read'), 0)) as cache_read,
  sum(coalesce(json_extract(m.data, '$.tokens.cache.write'), 0)) as cache_write,
  sum(coalesce(json_extract(m.data, '$.cost'), 0)) as total_cost
FROM message m
WHERE ${messageWhere(filters)}
  `.trim();
    const rows = await queryDb(sql);
    return toSessionTokenData(rows[0]);
}
export async function getModelBreakdown(filters = {}) {
    const sql = `
SELECT
  coalesce(json_extract(m.data, '$.providerID'), 'unknown') as provider,
  coalesce(json_extract(m.data, '$.modelID'), 'unknown') as model,
  count(*) as requests,
  count(distinct m.session_id) as sessions,
  sum(coalesce(json_extract(m.data, '$.tokens.total'), 0)) as total_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.input'), 0)) as input_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.output'), 0)) as output_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.reasoning'), 0)) as reasoning_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.cache.read'), 0)) as cache_read,
  sum(coalesce(json_extract(m.data, '$.tokens.cache.write'), 0)) as cache_write,
  sum(coalesce(json_extract(m.data, '$.cost'), 0)) as total_cost
FROM message m
WHERE ${messageWhere(filters)}
GROUP BY provider, model
ORDER BY total_tokens DESC
  `.trim();
    const rows = await queryDb(sql);
    return rows.map((row) => ({
        provider: row.provider ?? "unknown",
        model: row.model ?? "unknown",
        requests: row.requests ?? 0,
        sessions: row.sessions ?? 0,
        totalTokens: row.total_tokens ?? 0,
        inputTokens: row.input_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
        reasoningTokens: row.reasoning_tokens ?? 0,
        cacheRead: row.cache_read ?? 0,
        cacheWrite: row.cache_write ?? 0,
        totalCost: row.total_cost ?? 0,
    }));
}
export async function getProviderBreakdown(filters = {}) {
    const sql = `
SELECT
  coalesce(json_extract(m.data, '$.providerID'), 'unknown') as provider,
  count(*) as requests,
  count(distinct m.session_id) as sessions,
  sum(coalesce(json_extract(m.data, '$.tokens.total'), 0)) as total_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.input'), 0)) as input_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.output'), 0)) as output_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.reasoning'), 0)) as reasoning_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.cache.read'), 0)) as cache_read,
  sum(coalesce(json_extract(m.data, '$.cost'), 0)) as total_cost
FROM message m
WHERE ${messageWhere(filters)}
GROUP BY provider
ORDER BY total_tokens DESC
  `.trim();
    const rows = await queryDb(sql);
    return rows.map((row) => ({
        provider: row.provider ?? "unknown",
        requests: row.requests ?? 0,
        sessions: row.sessions ?? 0,
        totalTokens: row.total_tokens ?? 0,
        inputTokens: row.input_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
        reasoningTokens: row.reasoning_tokens ?? 0,
        cacheRead: row.cache_read ?? 0,
        totalCost: row.total_cost ?? 0,
    }));
}
export async function getDailyBreakdown(filters = {}) {
    const limit = filters.limit ?? 30;
    const sql = `
SELECT
  date(m.time_created / 1000, 'unixepoch', 'localtime') as day,
  count(*) as requests,
  count(distinct m.session_id) as sessions,
  sum(coalesce(json_extract(m.data, '$.tokens.total'), 0)) as total_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.input'), 0)) as input_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.output'), 0)) as output_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.reasoning'), 0)) as reasoning_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.cache.read'), 0)) as cache_read,
  sum(coalesce(json_extract(m.data, '$.cost'), 0)) as total_cost
FROM message m
WHERE ${messageWhere(filters)}
GROUP BY day
ORDER BY day DESC
LIMIT ${Math.max(1, limit)}
  `.trim();
    const rows = await queryDb(sql);
    return rows.map((row) => ({
        day: row.day ?? "",
        requests: row.requests ?? 0,
        sessions: row.sessions ?? 0,
        totalTokens: row.total_tokens ?? 0,
        inputTokens: row.input_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
        reasoningTokens: row.reasoning_tokens ?? 0,
        cacheRead: row.cache_read ?? 0,
        totalCost: row.total_cost ?? 0,
    }));
}
export async function getSessionBreakdown(filters = {}) {
    const limit = filters.limit ?? 20;
    const sql = `
SELECT
  s.id as session_id,
  s.title as title,
  coalesce(json_extract(m.data, '$.providerID'), json_extract(s.model, '$.providerID'), 'unknown') as provider,
  coalesce(json_extract(m.data, '$.modelID'), json_extract(s.model, '$.id'), 'unknown') as model,
  count(*) as requests,
  sum(coalesce(json_extract(m.data, '$.tokens.total'), 0)) as total_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.input'), 0)) as input_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.output'), 0)) as output_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.reasoning'), 0)) as reasoning_tokens,
  sum(coalesce(json_extract(m.data, '$.tokens.cache.read'), 0)) as cache_read,
  sum(coalesce(json_extract(m.data, '$.cost'), 0)) as total_cost,
  date(max(m.time_created) / 1000, 'unixepoch', 'localtime') as day
FROM message m
JOIN session s ON s.id = m.session_id
WHERE ${messageWhere(filters)}
GROUP BY s.id, s.title, provider, model
ORDER BY max(m.time_created) DESC
LIMIT ${Math.max(1, limit)}
  `.trim();
    const rows = await queryDb(sql);
    return rows.map((row) => ({
        sessionId: row.session_id ?? "",
        title: row.title ?? "(untitled)",
        provider: row.provider ?? "unknown",
        model: row.model ?? "unknown",
        requests: row.requests ?? 0,
        totalTokens: row.total_tokens ?? 0,
        inputTokens: row.input_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
        reasoningTokens: row.reasoning_tokens ?? 0,
        cacheRead: row.cache_read ?? 0,
        totalCost: row.total_cost ?? 0,
        day: row.day ?? "",
    }));
}
/** Get all child session IDs for a given parent session (subagent sessions) */
export async function getChildSessionIds(parentSessionId) {
    const sql = `
SELECT s.id as session_id
FROM session s
WHERE s.parent_id = '${escapeSql(parentSessionId)}'
  `.trim();
    try {
        const rows = await queryDb(sql);
        return rows.map(r => r.session_id ?? "").filter(Boolean);
    }
    catch {
        return [];
    }
}
/** Per-message detail for a specific session - used in /session-usage report */
export async function getMessageDetails(sessionId) {
    // Include child (subagent) sessions
    const childIds = await getChildSessionIds(sessionId);
    const allIds = [sessionId, ...childIds];
    const filters = { sessionIds: allIds };
    const sql = `
SELECT
  m.id as message_id,
  coalesce(json_extract(m.data, '$.modelID'), 'unknown') as model,
  coalesce(json_extract(m.data, '$.providerID'), 'unknown') as provider,
  coalesce(json_extract(m.data, '$.tokens.input'), 0) as input_tokens,
  coalesce(json_extract(m.data, '$.tokens.output'), 0) as output_tokens,
  coalesce(json_extract(m.data, '$.tokens.reasoning'), 0) as reasoning_tokens,
  coalesce(json_extract(m.data, '$.tokens.cache.read'), 0) as cache_read,
  coalesce(json_extract(m.data, '$.tokens.cache.write'), 0) as cache_write,
  coalesce(json_extract(m.data, '$.tokens.total'), 0) as total_tokens,
  coalesce(json_extract(m.data, '$.cost'), 0) as cost,
  m.time_created as time_created,
  json_extract(m.data, '$.time.completed') as time_completed
FROM message m
WHERE ${messageWhere(filters)}
ORDER BY m.time_created ASC
  `.trim();
    const rows = await queryDb(sql);
    return rows.map((row) => ({
        messageId: row.message_id ?? "",
        model: row.model ?? "unknown",
        provider: row.provider ?? "unknown",
        inputTokens: row.input_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
        reasoningTokens: row.reasoning_tokens ?? 0,
        cacheRead: row.cache_read ?? 0,
        cacheWrite: row.cache_write ?? 0,
        totalTokens: row.total_tokens ?? 0,
        cost: row.cost ?? 0,
        timeCreated: row.time_created ?? 0,
        timeCompleted: row.time_completed ?? null,
    }));
}
/** Get session title for a given session ID */
export async function getSessionTitle(sessionId) {
    const sql = `
SELECT s.title as title
FROM session s
WHERE s.id = '${escapeSql(sessionId)}'
LIMIT 1
  `.trim();
    try {
        const rows = await queryDb(sql);
        return rows[0]?.title ?? "(untitled)";
    }
    catch {
        return "(untitled)";
    }
}
export async function getErrorStats(filters = {}) {
    const baseConds = [
        "json_extract(m.data, '$.role') = 'assistant'",
    ];
    if (filters.sessionIds && filters.sessionIds.length > 0) {
        const ids = filters.sessionIds.map(id => `'${escapeSql(id)}'`).join(", ");
        baseConds.push(`m.session_id IN (${ids})`);
    }
    else if (filters.sessionId) {
        baseConds.push(`m.session_id = '${escapeSql(filters.sessionId)}'`);
    }
    if (filters.provider)
        baseConds.push(`coalesce(json_extract(m.data, '$.providerID'), '') = '${escapeSql(filters.provider)}'`);
    if (filters.model)
        baseConds.push(`coalesce(json_extract(m.data, '$.modelID'), '') = '${escapeSql(filters.model)}'`);
    if (filters.startDate && isValidDate(filters.startDate)) {
        baseConds.push(`date(m.time_created / 1000, 'unixepoch', 'localtime') >= '${filters.startDate}'`);
    }
    if (filters.endDate && isValidDate(filters.endDate)) {
        baseConds.push(`date(m.time_created / 1000, 'unixepoch', 'localtime') <= '${filters.endDate}'`);
    }
    const baseWhere = baseConds.join(" AND ");
    const sql = `
SELECT
  coalesce(json_extract(m.data, '$.providerID'), 'unknown') as provider,
  coalesce(json_extract(m.data, '$.modelID'), 'unknown') as model,
  count(*) as total,
  sum(CASE WHEN coalesce(json_extract(m.data, '$.tokens.total'), 0) = 0 THEN 1 ELSE 0 END) as failed
FROM message m
WHERE ${baseWhere}
GROUP BY provider, model
ORDER BY failed DESC
  `.trim();
    try {
        const rows = await queryDb(sql);
        let successCount = 0, failedCount = 0;
        const byModel = rows.map(r => {
            const total = r.total ?? 0;
            const failed = r.failed ?? 0;
            const success = total - failed;
            successCount += success;
            failedCount += failed;
            return { provider: r.provider ?? 'unknown', model: r.model ?? 'unknown', failed, total };
        });
        const errorRate = (successCount + failedCount) > 0
            ? failedCount / (successCount + failedCount)
            : 0;
        return { successCount, failedCount, errorRate, byModel };
    }
    catch {
        return { successCount: 0, failedCount: 0, errorRate: 0, byModel: [] };
    }
}
export async function getHourlyHeatmap(filters = {}) {
    const conds = [
        "json_extract(m.data, '$.role') = 'assistant'",
        "coalesce(json_extract(m.data, '$.tokens.total'), 0) > 0",
    ];
    if (filters.sessionIds && filters.sessionIds.length > 0) {
        const ids = filters.sessionIds.map(id => `'${escapeSql(id)}'`).join(", ");
        conds.push(`m.session_id IN (${ids})`);
    }
    else if (filters.sessionId) {
        conds.push(`m.session_id = '${escapeSql(filters.sessionId)}'`);
    }
    if (filters.provider)
        conds.push(`coalesce(json_extract(m.data, '$.providerID'), '') = '${escapeSql(filters.provider)}'`);
    if (filters.model)
        conds.push(`coalesce(json_extract(m.data, '$.modelID'), '') = '${escapeSql(filters.model)}'`);
    if (filters.startDate && isValidDate(filters.startDate)) {
        conds.push(`date(m.time_created / 1000, 'unixepoch', 'localtime') >= '${filters.startDate}'`);
    }
    if (filters.endDate && isValidDate(filters.endDate)) {
        conds.push(`date(m.time_created / 1000, 'unixepoch', 'localtime') <= '${filters.endDate}'`);
    }
    const sql = `
SELECT
  cast(strftime('%w', m.time_created / 1000, 'unixepoch', 'localtime') as int) as dow,
  cast(strftime('%H', m.time_created / 1000, 'unixepoch', 'localtime') as int) as hour,
  count(*) as requests,
  sum(coalesce(json_extract(m.data, '$.tokens.total'), 0)) as total_tokens,
  sum(coalesce(json_extract(m.data, '$.cost'), 0)) as total_cost
FROM message m
WHERE ${conds.join(" AND ")}
GROUP BY dow, hour
ORDER BY dow, hour
  `.trim();
    try {
        const rows = await queryDb(sql);
        return rows.map(r => ({
            dow: r.dow ?? 0,
            hour: r.hour ?? 0,
            requests: r.requests ?? 0,
            totalTokens: r.total_tokens ?? 0,
            totalCost: r.total_cost ?? 0,
        }));
    }
    catch {
        return [];
    }
}
export async function getUsageReport(filters = {}) {
    const [summary, models, providers, daily, sessions, errors] = await Promise.all([
        getSummary(filters),
        getModelBreakdown(filters),
        getProviderBreakdown(filters),
        getDailyBreakdown(filters),
        getSessionBreakdown(filters),
        getErrorStats(filters),
    ]);
    return { filters, summary, models, providers, daily, sessions, errors };
}
