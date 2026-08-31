import type { LogEntry, SessionPerfStats } from "./formatter.js";
export declare function setUsageStatLogPath(path: string): void;
interface PartEvent {
    message_id?: string;
    session_id?: string;
    type?: string;
    text?: string;
    time?: {
        start?: number;
    };
}
interface InboxEnqueuedEvent {
    created?: number;
    data?: {
        sessionID?: string;
        inboxID?: string;
        item?: {
            type?: string;
        };
    };
}
interface InboxDeliveredEvent {
    data?: {
        sessionID?: string;
        inboxID?: string;
    };
}
interface StepStartedEvent {
    created?: number;
    data?: {
        sessionID?: string;
        assistantMessageID?: string;
        model?: {
            providerID?: string;
            id?: string;
        };
    };
}
interface StepStreamedEvent {
    created?: number;
    data?: {
        sessionID?: string;
        assistantMessageID?: string;
    };
}
interface StepTerminalEvent {
    data?: {
        sessionID?: string;
        assistantMessageID?: string;
        tokens?: {
            input?: number;
            output?: number;
            reasoning?: number;
            cache?: {
                read?: number;
                write?: number;
            };
        };
        cost?: number;
    };
}
interface MessageRemoveEvent {
    properties: {
        sessionID?: string;
        messageID?: string;
    };
}
declare class PerfTracker {
    private steps;
    private inboxStarts;
    private promptStarts;
    private messagePromptStarts;
    private promptAssociationAttempted;
    private settledMessages;
    private statsMap;
    /** 原始样本串，用于分位数计算，不持久化 */
    private ttftSamples;
    private tpsSamples;
    private latencySamples;
    handleInboxEnqueued(event: InboxEnqueuedEvent): void;
    handleInboxDelivered(event: InboxDeliveredEvent): void;
    private associatePrompt;
    handleStepStarted(event: StepStartedEvent): void;
    handlePartUpdated(event: PartEvent): void;
    handleStepStreamed(event: StepStreamedEvent): void;
    handleStepTerminal(event: StepTerminalEvent): void;
    private clearMessage;
    private appendLog;
    handleMessageRemoved(event: MessageRemoveEvent): void;
    private updateStats;
    private percentile;
    getSessionStats(): SessionPerfStats;
    readLogs(last?: number): LogEntry[];
    reset(): void;
    loadSession(sessionID: string): void;
    loadSessions(sessionIDs: readonly string[]): void;
}
export declare function createPerfTracker(): PerfTracker;
export type { PartEvent, PerfTracker };
export declare function readLogs(last?: number): LogEntry[];
