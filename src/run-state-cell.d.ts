/**
 * Private run-state cell (plan 168 Task 5). The durable anchor for a suspended run is the store
 * slot's `suspended_run` entry; this cell is only the kernel's own bounded, versioned carrier for
 * the state of a run in flight, so `session.resume` can re-enter the loop without a host store.
 * It replaces the memory checkpoint store the suspension path used to allocate (plan 144), and it
 * is deliberately not part of the public surface: a host that needs durability across processes
 * uses a durable session store, whose `suspended_run` entry carries the whole state.
 */
/** One run-state write: the value plus the monotonically increasing version of the cell. */
export interface RunStateCellRecord {
    readonly value: unknown;
    readonly version: number;
}
/** Single-writer, per-run versioned cell. */
export interface RunStateCell {
    load(key: string): Promise<RunStateCellRecord | undefined>;
    save(input: {
        readonly key: string;
        readonly value: unknown;
    }): Promise<RunStateCellRecord>;
}
/** Durable-run options for the kernel's own path: no host store, no host policy knobs. */
export interface DurableRunStateOptions {
    readonly cell: RunStateCell;
    /** Immutable revision the fingerprint binds to. */
    readonly definitionRevision: string;
    readonly maxStateBytes?: number;
    /** Persist the session's loaded-skill names (and bodies, with `includeSkillBodies`) in the state. */
    readonly persistSessionState?: boolean;
    readonly includeSkillBodies?: boolean;
}
export declare function createMemoryRunStateCell(): RunStateCell;
