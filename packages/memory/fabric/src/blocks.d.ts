import type { Memory, WorkingMemoryRecord } from "@arnilo/prism-memory-core";
import { type MemoryNoteProvenance } from "./types.js";
/** Block labels an agent may target; matches the label rule `remember({ kind: "working" })` applies. */
export declare const FABRIC_BLOCK_LABEL: RegExp;
/** Stored form of one labeled fabric block inside the working-memory value. */
export interface FabricWorkingBlock {
    readonly id: string;
    readonly content: string;
    /** Set when the block was tombstoned; the content is empty and the label is free again. */
    readonly forgottenAt?: string;
    /** Provenance of the last write to this block. */
    readonly generated?: MemoryNoteProvenance;
}
export interface FabricBlockRecord {
    readonly created: boolean;
    readonly block: string;
    readonly content: string;
    readonly record: WorkingMemoryRecord;
}
export declare function assertFabricBlockLabel(block: unknown): asserts block is string;
/** Deterministic id for a block label: the same label keeps the same note id across writes. */
export declare function fabricBlockId(block: string): string;
/**
 * Fail-closed read of one labeled block. A missing, malformed, or tombstoned block reads as
 * `undefined`, so a corrupt working value can never make the fabric report content it does not have.
 */
export declare function readFabricBlock(record: WorkingMemoryRecord | undefined, block: string): FabricWorkingBlock | undefined;
/** Replace a block's content (the `remember({ kind: "working" })` write). */
export declare function setFabricBlock(memory: Memory, block: string, content: string, options?: {
    readonly signal?: AbortSignal;
    readonly generated?: MemoryNoteProvenance;
}): Promise<WorkingMemoryRecord>;
/**
 * Append to a labeled block under the memory text cap, versioned against concurrent writers.
 * The cap is checked before the write, so a rejected append leaves the stored version untouched.
 */
export declare function appendFabricBlock(memory: Memory, block: string, text: string, options?: {
    readonly signal?: AbortSignal;
    readonly generated?: MemoryNoteProvenance;
}): Promise<FabricBlockRecord>;
/** Tombstone a block: content cleared, `forgottenAt` stamped, label reusable. Returns false when absent. */
export declare function tombstoneFabricBlock(memory: Memory, block: string, options?: {
    readonly signal?: AbortSignal;
}): Promise<boolean>;
