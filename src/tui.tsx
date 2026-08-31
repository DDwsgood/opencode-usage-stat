import { createSignal, createEffect } from "solid-js"
import { define } from "@opencode-ai/plugin/tui/plugin"
import type { Context } from "@opencode-ai/plugin/tui/context"
import { createPerfTracker } from "./perf-tracker.js"
import type { PerfTracker } from "./perf-tracker.js"
import { UsageStatPanel } from "./sidebar.jsx"
import { registerCommands } from "./commands.js"

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

function messageToTokenMessage(msg: any, sessionID: string): TokenMessage | null {
  if (!msg || msg?.type !== "assistant") return null
  const tokens = msg?.tokens
  if (!tokens || typeof tokens !== "object") return null
  if ((tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0) === 0) return null
  return {
    id: msg.id,
    sessionID,
    providerID: msg.model?.providerID ?? "unknown",
    modelID: msg.model?.id ?? msg.model?.modelID ?? "unknown",
    inputTokens: tokens.input ?? 0,
    outputTokens: tokens.output ?? 0,
    reasoningTokens: tokens.reasoning ?? 0,
    cacheRead: tokens.cache?.read ?? 0,
    cacheWrite: tokens.cache?.write ?? 0,
    cost: msg.cost ?? 0,
  }
}

const plugin = define({
  id: "opencode-usage-stat",
  setup: async (context: Context) => {
    const perfTracker: PerfTracker = createPerfTracker()
    const [sidebarRevision, setSidebarRevision] = createSignal(0)
    const [allTokenMessages, setAllTokenMessages] = createSignal<TokenMessage[]>([])
    let currentSessionID = ""
    let currentFamily: string[] = []
    const cleanups: (() => void)[] = []
    // The installed SDK types predate a few current V2 events, while the host
    // exposes them at runtime. Keep the compatibility cast at this boundary.
    const onEvent = context.data.on as unknown as (type: string, handler: (event: any) => void) => () => void

    // ── Perf / token events (real V2 events) ──
    const unsubInboxEnqueued = context.data.on("session.inbox.enqueued", (event: any) => {
      perfTracker.handleInboxEnqueued(event)
    })
    cleanups.push(unsubInboxEnqueued)

    const unsubInboxDelivered = context.data.on("session.inbox.delivered", (event: any) => {
      perfTracker.handleInboxDelivered(event)
    })
    cleanups.push(unsubInboxDelivered)

    const unsubStepStarted = onEvent("session.step.started", (event: any) => {
      perfTracker.handleStepStarted(event)
    })
    cleanups.push(unsubStepStarted)

    const unsubPart = onEvent("session.text.started", (event: any) => {
      perfTracker.handlePartUpdated({
        message_id: event?.data?.assistantMessageID,
        session_id: event?.data?.sessionID,
        type: "text",
        time: { start: event?.created },
      })
    })
    cleanups.push(unsubPart)

    const unsubReasoning = onEvent("session.reasoning.started", (event: any) => {
      perfTracker.handlePartUpdated({
        message_id: event?.data?.assistantMessageID,
        session_id: event?.data?.sessionID,
        type: "reasoning",
        time: { start: event?.created },
      })
    })
    cleanups.push(unsubReasoning)

    const unsubToolInput = onEvent("session.tool.input.started", (event: any) => {
      perfTracker.handlePartUpdated({
        message_id: event?.data?.assistantMessageID,
        session_id: event?.data?.sessionID,
        type: "tool",
        time: { start: event?.created },
      })
    })
    cleanups.push(unsubToolInput)

    const unsubStepStreamed = onEvent("session.step.streamed", (event: any) => {
      perfTracker.handleStepStreamed(event)
    })
    cleanups.push(unsubStepStreamed)

    const settleStep = (event: any) => {
      perfTracker.handleStepTerminal(event)
      setSidebarRevision((value) => value + 1)
    }
    const unsubStepEnded = onEvent("session.step.ended", settleStep)
    const unsubStepFailed = onEvent("session.step.failed", settleStep)
    cleanups.push(unsubStepEnded, unsubStepFailed)

    const unsubUsage = context.data.on("session.usage.updated", (event: any) => {
      const sessionID = event?.data?.sessionID
      if (sessionID && currentFamily.includes(sessionID)) void refreshSession(sessionID)
      setSidebarRevision((v) => v + 1)
    })
    cleanups.push(unsubUsage)

    function familyFor(sessionID: string): string[] {
      if (!sessionID) return []
      const session = context.data.session.get(sessionID)
      if (session?.parentID) return [sessionID]
      const family = context.data.session.family(sessionID)
      return family.length > 0 ? [...family] : [sessionID]
    }

    function updateTokenMessages(): void {
      const seen = new Set<string>()
      const messages: TokenMessage[] = []
      for (const sessionID of currentFamily) {
        for (const message of context.data.session.message.list(sessionID) ?? []) {
          const tokenMessage = messageToTokenMessage(message, sessionID)
          if (tokenMessage && !seen.has(tokenMessage.id)) {
            seen.add(tokenMessage.id)
            messages.push(tokenMessage)
          }
        }
      }
      setAllTokenMessages(messages)
    }

    async function refreshSession(sessionID: string): Promise<void> {
      await context.data.session.message.sync(sessionID).catch(() => {})
      if (currentFamily.includes(sessionID)) updateTokenMessages()
      setSidebarRevision((value) => value + 1)
    }

    async function syncFamilyTree(rootID: string): Promise<void> {
      const visited = new Set<string>([rootID])
      const queue = [rootID]
      while (queue.length > 0 && visited.size < 200) {
        const sessionID = queue.shift()!
        await (context.data.session as any).sync(sessionID, { children: true }).catch(() => {})
        for (const member of context.data.session.family(sessionID)) {
          if (member && !visited.has(member)) {
            visited.add(member)
            queue.push(member)
          }
        }
      }
      if (rootID !== currentSessionID) return
      currentFamily = familyFor(rootID)
      perfTracker.loadSessions(currentFamily)
      await Promise.all(currentFamily.map((sessionID) => refreshSession(sessionID)))
      updateTokenMessages()
    }

    const unsubExec = context.data.on("session.execution.succeeded", (event: any) => {
      void refreshSession(event.data.sessionID)
    })
    cleanups.push(unsubExec)

    const unsubExecFailed = context.data.on("session.execution.failed", (event: any) => {
      void refreshSession(event.data.sessionID)
    })
    cleanups.push(unsubExecFailed)

    const unsubCreated = context.data.on("session.created", (event: any) => {
      const sessionID = event?.data?.sessionID
      const parentID = event?.data?.parentID
      if (!sessionID || !parentID || !currentFamily.includes(parentID) || currentFamily.includes(sessionID)) return
      currentFamily = [...currentFamily, sessionID]
      void refreshSession(sessionID)
    })
    cleanups.push(unsubCreated)

    // ── Slash command registration ──
    // Keymap layers need a mounted Solid owner and must live for the whole
    // app (not just a session screen), so they are created from an "app"
    // slot component instead of inside the sidebar panel.
    function CommandsMount(props: { readonly context: Context }) {
      registerCommands(props.context)
      return null
    }
    const disposeCommandsSlot = context.ui.slot({
      append: "app",
      render: () => <CommandsMount context={context} />,
    })
    cleanups.push(disposeCommandsSlot)

    // ── Sidebar slot ──
    // The render function runs once as a Solid component; `props` is a reactive
    // proxy. Session switching therefore happens inside createEffect (reactive
    // access) instead of relying on a host-side keyed remount.
    const disposeSlot = context.ui.slot({
      append: "sidebar.content",
      render: (slotProps: { readonly sessionID?: string }) => {
        createEffect(() => {
          const sessionID = slotProps.sessionID
          sidebarRevision()
          if (sessionID && sessionID !== currentSessionID) {
            currentSessionID = sessionID
            currentFamily = familyFor(sessionID)
            perfTracker.loadSessions(currentFamily)
            setAllTokenMessages([])
            void syncFamilyTree(sessionID)
          }
        })

        return (
          <UsageStatPanel
            context={context}
            perfTracker={perfTracker}
            sessionID={slotProps.sessionID ?? ""}
            revision={sidebarRevision}
            allTokenMessages={allTokenMessages}
          />
        )
      },
    })
    cleanups.push(disposeSlot)

    return () => {
      for (const cleanup of cleanups) {
        try { cleanup() } catch { /* ignore */ }
      }
    }
  },
})

export default plugin
export { plugin, messageToTokenMessage }
export type { PerfTracker }
