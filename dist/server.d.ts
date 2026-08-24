import type { Context, Plugin } from "@opencode-ai/plugin/promise/plugin";
export declare function setup(_context: Context): Promise<void>;
declare const plugin: Plugin & {
    readonly tui: true;
};
export default plugin;
export type { Context };
