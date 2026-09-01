import type { OpenCodeClient, SessionMessageInfo } from "@opencode-ai/client";
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
export declare function messageToTokenMessage(msg: SessionMessageInfo | undefined, sessionID: string): TokenMessage | null;
export declare function fetchSessionTokenMessages(client: OpenCodeClient, sessionID: string, mode?: "all" | "recent"): Promise<TokenMessage[]>;
export declare function mergeTokenMessages(existing: TokenMessage[], incoming: TokenMessage[]): TokenMessage[];
