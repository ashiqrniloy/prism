/**
 * Delivery tier 2 (plan 188.5 Task 2): path cues.
 *
 * When a file tool touches a path, the path-scoped notes whose `applies_to` globs match it are shown
 * once in the session, in the tail, after the topic-injected block. The cue is the retrieval cue of
 * encoding specificity (Tulving & Thomson 1973): a note about `packages/memory/**` is worth its tokens
 * exactly when that directory is in play. Matching is a glob check over an index bucketed by each
 * glob's first literal segment, so one touched path checks one bucket, not every path note.
 *
 * It makes no model call: a metadata scan (cached until a note changes), then one bounded `get` for
 * the text of the notes that matched.
 */
import { type SecretRedactor, type SessionContext } from "@arnilo/prism";
import { type Memory, type MemoryVectorMetadataPage, type VectorScanMetadataQuery } from "@arnilo/prism-memory-core";
import { type MemoryNoteDecay, type StorageWeights } from "../lifecycle/index.js";
export interface MemoryFabricCuesConfig {
    /** Ceiling on one turn's cue lines. Default 300, at most {@link HARD_CUE_TOKENS}. */
    readonly budgetTokens?: number;
    /** Notes a single turn may add by cue. Default 2, at most {@link HARD_CUES_PER_TURN}. */
    readonly maxPerTurn?: number;
}
export interface ResolvedFabricCuesOptions {
    readonly budgetTokens: number;
    readonly maxPerTurn: number;
}
export declare const HARD_CUE_TOKENS = 1000;
export declare const HARD_CUES_PER_TURN = 5;
export declare const DEFAULT_CUES_OPTIONS: ResolvedFabricCuesOptions;
/** The bucket that holds every glob whose first segment is not literal (`**`, `*`, `?`). */
export declare const CUE_ANY_BUCKET = "*";
export declare function resolveFabricCuesOptions(input: boolean | MemoryFabricCuesConfig | undefined, defaultOn: boolean): false | ResolvedFabricCuesOptions;
/** The session-state record this tier owns: the notes it has already shown. */
export interface FabricCueSessionState {
    get(session: SessionContext): unknown;
    set(session: SessionContext, value: {
        readonly injected: readonly string[];
    }): Promise<void>;
}
/** The minimum a note exposes for cross-source dedup, satisfied by a recall hit and by a cue. */
export interface FabricCueDuplicate {
    readonly id: string;
    readonly kind: string;
    readonly path?: string;
    readonly sourceEntryIds?: readonly string[];
}
export interface FabricCueBlock {
    /** One `- [id] path <kind> (for <glob>) <text>` line per note. */
    readonly lines: readonly string[];
    readonly tokens: number;
    readonly itemIds: readonly string[];
}
export interface FabricCueRenderOptions {
    /** The persisted user turn, so `maxPerTurn` counts per turn rather than per build. */
    readonly turnKey?: string;
    /** Ids already visible this turn (core and topic injection); resolved lazily. */
    readonly exclude?: () => ReadonlySet<string>;
    /** The existing visible-read dedup, resolved only when a note actually matched. */
    readonly duplicate?: () => ((note: FabricCueDuplicate) => boolean) | undefined;
    readonly signal?: AbortSignal;
}
export interface FabricCues {
    /** Cue lines for paths this session has not considered yet, or nothing when none is new. */
    render(session: SessionContext, paths: readonly string[], options?: FabricCueRenderOptions): Promise<FabricCueBlock | undefined>;
    /** Force the next render to rebuild its index (writes that bypass the memory instance). */
    invalidate(): void;
    /** Drop the in-memory path bookkeeping of a closed session. */
    forget(sessionId: string): void;
}
export interface CreateFabricCuesOptions {
    /** The project scope: path notes live there and only there. */
    readonly memory: Memory;
    readonly options: ResolvedFabricCuesOptions;
    readonly scanMetadata: (query: VectorScanMetadataQuery) => Promise<MemoryVectorMetadataPage>;
    readonly state: FabricCueSessionState;
    readonly storageWeights?: StorageWeights;
    readonly decay?: MemoryNoteDecay;
    readonly clock?: () => number;
    readonly redactor?: SecretRedactor;
    readonly secrets?: readonly (string | undefined)[];
}
/** The index bucket of a glob: its first segment when literal, else {@link CUE_ANY_BUCKET}. */
export declare function cueBucket(glob: string): string;
export declare function createFabricCues(input: CreateFabricCuesOptions): FabricCues;
