import type { JSX } from "solid-js";
import type { Context } from "@opencode-ai/plugin/tui/context";
export interface ProviderUsageBlocksProps {
    context: Context;
    /** Current session (slot input); required for Droid session-tracked FSC. */
    sessionID?: string;
    /** Outer sidebar panel width (border included); rows are fitted to it. */
    panelWidth?: number;
}
export declare function ProviderUsageBlocks(props: ProviderUsageBlocksProps): JSX.Element;
