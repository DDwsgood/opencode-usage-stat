/** Projected assistant message: only the fields reports need. */
export interface UsageRow {
    sessionID: string;
    messageID: string;
    providerID: string;
    modelID: string;
    agent: string;
    created: number;
    completed: number | null;
    cost: number;
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
    finish: string | null;
    errorType: string | null;
}
/** Projected session: identity, location, and the session-level usage totals. */
export interface SessionRow {
    id: string;
    projectID: string;
    parentID: string | null;
    directory: string;
    title: string;
    timeCreated: number;
    timeUpdated: number;
    cost: number;
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
}
export interface SqlDb {
    all(sql: string, params?: unknown[]): any[];
    close(): void;
}
export interface LoadRange {
    sinceMs?: number;
    untilMs?: number;
    sessionIds?: string[];
}
export interface LoadResult {
    sessions: SessionRow[];
    rows: UsageRow[];
}
/** Test hook: point the fast path at a fixture DB, or pass null to disable it. */
export declare function setUsageDbPathOverride(path: string | null | undefined): void;
export declare function usageDbPath(): string | null;
/** Open the database read-only through bun:sqlite (TUI) or node:sqlite (tests). */
export declare function openReadonlyDb(path: string): SqlDb | null;
export declare function hasUsageSchema(db: SqlDb): boolean;
export interface SqliteLoadOptions extends LoadRange {
    /** Called after each chunk; used by benchmarks to record the longest blocking slice. */
    onChunk?: (rows: number, ms: number) => void;
}
/** Opened, schema-checked handle. Callers must close() it. */
export interface UsageSqliteSource {
    /** Session plus all descendants (root first); null when the session is not in this DB. */
    family(sessionID: string): string[] | null;
    /** True when every id exists in session_v2 (guards against a TUI attached to a remote server). */
    hasSessions(ids: string[]): boolean;
    load(opts: SqliteLoadOptions): Promise<LoadResult>;
    close(): void;
}
export declare function openUsageSqliteSource(db?: SqlDb | null): UsageSqliteSource | null;
