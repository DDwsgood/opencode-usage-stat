// server.ts - OpenCode V2 plugin server entry.
//
// Uses the official V2 API: `import { Plugin } from "@opencode-ai/plugin"` and
// `Plugin.define({ id, tui: true, setup })`. `tui: true` tells the host that
// this package also ships a TUI module (./tui). The commands registered here
// stay discoverable in the V2 command list; the TUI entry intercepts the
// slash locally (keymap layer) and opens the built-in dashboard menus without
// ever sending the slash to the LLM.

import { Plugin } from "@opencode-ai/plugin"
import type { Context } from "@opencode-ai/plugin/promise/plugin"

export async function setup(context: Context): Promise<void> {
  await context.command.transform((commands) => {
    commands.update("usage", (command) => {
      command.description = "Usage Stat: open the local usage dashboard menu (current session & date ranges)"
    })
    commands.update("session-usage", (command) => {
      command.description = "Usage Stat: generate the current session's HTML usage report locally"
    })
    commands.update("total-usage", (command) => {
      command.description = "Usage Stat: generate a cumulative HTML usage report locally (optionally /total-usage 7 for last 7 days)"
    })
  })
}

const plugin = Plugin.define({
  id: "opencode-usage-stat",
  tui: true,
  setup,
} as Plugin.Plugin & { readonly tui: true }) as Plugin.Plugin & { readonly tui: true }

export default plugin

export type { Context }
