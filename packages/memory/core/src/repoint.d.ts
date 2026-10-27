import type { MemoryScope, MemoryVectorRecord, RagAccessConstraint, VectorStore } from "./types.js";
/** Default page size: the most records one `repointSource` call considers. Over it the call returns a cursor. */
export declare const HARD_REPOINT_RECORDS = 4096;
/** Store contract: reads the whole scope, writes through an optional transaction wrapper. */
export interface RepointStore extends VectorStore {
    getByThread?(scope: Required<MemoryScope>, options?: {
        readonly signal?: AbortSignal;
    }): Promise<readonly MemoryVectorRecord[]>;
    transaction?<T>(operation: (store: VectorStore) => Promise<T>, options?: {
        readonly signal?: AbortSignal;
    }): Promise<T>;
}
export interface RepointContext {
    readonly from: string;
    readonly to: string;
    readonly scope: Required<MemoryScope>;
    /** Ids whose lineage edge moved (derived rows), plus the re-keyed source rows. */
    readonly ids: readonly string[];
    readonly movedChunks: number;
    readonly signal?: AbortSignal;
}
/** Derived layer hook (wiki projections, summaries, fabric notes) run after the store write. */
export interface RepointHandler {
    readonly kind: string;
    repoint(context: RepointContext): number | Promise<number>;
}
export interface RepointSourceOptions {
    readonly scope: MemoryScope;
    readonly vectorStore: RepointStore;
    readonly from: string;
    readonly to: string;
    /** Required on ACL stores; must admit both `from` and `to`. */
    readonly authorization?: RagAccessConstraint;
    readonly handlers?: readonly RepointHandler[];
    readonly signal?: AbortSignal;
    /**
     * Records considered per page; defaults to and is bounded by `HARD_REPOINT_RECORDS` only as a page
     * size. A scope larger than one page no longer rejects — the call returns a `cursor` for the rest.
     */
    readonly pageSize?: number;
    /** Resume a paged move from the previous page's `cursor`. Another scope or source pair is rejected. */
    readonly cursor?: string;
    /** Opt-in all-or-nothing bound: over this many records in the scope the call rejects instead of paging. */
    readonly maxRecords?: number;
}
export interface RepointSourceResult {
    readonly from: string;
    readonly to: string;
    /** Chunk rows re-keyed to `to` with their embeddings reused verbatim. */
    readonly movedChunks: number;
    /** Derived records whose `_lineage.sourceIds` edge moved from `from` to `to`. */
    readonly rewrittenEdges: number;
    /** Per-handler-kind artifact counts for this page. */
    readonly layers: Readonly<Record<string, number>>;
    /** True when the store write committed inside one transaction (or there was nothing left to write). */
    readonly batched: boolean;
    /** Present while the scope holds records past this page: pass it back as `cursor` to continue. */
    readonly cursor?: string;
}
export declare function repointSource(options: RepointSourceOptions): Promise<RepointSourceResult>;
/** Plan 102 Task 7: one host-owned identity move. Ids are validated as a set, so a batch is order-free. */
export interface SourceRename {
    readonly from: string;
    readonly to: string;
}
/**
 * One rename's audit record, shaped like the retrieval denial sink: ids and outcome only, never rows.
 * A failed rename carries the error instead of counts — `repointSource` may have committed its store write
 * before a handler failed, so counts on a failure would be a guess. Re-running a committed rename is
 * idempotent and reports `movedChunks: 0`.
 */
export type SourceRenameEvent = {
    readonly from: string;
    readonly to: string;
    readonly outcome: "moved";
    readonly movedChunks: number;
    readonly rewrittenEdges: number;
    readonly layers: Readonly<Record<string, number>>;
} | {
    readonly from: string;
    readonly to: string;
    readonly outcome: "failed";
    readonly error: string;
};
export interface ApplySourceRenamesOptions extends Omit<RepointSourceOptions, "from" | "to" | "cursor"> {
    /** Host-owned `{ from, to }` pairs. Every id is claimed once: no duplicates, no chains, no overlap. */
    readonly renames: readonly SourceRename[];
    /** Report a failed rename in `failures` and keep going instead of throwing. Default: fail fast. */
    readonly continueOnError?: boolean;
    /** Audit sink, called once per rename when it settles — successes and failures alike. */
    readonly onRenamed?: (event: SourceRenameEvent) => void;
    /** Redacts error messages before they reach `onRenamed` and `failures`. */
    readonly redact?: (value: string) => string;
}
export interface ApplySourceRenamesResult {
    /** Per-rename results in the order applied, with every page already folded in (no `cursor`). */
    readonly results: readonly RepointSourceResult[];
    /** Renames that threw, in the order attempted; empty in fail-fast mode (the first failure throws). */
    readonly failures: readonly {
        readonly from: string;
        readonly to: string;
        readonly error: string;
    }[];
}
/**
 * Plan 102 Task 7: apply a batch of host-owned source renames.
 *
 * A thin, audited loop over `repointSource` — no second re-key path and no new store method. Validation is
 * whole-batch and runs before the first store read, so a malformed list writes nothing; each pair is then
 * handed to `repointSource`, which re-checks its own ACLs, cap, and abort. Fail-fast (the default) surfaces
 * the original error after the failed pair's audit event; `continueOnError` collects failures instead. Aborts
 * stop the batch either way and are never reported as rename failures.
 */
export declare function applySourceRenames(options: ApplySourceRenamesOptions): Promise<ApplySourceRenamesResult>;
