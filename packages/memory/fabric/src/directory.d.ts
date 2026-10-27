import { type SecretRedactor } from "@arnilo/prism";
import type { Memory, MemoryTagCount } from "@arnilo/prism-memory-core";
import type { FabricFileJail } from "./files.js";
import { type MemoryNoteKind } from "./types.js";
/**
 * The memory directory: a small, write-versioned index of long-term memory (counts, top topics, recent
 * files, working-block labels) that sits in the prompt prefix so the agent knows what it could recall.
 * It is the first of three disclosure levels; `memory.view` pages the full lists, and `memory.recall` /
 * `memory.read` fetch content. It makes no model or embedding call.
 */
export interface MemoryFabricDirectoryConfig {
    /** Topics (tags/keywords) named in the prefix block. Default 8, at most {@link HARD_DIRECTORY_TOPICS}. */
    readonly maxTopics?: number;
    /** Recent files named in the prefix block. Default 10, at most {@link HARD_DIRECTORY_FILES}. */
    readonly maxFiles?: number;
    /** Ceiling on the rendered block. Default 200, at most {@link HARD_DIRECTORY_TOKENS}. */
    readonly maxTokens?: number;
}
export interface ResolvedFabricDirectoryOptions {
    readonly maxTopics: number;
    readonly maxFiles: number;
    readonly maxTokens: number;
}
export declare const DEFAULT_DIRECTORY_OPTIONS: ResolvedFabricDirectoryOptions;
export declare const HARD_DIRECTORY_TOPICS = 50;
export declare const HARD_DIRECTORY_FILES = 100;
export declare const HARD_DIRECTORY_TOKENS = 500;
export declare function resolveFabricDirectoryOptions(input: boolean | MemoryFabricDirectoryConfig | undefined, defaultOn: boolean): false | ResolvedFabricDirectoryOptions;
/** Record that a memory instance's notes, files, or blocks changed, so its directory is recomputed once. */
export declare function noteMemoryWrite(memory: object): void;
/** The write counter behind {@link noteMemoryWrite}; the pinned core reuses it as its cache key. */
export declare function memoryWriteVersion(memory: object): number;
export interface FabricDirectoryScopeSnapshot {
    readonly level: string;
    readonly counts: Readonly<Partial<Record<MemoryNoteKind, number>>>;
    readonly topics: readonly MemoryTagCount[];
}
export interface FabricDirectorySnapshot {
    /** Active notes by kind, summed over the active scopes. */
    readonly counts: Readonly<Partial<Record<MemoryNoteKind, number>>>;
    readonly topics: readonly MemoryTagCount[];
    /** Per-scope counts and topics, narrowest first; one entry per active scope with anything to say. */
    readonly scopes: readonly FabricDirectoryScopeSnapshot[];
    /** Relative paths under `tools.root`, most recently modified first. */
    readonly files: readonly string[];
    /** True when the file walk stopped at its scan cap. */
    readonly filesTruncated: boolean;
    readonly blocks: readonly string[];
}
export interface FabricDirectory {
    /** The cached snapshot; recomputed only after a write bumped the memory's version. */
    snapshot(signal?: AbortSignal): Promise<FabricDirectorySnapshot>;
    /** Force the next `snapshot` to recompute (file edits and reconciles that bypass the memory). */
    invalidate(): void;
}
/** A directory plus the caps its prefix block renders under; what the context hook and `memory.view` share. */
export interface FabricDirectoryHandle {
    readonly source: FabricDirectory;
    readonly options: ResolvedFabricDirectoryOptions;
}
export interface CreateFabricDirectoryOptions {
    /** The default (narrowest) memory; `memories` adds the other active scopes. */
    readonly memory: Memory;
    /** One memory per active scope; when omitted only `memory` is read. */
    readonly memories?: readonly {
        readonly level: string;
        readonly memory: Memory;
    }[];
    /** Jail over `tools.root`; without it the directory names no files. */
    readonly files?: FabricFileJail;
    /** True for a relative path the walk must not list (the store's own SQLite file). */
    readonly exclude?: (relativePath: string) => boolean;
    readonly redactor?: SecretRedactor;
    readonly secrets?: readonly (string | undefined)[];
}
export declare function createFabricDirectory(options: CreateFabricDirectoryOptions): FabricDirectory;
export declare function isFabricDirectoryEmpty(snapshot: FabricDirectorySnapshot): boolean;
/**
 * The prefix block text, deterministic for a snapshot (stable sort, no timestamps). The topic and file
 * lists shrink until the block fits `maxTokens`; only if the fixed lines alone exceed it is the text cut.
 */
export declare function renderFabricDirectory(snapshot: FabricDirectorySnapshot, options: ResolvedFabricDirectoryOptions): {
    readonly content: string;
    readonly tokens: number;
} | undefined;
export declare const DIRECTORY_VIEW_PAGE = 50;
/** One `memory.view` page: the full topic and file lists from `offset`, so deeper levels stay reachable. */
export declare function pageFabricDirectory(snapshot: FabricDirectorySnapshot, offset: number, size?: number): {
    offset: number;
    topics: MemoryTagCount[];
    files: string[];
    totals: {
        topics: number;
        files: number;
        filesTruncated: boolean;
    };
    nextOffset?: number | undefined;
};
