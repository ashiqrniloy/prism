import type { JsonObject, ModelClient, ModelRef, SecretRedactor, SessionEntry, ToolDefinition } from "@arnilo/prism";
import type { Memory, MemoryConsent, MemoryConsentInput, MemoryContextProviderOptions, MemoryScope, RecallScoringOptions } from "@arnilo/prism-memory-core";
import type { MemoryWorkerLimitOptions, RecallBranchPageResult, RecallPageDetail, RecallPageDirection } from "@arnilo/prism-memory-observational";
import type { MemoryNoteUseEvent } from "./lifecycle/events.js";
import type { MemoryNoteStatus } from "./lifecycle/status.js";
/**
 * Note kinds a fabric record may carry. `episode` is a **view** over an observational-memory
 * id: it is never stored as a second row, so `kind: "episode"` writes nothing. `exchange` is the
 * verbatim archive of a completed user turn plus the assistant reply (plan 188.9 Task 7); the
 * archive writes it, never a tool call.
 */
export type MemoryNoteKind = "working" | "episode" | "fact" | "preference" | "procedure" | "file" | "exchange";
export type { MemoryNoteUseEvent } from "./lifecycle/events.js";
export type { MemoryNoteStatus } from "./lifecycle/status.js";
export declare const MEMORY_NOTE_KINDS: readonly MemoryNoteKind[];
/** Storage levels a fabric reads and writes, narrowest first. `path` notes live in `project`; `team` is the
 * checked-in shared store, read-only to tools (plan 188.5 Task 3). */
export type FabricScopeLevel = "user" | "agent" | "team" | "project";
export type MemoryNoteScope = FabricScopeLevel | "path";
export declare const MEMORY_NOTE_SCOPES: readonly MemoryNoteScope[];
export declare function isMemoryNoteScope(value: unknown): value is MemoryNoteScope;
/** The default write scope per kind: user-wide preferences and everything learned in the project. */
export declare function defaultScopeFor(kind: MemoryNoteKind): MemoryNoteScope;
/**
 * Validate `appliesTo`: 1–8 globs relative to the project root. No absolute path, no home path,
 * no `..` segment, no NUL, and no backslash (globs use `/`). Never resolved against the filesystem.
 */
export declare function validateAppliesTo(value: unknown): readonly string[];
export declare function validateNoteKey(value: unknown): string;
/**
 * Kinds `recall` returns when the caller does not name kinds. `procedure` is opt-in: it is
 * never mixed into an untyped recall, and `working` is injected as a core block instead.
 */
export declare const DEFAULT_RECALL_KINDS: readonly MemoryNoteKind[];
/** Reserved `metadata` key holding the fabric note fields on a vector record. */
export declare const MEMORY_NOTE_METADATA_KEY = "fabric";
/** Reserved top-level key inside the working-memory value holding labeled fabric blocks. */
export declare const MEMORY_FABRIC_WORKING_KEY = "_fabric";
export interface MemoryNoteLink {
    /** Target note id (12-hex, same id space as observational memory). */
    readonly id: string;
    readonly relation?: string;
    /** Optional edge weight in [0,1]; 1 when absent. */
    readonly weight?: number;
}
/** Who wrote a note. `human` is an external edit found by reconcile; the rest are programmatic writes. */
export type MemoryNoteActor = "agent" | "promotion" | "human" | "import" | "host";
/**
 * Write provenance, stored top-level in record metadata as `generated` (OKF v0.2 `generated` field).
 * The trust scan is heuristic, so this stamp plus `log.md` and `git diff` are the audit path.
 */
export type MemoryNoteProvenance = {
    readonly by: MemoryNoteActor;
    readonly at: string;
    /** Session that wrote it, for an agent/tool write. */
    readonly session?: string;
    /** Promotion only: the observational-memory reflection it graduated from. */
    readonly reflectionId?: string;
    /** Promotion only: the evidence entry ids the reflection rested on. Mutable so the stamp is `JsonValue`-safe. */
    readonly sourceEntryIds?: string[];
};
/** One provenance stamp. The single place a write's `generated` field is built. */
export declare function stampProvenance(by: MemoryNoteActor, at: string, extra?: {
    readonly session?: string;
    readonly reflectionId?: string;
    readonly sourceEntryIds?: readonly string[];
}): MemoryNoteProvenance;
/** Provenance of a note derived from a reflection explicitly bound to a closed work scope. */
export interface MemoryNotePromotion {
    readonly reflectionId: string;
    /** The work scope the source reflection was bound to, when one still exists. */
    readonly scopeId?: string;
}
/**
 * Score stamp a session-consolidation write carries: `prism.promotion`. Its terms are data, so a
 * rejected or accepted note can be explained without rerunning the pass.
 */
export interface MemoryNotePromotionStamp {
    readonly score: number;
    readonly signals: Readonly<Record<string, number>>;
    /** The consolidation pass that wrote it; retries of one pass share it. */
    readonly pass: string;
}
/** One fabric note as returned by `remember` and `recall`. */
export interface MemoryNote {
    readonly id: string;
    readonly kind: MemoryNoteKind;
    readonly content: string;
    /** Write time of the backing record (vector `createdAt` / working `updatedAt` / observation timestamp). */
    readonly ingestedAt: string;
    readonly tokenCount: number;
    /** Reference time the note talks about; informational, not a validity bound. */
    readonly tRef?: string;
    readonly validFrom?: string;
    readonly validTo?: string;
    readonly keywords?: readonly string[];
    readonly tags?: readonly string[];
    readonly context?: string;
    readonly links?: readonly MemoryNoteLink[];
    readonly sourceEntryIds?: readonly string[];
    readonly supersedes?: string;
    /** Set only on a note derived from a bound reflection; names the bind it graduated from. */
    readonly promotedFrom?: MemoryNotePromotion;
    /** Lifecycle; absent on a note written before promotion existed, which means `verified`. */
    readonly status?: MemoryNoteStatus;
    /** Distinct sessions the note has been used in; a candidate verifies at `verifyAfterSessions`. */
    readonly useSessions?: number;
    /** Diagnostic count of returns from recall and injection; it never affects status or strength. */
    readonly retrievals?: number;
    /** Turns whose outcome tag credited this note. */
    readonly helpful?: number;
    /** User corrections that cited this note. */
    readonly harmful?: number;
    /** Last 32 uses: scope-session ordinal and wall time. */
    readonly uses?: readonly MemoryNoteUseEvent[];
    /** Block label, `kind: "working"` only. */
    readonly block?: string;
    /** Workspace path, `kind: "file"` only. */
    readonly path?: string;
    /** SHA-256 of the file contents read through the file jail. */
    readonly contentHash?: string;
    readonly importance?: number;
    readonly consent?: MemoryConsent;
    readonly scope?: MemoryScope;
    /** The write scope the note belongs to; absent on notes written before scopes existed. */
    readonly level?: MemoryNoteScope;
    /** Globs the note applies to, project-root relative; present exactly when `level` is `path`. */
    readonly appliesTo?: readonly string[];
    /** Stable subject id used for shadowing and widening; `[a-z0-9.-]{1,64}`. */
    readonly key?: string;
    /** Provenance of the last write to this note. */
    readonly generated?: MemoryNoteProvenance;
    /** Trust-scan classes a human edit tripped; a flagged note is a candidate and is never injected. */
    readonly flags?: readonly string[];
    /** When status: "archived", the timestamp it was archived; used for historical asOf queries. */
    readonly archivedAt?: string;
    /** The status to restore when a citation revives an archived note. */
    readonly archivedFrom?: MemoryNoteStatus;
    /** Exempt from archiving and capacity eviction. */
    readonly pinned?: boolean;
    /** Scope-session ordinal the note was written in; absent counts as 0 (older than the clock). */
    readonly created?: number;
    /** True when a verified note was edited after promotion; marked for plan 188.3 reconsolidation. */
    readonly reconsolidate?: boolean;
    /** The wider-scope note this exception shadows; written together with the same `key`. */
    readonly overrides?: string;
    /** Set when capacity merging archived this note into another; the survivor's id. */
    readonly mergedInto?: string;
    /** Set when widening archived this note into a wider scope; the wider note's id. */
    readonly widenedTo?: string;
    /** Project ids whose project-scope note contradicts this wider note; ids only, never text. */
    readonly contradictedIn?: readonly string[];
    /** Score and signals of the consolidation pass that wrote this note. */
    readonly promotion?: MemoryNotePromotionStamp;
}
export interface MemoryNoteHit extends MemoryNote {
    readonly retrieval?: "vector" | "lexical" | "hybrid";
    readonly score: number;
    /** Share of the query's analyzed terms this note contains, in [0,1]; set in lexical mode. */
    readonly coverage?: number;
    /** Pre-fusion vector cosine, absent for lexical-only hits and expanded links. */
    readonly similarity?: number;
    readonly recency?: number;
}
export interface MemoryFabricRememberInput {
    readonly kind: MemoryNoteKind;
    /** Required for `episode` (it is the observational-memory id); optional elsewhere. */
    readonly id?: string;
    /**
     * Derives content from an observational-memory reflection; `fact`/`procedure` only. The
     * reflection must exist in the attached session's ledger (work scopes were removed with the
     * observational attach surface), and `content` is not accepted with it.
     */
    readonly reflectionId?: string;
    /** Required for `working`; required for `fact`/`procedure`; defaults to `path` for `file`. */
    readonly content?: string;
    /** Block label, `kind: "working"` only. */
    readonly block?: string;
    /** Workspace path, `kind: "file"` only. */
    readonly path?: string;
    /** SHA-256 of the file contents read through the file jail. */
    readonly contentHash?: string;
    readonly tRef?: string;
    readonly validFrom?: string;
    readonly validTo?: string;
    readonly keywords?: readonly string[];
    readonly tags?: readonly string[];
    readonly context?: string;
    readonly links?: readonly MemoryNoteLink[];
    readonly sourceEntryIds?: readonly string[];
    readonly supersedes?: string;
    /** Where the note lives: `user`/`agent`/`project`, or `path` for a project note limited by globs. */
    readonly scope?: MemoryNoteScope;
    /** 1–8 project-root-relative globs; required exactly when `scope` is `path`. */
    readonly appliesTo?: readonly string[];
    /** Stable subject id, `[a-z0-9.-]{1,64}`; used for shadowing and widening. */
    readonly key?: string;
    /** The wider-scope note this exception shadows; requires the same `key` as that note. */
    readonly overrides?: string;
    /** Score and signals of the consolidation pass that wrote it. */
    readonly promotion?: MemoryNotePromotionStamp;
    readonly importance?: number;
    readonly consent?: MemoryConsentInput;
}
export interface MemoryFabricWriteOptions {
    readonly sessionId?: string;
    readonly signal?: AbortSignal;
    /**
     * Write an indexed note as a `candidate`: stored, recallable by tool, never injected passively until
     * it is used or confirmed. A write that updates an existing verified note leaves it verified.
     */
    readonly status?: "candidate";
    /** Overrides the inferred provenance actor (`agent` when a sessionId is present, else `host`). */
    readonly generatedBy?: "agent" | "host" | "import" | "promotion";
}
export interface MemoryFabricRecallOptions {
    readonly minSimilarity?: number;
    /** Workspace-relative file paths this session touched; a `path` note earns its prior only on a glob match. */
    readonly touchedPaths?: readonly string[];
    /** Reference-time interval, inclusive start and exclusive end. */
    readonly tRef?: {
        readonly from: string;
        readonly to: string;
    };
    /**
     * Defaults to {@link DEFAULT_RECALL_KINDS}; naming a kind is the only way to get `procedure`.
     * `["all"]` is shorthand for every kind {@link MEMORY_NOTE_KINDS} lists.
     */
    readonly kinds?: readonly (MemoryNoteKind | "all")[];
    /** Point in time used for the validity window. Defaults to now. */
    readonly asOf?: string | Date;
    readonly topK?: number;
    /** Ceiling on the summed `tokenCount` of the returned hits; the best hit is always returned. */
    readonly budget?: number;
    /**
     * Also return archived notes, appended after the active hits. Without it, archived notes are
     * searched only when the best active match is weak, and then at most three are appended.
     */
    readonly includeArchived?: boolean;
    /**
     * Search archived notes when the active result is weak (default true). Passive injection turns it
     * off: it filters archived hits out anyway, so the extra query would only cost embeddings.
     */
    readonly archiveSearch?: boolean;
    readonly scoring?: RecallScoringOptions;
    readonly signal?: AbortSignal;
}
/** One provenance row, parallel to `hits[i]`; scores only, never a payload beyond the returned hits. */
export interface MemoryFabricExplainEntry {
    readonly retrieval?: "vector" | "lexical" | "hybrid";
    readonly id: string;
    readonly score: number;
    /** Pre-fusion vector cosine, absent for lexical-only hits and expanded links. */
    readonly similarity?: number;
    readonly recency?: number;
    readonly importance?: number;
    /** True when the hit arrived through a link from a seed hit instead of the query ranking. */
    readonly link: boolean;
    /** True for every returned hit: each one passed the `asOf` validity filter. */
    readonly valid: boolean;
    /** Set on a hit dropped because a narrower scope holds the same `key`. */
    readonly shadowedBy?: string;
    readonly links?: readonly MemoryNoteLink[];
}
export interface MemoryFabricRecallResult {
    readonly hits: readonly MemoryNoteHit[];
    readonly explain: readonly MemoryFabricExplainEntry[];
}
/**
 * Observational-memory ledger source for `kind: "episode"` views. A kernel `Session` satisfies this
 * (`{ session }`): the fabric folds the package's `state.log` records off the branch, so no attach
 * surface and no host-side ledger plumbing are involved.
 */
export interface MemoryFabricObservationSource {
    readonly session: {
        readonly id?: string;
        entries(): Promise<readonly SessionEntry[]>;
    };
}
export interface MemoryFabricScopeBinding {
    readonly level: FabricScopeLevel;
    readonly memory: Memory;
}
/** What the maintenance pass asks a host to open; see `CreateMemoryFabricOptions.openScope`. */
export interface MemoryFabricScopeOpenInput {
    readonly level: MemoryNoteScope;
    readonly tenantId: string;
    readonly resourceId: string;
}
export interface CreateMemoryFabricOptions {
    readonly inject?: false | import("./config.js").MemoryFabricInjectConfig;
    readonly memory: Memory;
    /**
     * The store behind `memory`, when the caller has it. `maintain()` needs `scanMetadata`; without a
     * store, or with one that cannot scan, it fails closed and leaves recall and writes alone.
     */
    readonly vectorStore?: import("@arnilo/prism-memory-core").VectorStore;
    /** One memory per active storage level; `memory` is the default when omitted. */
    readonly scopes?: readonly MemoryFabricScopeBinding[];
    /**
     * Levels that are recalled alongside `scopes` but never written, maintained, or widened — the team
     * store (plan 188.5 Task 3). They take part in fusion, key shadowing, and the recall priors.
     */
    readonly readOnlyScopes?: readonly MemoryFabricScopeBinding[];
    /**
     * Opens a `Memory` for a resource the maintenance pass discovered but the host did not bind
     * (plan 188.4 Further Action 2). Widening finds every project through `listResources`; without
     * this resolver an unbound project is evidence only — its text cannot be read and its copies
     * cannot be archived. Return `undefined` to leave that resource metadata-only. A resolver that
     * throws or returns a memory for another resource is treated as "not opened".
     */
    readonly openScope?: (input: MemoryFabricScopeOpenInput) => Memory | undefined | Promise<Memory | undefined>;
    /** Additive scope priors; each in [0,0.5]. Defaults are path 0.15, project 0.10, agent 0.05, user 0. */
    readonly scopePriors?: Partial<Record<MemoryNoteScope, number>>;
    /**
     * The scope-session ordinal to rank against (plan 188.4 Task 3): retrieval strength counts the
     * sessions since each use. Absent ranks as ordinal 0, which only the pre-clock stores see.
     */
    readonly clock?: () => number;
    /** Resolved `lifecycle` decay and weights; absent uses the plan's provisional defaults. */
    readonly lifecycle?: import("./config.js").ResolvedLifecycleConfig;
    /** Workspace-relative file paths a session touched, keyed by session id (fed by `tool.started`). */
    readonly touchedPaths?: (sessionId: string) => readonly string[];
    /** Required only for `kind: "episode"`; fabric stays fully inert without it. */
    readonly observational?: MemoryFabricObservationSource;
    /**
     * Overrides the retrieval mode read from `memory.retrieval` (the create-time source of truth):
     * `"lexical"` compares notes with term-set Dice, `"hybrid"` with pre-fusion cosine.
     */
    readonly retrieval?: "lexical" | "hybrid";
    /**
     * Deterministic near-duplicate folding on `fact`/`procedure`/`file` writes (default on): an
     * existing note at or above the threshold is rewritten in place when it is the same note, and
     * retained with a similar link when its content differs. Pass `false` to write unconditionally.
     */
    readonly consolidate?: boolean | MemoryFabricConsolidationOptions;
    /**
     * Lazily resolved only for the opt-in model decider and the extractor. A `ModelRef` (not just a
     * name) because the extractor's output budget is applied by re-resolving with a capped `ModelSpec`,
     * the same rule compaction uses.
     */
    readonly resolveModelClient?: (ref?: ModelRef) => ModelClient;
    /**
     * Human-readable maintenance warnings (a scope whose protected notes alone exceed its capacity
     * budget). The package definition routes it to `prism.status.note("warn", ...)`.
     */
    readonly notify?: (message: string) => void;
    readonly onDeciderFailure?: (sessionId?: string) => void;
    readonly redactor?: SecretRedactor;
    readonly secrets?: readonly (string | undefined)[];
    /** Opt-in derived `related` edges stored on the written note. */
    readonly linker?: boolean | MemoryFabricLinkerOptions;
    /** Opt-in annotation patch (keywords/context) of the written note's nearest neighbors. */
    readonly evolution?: boolean | MemoryFabricEvolutionOptions;
    /** Skips the opt-in workers (linker, evolution); consolidation is part of the write path. */
    readonly passive?: boolean;
    /** Worker caps, resolved by the observational-memory `resolveMemoryWorkerLimits` helper. */
    readonly workerLimits?: MemoryWorkerLimitOptions;
    /** The resolved `promote` config; absent (or `enabled: false`) makes `consolidate` a no-op. */
    readonly promote?: import("./promote.js").ResolvedPromoteConfig;
    /** Workspace root the `promote.derivableFrom` files resolve inside. Default `process.cwd()`. */
    readonly promoteRoot?: string;
    /**
     * A project scope with a declared root is active, so the extractor gets the repository and
     * derivability rules (plan 188.9 Task 8). Absent means the domain-neutral prompt.
     */
    readonly repositoryRules?: boolean;
    /** The archive config; when it is enabled, its unconsolidated exchanges join a pass's candidates. */
    readonly exchanges?: import("./config.js").MemoryFabricExchangesConfig;
}
export interface MemoryFabricConsolidationOptions {
    /** Cosine floor at which a recalled note counts as the same note; default 0.85. */
    readonly threshold?: number;
    readonly decider?: "model";
    readonly model?: string;
}
export interface MemoryFabricLinkerOptions {
    readonly enabled?: boolean;
    /** Edges per note; default 3, hard cap 32. */
    readonly topK?: number;
}
export interface MemoryFabricEvolutionOptions {
    readonly enabled?: boolean;
    /** Neighbors patched per write; default is the resolved worker per-turn budget, hard cap 32. */
    readonly maxPatches?: number;
}
export interface MemoryFabricConversationSearchOptions {
    /** Messages per page around a hit: the observational-memory page limit (default 20, hard cap 100). */
    readonly limit?: number;
    /** Page direction; default `backward` (the page ends at the matching message). */
    readonly direction?: RecallPageDirection;
    /** Page detail; default `summary`. */
    readonly detail?: RecallPageDetail;
    /** Matching messages returned; default 5, hard cap 100. */
    readonly topK?: number;
    readonly signal?: AbortSignal;
}
export interface MemoryFabricConversationHit {
    readonly entryId: string;
    /** Query-term coverage in [0,1]. */
    readonly score: number;
    readonly timestamp: string;
    /** Branch page around the match, from `recallObservationalMemoryBranchPage` (cursor semantics included). */
    readonly page: RecallBranchPageResult;
}
export interface MemoryFabricConversationSearchResult {
    readonly hits: readonly MemoryFabricConversationHit[];
    /** Eligible branch messages scanned on this call. */
    readonly scanned: number;
}
export interface MemoryFabricForgetInput {
    /** Indexed note id to tombstone. Exactly one of `id`/`block` is required. */
    readonly id?: string;
    /** Working block label to tombstone (content cleared, label reusable). */
    readonly block?: string;
    /** Retain the row as a legal hold instead of deleting it; ignored for blocks. */
    readonly hold?: boolean;
}
export interface MemoryFabricForgetResult {
    readonly id?: string;
    readonly block?: string;
    /** Rows removed from the vector store; 0 when the note was held or was not in this scope. */
    readonly deleted: number;
    /** True when the note was retained under legal hold rather than deleted. */
    readonly held: boolean;
}
export interface MemoryFabricToolsOptions {
    /** Directory file tools are jailed to. Without it, path-taking tools fail closed. */
    readonly root?: string;
    /** Per-file read/append ceiling; default 50 KiB, hard cap 1 MiB. */
    readonly maxFileBytes?: number;
}
/** The part of a kernel `SessionContext` a consolidation pass reads. */
export interface MemoryFabricConsolidateSource {
    readonly id: string;
    entries(): Promise<readonly SessionEntry[]>;
}
export interface MemoryFabricConsolidateOptions {
    readonly signal?: AbortSignal;
    /** Resume after this session entry; the package persists it in session state. */
    readonly cursor?: string;
}
/** `ran: false` names why a pass did no work; a busy trigger is dropped, not queued. */
export interface MemoryFabricConsolidateResult {
    readonly ran: boolean;
    /** `failed` is an extraction failure: nothing was written, the cursor stayed, and `report.failures` says why. */
    readonly reason?: "disabled" | "busy" | "empty" | "failed";
    /** The extractor's reason code when `reason` is `failed`; a code, never model text. */
    readonly reasonCode?: import("./consolidation/extract.js").ConsolidationExtractionReason;
    readonly cursor?: string;
    readonly report?: import("./promote.js").FabricConsolidationReport;
}
export interface MemoryFabric {
    readonly remember: (input: MemoryFabricRememberInput, options?: MemoryFabricWriteOptions) => Promise<MemoryNote>;
    /**
     * Run one consolidation pass now: gather, one extractor call, score, and write. The host calls it
     * before `session.close()`; no-op when `promote` is off.
     */
    readonly consolidate: (session: MemoryFabricConsolidateSource, options?: MemoryFabricConsolidateOptions) => Promise<MemoryFabricConsolidateResult>;
    readonly recall: (query: string, options?: MemoryFabricRecallOptions) => Promise<MemoryFabricRecallResult>;
    /** Lexical search over the current branch, each hit carrying the observational-memory page around it. */
    readonly searchConversation: (query: string, options?: MemoryFabricConversationSearchOptions) => Promise<MemoryFabricConversationSearchResult>;
    /** Tombstone a note: `memory.forget` (deleted, or retained under legal hold) or `updateWorking` (block). */
    readonly forget: (input: MemoryFabricForgetInput, options?: MemoryFabricWriteOptions) => Promise<MemoryFabricForgetResult>;
    /** Confirm a candidate note. False when it is missing or not a candidate. Metadata only: no model or embedding call. */
    readonly verify: (id: string, options?: MemoryFabricWriteOptions) => Promise<boolean>;
    /**
     * Exempt a note from archiving and capacity eviction (`pinned: false` unpins). Metadata only:
     * no model or embedding call. False when the note is missing.
     */
    readonly pin: (id: string, pinned?: boolean, options?: MemoryFabricWriteOptions) => Promise<boolean>;
    /**
     * Record at most one use per session per note and return the ids that became verified. A use is a
     * citation of a shown id, never a retrieval.
     */
    readonly recordUses: (sessionKey: string, ids: readonly string[], options?: import("./lifecycle/index.js").RecordUsesOptions) => Promise<readonly string[]>;
    /**
     * One maintenance pass over the configured scopes. Tasks 4-6 add archive, capacity, and widening;
     * today it fixes the capability gate: a store without `scanMetadata` refuses instead of scanning
     * nothing, and recall and writes are unaffected.
     */
    readonly maintain: (options?: MemoryFabricMaintainOptions) => Promise<MemoryFabricMaintenanceReport>;
    /** Fabric-filtered context: working prefix and opt-in semantic tail. */
    readonly registerContextBuild: (hooks: import("@arnilo/prism").HookRegistrar, options?: MemoryContextProviderOptions) => void;
    /** Fresh inert definitions each call; nothing is registered globally and nothing runs until the host adds them. */
    readonly tools: (options?: MemoryFabricToolsOptions) => readonly ToolDefinition[];
}
export interface MemoryFabricMaintainOptions {
    /** One resource id; archive and capacity run for that scope only, and widening is skipped. */
    readonly scope?: string;
    readonly signal?: AbortSignal;
}
/** What one maintenance pass changed (plan 188.4 Task 6). */
export interface MemoryFabricMaintenanceReport {
    readonly archived: number;
    /** Notes archived because a duplicate or episode cluster absorbed them. */
    readonly merged: number;
    /** Episode clusters summarised into one note; 0 unless `lifecycle.merge.episodes` is on. */
    readonly episodesMerged: number;
    readonly evicted: number;
    readonly widened: number;
    readonly superseded: number;
    /** Scopes still over `lifecycle.capacity` after the pass because the protected notes alone exceed it. */
    readonly overBudget: readonly MemoryFabricScopeBudget[];
}
/** One scope whose protected notes (pinned or high storage strength) alone exceed its budget. */
export interface MemoryFabricScopeBudget {
    readonly scope: string;
    readonly notes: number;
    readonly tokens: number;
    readonly limitNotes: number;
    readonly limitTokens: number;
}
/** Stored form of a note's fabric fields (the `v: 1` schema under {@link MEMORY_NOTE_METADATA_KEY}). */
export interface MemoryNoteMetadata {
    readonly v: 1;
    readonly kind: MemoryNoteKind;
    readonly tRef?: string;
    readonly validFrom?: string;
    readonly validTo?: string;
    readonly keywords?: readonly string[];
    readonly tags?: readonly string[];
    readonly context?: string;
    readonly links?: readonly MemoryNoteLink[];
    readonly sourceEntryIds?: readonly string[];
    readonly supersedes?: string;
    /** Set only on a note derived from a bound reflection; names the bind it graduated from. */
    readonly promotedFrom?: MemoryNotePromotion;
    /**
     * Stored as top-level vector `metadata.status` (the stores filter candidates there), not under the
     * fabric key. Absent means `verified`.
     */
    readonly status?: MemoryNoteStatus;
    /** The last 32 uses: the scope-session ordinal each use happened in and its wall time. */
    readonly uses?: readonly MemoryNoteUseEvent[];
    /** Distinct sessions the note has been used in. */
    readonly useSessions?: number;
    /** Returns from recall and injection, for diagnostics only. */
    readonly retrievals?: number;
    /** Outcome-tagged turns that credited this note. */
    readonly helpful?: number;
    /** User corrections that cited this note; a harmful note is never verified. */
    readonly harmful?: number;
    /** The last session that counted a use, so one session never counts twice. */
    readonly lastSession?: string;
    readonly path?: string;
    /** SHA-256 of the file contents read through the file jail. */
    readonly contentHash?: string;
    /** Write scope stored on the note; `path` notes live in the project resource. */
    readonly scope?: MemoryNoteScope;
    /** Globs the note applies to, project-root relative; present exactly when `scope` is `path`. */
    readonly appliesTo?: readonly string[];
    /** Stable subject id used for shadowing and widening. */
    readonly key?: string;
    /** Trust-scan classes a human edit tripped; kept until `memory.replace` or a clean human edit. */
    readonly flags?: readonly string[];
    /** When status: "archived", the timestamp it was archived; used for historical asOf queries. */
    readonly archivedAt?: string;
    /** The status to restore when a citation revives an archived note. */
    readonly archivedFrom?: MemoryNoteStatus;
    /** Exempt from archiving and capacity eviction. */
    readonly pinned?: boolean;
    /** Scope-session ordinal the note was written in; absent counts as 0 (older than the clock). */
    readonly created?: number;
    /** True when a verified note was edited after promotion; marked for plan 188.3 reconsolidation. */
    readonly reconsolidate?: boolean;
    /** The wider-scope note this exception shadows; same `key`, so narrowest-scope shadowing applies. */
    readonly overrides?: string;
    /** When a consolidation pass read this exchange; absent means the pass still gathers it. */
    readonly consolidatedAt?: string;
    /** Set when capacity merging archived this note into another; the survivor's id. */
    readonly mergedInto?: string;
    /** Set when widening archived this note into a wider scope; the wider note's id. */
    readonly widenedTo?: string;
    /** Project ids whose project note contradicts this wider note; ids only, never text. */
    readonly contradictedIn?: readonly string[];
    /** Score and signals of the consolidation pass that wrote the note. */
    readonly promotion?: MemoryNotePromotionStamp;
    /** Write provenance; stored top-level (next to `status`), not under the fabric key. */
    readonly generated?: MemoryNoteProvenance;
    /**
     * Keys under the fabric object this version does not know (written by a newer minor version). They are
     * carried through every rewrite and never shown to the model; `noteFields` omits them.
     */
    readonly unknown?: JsonObject;
}
/** Every key {@link parseMemoryNoteMetadata} reads from the fabric object; anything else is carried as `unknown`. */
export declare const MEMORY_NOTE_FABRIC_KEYS: ReadonlySet<string>;
/**
 * Why a fabric note cannot be read by this version, or `undefined` when it can (or is not a fabric note).
 * `version>1` is a note a newer version wrote; `invalid-fabric` is any other field this parser refuses.
 */
export declare function unreadableNoteReason(metadata: JsonObject | undefined): "version>1" | "invalid-fabric" | undefined;
export declare function isMemoryNoteKind(value: unknown): value is MemoryNoteKind;
/** Fail-closed parse of a `generated` stamp; a malformed one makes the whole note unparsable. */
export declare function parseMemoryNoteProvenance(value: unknown): MemoryNoteProvenance | undefined;
/** Project ids are `<slug>--<id8>`, the suffix the identity resolver produces. */
export declare const PROJECT_ID_PATTERN: RegExp;
/** Fail-closed parse of a promotion stamp: finite score, finite signal terms, non-empty pass. */
export declare function parsePromotionStamp(value: unknown): MemoryNotePromotionStamp | undefined;
/**
 * Fail-closed parse of the fabric fields on a vector record. Returns `undefined` when the
 * record is not a fabric note or carries a malformed field, so a corrupt row is never injected.
 */
export declare function parseMemoryNoteMetadata(metadata: JsonObject | undefined): MemoryNoteMetadata | undefined;
/** JSON-safe form of the fabric fields; `undefined` fields are dropped. */
export declare function encodeMemoryNoteMetadata(fields: Omit<MemoryNoteMetadata, "v">): JsonObject;
/**
 * True when `asOfMs` falls inside the note's validity window. The window is half-open:
 * `validFrom` is inclusive and `validTo` is exclusive, so a supersession never leaves two
 * current versions of one note at the boundary millisecond.
 */
export declare function isMemoryNoteValidAt(metadata: Pick<MemoryNoteMetadata, "validFrom" | "validTo">, asOfMs: number): boolean;
/** Note fields a hit/result carries, without the storage-only `v`/`kind` discriminator. */
/** Note fields a hit/result carries, without the storage-only `v`/`kind` discriminator. */
export type MemoryNoteFields = Omit<MemoryNoteMetadata, "v" | "kind" | "lastSession" | "scope"> & {
    readonly level?: MemoryNoteScope;
};
export declare function noteFields(metadata: MemoryNoteMetadata): MemoryNoteFields;
/** ponytail: 4-chars-per-token estimate; swap for a real tokenizer only if budgeting drifts. */
export declare function estimateNoteTokens(text: string): number;
