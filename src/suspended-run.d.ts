/**
 * Suspended-run store entry (roadmap §2.4 ask path, §2.5 store slot). A run that suspends on an
 * `ask` decision writes one `suspended_run` session entry through the store slot, so a later
 * process over the same store can find it and resume. The entry is self-contained: it carries the
 * full redacted run state, so a resume reads nothing else from the store.
 */
import { type StoredAgentRunState } from "./agent-run-state.js";
import type { AgentRunInterruption, JsonValue, SessionEntry } from "./contracts.js";
export declare const SUSPENDED_RUN_ENTRY_SCHEMA_VERSION: 1;
/** Loop identity at suspension. `snapshot` is present only when the strategy declares one. */
export interface SuspendedRunLoopRef {
    readonly name: string;
    readonly revision: string;
    readonly snapshot?: JsonValue;
}
/** `SessionEntry.data` for a `suspended_run` entry. */
export interface SuspendedRunEntryData {
    readonly schemaVersion: typeof SUSPENDED_RUN_ENTRY_SCHEMA_VERSION;
    readonly runId: string;
    readonly loop: SuspendedRunLoopRef;
    /** Owner-scoped hook registration ids active when the run suspended. */
    readonly hookIds: readonly string[];
    readonly interruption: AgentRunInterruption;
    /** Full redacted run state; `session.resume` reads it from the branch to continue the run. */
    readonly state: StoredAgentRunState;
}
export declare function createSuspendedRunEntry(input: {
    readonly id: string;
    readonly sessionId: string;
    readonly parentId?: string;
    readonly runId: string;
    readonly loop: SuspendedRunLoopRef;
    readonly hookIds: readonly string[];
    readonly state: StoredAgentRunState;
}): SessionEntry;
/** Fail-closed parse of a `suspended_run` entry's data; a malformed entry never resumes. */
export declare function parseSuspendedRunEntry(entry: SessionEntry): SuspendedRunEntryData;
/** Newest `suspended_run` entry for a session, or `undefined`. */
export declare function loadSuspendedRunEntry(store: import("./contracts.js").SessionStore, sessionId: string, runId?: string): Promise<SuspendedRunEntryData | undefined>;
/**
 * The suspension a session's branch is waiting on: the newest `suspended_run` entry, provided it is the
 * branch tip (package state aside). Anything appended after it, such as a later run or the resumed run's own
 * messages, means that suspension was resolved or abandoned, so it never resumes twice.
 */
export declare function pendingSuspensionOf(branch: readonly SessionEntry[]): SuspendedRunEntryData | undefined;
