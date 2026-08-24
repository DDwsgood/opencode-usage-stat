// server.ts - OpenCode V2 plugin server entry.
//
// Uses the official V2 API: `import { Plugin } from "@opencode-ai/plugin"` and
// `Plugin.define({ id, tui: true, setup })`. `tui: true` tells the host that
// this package also ships a TUI module (./tui). The unified /usage slash is
// registered only in the TUI keymap layer so it is intercepted locally and
// never sent to the LLM.

import { define } from "@opencode-ai/plugin/promise/plugin"
import type { Context, Plugin } from "@opencode-ai/plugin/promise/plugin"

export async function setup(_context: Context): Promise<void> {
  // No server-command templates are registered here: the TUI registers the
  // keymap slash /usage locally and those stale "empty" command entries caused
  // empty messages to be sent to the LLM and duplicated slash completion.
}

const plugin = define({
  id: "opencode-usage-stat",
  tui: true,
  setup,
} as Plugin & { readonly tui: true }) as Plugin & { readonly tui: true }

export default plugin

export type { Context }
