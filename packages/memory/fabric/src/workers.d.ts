import { type ResolvedMemoryWorkerLimits } from "@arnilo/prism-memory-observational";
import type { Memory, MemoryVectorHit } from "@arnilo/prism-memory-core";
import { type CreateMemoryFabricOptions, type MemoryNoteMetadata } from "./types.js";
export interface MemoryFabricSettings {
    readonly consolidate: boolean;
    readonly threshold: number;
    /** The memory's retrieval mode: `"lexical"` scores notes with term-set Dice, `"hybrid"` with cosine. */
    readonly retrieval: "lexical" | "hybrid";
    readonly linker: {
        readonly enabled: boolean;
        readonly topK: number;
    };
    readonly evolution: {
        readonly enabled: boolean;
        readonly maxPatches: number;
    };
    readonly passive: boolean;
    readonly workerLimits: ResolvedMemoryWorkerLimits;
}
/**
 * Create-time settings. Worker caps come from the observational-memory limit helper: `maxPatches`
 * defaults to its per-turn tool-call budget and `maxResultBytes` bounds one patched note payload.
 */
export declare function resolveMemoryFabricSettings(options: CreateMemoryFabricOptions): MemoryFabricSettings;
export interface MemoryEvolutionNeighbor {
    readonly hit: MemoryVectorHit;
    readonly metadata: MemoryNoteMetadata;
}
/**
 * Deterministic evolution worker: patches neighbor **annotations only** — keyword union, plus the
 * new note's context when the neighbor has none. Content, embedding, validity, consent, importance,
 * and `sourceEntryIds` are carried over untouched, and a neighbor that already carries the
 * annotations is not rewritten. No model, no tools, redacted text only.
 */
export declare function runFabricEvolutionWorker(input: {
    readonly memory: Memory;
    readonly neighbors: readonly MemoryEvolutionNeighbor[];
    readonly keywords?: readonly string[];
    readonly context?: string;
    readonly limitBytes: number;
    readonly signal?: AbortSignal;
}): Promise<number>;
