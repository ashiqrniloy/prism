import type { SessionEntry } from "@arnilo/prism";
import { type ObservationalMemoryLedger } from "./ledger.js";
import { type FoldedMemoryDetails, type MemoryTaskState, type MemoryObservation, type MemoryReflection } from "./types.js";
export interface ObservationalMemoryProjection {
    readonly taskState?: MemoryTaskState;
    readonly full: ObservationalMemoryLedger;
    readonly observations: readonly MemoryObservation[];
    readonly reflections: readonly MemoryReflection[];
    readonly droppedObservationIds: readonly string[];
    readonly folded?: FoldedMemoryDetails;
}
export declare function buildObservationalMemoryProjection(entries: readonly SessionEntry[], firstKeptEntryId?: string, options?: {
    readonly invalidatedIds?: readonly string[];
}): ObservationalMemoryProjection;
export declare function createFoldedMemoryDetails(projection: Pick<ObservationalMemoryProjection, "observations" | "reflections" | "droppedObservationIds">, fullFold?: boolean): FoldedMemoryDetails;
