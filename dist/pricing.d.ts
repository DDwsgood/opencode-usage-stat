/**
 * pricing.ts - API equivalent pricing engine
 * Copied from opencode-tokenwatch (MIT, (c) TTWK)
 *
 * For providers that don't report cost, estimates API equivalent cost
 * using official model pricing (from models.dev) x token usage.
 *
 * MISSING models (upstream doesn't return cache data) estimated at 94% hit rate.
 * A model with cacheWrite > 0 is NOT missing: the upstream does report cache
 * stats, so real token counts (including cache write) are used instead.
 */
/** Single model pricing (per million tokens USD) */
export interface ModelPricing {
    input?: number;
    output?: number;
    reasoning?: number;
    cache_read?: number;
    cache_write?: number;
}
/** Test-only: inject a fixed pricing table so cost regressions stay offline/deterministic. */
export declare function setPricingCacheForTest(models: Record<string, ModelPricing>, fetchedAt?: string): void;
export declare function lookupPricing(providerID: string, modelID: string): ModelPricing | null;
export interface ApiCostEstimate {
    model: string;
    cost: number | null;
    estimated: boolean;
    pricingProvider: string | null;
}
/**
 * Estimate API equivalent cost for a single request/aggregate.
 *
 * Non-MISSING model (has real cache data):
 *   input * input_rate + output * output_rate + reasoning * reasoning_rate
 *   + cacheRead * cache_read_rate + cacheWrite * cache_write_rate
 *
 * MISSING model (upstream doesn't return cache at all, cacheRead=0 AND cacheWrite=0):
 *   Estimated at 94% hit rate: input * (1-0.94) * input_rate + input * 0.94 * cache_read_rate + output * output_rate
 *
 * Pricing unit: USD per million tokens
 */
export declare function estimateApiCost(providerID: string, modelID: string, requestCount: number, inputTokens: number, outputTokens: number, reasoningTokens: number, cacheRead: number, cacheWrite: number): ApiCostEstimate;
