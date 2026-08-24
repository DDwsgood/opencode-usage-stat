import type { Context } from "@opencode-ai/plugin/tui/context";
export { parseDaysFilter } from "./formatter.js";
/** Register the V2 keymap layer with the unified /usage slash command (never sends to LLM). */
export declare function registerCommands(context: Context): void;
