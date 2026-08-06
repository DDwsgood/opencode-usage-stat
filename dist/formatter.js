// formatter.ts - Types and formatting helpers
// Adapted from opencode-tokenwatch (MIT, (c) TTWK)
/**
 * 判定某模型的缓存数据是否属于"上游不回传"（MISSING）。
 * 判定标准：请求数 >= 2 且 cacheRead 严格为 0。
 */
export function isMissingCache(requestCount, totalCacheRead) {
    return requestCount >= 2 && totalCacheRead === 0;
}
export function formatTokens(n) {
    if (n >= 1_000_000_000)
        return `${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000)
        return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)
        return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}
export function formatCost(n) {
    if (n === 0)
        return "$0.00";
    if (n < 0.01)
        return `$${n.toFixed(6)}`;
    return `$${n.toFixed(2)}`;
}
export function cacheHitRate(input, cacheRead) {
    if (input + cacheRead === 0)
        return 0;
    return cacheRead / (input + cacheRead);
}
export function getPresetRange(preset) {
    if (preset === "all")
        return {};
    const end = new Date();
    const start = new Date(end);
    if (preset === "7d")
        start.setDate(end.getDate() - 6);
    if (preset === "30d")
        start.setDate(end.getDate() - 29);
    if (preset === "month")
        start.setDate(1);
    const format = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    };
    return { startDate: format(start), endDate: format(end) };
}
