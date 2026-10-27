/**
 * Capacity budgets (plan 188.4 Task 5): what a scope may hold, and which notes leave first when it
 * holds more. Merging runs before eviction, and a note that earned its place — pinned, or above the
 * archive's storage threshold — is never evicted. The pass itself lives in `create.ts`; this module is
 * the arithmetic, so it is tested without a store.
 */
import type { MemoryNoteMetadata, MemoryNoteScope, MemoryNoteStatus } from "../types.js";
import { type ArchiveDecisionOptions } from "./archive.js";
export interface CapacityLimits {
    readonly notes: number;
    readonly tokens: number;
}
/** Provisional defaults (plan 188.6 fits them): a project resizes with the code, a profile does not. */
export declare const DEFAULT_CAPACITY: Readonly<Record<"user" | "agent" | "project", CapacityLimits>>;
export declare const MAX_FABRIC_CAPACITY_NOTES = 10000;
export declare const MAX_FABRIC_CAPACITY_TOKENS = 1000000;
export declare function capacityForLevel(level: MemoryNoteScope, capacity?: Readonly<Record<string, CapacityLimits>>): CapacityLimits;
/** One active note as the capacity pass sees it: metadata for the strengths, text for tokens and Dice. */
export interface CapacityNote {
    readonly id: string;
    readonly metadata: MemoryNoteMetadata;
    readonly status: MemoryNoteStatus;
    readonly tokens: number;
    /** Absent when the note lives in another thread of the resource: it counts, but cannot be merged. */
    readonly text?: string;
}
export interface CapacityUsage {
    readonly notes: number;
    readonly tokens: number;
}
export declare function capacityUsage(notes: readonly CapacityNote[]): CapacityUsage;
export declare function overCapacity(usage: CapacityUsage, limits: CapacityLimits): boolean;
/**
 * Stable order for equal-strength notes: content first, id only as a last resort. Note ids are random,
 * so id-first ties reorder real replays of one policy and invalidate warm caches.
 */
export declare function compareNotes(left: CapacityNote, right: CapacityNote): number;
/**
 * Lowest `S·exp(R)` first — the note the ranking already valued least, ties broken by content. Pinned
 * notes and notes at or above the archive's storage threshold are protected: capacity pressure is not
 * a reason to shed knowledge that was earned.
 */
export declare function evictionOrder(notes: readonly CapacityNote[], clock: number, options?: ArchiveDecisionOptions): readonly CapacityNote[];
