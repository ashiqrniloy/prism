/**
 * Scope widening and narrowing (plan 188.4 Task 6): a lesson proven in two projects may live at
 * `agent`; a note that two projects contradict stops being true.
 *
 * Widening is replication-gated and deterministic: verification plus a second project is what
 * promotes knowledge, so one compromised project cannot plant agent-wide instructions. The grouping
 * is pure; the writes happen through the fabric's own write path in `maintain.ts`.
 */
import { type CapacityNote } from "./capacity.js";
import { type StorageWeights } from "./strength.js";
export interface WidenConfig {
    /** Distinct projects a verified lesson needs before it may live at `agent`; never below 2. */
    readonly minProjects: number;
    readonly minSiblings: number;
    readonly contradictionsToSupersede: number;
}
/** Provisional defaults (plan 188.6 fits them). */
export declare const DEFAULT_WIDEN_CONFIG: WidenConfig;
/** One project can never widen: the poisoning bound is the replication rule itself. */
export declare const MIN_WIDEN_PROJECTS = 2;
export declare const MAX_WIDEN_PROJECTS = 10;
export declare const MIN_WIDEN_SIBLINGS = 2;
export declare const MAX_WIDEN_SIBLINGS = 20;
export declare const MIN_WIDEN_CONTRADICTIONS = 2;
export declare const MAX_WIDEN_CONTRADICTIONS = 20;
/** One active note tagged with the project resource it was read from. */
export interface WidenNote extends CapacityNote {
    readonly project: string;
}
export interface WidenGroup {
    /** The note whose text becomes the wider note: highest storage strength, ties by id. */
    readonly survivor: WidenNote;
    readonly others: readonly WidenNote[];
    readonly projects: readonly string[];
}
/**
 * Conservative content equality (plan 188.7 Task 4): case, Unicode form and runs of whitespace are
 * ignorable; numbers, negation and every other token are not. Dice "semantic agreement" is never used
 * to widen, because one shared subject key does not prove the two values agree.
 */
export declare function normalizeWidenText(text: string): string;
export interface SiblingGroup {
    readonly key: string;
    readonly survivor: CapacityNote;
    readonly others: readonly CapacityNote[];
    /** The sibling subtrees the globs cover; at least `minSiblings` distinct. */
    readonly subtrees: readonly string[];
}
/**
 * Lessons the same in several projects: one `key` and one **identical** normalized value, or keyless
 * notes with identical normalized text. A group widens only when every readable note agrees on the
 * value (one differing note blocks the whole subject), at least `minProjects` distinct projects and
 * distinct witness origins supply readable text, and the text names no participating resource.
 * Metadata-only notes are evidence of presence, never of agreement. `duplicateDice` is retained for
 * source compatibility and ignored: fuzzy overlap is not agreement.
 */
export declare function crossProjectGroups(notes: readonly WidenNote[], options?: {
    readonly duplicateDice?: number;
    readonly weights?: StorageWeights;
    readonly minProjects?: number;
}): readonly WidenGroup[];
/**
 * Path notes of one project that agree across sibling subtrees: one `key`, verified, and globs that
 * cover at least `minSiblings` distinct subtrees under one parent. They widen to the project scope.
 */
export declare function siblingGroups(pathNotes: readonly CapacityNote[], minSiblings?: number): readonly SiblingGroup[];
/** Wider-scope notes enough projects contradict: supersede them with `validTo`. */
export declare function narrowingCandidates(notes: readonly CapacityNote[], threshold?: number): readonly string[];
/** Union of the keywords a wider note inherits from its sources. */
export declare function mergedKeywords(notes: readonly CapacityNote[], key?: string): readonly string[];
