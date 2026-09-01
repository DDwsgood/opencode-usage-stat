import type { PerfTracker } from "./perf-tracker.js";
import { messageToTokenMessage } from "./token-messages.js";
import type { TokenMessage } from "./token-messages.js";
declare const plugin: import("@opencode-ai/plugin/tui/plugin").Definition;
export default plugin;
export { plugin, messageToTokenMessage };
export type { PerfTracker, TokenMessage };
