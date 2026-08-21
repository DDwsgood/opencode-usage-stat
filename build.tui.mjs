import { build } from "esbuild"
import { readFile } from "node:fs/promises"
import { transformAsync } from "@babel/core"
import ts from "@babel/preset-typescript"
import solid from "babel-preset-solid"

/**
 * esbuild build for opencode-usage-stat (V2 beta).
 *
 * - src/tui.tsx   -> dist/tui.jsx   (TUI entry; JSX is compiled with the same
 *   Babel Solid universal preset the OpenCode host uses for local TUI plugins.
 *   Bun's built-in JSX transform is NOT used for packages under node_modules,
 *   and it evaluates reactive JSX props eagerly, which breaks Solid updates and
 *   onMouseDown event wiring.)
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
  "@opencode-ai/client",
  "@opencode-ai/client/*",
  "@opencode-ai/theme",
  "@opencode-ai/theme/*",
]

const solidUniversalPlugin = {
  name: "solid-universal",
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, async (args) => {
      const code = await readFile(args.path, "utf8")
      const result = await transformAsync(code, {
        filename: args.path,
        configFile: false,
        babelrc: false,
        presets: [
          [solid, { moduleName: "@opentui/solid", generate: "universal" }],
          [ts],
        ],
      })
      return { contents: result.code, loader: "js" }
    })
  },
}

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
    plugins: [solidUniversalPlugin],
    banner: { js: "/** @jsxImportSource @opentui/solid */" },
  }),
  build({
    ...common,
    entryPoints: ["src/server.ts"],
    outfile: "dist/server.js",
  }),
])

console.log("✓ esbuild: dist/tui.jsx + dist/server.js")
