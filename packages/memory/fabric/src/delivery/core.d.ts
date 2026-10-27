/**
 * Delivery tier 1 (plan 188.5 Task 1): the pinned core.
 *
 * A small always-present slice of long-term memory — verified notes of the durable kinds, ordered by
 * storage strength S with pinned notes first — rendered into the prompt prefix. It is rebuilt only
 * when a note it could show changes, so a turn with no such change sends byte-identical bytes and the
 * provider cache survives (plan 184). It makes no model call: one metadata scan per scope, then one
 * bounded `get` for the text of the notes that fit the budget.
 */
import { type SecretRedactor } from "@arnilo/prism";
import { type Memory, type MemoryVectorMetadataPage, type MemoryVectorMetadataRow, type VectorScanMetadataQuery } from "@arnilo/prism-memory-core";
import { type StorageWeights } from "../lifecycle/index.js";
import { type MemoryNoteMetadata } from "../types.js";
/** Scope levels the core draws from, in the order the block lists them. */
export type FabricCoreScope = "user" | "project";
export interface MemoryFabricCoreConfig {
    /** Ceiling on the rendered block. Default 600, at most {@link HARD_CORE_TOKENS}. */
    readonly maxTokens?: number;
    /** Scopes to include. Default both; `user` always renders first. */
    readonly scopes?: readonly FabricCoreScope[];
}
export interface ResolvedFabricCoreOptions {
    readonly maxTokens: number;
    readonly scopes: readonly FabricCoreScope[];
}
export declare const HARD_CORE_TOKENS = 1000;
export declare const DEFAULT_CORE_OPTIONS: ResolvedFabricCoreOptions;
export declare function resolveFabricCoreOptions(input: boolean | MemoryFabricCoreConfig | undefined, defaultOn: boolean): false | ResolvedFabricCoreOptions;
/** One active scope the core reads, and the memory that holds it. */
export interface FabricCoreScopeBinding {
    readonly level: FabricCoreScope;
    readonly memory: Memory;
}
export interface CreateFabricCoreOptions {
    readonly scopes: readonly FabricCoreScopeBinding[];
    readonly options: ResolvedFabricCoreOptions;
    /** The store's metadata scan; the core needs no text from a listing, only ids and metadata. */
    readonly scanMetadata: (query: VectorScanMetadataQuery) => Promise<MemoryVectorMetadataPage>;
    readonly storageWeights?: StorageWeights;
    readonly redactor?: SecretRedactor;
    readonly secrets?: readonly (string | undefined)[];
    /**
     * Write a scope's derived `core.md` (the markdown store has one; the others have no file layout).
     * A failure is reported once and never fails the turn.
     */
    readonly writeFile?: (scope: {
        readonly tenantId: string;
        readonly resourceId: string;
    }, content: string) => Promise<void>;
    readonly notify?: (message: string) => void;
}
/** The rendered block, without the context-block envelope the caller adds. */
export interface FabricCoreBlock {
    readonly content: string;
    readonly tokens: number;
    /** The notes the block shows, so later tiers can deduplicate against it. */
    readonly itemIds: readonly string[];
}
export interface FabricCore {
    /** The cached block; recomputed only after a write bumped a scope's version. */
    block(signal?: AbortSignal): Promise<FabricCoreBlock | undefined>;
    /** Force the next `block` to recompute (writes that bypass the memory instance). */
    invalidate(): void;
}
interface CoreLine {
    readonly id: string;
    readonly line: string;
    readonly tokens: number;
}
/** The heading a scope's core line starts with; a person sees the same text in `core.md`. */
export declare function coreHeading(label: string): string;
/**
 * Selection and order for one scope: verified, active, unflagged notes of the core kinds, pinned
 * first, then descending S, ties by id so the order is stable across rebuilds.
 */
export declare function coreCandidateRows(rows: readonly MemoryVectorMetadataRow[], weights?: StorageWeights): readonly {
    readonly id: string;
    readonly metadata: MemoryNoteMetadata;
    readonly storage: number;
}[];
/** One scope's core body and the budget its notes spend; `undefined` when the scope holds nothing. */
export interface FabricCoreScopeRender {
    readonly level: FabricCoreScope;
    readonly label: string;
    readonly scope: {
        readonly tenantId: string;
        readonly resourceId: string;
    };
    readonly lines: readonly CoreLine[];
    readonly content?: string;
    readonly tokens: number;
    readonly itemIds: readonly string[];
}
/** One scope's `core.md` body: the heading plus the note lines, exactly what the model reads of it. */
export declare function renderCore(label: string, lines: readonly CoreLine[]): {
    readonly content: string;
    readonly tokens: number;
} | undefined;
export declare function createFabricCore(input: CreateFabricCoreOptions): FabricCore;
export {};
