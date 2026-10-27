/**
 * Per-note lifecycle view (plan 188.4 Further Action 4): S, R, the use log, and why the archive and
 * widening rules do or do not pick this note. The decisions stay in `archive.ts` and `widen.ts`; this
 * module only explains them, so an operator reads a note instead of `log.md` or a debug script.
 */
import { type MemoryNoteMetadata, type MemoryNoteScope, type MemoryNoteStatus } from "../types.js";
import { type ArchiveConfig } from "./archive.js";
import { type MemoryNoteDecay, type StorageWeights } from "./strength.js";
/** One gate's verdict: `eligible` with no reasons, or the gates that refused. */
export interface LifecycleDecisionView {
    readonly eligible: boolean;
    readonly reasons: readonly string[];
}
export interface LifecycleNoteView {
    readonly id: string;
    readonly kind: MemoryNoteMetadata["kind"];
    readonly noteScope?: MemoryNoteScope;
    readonly key?: string;
    readonly status: MemoryNoteStatus;
    readonly created?: number;
    readonly pinned?: boolean;
    readonly uses: readonly {
        readonly s: number;
        readonly at?: string;
    }[];
    readonly useSessions: number;
    readonly retrievals: number;
    readonly helpful: number;
    readonly harmful: number;
    /** Storage strength S, rounded for printing. */
    readonly storage: number;
    /** Retrieval strength R, rounded for printing. */
    readonly retrieval: number;
    /** `noteImportance(S)` as stamped on the note at write time. */
    readonly importance: number;
    readonly archive: LifecycleDecisionView;
    readonly widen: LifecycleDecisionView;
    readonly contradictedIn?: readonly string[];
    readonly archivedAt?: string;
    readonly archivedFrom?: MemoryNoteStatus;
    readonly widenedTo?: string;
    readonly mergedInto?: string;
    readonly validTo?: string;
}
export interface InspectNoteInput {
    readonly id: string;
    readonly metadata: MemoryNoteMetadata;
    readonly status: MemoryNoteStatus;
    /** The scope's session ordinal, the same clock `maintain()` reads. */
    readonly clock: number;
    readonly archive?: ArchiveConfig;
    readonly decay?: MemoryNoteDecay;
    readonly storageWeights?: StorageWeights;
}
export declare function inspectNote(input: InspectNoteInput): LifecycleNoteView;
/** One line an operator can scan: the rememberable surface, without the token cost of JSON. */
export declare function describeNote(view: LifecycleNoteView): string;
