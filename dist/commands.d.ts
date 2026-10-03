import type { Context } from "@opencode-ai/plugin/tui/context";
/** Generate and open the HTML report for the current (or given) session. Re-entrant calls only toast. */
export declare function generateSessionHtmlReport(context: Context, sessionID?: string): Promise<void>;
export { parseDaysFilter } from "./formatter.js";
/** Register the V2 keymap layer with the unified /usage slash command (never sends to LLM). */
export declare function registerCommands(context: Context): void;
