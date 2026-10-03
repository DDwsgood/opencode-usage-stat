import { build } from "esbuild"

/**
 * Bundle each test/*.test.ts -> dist-test/*.test.mjs with esbuild so we can run
 * `node --test dist-test` (TS sources are bundled; node builtins stay external).
 */

const external = [
  "@opencode-ai/plugin",
  "@opencode-ai/plugin/*",
  "@opencode-ai/client",
  "@opencode-ai/client/*",
  "@opencode-ai/theme",
  "@opencode-ai/theme/*",
  "@opentui/core",
  "@opentui/core/*",
  "@opentui/solid",
  "@opentui/solid/*",
  "solid-js",
  "solid-js/*",
]

const files = [
  "test/provider-usage.test.ts",
  "test/droid-usage.test.ts",
  "test/factory-keyring.test.ts",
  "test/formatter.test.ts",
  "test/queries.test.ts",
  "test/sqlite-source.test.ts",
  "test/credentials.test.ts",
  "test/perf-tracker.test.ts",
  "test/stats-store.test.ts",
  "test/token-messages.test.ts",
]

await Promise.all(
  files.map(file => {
    const name = file.split("/").pop().replace(/\.test\.ts$/, "")
    return build({
      bundle: true,
      platform: "node",
      format: "esm",
      target: "es2022",
      external,
      logLevel: "info",
      entryPoints: [file],
      outfile: `dist-test/${name}.test.mjs`,
    })
  }),
)

console.log("✓ esbuild: tests -> dist-test/*.test.mjs")
