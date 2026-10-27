import type { MemoryNoteLink } from "./types.js";
/** Default neighbor edges the linker stores per note when a host enables it. */
export declare const DEFAULT_LINKER_TOP_K = 3;
/** Hard cap on linker edges and evolution patches; matches the recall top-K cap. */
export declare const HARD_MAX_FABRIC_LINK_TOP_K = 32;
export interface MemoryLinkCandidate {
    readonly id: string;
    readonly score: number;
}
/**
 * Deterministic linker edges: in-rank-order neighbors, weight = embedding similarity clamped to
 * [0,1]. Non-positive similarity and excluded ids (self, the note just superseded) never link.
 */
export declare function resolveNoteLinks(candidates: readonly MemoryLinkCandidate[], options: {
    readonly topK: number;
    readonly exclude?: readonly string[];
}): readonly MemoryNoteLink[] | undefined;
/** Later groups win on the same id, so caller-supplied links override derived ones. */
export declare function mergeNoteLinks(...groups: (readonly MemoryNoteLink[] | undefined)[]): readonly MemoryNoteLink[] | undefined;
