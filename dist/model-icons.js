// model-icons.ts - Resolve and embed model brand icons as base64 data URIs.
// Icons sourced from rikkahub-agent assets + models.dev (Tencent/Hy3 lab logo).
// Used in both total-usage and session-usage HTML reports (tables, chart labels).
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
/** Candidate locations for the bundled icons/ directory. */
function resolveIconsDir() {
    const candidates = [];
    // 1. Relative to this module file (ESM): dist/model-icons.js -> ../icons
    try {
        const url = import.meta.url;
        if (url)
            candidates.push(join(dirname(fileURLToPath(url)), "..", "icons"));
    }
    catch { /* ignore */ }
    // 2. Absolute fallback for this machine
    candidates.push("C:/Users/34177/AIGC/opencode-local-plugins/opencode-usage-stat/icons");
    // 3. Relative to cwd
    candidates.push(join(process.cwd(), "icons"));
    for (const c of candidates) {
        if (c && existsSync(join(c, "_default.svg")))
            return c;
    }
    return null;
}
const ICONS_DIR = resolveIconsDir();
const _cache = new Map(); // fileName -> dataUri
/** Light gray used to replace `currentColor` in monochrome SVGs when
 *  embedded as standalone images (where currentColor would render black
 *  and be invisible on the dark dashboard background). */
const FALLBACK_FILL = "#C8C8D8";
/**
 * Ordered matching rules: [regex against normalized id, icon file name].
 * First match wins. Normalization strips virtual prefixes (oc-/ds-/ol-)
 * and takes the last segment after '/'.
 */
const RULES = [
    // GPT family unified to OpenAI (gpt-*, o1/o3/o4, codex, chatgpt, sora, gpt-oss)
    [/^(gpt|o[1-4](?=[\b-]|$)|chatgpt|codex|sora)/, "openai.svg"],
    [/claude|anthropic/, "claude-color.svg"],
    [/deepseek/, "deepseek-color.svg"],
    [/gemini/, "gemini-color.svg"],
    [/gemma/, "gemma-color.svg"],
    [/qwen|qwq|qvq|qianwen/, "qwen-color.svg"],
    [/glm|chatglm|zhipu/, "zhipu-color.svg"],
    [/kimi|moonshot/, "kimi-color.svg"],
    [/grok/, "grok.svg"],
    [/doubao/, "doubao-color.svg"],
    [/\bseed\b/, "bytedance-color.svg"],
    [/llama/, "meta-color.svg"],
    [/mistral|mixtral|codestral|devstral/, "mistral-color.svg"],
    [/minimax|abab/, "minimax-color.svg"],
    [/hunyuan/, "hunyuan-color.svg"],
    [/hy3|hy[-_]/, "tencent.svg"],
    [/longcat/, "longcat-color.svg"],
    [/internlm/, "internlm-color.svg"],
    [/^step|stepfun/, "stepfun-color.svg"],
    [/command|cohere/, "cohere-color.svg"],
    [/\bling\b/, "ling.png"],
    [/mimo/, "xiaomimimo.svg"],
    [/nvidia/, "nvidia-color.svg"],
    [/ollama/, "ollama.svg"],
];
/** Normalize a model ID for icon matching: lowercase, strip virtual
 *  prefixes, take last path segment. */
function normalizeModelId(modelId) {
    let id = modelId.toLowerCase().trim();
    for (const p of ["oc-", "ds-", "ol-"]) {
        if (id.startsWith(p)) {
            id = id.slice(p.length);
            break;
        }
    }
    if (id.includes("/"))
        id = id.split("/").pop().trim();
    return id;
}
/** Resolve which icon file name to use for a model ID. */
export function resolveIconFile(modelId) {
    const id = normalizeModelId(modelId);
    for (const [re, file] of RULES) {
        if (re.test(id))
            return file;
    }
    return "_default.svg";
}
/** Read an icon file and return its base64 data URI (cached in memory).
 *  Replaces `currentColor` in SVGs with a visible light color so monochrome
 *  logos render correctly when embedded as standalone images. */
function readIconDataUri(fileName) {
    const cached = _cache.get(fileName);
    if (cached !== undefined)
        return cached;
    if (!ICONS_DIR) {
        _cache.set(fileName, "");
        return "";
    }
    const filePath = join(ICONS_DIR, fileName);
    try {
        const buf = readFileSync(filePath);
        let uri;
        if (fileName.endsWith(".svg")) {
            let text = buf.toString("utf8");
            text = text.replace(/currentColor/gi, FALLBACK_FILL);
            uri = "data:image/svg+xml;base64," + Buffer.from(text, "utf8").toString("base64");
        }
        else {
            uri = "data:image/png;base64," + buf.toString("base64");
        }
        _cache.set(fileName, uri);
        return uri;
    }
    catch {
        // Fall back to the default icon; guard against infinite recursion
        if (fileName !== "_default.svg") {
            const fallback = readIconDataUri("_default.svg");
            _cache.set(fileName, fallback);
            return fallback;
        }
        _cache.set(fileName, "");
        return "";
    }
}
/** Get the base64 data URI for a model's icon. */
export function getModelIconDataUri(modelId) {
    return readIconDataUri(resolveIconFile(modelId));
}
/** Render an `<img>` tag for a model icon, or empty string if unavailable. */
export function modelIconImg(modelId, size = 16) {
    const uri = getModelIconDataUri(modelId);
    if (!uri)
        return "";
    return `<img class="model-icon" src="${uri}" alt="" width="${size}" height="${size}" loading="lazy" style="width:${size}px;height:${size}px;vertical-align:middle;border-radius:3px;flex-shrink:0">`;
}
/** Build a JSON string mapping each model ID -> icon data URI, for use in
 *  client-side JS (e.g. ECharts rich-text background images). */
export function modelIconMap(modelIds) {
    const m = {};
    for (const id of modelIds)
        m[id] = getModelIconDataUri(id);
    return JSON.stringify(m);
}
