import type { PerfTracker } from "./perf-tracker.js";
export interface TokenMessage {
    id: string;
    sessionID: string;
    providerID: string;
    modelID: string;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
}
declare function messageToTokenMessage(msg: any, sessionID: string): TokenMessage | null;
declare const plugin: import("@opencode-ai/plugin/tui/plugin").Definition;
export default plugin;
export { plugin, messageToTokenMessage };
export type { PerfTracker };
