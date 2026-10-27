import type { SessionEntry } from "@arnilo/prism";
import { type MemoryTaskState, type TaskStateRecordedData, type MemoryObservation, type MemoryReflection, type ObservationsDroppedData, type ObservationsRecordedData, type ReflectionsRecordedData } from "./types.js";
export interface ObservationalMemoryLedger {
    readonly taskState?: MemoryTaskState;
    readonly observations: readonly MemoryObservation[];
    readonly reflections: readonly MemoryReflection[];
    readonly droppedObservationIds: readonly string[];
    readonly consumedObservationIds?: readonly string[];
    readonly supersededReflectionIds?: readonly string[];
    readonly latestObservationCoverageId?: string;
    readonly latestReflectionCoverageId?: string;
    readonly latestDropCoverageId?: string;
}
/** The three ledger records a worker appends. A package keeps them in its session log. */
export type ObservationalMemoryRecord = TaskStateRecordedData | ObservationsRecordedData | ReflectionsRecordedData | ObservationsDroppedData;
/**
 * A branch entry (0.12 attach path, folded memory on a compaction entry) or a bare ledger record (a
 * package's session log). The fold reads both, so one ledger shape serves either storage. Anything
 * else is skipped.
 */
export type ObservationalMemoryLedgerSource = SessionEntry | ObservationalMemoryRecord;
export declare function foldObservationalMemoryLedger(sources: readonly unknown[]): ObservationalMemoryLedger;
/**
 * A session entry carries its payload under `data`; a log record is the payload.
 *
 * A package keeps its ledger in `state.log`, so a branch fold meets those records as `package_state`
 * entries whose payload is `data.value`. Reading the payload is what lets a consumer that only has the
 * branch (the memory fabric, a host's own projection) see the same ledger `SessionLog.entries` returns.
 */
export declare function recordData(source: unknown): unknown;
export declare function activeObservations(ledger: ObservationalMemoryLedger): readonly MemoryObservation[];
/**
 * Union id-keyed ledgers (local + shared branches). Coverage cursors and drop cursors are per branch
 * and are not merged; read-only consumers never use them.
 */
export declare function mergeObservationalMemoryLedgers(...ledgers: readonly ObservationalMemoryLedger[]): ObservationalMemoryLedger;
export declare function observationBlockedByInvalidation(observation: Pick<MemoryObservation, "id" | "sourceEntryIds">, invalidated: ReadonlySet<string>): boolean;
export declare function reflectionBlockedByInvalidation(reflection: Pick<MemoryReflection, "id" | "supportingObservationIds">, invalidated: ReadonlySet<string>): boolean;
export declare function activeReflections(ledger: ObservationalMemoryLedger): readonly MemoryReflection[];
