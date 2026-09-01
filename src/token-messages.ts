import type { OpenCodeClient, SessionMessageInfo } from "@opencode-ai/client"

export interface TokenMessage {
  id: string
  sessionID: string
  providerID: string
  modelID: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

export function messageToTokenMessage(msg: SessionMessageInfo | undefined, sessionID: string): TokenMessage | null {
  if (!msg || msg.type !== "assistant" || !msg.tokens) return null
  const tokens = msg.tokens
  const inputTokens = tokens.input ?? 0
  const outputTokens = tokens.output ?? 0
  const reasoningTokens = tokens.reasoning ?? 0
  const cacheRead = tokens.cache?.read ?? 0
  const cacheWrite = tokens.cache?.write ?? 0
  if (inputTokens + outputTokens + reasoningTokens + cacheRead + cacheWrite === 0) return null
  return {
    id: msg.id,
    sessionID,
    providerID: msg.model?.providerID ?? "unknown",
    modelID: msg.model?.id ?? "unknown",
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheRead,
    cacheWrite,
    cost: msg.cost ?? 0,
  }
}

export async function fetchSessionTokenMessages(
  client: OpenCodeClient,
  sessionID: string,
  mode: "all" | "recent" = "all",
): Promise<TokenMessage[]> {
  const messages: TokenMessage[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  for (;;) {
    const response = await client.message.list({
      sessionID,
      limit: 200,
      order: cursor ? undefined : mode === "all" ? "asc" : "desc",
      cursor,
    })
    if (!Array.isArray(response?.data) || response.data.length === 0) break
    for (const message of response.data) {
      const tokenMessage = messageToTokenMessage(message, sessionID)
      if (tokenMessage) messages.push(tokenMessage)
    }
    if (mode === "recent") break
    const next = response.cursor?.next
    if (!next || cursors.has(next)) break
    cursors.add(next)
    cursor = next
  }
  return mode === "recent" ? messages.reverse() : messages
}

export function mergeTokenMessages(existing: TokenMessage[], incoming: TokenMessage[]): TokenMessage[] {
  const messages = new Map(existing.map((message) => [message.id, message]))
  for (const message of incoming) messages.set(message.id, message)
  return Array.from(messages.values())
}
