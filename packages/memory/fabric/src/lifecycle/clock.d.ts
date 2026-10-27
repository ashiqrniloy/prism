/**
 * The scope clock (plan 188.4 Task 2): one counter per resource that ticks at most once per session.
 *
 * Decay and archival measure time in sessions a scope was actually worked in, not calendar days (D7),
 * and the counter lives in the store so two processes on one project share it. The session key is
 * remembered in session state, so a restored session never counts itself twice.
 */
import { type ScopeCounterStore } from "@arnilo/prism-memory-core";
/** The only counter name today. */
export declare const SCOPE_CLOCK_COUNTER = "sessions";
/** What the fabric keeps in session state: the resources this session already ticked. */
export interface ScopeClockSessionState {
    readonly counted: readonly string[];
}
export interface ScopeClockTick {
    /** Every resource this session has ticked, including the ones from earlier turns. */
    readonly counted: readonly string[];
    /** The new ordinal per resource ticked by this call. */
    readonly clocks: Readonly<Record<string, number>>;
}
export interface ScopeClock {
    read(resourceId: string, options?: {
        readonly signal?: AbortSignal;
    }): Promise<number>;
    /** Increment every resource not yet counted by this session: one write per resource, none after. */
    tick(counted: readonly string[], resourceIds: readonly string[], options?: {
        readonly signal?: AbortSignal;
    }): Promise<ScopeClockTick>;
}
export declare function createScopeClock(counter: ScopeCounterStore, tenantId: string): ScopeClock;
/** Reads the stored form; anything unexpected means "nothing counted yet", never a throw. */
export declare function readScopeClockState(value: unknown): ScopeClockSessionState;
