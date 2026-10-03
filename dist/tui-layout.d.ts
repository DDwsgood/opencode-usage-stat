export interface DistInput {
    cacheRead: number;
    /** Uncached input + cache write. */
    input: number;
    /** Output + reasoning. */
    output: number;
}
export interface DistSegments {
    cache: number;
    input: number;
    output: number;
}
/**
 * Split `width` cells across cache / input / output by token share using
 * largest-remainder rounding. Every non-zero category gets at least one cell
 * (when width allows), and the sum is exactly `width` whenever any category
 * is non-zero.
 */
export declare function distSegments(data: DistInput, width: number): DistSegments;
export declare const DIST_BAR_MIN = 6;
export declare const DIST_BAR_MAX = 48;
/** " 100.0%" */
export declare const DIST_RATE_BUDGET = 7;
/** " ↑12.3%" */
export declare const DIST_TREND_BUDGET = 7;
/**
 * Dist bar width inside a model block. `contentWidth` is the usable row
 * width, `prefixWidth` the padded "Dist: " label, `suffix` the actual text
 * after the bar (rate/MISSING + trend). A fixed suffix budget keeps bars of
 * different models aligned; a longer real suffix shrinks the bar instead of
 * wrapping.
 */
export declare function distBarWidth(contentWidth: number, prefixWidth: number, suffix: string, showTrend: boolean): number;
export declare const PROVIDER_BAR_MIN = 5;
export declare const PROVIDER_BAR_MAX = 20;
export interface ProviderRowLayout {
    barWidth: number;
    /** Reset suffix to render (may be shortened or "" to make the row fit). */
    reset: string;
}
/**
 * Fit "label + bar + suffix + reset" into `contentWidth` cells. The bar
 * shrinks first; below PROVIDER_BAR_MIN the reset suffix falls back to
 * `compactReset`, then disappears.
 */
export declare function providerRowLayout(contentWidth: number, label: string, suffix: string, reset: string, compactReset: string): ProviderRowLayout;
/**
 * Provider header "● Name ▾" + gap + right text within `available` cells.
 * The right text is cut first; the name only shrinks when it alone is too wide.
 */
export declare function providerHeaderFit(available: number, name: string, right: string): {
    name: string;
    right: string;
};
export type UsageLevel = "ok" | "warn" | "critical";
/** Color level from the *used* percent, regardless of display mode. */
export declare function usageLevel(usedPercent: number | null | undefined): UsageLevel;
export declare function percentBar(percent: number, width: number): string;
export declare function clamp(value: number, min: number, max: number): number;
