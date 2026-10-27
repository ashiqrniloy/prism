import type { MemoryNoteKind, MemoryNoteMetadata } from "./types.js";
/**
 * Cosine floor for near-duplicate candidates; similarity alone never retires a note.
 */
export declare const DEFAULT_CONSOLIDATION_THRESHOLD = 0.85;
export interface MemoryConsolidationCandidate {
    readonly id: string;
    readonly text: string;
    readonly score: number;
    readonly metadata: MemoryNoteMetadata;
}
export type MemoryConsolidationPlan = {
    readonly action: "insert";
    readonly similar?: string;
} | {
    readonly action: "update";
    readonly id: string;
};
/** Token comparison so punctuation, case, and spacing rewording is not a contradiction. */
export declare function normalizeNoteText(text: string): string;
/** Stable order union; `undefined` when both sides are empty. */
export declare function unionStrings(left: readonly string[] | undefined, right: readonly string[] | undefined): readonly string[] | undefined;
/**
 * Deterministic default consolidation: an existing same-kind note above the threshold is either
 * rewritten in place (same note) or retained with a similar link. No model, no tools.
 */
export declare function planMemoryConsolidation(input: {
    readonly kind: MemoryNoteKind;
    readonly text: string;
    readonly path?: string;
    readonly threshold: number;
    readonly candidate?: MemoryConsolidationCandidate;
}): MemoryConsolidationPlan;
/**
 * Merge for the update-in-place path: annotations union, the incoming note's claims win, and the
 * existing record's `validTo` is dropped unless the new note sets one (a reassertion is valid again).
 */
export declare function mergeNoteMetadata(existing: MemoryNoteMetadata, incoming: MemoryNoteMetadata): MemoryNoteMetadata;
/** Threshold validation shared with the fabric settings resolver. */
export declare function resolveConsolidationThreshold(value: unknown): number;
