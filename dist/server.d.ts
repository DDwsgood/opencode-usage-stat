import { Plugin } from "@opencode-ai/plugin";
import type { Context } from "@opencode-ai/plugin/promise/plugin";
export declare function setup(context: Context): Promise<void>;
declare const plugin: Plugin.Plugin & {
    readonly tui: true;
};
export default plugin;
export type { Context };
