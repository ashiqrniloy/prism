import type { JsonObject, ModelClient, ModelRef, SecretRedactor, SessionEntry, ToolDefinition } from "@arnilo/prism";
import type {
  Memory,
  MemoryConsent,
  MemoryConsentInput,
  MemoryContextProviderOptions,
  MemoryScope,
  RecallScoringOptions,
} from "@arnilo/prism-memory-system/core";
import { MemoryValidationError } from "@arnilo/prism-memory-system/core";
import type { RecallBranchPageResult, RecallPageDetail, RecallPageDirection } from "../session/recall.js";
import type { MemoryWorkerLimitOptions } from "@arnilo/prism-memory-system/core";
import { isMemoryId } from "../session/types.js";
import type { MemoryNoteCoReadEvent, MemoryNoteUseEvent } from "./lifecycle/events.js";
import { readCoReadEvents, readUseEvents } from "./lifecycle/events.js";
import type { MemoryNoteStatus } from "./lifecycle/status.js";
import { isMemoryNoteStatus } from "./lifecycle/status.js";

/**
 * Note kinds a fabric record may carry. `episode` is reserved for the stored, immutable episode kind
 * (plan 219): `remember({ kind: "episode" })` fails with `episode_kind_not_available` until then. Working memory
 * left long-term memory (plan 216 Task 7); its name belongs to the WM component. `exchange` is the
 * verbatim archive of a completed user turn plus the assistant reply (plan 188.9 Task 7); the
 * archive writes it, never a tool call. `decision` is a standing rule with a rationale, a decision
 * status and optional supersession (plan 202 Task 11). The ontology's `concept` kind left memory for the wiki
 * (`@arnilo/prism-knowledge/wiki`, plan 216 Task 3): a stored concept note is unreadable here (`retired-concept`).
 */
export type MemoryNoteKind = "episode" | "fact" | "preference" | "procedure" | "decision" | "file" | "exchange";

export type { MemoryNoteCoReadEvent, MemoryNoteUseEvent } from "./lifecycle/events.js";
export type { MemoryNoteStatus } from "./lifecycle/status.js";

export const MEMORY_NOTE_KINDS: readonly MemoryNoteKind[] = ["episode", "fact", "preference", "procedure", "decision", "file", "exchange"];

/** Decision lifecycle, independent of the storage lifecycle (`candidate`/`verified`/`archived`). */
export type MemoryDecisionStatus = "proposed" | "active" | "superseded";
export const MEMORY_DECISION_STATUSES: readonly MemoryDecisionStatus[] = ["proposed", "active", "superseded"];

export function isMemoryDecisionStatus(value: unknown): value is MemoryDecisionStatus {
  return typeof value === "string" && (MEMORY_DECISION_STATUSES as readonly string[]).includes(value);
}

/** Only confirmed decisions are delivered passively; proposed and superseded stay readable by recall. */
export function isMemoryDecisionDeliverable(
  note:
    | Pick<MemoryNoteMetadata, "kind" | "decisionStatus" | "status">
    | { readonly kind: MemoryNoteKind; readonly decisionStatus?: MemoryDecisionStatus; readonly status?: string },
): boolean {
  return note.kind !== "decision" || (note.decisionStatus === "active" && note.status !== "candidate");
}

/** Storage levels a fabric reads and writes, narrowest first. `path` notes live in `project`; `team` is the
 * checked-in shared store, read-only to tools (plan 188.5 Task 3). */
export type FabricScopeLevel = "user" | "agent" | "team" | "project";
export type MemoryNoteScope = FabricScopeLevel | "path";
export const MEMORY_NOTE_SCOPES: readonly MemoryNoteScope[] = ["user", "agent", "team", "project", "path"];

const NOTE_KEY = /^[a-z0-9.-]{1,64}$/;

export function isMemoryNoteScope(value: unknown): value is MemoryNoteScope {
  return typeof value === "string" && (MEMORY_NOTE_SCOPES as readonly string[]).includes(value);
}

/** The default write scope per kind: user-wide preferences and everything learned in the project. */
export function defaultScopeFor(kind: MemoryNoteKind): MemoryNoteScope {
  return kind === "preference" ? "user" : "project";
}

/** Decisions are user, project or path rules; the agent and checked-in team scopes are not decision homes. */
export function isDecisionScope(scope: MemoryNoteScope | undefined): boolean {
  return scope === undefined || scope === "user" || scope === "project" || scope === "path";
}

/**
 * Validate `appliesTo`: 1–8 globs relative to the project root. No absolute path, no home path,
 * no `..` segment, no NUL, and no backslash (globs use `/`). Never resolved against the filesystem.
 */
export function validateAppliesTo(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new MemoryValidationError("appliesTo must be an array of 1-8 globs");
  }
  return value.map((glob) => {
    if (typeof glob !== "string" || glob.length === 0 || glob.length > 512) {
      throw new MemoryValidationError("each appliesTo glob must be a non-empty string of at most 512 characters");
    }
    if (glob.includes("\0") || glob.includes("\\")) throw new MemoryValidationError("appliesTo globs must not contain NUL or backslash");
    if (glob.startsWith("/") || glob.startsWith("~") || /^[A-Za-z]:/.test(glob)) {
      throw new MemoryValidationError(`appliesTo glob must be relative to the project root: ${glob}`);
    }
    if (glob.split("/").includes("..")) throw new MemoryValidationError(`appliesTo glob must not traverse upward: ${glob}`);
    return glob;
  });
}

export function validateNoteKey(value: unknown): string {
  if (typeof value !== "string" || !NOTE_KEY.test(value)) {
    throw new MemoryValidationError("key must match [a-z0-9.-]{1,64}");
  }
  return value;
}

/**
 * Kinds `recall` returns when the caller does not name kinds. `procedure` and `decision` are
 * opt-in: they are never mixed into an untyped recall.
 */
export const DEFAULT_RECALL_KINDS: readonly MemoryNoteKind[] = ["fact", "preference", "file", "exchange"];

/** Reserved `metadata` key holding the fabric note fields on a vector record. */
export const MEMORY_NOTE_METADATA_KEY = "fabric";

export interface MemoryNoteLink {
  /** Target note id (12-hex, same id space as observational memory). */
  readonly id: string;
  readonly relation?: string;
  /** Optional edge weight in [0,1]; 1 when absent. */
  readonly weight?: number;
}

/** How coarse a resolved date expression is; `resolved` is the start of that period. */
export type MemoryNoteDatePrecision = "day" | "week" | "month" | "year";

/**
 * One relative date expression in a note's text, resolved against its reference time by the
 * deterministic resolver (plan 202 Task 6). A reading, not a validity bound: the note still talks
 * about the whole span its text names.
 */
export interface MemoryNoteDate {
  /** The expression as written, e.g. `last Tuesday`. */
  readonly text: string;
  /** ISO timestamp: the start of the period `precision` names, UTC. */
  readonly resolved: string;
  readonly precision: MemoryNoteDatePrecision;
}

/** Who wrote a note. `human` is an external edit found by reconcile; the rest are programmatic writes. */
export type MemoryNoteActor = "agent" | "promotion" | "human" | "import" | "host" | "consolidation";

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
export function stampProvenance(
  by: MemoryNoteActor,
  at: string,
  extra: { readonly session?: string; readonly reflectionId?: string; readonly sourceEntryIds?: readonly string[] } = {},
): MemoryNoteProvenance {
  return {
    by,
    at,
    ...(extra.session === undefined ? {} : { session: extra.session }),
    ...(extra.reflectionId === undefined ? {} : { reflectionId: extra.reflectionId }),
    ...(extra.sourceEntryIds === undefined ? {} : { sourceEntryIds: [...extra.sourceEntryIds] }),
  };
}

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
  /** Write time of the backing record (vector `createdAt` / observation timestamp). */
  readonly ingestedAt: string;
  readonly tokenCount: number;
  /** Archive session identity, when recorded. */
  readonly session?: string;
  /** Reference time the note talks about; informational, not a validity bound. */
  readonly tRef?: string;
  /** Relative dates in the note text, resolved against `tRef`. */
  readonly dates?: readonly MemoryNoteDate[];
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly keywords?: readonly string[];
  readonly tags?: readonly string[];
  readonly context?: string;
  readonly links?: readonly MemoryNoteLink[];
  readonly sourceEntryIds?: readonly string[];
  readonly supersedes?: string;
  /** Why the decision was chosen; `kind: "decision"` only. */
  readonly rationale?: string;
  /** Decision lifecycle; absent on non-decisions. */
  readonly decisionStatus?: MemoryDecisionStatus;
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
  /** Last 16 answering turns that cited this note with others: ids and turn indexes, no text (plan 207 Task 4). */
  readonly coRead?: readonly MemoryNoteCoReadEvent[];
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
  /** Stable subject id used for shadowing; `[a-z0-9.-]{1,64}`. */
  readonly key?: string;
  /** A topic key the writer gave the note; the wiki reads it as a binding hint. LTM never binds. `[a-z0-9.-]{1,64}`. */
  readonly subject?: string;
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
  /**
   * Read-time hint: a newer same-subject hit this one is grouped under. It is inferred from `key`,
   * an explicit `supersedes` edge, or exchange subject terms; nothing is deleted or invalidated.
   */
  readonly supersededBy?: { readonly id: string; readonly at: string };
}

export interface MemoryFabricRememberInput {
  readonly kind: MemoryNoteKind;
  /** Optional note id; generated when absent. */
  readonly id?: string;
  /**
   * Derives content from an observational-memory reflection; `fact`/`procedure` only. The
   * reflection must exist in the attached session's ledger (work scopes were removed with the
   * observational attach surface), and `content` is not accepted with it.
   */
  readonly reflectionId?: string;
  /** Required for `fact`/`procedure`; defaults to `path` for `file`. */
  readonly content?: string;
  /** Workspace path, `kind: "file"` only. */
  readonly path?: string;
  /** SHA-256 of the file contents read through the file jail. */
  readonly contentHash?: string;
  readonly session?: string;
  readonly tRef?: string;
  readonly dates?: readonly MemoryNoteDate[];
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly keywords?: readonly string[];
  readonly tags?: readonly string[];
  readonly context?: string;
  readonly links?: readonly MemoryNoteLink[];
  /**
   * 1-8 note ids the note is grounded in (exchanges, with their steps, or other notes), stored as links
   * with relation `evidence`. Each must be readable wherever the note is read, or the write is rejected
   * (`not_found`). Required on a note tagged `lesson` (plan 209 Task 4).
   */
  readonly evidence?: readonly string[];
  readonly sourceEntryIds?: readonly string[];
  readonly supersedes?: string;
  /** Why the decision was chosen; `kind: "decision"` only. */
  readonly rationale?: string;
  /** Decision lifecycle; defaults to `proposed` for `kind: "decision"`. */
  readonly decisionStatus?: MemoryDecisionStatus;
  /** Where the note lives: `user`/`agent`/`project`, or `path` for a project note limited by globs. */
  readonly scope?: MemoryNoteScope;
  /** 1–8 project-root-relative globs; required exactly when `scope` is `path`. */
  readonly appliesTo?: readonly string[];
  /** Stable subject id, `[a-z0-9.-]{1,64}`; used for shadowing. */
  readonly key?: string;
  /** A topic key for the note; the wiki reads it as a binding hint. LTM never binds. */
  readonly subject?: string;
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
  readonly generatedBy?: "agent" | "host" | "import" | "promotion" | "human";
}

export interface MemoryFabricRecallOptions {
  readonly minSimilarity?: number;
  /** Workspace-relative file paths this session touched; a `path` note earns its prior only on a glob match. */
  readonly touchedPaths?: readonly string[];
  /** Reference-time interval, inclusive start and exclusive end. */
  readonly tRef?: { readonly from: string; readonly to: string };
  /** Time-scoped recall: only notes whose resolved date (else `tRef`) falls in the window, inclusive. */
  readonly from?: string;
  readonly to?: string;
  /** `relevance` (default) keeps the ranked order; `time` orders by resolved date, oldest first. */
  readonly order?: "relevance" | "time";
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
 * Observational-memory ledger source for reflection promotion and conversation search. A kernel `Session` satisfies this
 * (`{ session }`): the fabric folds the package's `state.log` records off the branch, so no attach
 * surface and no host-side ledger plumbing are involved.
 */
export interface MemoryFabricObservationSource {
  readonly session: { readonly id?: string; entries(): Promise<readonly SessionEntry[]> };
}

export interface MemoryFabricScopeBinding {
  readonly level: FabricScopeLevel;
  readonly memory: Memory;
}

export interface CreateMemoryFabricOptions {
  /** `recall.expansion` (plan 210 Task 3.1): expand the lexical query with informal and formal forms. Default off. */
  readonly queryExpansion?: boolean;
  /** `recall.gather` (plan 210 Task 3.1): add `gather` to the `memory.recall` tool. Default off. */
  readonly gather?: boolean;
  /** Optional private diagnostic observer; never changes ranking or model-visible content. */
  readonly onRecall?: (event: {
    readonly query: string;
    readonly options: MemoryFabricRecallOptions;
    readonly candidates: readonly { readonly id: string; readonly score: number }[];
    readonly returnedIds: readonly string[];
  }) => void;
  readonly inject?: false | import("./config.js").MemoryFabricInjectConfig;
  readonly memory: Memory;
  /**
   * The store behind `memory`, when the caller has it. `maintain()` needs `scanMetadata`; without a
   * store, or with one that cannot scan, it fails closed and leaves recall and writes alone.
   */
  readonly vectorStore?: import("@arnilo/prism-memory-system/core").VectorStore;
  /** One memory per active storage level; `memory` is the default when omitted. */
  readonly scopes?: readonly MemoryFabricScopeBinding[];
  /**
   * Levels that are recalled alongside `scopes` but never written or maintained — the team
   * store (plan 188.5 Task 3). They take part in fusion, key shadowing, and the recall priors.
   */
  readonly readOnlyScopes?: readonly MemoryFabricScopeBinding[];
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
  /** Needed only for `reflectionId` promotion and `searchConversation`; fabric stays fully inert without it. */
  readonly observational?: MemoryFabricObservationSource;
  /**
   * Deterministic near-duplicate folding on `fact`/`procedure`/`file` writes (default on): an
   * existing note at or above the threshold is rewritten in place when it is the same note, and
   * both notes are kept when its content differs. Pass `false` to write unconditionally.
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
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
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
  /** Indexed note id to tombstone. */
  readonly id: string;
  /** Retain the row as a legal hold instead of deleting it. */
  readonly hold?: boolean;
}

export interface MemoryFabricForgetResult {
  readonly id: string;
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
  readonly consolidate: (
    session: MemoryFabricConsolidateSource,
    options?: MemoryFabricConsolidateOptions,
  ) => Promise<MemoryFabricConsolidateResult>;
  readonly recall: (query: string, options?: MemoryFabricRecallOptions) => Promise<MemoryFabricRecallResult>;
  /** Lexical search over the current branch, each hit carrying the observational-memory page around it. */
  readonly searchConversation: (
    query: string,
    options?: MemoryFabricConversationSearchOptions,
  ) => Promise<MemoryFabricConversationSearchResult>;
  /** Tombstone a note: deleted, or retained under legal hold. */
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
  readonly recordUses: (
    sessionKey: string,
    ids: readonly string[],
    options?: import("./lifecycle/index.js").RecordUsesOptions,
  ) => Promise<readonly string[]>;
  /**
   * One maintenance pass over the configured scopes: archive, capacity, merge. A store without
   * `scanMetadata` refuses instead of scanning nothing, and recall and writes are unaffected.
   */
  readonly maintain: (options?: MemoryFabricMaintainOptions) => Promise<MemoryFabricMaintenanceReport>;
  /** Fabric-filtered context: directory and rules prefix and opt-in semantic tail. */
  readonly registerContextBuild: (hooks: import("@arnilo/prism").HookRegistrar, options?: MemoryContextProviderOptions) => void;
  /** Fresh inert definitions each call; nothing is registered globally and nothing runs until the host adds them. */
  readonly tools: (options?: MemoryFabricToolsOptions) => readonly ToolDefinition[];
}

export interface MemoryFabricMaintainOptions {
  /** One resource id; the pass runs for that scope only. */
  readonly scope?: string;
  readonly signal?: AbortSignal;
}

/** What one maintenance pass changed (plan 188.4 Tasks 4-5). */
export interface MemoryFabricMaintenanceReport {
  readonly archived: number;
  /** Notes archived because a duplicate absorbed them. */
  readonly merged: number;
  readonly evicted: number;
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
  readonly session?: string;
  readonly tRef?: string;
  readonly dates?: readonly MemoryNoteDate[];
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly keywords?: readonly string[];
  readonly tags?: readonly string[];
  readonly context?: string;
  readonly links?: readonly MemoryNoteLink[];
  readonly sourceEntryIds?: readonly string[];
  readonly supersedes?: string;
  /** Why the decision was chosen; `kind: "decision"` only. */
  readonly rationale?: string;
  /** Decision lifecycle; absent on non-decisions. */
  readonly decisionStatus?: MemoryDecisionStatus;
  /** Set only on a note derived from a bound reflection; names the bind it graduated from. */
  readonly promotedFrom?: MemoryNotePromotion;
  /**
   * Stored as top-level vector `metadata.status` (the stores filter candidates there), not under the
   * fabric key. Absent means `verified`.
   */
  readonly status?: MemoryNoteStatus;
  /** The last 32 uses: the scope-session ordinal each use happened in and its wall time. */
  readonly uses?: readonly MemoryNoteUseEvent[];
  /** The last 16 answering turns that cited this note together with others: ids and turn indexes only. */
  readonly coRead?: readonly MemoryNoteCoReadEvent[];
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
  /** Stable subject id used for shadowing. */
  readonly key?: string;
  /** A topic key the writer gave the note; the wiki reads it as a binding hint. LTM never binds. `[a-z0-9.-]{1,64}`. */
  readonly subject?: string;
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
export const MEMORY_NOTE_FABRIC_KEYS: ReadonlySet<string> = new Set([
  "v",
  "kind",
  "session",
  "tRef",
  "dates",
  "validFrom",
  "validTo",
  "keywords",
  "tags",
  "context",
  "links",
  "sourceEntryIds",
  "supersedes",
  "rationale",
  "decisionStatus",
  "promotedFrom",
  "uses",
  "coRead",
  "useSessions",
  "retrievals",
  "helpful",
  "harmful",
  "lastSession",
  "path",
  "contentHash",
  "scope",
  "appliesTo",
  "key",
  "subject",
  "flags",
  "archivedAt",
  "archivedFrom",
  "pinned",
  "created",
  "reconsolidate",
  "overrides",
  "consolidatedAt",
  "mergedInto",
  "contradictedIn",
  "promotion",
]);

/**
 * Why a fabric note cannot be read by this version, or `undefined` when it can (or is not a fabric note).
 * `version>1` is a note a newer version wrote; `invalid-fabric` is any other field this parser refuses.
 */
export function unreadableNoteReason(metadata: JsonObject | undefined): "version>1" | "invalid-fabric" | "retired-concept" | undefined {
  const raw = metadata?.[MEMORY_NOTE_METADATA_KEY];
  if (raw === undefined || raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  if (parseMemoryNoteMetadata(metadata) !== undefined) return undefined;
  // The ontology left memory (plan 216 Task 3): concepts now live in the wiki's own store.
  if ((raw as Record<string, unknown>).kind === "concept") return "retired-concept";
  const version = (raw as Record<string, unknown>).v;
  return typeof version === "number" && version > 1 ? "version>1" : "invalid-fabric";
}

export function isMemoryNoteKind(value: unknown): value is MemoryNoteKind {
  return typeof value === "string" && (MEMORY_NOTE_KINDS as readonly string[]).includes(value);
}

const isIsoTimestamp = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));

const isStringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);

const NOTE_DATE_PRECISIONS: readonly MemoryNoteDatePrecision[] = ["day", "week", "month", "year"];

/** Fail-closed parse of the additive `dates` field; a malformed entry makes the whole note unparsable. */
export function parseDates(value: unknown): readonly MemoryNoteDate[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const dates: MemoryNoteDate[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return undefined;
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "text" && key !== "resolved" && key !== "precision")) return undefined;
    if (typeof record.text !== "string" || record.text.trim().length === 0) return undefined;
    if (!isIsoTimestamp(record.resolved)) return undefined;
    if (!(NOTE_DATE_PRECISIONS as readonly unknown[]).includes(record.precision)) return undefined;
    dates.push({ text: record.text, resolved: record.resolved, precision: record.precision as MemoryNoteDatePrecision });
  }
  return dates;
}

const NOTE_ACTORS: readonly MemoryNoteActor[] = ["agent", "promotion", "human", "import", "host", "consolidation"];

/** Fail-closed parse of a `generated` stamp; a malformed one makes the whole note unparsable. */
export function parseMemoryNoteProvenance(value: unknown): MemoryNoteProvenance | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.by !== "string" || !(NOTE_ACTORS as readonly string[]).includes(record.by) || !isIsoTimestamp(record.at))
    return undefined;
  if (record.session !== undefined && (typeof record.session !== "string" || record.session.length === 0)) return undefined;
  if (record.reflectionId !== undefined && !isMemoryId(record.reflectionId)) return undefined;
  if (record.sourceEntryIds !== undefined && !isStringList(record.sourceEntryIds)) return undefined;
  return {
    by: record.by as MemoryNoteActor,
    at: record.at,
    ...(record.session === undefined ? {} : { session: record.session as string }),
    ...(record.reflectionId === undefined ? {} : { reflectionId: record.reflectionId as string }),
    ...(record.sourceEntryIds === undefined ? {} : { sourceEntryIds: [...(record.sourceEntryIds as readonly string[])] }),
  };
}

/** Project ids are `<slug>--<id8>`, the suffix the identity resolver produces. */
export const PROJECT_ID_PATTERN = /^[a-z0-9-]{1,40}--[0-9a-f]{8}$/;

/** Fail-closed parse of a promotion stamp: finite score, finite signal terms, non-empty pass. */
export function parsePromotionStamp(value: unknown): MemoryNotePromotionStamp | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "score" && key !== "signals" && key !== "pass")) return undefined;
  const { score, pass, signals } = record;
  if (typeof score !== "number" || !Number.isFinite(score)) return undefined;
  if (typeof pass !== "string" || pass.length === 0) return undefined;
  if (signals === null || typeof signals !== "object" || Array.isArray(signals)) return undefined;
  const terms: Record<string, number> = {};
  for (const [name, term] of Object.entries(signals)) {
    if (typeof term !== "number" || !Number.isFinite(term)) return undefined;
    terms[name] = term;
  }
  return { score, signals: terms, pass };
}

/** `subject` may sit on any kind: a topic key, `[a-z0-9.-]{1,64}`. */
function parseSubjectField(record: Record<string, unknown>): boolean {
  return record.subject === undefined || (typeof record.subject === "string" && NOTE_KEY.test(record.subject));
}

/**
 * Fail-closed parse of the fabric fields on a vector record. Returns `undefined` when the
 * record is not a fabric note or carries a malformed field, so a corrupt row is never injected.
 */
export function parseMemoryNoteMetadata(metadata: JsonObject | undefined): MemoryNoteMetadata | undefined {
  const raw = metadata?.[MEMORY_NOTE_METADATA_KEY];
  const status = metadata?.status;
  if (status !== undefined && !isMemoryNoteStatus(status)) return undefined;
  let generated: MemoryNoteProvenance | undefined;
  if (metadata?.generated !== undefined) {
    generated = parseMemoryNoteProvenance(metadata.generated);
    if (generated === undefined) return undefined;
  }
  if (raw === undefined || raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.v !== 1 || !isMemoryNoteKind(record.kind)) return undefined;
  if (record.session !== undefined && (typeof record.session !== "string" || !record.session.trim())) return undefined;
  const dates = record.dates === undefined ? undefined : parseDates(record.dates);
  if (record.dates !== undefined && dates === undefined) return undefined;
  const promotion = record.promotion === undefined ? undefined : parsePromotionStamp(record.promotion);
  if (record.promotion !== undefined && promotion === undefined) return undefined;
  if (record.flags !== undefined && !isStringList(record.flags)) return undefined;
  for (const key of ["tRef", "validFrom", "validTo"] as const) {
    if (record[key] !== undefined && !isIsoTimestamp(record[key])) return undefined;
  }
  for (const key of ["keywords", "tags", "sourceEntryIds"] as const) {
    if (record[key] !== undefined && !isStringList(record[key])) return undefined;
  }
  if (record.context !== undefined && (typeof record.context !== "string" || record.context.length === 0)) return undefined;
  if (record.supersedes !== undefined && !isMemoryId(record.supersedes)) return undefined;
  if (record.rationale !== undefined && (typeof record.rationale !== "string" || record.rationale.trim().length === 0)) return undefined;
  if (record.decisionStatus !== undefined && !isMemoryDecisionStatus(record.decisionStatus)) return undefined;
  if (!parseSubjectField(record)) return undefined;
  if (record.kind === "decision" && record.decisionStatus === undefined) return undefined;
  if (record.kind !== "decision" && (record.rationale !== undefined || record.decisionStatus !== undefined)) return undefined;
  const uses = record.uses === undefined ? [] : readUseEvents(record.uses);
  if (uses === undefined) return undefined;
  const coRead = record.coRead === undefined ? [] : readCoReadEvents(record.coRead);
  if (coRead === undefined) return undefined;
  for (const key of ["useSessions", "retrievals", "helpful", "harmful"] as const) {
    if (record[key] !== undefined && (!Number.isSafeInteger(record[key]) || (record[key] as number) < 0)) return undefined;
  }
  if (record.lastSession !== undefined && (typeof record.lastSession !== "string" || record.lastSession.length === 0)) return undefined;
  if (record.path !== undefined && (typeof record.path !== "string" || record.path.length === 0)) return undefined;
  if (record.contentHash !== undefined && (typeof record.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(record.contentHash)))
    return undefined;
  if (record.archivedAt !== undefined && !isIsoTimestamp(record.archivedAt)) return undefined;
  if (record.consolidatedAt !== undefined && !isIsoTimestamp(record.consolidatedAt)) return undefined;
  if (record.archivedFrom !== undefined && record.archivedFrom !== "candidate" && record.archivedFrom !== "verified") return undefined;
  if (record.pinned !== undefined && typeof record.pinned !== "boolean") return undefined;
  if (record.created !== undefined && (!Number.isSafeInteger(record.created) || (record.created as number) < 0)) return undefined;
  if (record.reconsolidate !== undefined && typeof record.reconsolidate !== "boolean") return undefined;
  if (record.overrides !== undefined && !isMemoryId(record.overrides)) return undefined;
  if (record.mergedInto !== undefined && !isMemoryId(record.mergedInto)) return undefined;
  if (record.contradictedIn !== undefined) {
    if (!isStringList(record.contradictedIn) || record.contradictedIn.some((id) => !PROJECT_ID_PATTERN.test(id))) return undefined;
  }
  if (record.promotion !== undefined && parsePromotionStamp(record.promotion) === undefined) return undefined;
  if (record.scope !== undefined && !isMemoryNoteScope(record.scope)) return undefined;
  if (record.appliesTo !== undefined) {
    try {
      validateAppliesTo(record.appliesTo);
    } catch {
      return undefined;
    }
  }
  if ((record.scope === "path") !== (record.appliesTo !== undefined)) return undefined;
  if (record.key !== undefined && (typeof record.key !== "string" || !NOTE_KEY.test(record.key))) return undefined;
  let promotedFrom: MemoryNotePromotion | undefined;
  if (record.promotedFrom !== undefined) {
    if (record.promotedFrom === null || typeof record.promotedFrom !== "object" || Array.isArray(record.promotedFrom)) return undefined;
    const source = record.promotedFrom as Record<string, unknown>;
    if (!isMemoryId(source.reflectionId)) return undefined;
    promotedFrom = {
      reflectionId: source.reflectionId,
      ...(typeof source.scopeId === "string" && source.scopeId.length > 0 ? { scopeId: source.scopeId } : {}),
    };
  }
  let links: readonly MemoryNoteLink[] | undefined;
  if (record.links !== undefined) {
    if (!Array.isArray(record.links)) return undefined;
    const parsedLinks: MemoryNoteLink[] = [];
    for (const link of record.links) {
      if (link === null || typeof link !== "object" || Array.isArray(link)) return undefined;
      const item = link as Record<string, unknown>;
      if (!isMemoryId(item.id)) return undefined;
      if (item.relation !== undefined && typeof item.relation !== "string") return undefined;
      if (item.weight !== undefined && (typeof item.weight !== "number" || !Number.isFinite(item.weight))) return undefined;
      parsedLinks.push({
        id: item.id,
        ...(item.relation === undefined ? {} : { relation: item.relation as string }),
        ...(item.weight === undefined ? {} : { weight: item.weight as number }),
      });
    }
    links = parsedLinks;
  }
  const unknown = Object.fromEntries(Object.entries(record).filter(([key]) => !MEMORY_NOTE_FABRIC_KEYS.has(key))) as JsonObject;
  return {
    v: 1,
    kind: record.kind,
    ...(Object.keys(unknown).length === 0 ? {} : { unknown }),
    ...(record.session === undefined ? {} : { session: record.session as string }),
    ...(record.tRef === undefined ? {} : { tRef: record.tRef as string }),
    ...(dates === undefined ? {} : { dates }),
    ...(record.validFrom === undefined ? {} : { validFrom: record.validFrom as string }),
    ...(record.validTo === undefined ? {} : { validTo: record.validTo as string }),
    ...(record.keywords === undefined ? {} : { keywords: record.keywords as readonly string[] }),
    ...(record.tags === undefined ? {} : { tags: record.tags as readonly string[] }),
    ...(record.context === undefined ? {} : { context: record.context as string }),
    ...(links === undefined ? {} : { links }),
    ...(record.sourceEntryIds === undefined ? {} : { sourceEntryIds: record.sourceEntryIds as readonly string[] }),
    ...(record.supersedes === undefined ? {} : { supersedes: record.supersedes as string }),
    ...(record.rationale === undefined ? {} : { rationale: record.rationale as string }),
    ...(record.decisionStatus === undefined ? {} : { decisionStatus: record.decisionStatus as MemoryDecisionStatus }),
    ...(promotedFrom === undefined ? {} : { promotedFrom }),
    ...(status === undefined ? {} : { status }),
    ...(uses.length === 0 ? {} : { uses }),
    ...(coRead.length === 0 ? {} : { coRead }),
    ...(record.useSessions === undefined ? {} : { useSessions: record.useSessions as number }),
    ...(record.retrievals === undefined ? {} : { retrievals: record.retrievals as number }),
    ...(record.helpful === undefined ? {} : { helpful: record.helpful as number }),
    ...(record.harmful === undefined ? {} : { harmful: record.harmful as number }),
    ...(record.lastSession === undefined ? {} : { lastSession: record.lastSession as string }),
    ...(record.path === undefined ? {} : { path: record.path as string }),
    ...(record.contentHash === undefined ? {} : { contentHash: record.contentHash as string }),
    ...(record.scope === undefined ? {} : { scope: record.scope as MemoryNoteScope }),
    ...(record.appliesTo === undefined ? {} : { appliesTo: record.appliesTo as readonly string[] }),
    ...(record.key === undefined ? {} : { key: record.key as string }),
    ...(record.subject === undefined ? {} : { subject: record.subject as string }),
    ...(record.flags === undefined ? {} : { flags: record.flags as readonly string[] }),
    ...(record.archivedAt === undefined ? {} : { archivedAt: record.archivedAt as string }),
    ...(record.consolidatedAt === undefined ? {} : { consolidatedAt: record.consolidatedAt as string }),
    ...(record.archivedFrom === undefined ? {} : { archivedFrom: record.archivedFrom as MemoryNoteStatus }),
    ...(record.pinned === undefined ? {} : { pinned: record.pinned as boolean }),
    ...(record.created === undefined ? {} : { created: record.created as number }),
    ...(record.reconsolidate === true ? { reconsolidate: true } : {}),
    ...(record.overrides === undefined ? {} : { overrides: record.overrides as string }),
    ...(record.mergedInto === undefined ? {} : { mergedInto: record.mergedInto as string }),
    ...(record.contradictedIn === undefined ? {} : { contradictedIn: record.contradictedIn as readonly string[] }),
    ...(promotion === undefined ? {} : { promotion }),
    ...(generated === undefined ? {} : { generated }),
  };
}

/** JSON-safe form of the fabric fields; `undefined` fields are dropped. */
export function encodeMemoryNoteMetadata(fields: Omit<MemoryNoteMetadata, "v">): JsonObject {
  // Unknown keys go first so a known key can never be shadowed by one a newer version wrote.
  const encoded: Record<string, unknown> = { ...fields.unknown, v: 1, kind: fields.kind };
  for (const [key, value] of Object.entries(fields)) {
    // `status` and `generated` live top-level on record metadata, not under the fabric key.
    if (key !== "kind" && key !== "status" && key !== "generated" && key !== "unknown" && value !== undefined) encoded[key] = value;
  }
  return encoded as JsonObject;
}

/**
 * True when `asOfMs` falls inside the note's validity window. The window is half-open:
 * `validFrom` is inclusive and `validTo` is exclusive, so a supersession never leaves two
 * current versions of one note at the boundary millisecond.
 */
export function isMemoryNoteValidAt(metadata: Pick<MemoryNoteMetadata, "validFrom" | "validTo">, asOfMs: number): boolean {
  if (metadata.validFrom !== undefined && Date.parse(metadata.validFrom) > asOfMs) return false;
  if (metadata.validTo !== undefined && Date.parse(metadata.validTo) <= asOfMs) return false;
  return true;
}

/** Note fields a hit/result carries, without the storage-only `v`/`kind` discriminator. */
/** Note fields a hit/result carries, without the storage-only `v`/`kind` discriminator. */
export type MemoryNoteFields = Omit<MemoryNoteMetadata, "v" | "kind" | "lastSession" | "scope"> & {
  readonly level?: MemoryNoteScope;
};

export function noteFields(metadata: MemoryNoteMetadata): MemoryNoteFields {
  const { v: _v, kind: _kind, lastSession: _lastSession, unknown: _unknown, scope, ...fields } = metadata;
  return { ...fields, ...(scope === undefined ? {} : { level: scope }) };
}

/** ponytail: 4-chars-per-token estimate; swap for a real tokenizer only if budgeting drifts. */
export function estimateNoteTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
