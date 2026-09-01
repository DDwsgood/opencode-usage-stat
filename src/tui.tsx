import { createSignal, createEffect } from "solid-js"
import { define } from "@opencode-ai/plugin/tui/plugin"
import type { Context } from "@opencode-ai/plugin/tui/context"
import { createPerfTracker } from "./perf-tracker.js"
import type { PerfTracker } from "./perf-tracker.js"
import { UsageStatPanel } from "./sidebar.jsx"
import { registerCommands } from "./commands.js"
import { fetchSessionTokenMessages, mergeTokenMessages, messageToTokenMessage } from "./token-messages.js"
import type { TokenMessage } from "./token-messages.js"

const plugin = define({
  id: "opencode-usage-stat",
  setup: async (context: Context) => {
    const perfTracker: PerfTracker = createPerfTracker()
    const [sidebarRevision, setSidebarRevision] = createSignal(0)
    const [allTokenMessages, setAllTokenMessages] = createSignal<TokenMessage[]>([])
    const tokenMessagesBySession = new Map<string, TokenMessage[]>()
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
        for (const message of tokenMessagesBySession.get(sessionID) ?? []) {
          if (!seen.has(message.id)) {
            seen.add(message.id)
            messages.push(message)
          }
        }
      }
      setAllTokenMessages(messages)
    }

    async function refreshSession(sessionID: string): Promise<void> {
      try {
        const existing = tokenMessagesBySession.get(sessionID)
        const incoming = await fetchSessionTokenMessages(context.client, sessionID, existing ? "recent" : "all")
        if (!currentFamily.includes(sessionID)) return
        tokenMessagesBySession.set(sessionID, existing ? mergeTokenMessages(existing, incoming) : incoming)
        updateTokenMessages()
      } catch (err) {
        console.warn(`[opencode-usage-stat] failed to restore token history for ${sessionID}:`, err)
      }
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
      for (let i = 0; i < currentFamily.length; i += 8) {
        await Promise.all(currentFamily.slice(i, i + 8).map((sessionID) => refreshSession(sessionID)))
      }
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
export type { PerfTracker, TokenMessage }
