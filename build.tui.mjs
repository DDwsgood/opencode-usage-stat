import { build } from "esbuild"

/**
 * esbuild build for opencode-usage-stat (V2 beta).
 *
 * - src/tui.tsx   -> dist/tui.jsx   (TUI module compiled by the V2 host)
 * - src/server.ts -> dist/server.js (server module: @opencode-ai/plugin Plugin.define)
 *
 * Runtime UI dependencies stay external so OpenCode's runtime plugin maps them
 * to the host's Solid/OpenTUI contexts. Node builtins are auto-external.
 */

const external = [
  "solid-js",
  "solid-js/*",
  "@opentui/solid",
  "@opentui/solid/*",
  "@opentui/core",
  "@opentui/core/*",
  "@opentui/keymap",
  "@opentui/keymap/*",
  "@opencode-ai/plugin",
  "@opencode-ai/plugin/*",
  "@opencode-ai/client",
  "@opencode-ai/client/*",
  "@opencode-ai/theme",
  "@opencode-ai/theme/*",
]

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
  external,
  logLevel: "info",
}

await Promise.all([
  build({
    ...common,
    entryPoints: ["src/tui.tsx"],
    outfile: "dist/tui.jsx",
    jsx: "preserve",
  }),
  build({
    ...common,
    entryPoints: ["src/server.ts"],
    outfile: "dist/server.js",
  }),
])

console.log("✓ esbuild: dist/tui.jsx + dist/server.js")
