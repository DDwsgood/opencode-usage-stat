/**
 * pricing.ts - API equivalent pricing engine
 * Copied from opencode-tokenwatch (MIT, (c) TTWK)
 *
 * For providers that don't report cost, estimates API equivalent cost
 * using official model pricing (from models.dev) x token usage.
 *
 * MISSING models (upstream doesn't return cache data) estimated at 94% hit rate.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { execSync } from "node:child_process"
import { isMissingCache } from "./formatter.js"

const PRICING_PATH = join(homedir(), ".opencode", "usage-stat-pricing.json")
const MODELS_DEV_URL = "https://models.dev/api.json"
/** MISSING model estimated hit rate */
const MISSING_HIT_RATE = 0.94
/** Cache valid for 24 hours */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** Providers whose upstreams never report cache data — MISSING heuristics don't apply. */
const NON_CACHE_PROVIDERS = new Set(["ollama", "ollama-cloud"])

/** Single model pricing (per million tokens USD) */
export interface ModelPricing {
  input?: number
  output?: number
  reasoning?: number
  cache_read?: number
  cache_write?: number
}

interface PricingCache {
  fetchedAt: string
  models: Record<string, ModelPricing>
}

/**
 * modelID prefix -> models.dev official provider ID mapping.
 * Longest prefix match ensures glm-5.2 takes priority over glm-5.
 */
const MODEL_PREFIX_MAP: Array<{ prefix: string; provider: string }> = [
  // DeepSeek
  { prefix: "deepseek-v4-pro", provider: "deepseek" },
  { prefix: "deepseek-v4-flash", provider: "deepseek" },
  { prefix: "deepseek-v3", provider: "deepseek" },
  // GLM (Zhipu)
  { prefix: "glm-5.2", provider: "zhipuai" },
  { prefix: "glm-5.1", provider: "zhipuai" },
  { prefix: "glm-5", provider: "zhipuai" },
  { prefix: "glm-4", provider: "zhipuai" },
  // Kimi (Moonshot)
  { prefix: "kimi-k3", provider: "moonshotai" },
  { prefix: "kimi-k2.7", provider: "moonshotai" },
  { prefix: "kimi-k2.6", provider: "moonshotai" },
  { prefix: "kimi-k2.5", provider: "moonshotai" },
  { prefix: "kimi-k2", provider: "moonshotai" },
  // OpenAI
  { prefix: "gpt-5.6", provider: "openai" },
  { prefix: "gpt-5.5", provider: "openai" },
  { prefix: "gpt-5", provider: "openai" },
  // Qwen (Alibaba)
  { prefix: "qwen3.7", provider: "alibaba-cn" },
  { prefix: "qwen3.6", provider: "alibaba-cn" },
  { prefix: "qwen3.5", provider: "alibaba-cn" },
  { prefix: "qwen3", provider: "alibaba-cn" },
  // Doubao - models.dev has no official volcengine provider, use nano-gpt proxy pricing
  { prefix: "doubao-seed-2-0-pro", provider: "nano-gpt" },
  { prefix: "doubao-seed-2-1-pro", provider: "nano-gpt" },
  { prefix: "doubao-seed", provider: "nano-gpt" },
  // MiniMax
  { prefix: "minimax-m", provider: "opencode-go" },
  // MiMo
  { prefix: "mimo-v2", provider: "opencode-go" },
  // Hy3
  { prefix: "hy3", provider: "opencode-go" },
]

/** Match official provider by longest modelID prefix */
function resolveOfficialProvider(modelID: string): string | null {
  let best: { prefix: string; provider: string } | null = null
  for (const entry of MODEL_PREFIX_MAP) {
    if (modelID.startsWith(entry.prefix)) {
      if (!best || entry.prefix.length > best.prefix.length) best = entry
    }
  }
  return best?.provider ?? null
}

/**
 * LiteLLM virtual model prefixes -> upstream providers for pricing lookup.
 * When a modelID starts with one of these prefixes, we strip it and
 * look up pricing under the upstream provider(s).
 */
const VIRTUAL_PREFIX_MAP: Record<string, string[]> = {
  "oc-": ["opencode-go"],
  "ds-": ["deepseek"],
  "ol-": [],               // Ollama Cloud – typically free, no pricing needed
}

/** Strip known LiteLLM / gateway virtual prefixes from a model ID */
function stripVirtualPrefix(modelID: string): string {
  for (const prefix of Object.keys(VIRTUAL_PREFIX_MAP)) {
    if (modelID.startsWith(prefix)) return modelID.slice(prefix.length)
  }
  return modelID
}

/** Tokenise a model ID for fuzzy comparison */
function tokenizeModelID(id: string): string[] {
  return id.toLowerCase().split(/[-_.]+/).filter(t => t.length >= 2)
}

/**
 * Fuzzy-match a model ID against every entry in the pricing database.
 *
 * Example:  "oc-deepseek-v4-pro" (stripped -> "deepseek-v4-pro")
 *  matches  "opencode-go/deepseek-v4-pro"  (tokens deepseek, v4, pro all hit)
 *  or       "deepseek/deepseek-v4-pro"
 *
 * We prefer entries from well-known providers (opencode-go, deepseek, zhipuai,
 * moonshotai, alibaba-cn) when scores are tied.
 */
function fuzzyLookupPricing(modelID: string): { key: string; pricing: ModelPricing } | null {
  const queryTokens = tokenizeModelID(modelID)
  if (queryTokens.length === 0) return null

  const pricing = getPricing()
  let bestKey: string | null = null
  let bestScore = 0

  for (const key of Object.keys(pricing.models)) {
    const slashIdx = key.indexOf("/")
    if (slashIdx === -1) continue
    const provider = key.slice(0, slashIdx)
    const candidate = key.slice(slashIdx + 1)
    const candTokens = tokenizeModelID(candidate)

    let hits = 0
    for (const qt of queryTokens) {
      if (candTokens.some(ct => ct === qt || ct.includes(qt) || qt.includes(ct))) {
        hits++
      }
    }
    const score = hits / queryTokens.length

    // Slight boost for major providers so we pick the most authoritative price
    const boost =
      provider === "opencode-go" || provider === "deepseek" ||
      provider === "zhipuai" || provider === "moonshotai" ||
      provider === "alibaba-cn"
        ? 0.005
        : 0

    if (score + boost > bestScore && score >= 0.5) {
      bestScore = score + boost
      bestKey = key
    }
  }

  return bestKey ? { key: bestKey, pricing: pricing.models[bestKey] } : null
}

/** Fetch pricing from models.dev api.json and cache to local file */
function fetchAndCachePricing(): PricingCache {
  try {
    const tmpJson = execSync(`curl -s "${MODELS_DEV_URL}"`, {
      timeout: 30000,
      encoding: "utf-8",
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    })
    const apiData = JSON.parse(tmpJson) as Record<string, any>
    const models: Record<string, ModelPricing> = {}

    for (const [providerID, providerVal] of Object.entries(apiData)) {
      const providerModels = providerVal?.models
      if (typeof providerModels !== "object" || !providerModels) continue
      for (const [modelID, modelVal] of Object.entries(providerModels)) {
        const cost = (modelVal as any)?.cost
        if (!cost) continue
        const key = `${providerID}/${modelID}`
        models[key] = {
          input: cost.input,
          output: cost.output,
          reasoning: cost.reasoning,
          cache_read: cost.cache_read,
          cache_write: cost.cache_write,
        }
      }
    }

    const cache: PricingCache = {
      fetchedAt: new Date().toISOString(),
      models,
    }
    writeFileSync(PRICING_PATH, JSON.stringify(cache), "utf-8")
    return cache
  } catch {
    return loadCachedPricing()
  }
}

function loadCachedPricing(): PricingCache {
  try {
    if (existsSync(PRICING_PATH)) {
      const content = readFileSync(PRICING_PATH, "utf-8")
      return JSON.parse(content) as PricingCache
    }
  } catch { /* ignore */ }
  return { fetchedAt: "", models: {} }
}

let pricingCache: PricingCache | null = null

function getPricing(): PricingCache {
  if (pricingCache) return pricingCache

  const cached = loadCachedPricing()
  const now = Date.now()
  const fetchedAt = cached.fetchedAt ? new Date(cached.fetchedAt).getTime() : 0

  if (cached.models && Object.keys(cached.models).length > 0 && (now - fetchedAt) < CACHE_TTL_MS) {
    pricingCache = cached
  } else {
    pricingCache = fetchAndCachePricing()
  }
  return pricingCache
}

export function lookupPricing(providerID: string, modelID: string): ModelPricing | null {
  const pricing = getPricing()

  // 1. Direct lookup by actual provider/model
  const directKey = `${providerID}/${modelID}`
  if (pricing.models[directKey]) return pricing.models[directKey]

  // 2. Strip virtual prefix (oc-, ds-, ol-) and try upstream provider(s)
  const stripped = stripVirtualPrefix(modelID)
  if (stripped !== modelID) {
    // 2a. Same provider with stripped ID
    const strippedKey = `${providerID}/${stripped}`
    if (pricing.models[strippedKey]) return pricing.models[strippedKey]

    // 2b. Mapped upstream providers (e.g. oc- -> opencode-go)
    const mappedProviders = VIRTUAL_PREFIX_MAP[
      Object.keys(VIRTUAL_PREFIX_MAP).find(p => modelID.startsWith(p)) ?? ""
    ] ?? []
    for (const up of mappedProviders) {
      const upstreamKey = `${up}/${stripped}`
      if (pricing.models[upstreamKey]) return pricing.models[upstreamKey]
    }
  }

  // 3. Lookup by official provider (via prefix mapping), also with stripped ID
  const officialProvider = resolveOfficialProvider(stripped)
  if (officialProvider) {
    const officialKey = `${officialProvider}/${stripped}`
    if (pricing.models[officialKey]) return pricing.models[officialKey]
    // fallback: try with original modelID in case prefix mapping expects it
    const officialKeyOrig = `${officialProvider}/${modelID}`
    if (pricing.models[officialKeyOrig]) return pricing.models[officialKeyOrig]
  }

  // 4. Fuzzy fallback: match stripped modelID across entire pricing DB
  const fuzzy = fuzzyLookupPricing(stripped)
  if (fuzzy) return fuzzy.pricing

  return null
}

export interface ApiCostEstimate {
  model: string
  cost: number | null
  estimated: boolean
  pricingProvider: string | null
}

/**
 * Estimate API equivalent cost for a single request/aggregate.
 *
 * Non-MISSING model (has real cache data):
 *   input * input_rate + output * output_rate + reasoning * reasoning_rate
 *   + cacheRead * cache_read_rate + cacheWrite * cache_write_rate
 *
 * MISSING model (upstream doesn't return cache, cacheRead=0):
 *   Estimated at 94% hit rate: input * (1-0.94) * input_rate + input * 0.94 * cache_read_rate + output * output_rate
 *
 * Pricing unit: USD per million tokens
 */
export function estimateApiCost(
  providerID: string,
  modelID: string,
  requestCount: number,
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number,
  cacheRead: number,
  cacheWrite: number,
): ApiCostEstimate {
  const model = `${providerID}/${modelID}`
  const pricing = lookupPricing(providerID, modelID)

  if (!pricing) {
    return { model, cost: null, estimated: false, pricingProvider: null }
  }

  const stripped = stripVirtualPrefix(modelID)
  const officialProvider = resolveOfficialProvider(stripped) ?? providerID
  const inputRate = pricing.input ?? 0
  const outputRate = pricing.output ?? 0
  const reasoningRate = pricing.reasoning ?? pricing.output ?? 0
  const cacheReadRate = pricing.cache_read ?? 0
  const cacheWriteRate = pricing.cache_write ?? 0

  // Model is flagged MISSING when the upstream reports no cache data at all
  // (requestCount>1, cacheRead=0); estimated at the 94% hit-rate heuristic.
  const isMissing = !NON_CACHE_PROVIDERS.has(providerID.toLowerCase()) && isMissingCache(requestCount, cacheRead)

  let cost: number
  if (isMissing) {
    // MISSING: estimate cache_read at 94% hit rate
    const nonCacheInput = inputTokens * (1 - MISSING_HIT_RATE)
    const cacheInput = inputTokens * MISSING_HIT_RATE
    cost = (nonCacheInput / 1e6) * inputRate
      + (cacheInput / 1e6) * cacheReadRate
      + (outputTokens / 1e6) * outputRate
      + (reasoningTokens / 1e6) * reasoningRate
  } else {
    // Non-MISSING: use real token counts
    cost = (inputTokens / 1e6) * inputRate
      + (outputTokens / 1e6) * outputRate
      + (reasoningTokens / 1e6) * reasoningRate
      + (cacheRead / 1e6) * cacheReadRate
      + (cacheWrite / 1e6) * cacheWriteRate
  }

  return { model, cost, estimated: isMissing, pricingProvider: officialProvider }
}
