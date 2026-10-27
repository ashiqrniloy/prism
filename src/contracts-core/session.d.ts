/** Contracts-core session family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */
import type { AgentEvent } from "../contracts-protocol.js";
import type { Message, ModelConfig } from "./content.js";
import type { OwnershipScope, PersistencePage, PersistenceQuery } from "./persistence.js";
export type SessionEntryKind = "message" | "event" | "summary" | "metadata" | "model_change" | "label" | "custom" | "compaction" | "suspended_run" | "package_state" | "external_state";
export declare const SESSION_ENTRY_KINDS: readonly SessionEntryKind[];
export declare const SESSION_ENTRY_SCHEMA_VERSION = 1;
export declare function isSessionEntryKind(value: unknown): value is SessionEntryKind;
export interface SessionEntry {
    readonly id: string;
    readonly parentId?: string;
    readonly sessionId: string;
    readonly timestamp: string;
    readonly kind: SessionEntryKind;
    readonly schemaVersion?: 1;
    readonly runId?: string;
    readonly message?: Message;
    readonly event?: AgentEvent;
    readonly model?: ModelConfig;
    readonly previousModel?: ModelConfig;
    readonly label?: string;
    readonly summary?: string;
    readonly data?: unknown;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface SessionStore {
    append(entry: SessionEntry, options?: SessionAppendOptions): Promise<void>;
    list(sessionId: string): Promise<readonly SessionEntry[]>;
    get?(id: string): Promise<SessionEntry | undefined>;
    /** DB-friendly branch read: return one branch's ancestor chain as a page so adapters
     *  avoid `list(sessionId)` (full-session scan) + in-memory rebuild. Optional — the
     *  built-in JSONL store omits it and the runtime falls back to `list()`. The memory
     *  store implements it. */
    readBranchPath?(query: SessionBranchRead): Promise<PersistencePage<SessionEntry>>;
    /**
     * Optional bounded session search. Prefer implementing this **or** returning a companion
     * `SessionSearchIndex` from the adapter factory — hosts must not need both. Call
     * `resolveSessionSearchQuery` before scan/query. Memory and JSONL default to capped linear
     * search (memory `sessionSearchMode: "unsupported"` throws); DB adapters index.
     */
    searchSessions?(query: SessionSearchQuery): Promise<PersistencePage<SessionSearchHit>>;
    /**
     * Optional store capability behind `agent.sessions.list()`: a page of session summaries, newest first by
     * default, restricted to sessions whose every entry carries the query's ownership scope. A page never
     * loads entries into the caller. A store without it answers `agent.sessions.list()` with
     * `UnsupportedStoreCapabilityError`. The kernel memory store implements it; durable stores follow in Phase 6.
     */
    listSessions?(query: SessionListQuery): Promise<PersistencePage<SessionSummary>>;
    /**
     * Optional store capability behind `agent.sessions.delete()`: removes every entry of the session and resolves
     * `true`, or resolves `false` (and removes nothing) when the session is absent or any entry is outside `scope`.
     */
    deleteSession?(sessionId: string, scope?: OwnershipScope): Promise<boolean>;
}
/** Who drives a session: Prism itself, or an external agent a driver runs. Set by the host, never derived. */
export interface SessionActor {
    readonly kind: "prism" | "external";
    readonly agent: string;
    /** Opaque, set by the driver. */
    readonly vendor?: string;
}
/** Link ids are opaque strings; one id may be at most this many characters. */
export declare const MAX_SESSION_LINK_ID_LENGTH = 256;
/** The parent link a session is opened with (`SessionOptions.parent`). */
export interface SessionParentLink {
    readonly sessionId?: string;
    readonly agentId?: string;
    readonly workflowRunId?: string;
    readonly delegationId?: string;
}
/** Links persisted for a session in its first `metadata` entry, under `data[SESSION_LINKS_DATA_KEY]`. */
export interface SessionLinks extends SessionParentLink {
    readonly actor?: SessionActor;
}
/** `data` key of the `metadata` entry holding a session's `SessionLinks`. The entry is the source of truth; SQL stores index it. */
export declare const SESSION_LINKS_DATA_KEY: "links";
/** Link filters shared by `SessionListQuery` and `SessionSearchQuery`. Each is an exact match; none widens the ownership scope. */
export interface SessionLinkFilter {
    readonly agentId?: string;
    readonly parentSessionId?: string;
    readonly workflowRunId?: string;
    readonly delegationId?: string;
    readonly actorKind?: SessionActor["kind"];
    readonly actorAgent?: string;
}
/** Bounded page request for `SessionStore.listSessions`. The scope is the agent's `ownership`. */
export interface SessionListQuery extends PersistenceQuery, OwnershipScope, SessionLinkFilter {
    readonly signal?: AbortSignal;
}
/** Safe summary of one session for listings. Never a transcript or a credential. */
export interface SessionSummary {
    readonly sessionId: string;
    /** The branch tip, for `agent.session({ id, leafId })`. */
    readonly leafId?: string;
    readonly createdAt?: string;
    readonly updatedAt?: string;
    /** Count of message entries; display-only. */
    readonly messageCount: number;
    /** The `title` session metadata, when the host wrote one. */
    readonly title?: string;
    /** Safe display fields only (e.g. `workspaceRoot`). */
    readonly metadata?: Readonly<Record<string, unknown>>;
    /** `SessionOptions.parent.agentId`, when the session was opened with a parent link. */
    readonly agentId?: string;
    readonly parentSessionId?: string;
    readonly workflowRunId?: string;
    readonly delegationId?: string;
    readonly actor?: SessionActor;
}
export declare const DEFAULT_SESSION_LIST_LIMIT = 20;
export declare const HARD_MAX_SESSION_LIST_LIMIT = 100;
export type SessionStoreCapability = "listSessions" | "deleteSession" | "searchSessions";
export declare const UNSUPPORTED_STORE_CAPABILITY_CODE: "unsupported_store_capability";
/** Thrown by `agent.sessions` when the resolved `store` slot does not declare the capability the call needs. */
export declare class UnsupportedStoreCapabilityError extends Error {
    readonly capability: SessionStoreCapability;
    readonly code: "unsupported_store_capability";
    constructor(capability: SessionStoreCapability);
}
export declare function isUnsupportedStoreCapability(error: unknown): error is UnsupportedStoreCapabilityError;
/** Host-written `SessionRecord.metadata` / session metadata key for workspace filtering. */
export declare const SESSION_SEARCH_WORKSPACE_METADATA_KEY: "workspaceRoot";
/** Host-written session metadata key for the human-readable session title (first prompt or `/rename`). */
export declare const SESSION_TITLE_METADATA_KEY: "title";
/** Maximum title length in characters a host should store under `SESSION_TITLE_METADATA_KEY`. */
export declare const SESSION_TITLE_MAX_LENGTH = 80;
export declare const DEFAULT_SESSION_SEARCH_LIMIT = 20;
export declare const HARD_MAX_SESSION_SEARCH_LIMIT = 100;
export declare const DEFAULT_MAX_SESSION_SEARCH_QUERY_BYTES: number;
export declare const HARD_MAX_SESSION_SEARCH_QUERY_BYTES: number;
export declare const DEFAULT_MAX_SESSION_SEARCH_SNIPPET_BYTES = 512;
export declare const HARD_MAX_SESSION_SEARCH_SNIPPET_BYTES: number;
export declare const DEFAULT_MAX_SESSION_SEARCH_CURSOR_BYTES: number;
export declare const HARD_MAX_SESSION_SEARCH_CURSOR_BYTES: number;
export declare const DEFAULT_MAX_SESSION_SEARCH_LINEAR_SESSIONS = 1000;
export declare const HARD_MAX_SESSION_SEARCH_LINEAR_SESSIONS = 5000;
export declare const DEFAULT_MAX_SESSION_SEARCH_LINEAR_ENTRIES = 10000;
export declare const HARD_MAX_SESSION_SEARCH_LINEAR_ENTRIES = 50000;
export declare const DEFAULT_MAX_SESSION_SEARCH_LINEAR_BYTES: number;
export declare const HARD_MAX_SESSION_SEARCH_LINEAR_BYTES: number;
export declare const DEFAULT_MAX_SESSION_SEARCH_FTS_CANDIDATES = 1000;
export declare const HARD_MAX_SESSION_SEARCH_FTS_CANDIDATES = 5000;
/** Entry-kind filter for `SessionSearchQuery.kind`; `"any"` (the default) matches every kind. */
export type SessionSearchKind = SessionEntryKind | "any";
/** Bounded session search filters. Workspace matches host-written `metadata.workspaceRoot`. */
export interface SessionSearchQuery extends PersistenceQuery, OwnershipScope, SessionLinkFilter {
    readonly workspaceRoot?: string;
    /** Optional full-text / message+summary query (adapter-defined matching). */
    readonly query?: string;
    /**
     * Restrict the text `query` to entries of these kinds (one kind or a list). Omitted or `"any"`
     * matches every kind. Annotation search is `kind: ["label", "summary", "metadata", "custom"]`.
     */
    readonly kind?: SessionSearchKind | readonly SessionSearchKind[];
    readonly provider?: string;
    readonly model?: string;
    readonly label?: string;
    readonly summary?: string;
    readonly fromUpdatedAt?: string;
    readonly toUpdatedAt?: string;
    readonly signal?: AbortSignal;
}
/**
 * Safe search hit for resume/checkout. Never includes credentials or raw full transcripts.
 * `leafId` is the branch tip for `session.checkout` when known; when a text `query` matched,
 * `entryId`/`runId`/`turn`/`score` point at the matched entry and `snippet` is its matched text.
 */
export interface SessionSearchHit {
    readonly sessionId: string;
    readonly leafId?: string;
    /** Transcript entry that matched the text `query` (absent for filter-only searches). */
    readonly entryId?: string;
    /** Run that wrote the matched entry. */
    readonly runId?: string;
    /** 1-based position of the matched entry in the session transcript (`(timestamp, id)` order). */
    readonly turn?: number;
    /** Matched-entry relevance from the store's full-text index; higher is better (0 is a valid score). */
    readonly score?: number;
    readonly updatedAt?: string;
    /** Count of message entries in the session; display-only, never the full transcript. */
    readonly messageCount?: number;
    readonly label?: string;
    readonly summary?: string;
    readonly snippet?: string;
    /** Safe display fields only (e.g. workspaceRoot); never credentials. */
    readonly metadata?: Readonly<Record<string, unknown>>;
}
/** Narrow search seam; adapters may implement this instead of `SessionStore.searchSessions`. */
export interface SessionSearchIndex {
    search(query: SessionSearchQuery): Promise<PersistencePage<SessionSearchHit>>;
}
/** Validated search query with finite `limit` / `order` filled in and `kind` normalized. */
export interface ResolvedSessionSearchQuery extends SessionSearchQuery {
    readonly limit: number;
    readonly order: "asc" | "desc";
    /** Concrete kinds to match, or `undefined` for "any". */
    readonly kind?: readonly SessionEntryKind[];
}
/**
 * O(1) validation before any scan/query. Applies default page limit; rejects NaN,
 * non-positive limits, oversize query/cursor/filter strings, and invalid order.
 */
export declare function resolveSessionSearchQuery(query: SessionSearchQuery): ResolvedSessionSearchQuery;
/** Fail closed on a link filter that is not a bounded string (or a known actor kind). */
export declare function assertSessionLinkFilter(filter: SessionLinkFilter): void;
/** Validate the links a session is opened with. Ids are opaque; only length and type are checked. */
export declare function assertSessionLinks(links: SessionLinks): void;
export declare const SESSION_SEARCH_UNSUPPORTED_CODE: "session_search_unsupported";
/** Thrown when a store opts out of `searchSessions` (memory `sessionSearchMode: "unsupported"`). */
export declare class SessionSearchUnsupportedError extends Error {
    readonly code: "session_search_unsupported";
    constructor(message?: string);
}
export declare function isSessionSearchUnsupported(error: unknown): error is SessionSearchUnsupportedError;
export declare const SESSION_NOT_FOUND_CODE: "session_not_found";
/** Thrown when `agent.session({ id, create: true })` cannot find the requested session or its branch in the store slot, or across ownership scopes. */
export declare class SessionNotFoundError extends Error {
    readonly sessionId: string;
    readonly code: "session_not_found";
    constructor(sessionId: string, message?: string);
}
export declare function isSessionNotFound(error: unknown): error is SessionNotFoundError;
export declare const OWNERSHIP_WIDEN_CODE: "ERR_PRISM_OWNERSHIP_WIDEN";
/**
 * Thrown when a session or run ownership scope sets a field the enclosing scope already fixed to a
 * different value (plan 177 Task 4): scope narrows, never widens.
 */
export declare class OwnershipScopeError extends Error {
    readonly code: "ERR_PRISM_OWNERSHIP_WIDEN";
    constructor(message?: string);
}
/** Query for a single branch's ancestor chain (DB-friendly: one recursive/ancestor query
 *  instead of a full-session scan). Honored by `SessionStore.readBranchPath` and the pure
 *  branch helpers' reader overload. `leafId` is optional (omit for the latest leaf). */
export interface SessionBranchRead {
    readonly sessionId: string;
    readonly leafId?: string;
    readonly cursor?: string;
    readonly limit?: number;
}
/** Database-neutral callable returning one branch's ancestor chain as a page. Implementations
 *  issue a single recursive CTE / ancestor walk; the pure helpers follow `nextCursor` to
 *  completion. Returns redacted `SessionEntry` values only (stores already persist redacted
 *  entries; the runtime redacts before append). */
export type BranchReader = (query: SessionBranchRead) => Promise<PersistencePage<SessionEntry>>;
/**
 * Options for `SessionStore.append`. Stores that honor them reject dangling
 * `expectedParentId` values and deduplicate exact retries by `idempotencyKey` +
 * parent. Production stores may add stricter branch-tip CAS and report
 * `currentLeafId` in `SessionAppendConflictError`. `idempotencyKey` is an opaque
 * host string; stores redact it like metadata when persisted. Carries no
 * credentials, credential resolvers, provider instances, or unredacted secrets.
 */
export interface SessionAppendOptions {
    /** Parent entry the new entry should attach to. Must exist when provided. */
    readonly expectedParentId?: string;
    /** Opaque host idempotency key; exact retries for one parent deduplicate. */
    readonly idempotencyKey?: string;
}
/**
 * Durable pointer to a branch tip. One session may own many handles (one per
 * leaf). `BranchRecord.leafEntryId` is the persistence-side equivalent.
 */
export interface SessionBranchHandle {
    readonly sessionId: string;
    readonly leafId: string;
}
/** Stable error code carried by `SessionAppendConflictError`. */
export declare const SESSION_APPEND_CONFLICT_CODE: "session_append_conflict";
/** CAS conflict code for `appendSession` metadata writes. Stable and message-independent. */
export declare const SESSION_METADATA_CONFLICT_CODE: "metadata_conflict";
/** Conflict details carried by `SessionMetadataConflictError`. Versions only; never metadata content. */
export interface SessionMetadataConflict {
    readonly code: typeof SESSION_METADATA_CONFLICT_CODE;
    readonly id: string;
    readonly expectedVersion: number;
    readonly currentVersion: number;
}
/**
 * Thrown when `appendSession` is called with an `expectedVersion` CAS guard and the
 * stored session's version no longer matches (concurrent create/branch/archive, or a
 * delete raced the write). Recognize via the stable `code` or `isSessionMetadataConflict`.
 */
export declare class SessionMetadataConflictError extends Error {
    readonly conflict: SessionMetadataConflict;
    readonly code: "metadata_conflict";
    constructor(conflict: SessionMetadataConflict);
}
/** Type guard keyed off the stable `code` (works across bundles; not message text). */
export declare function isSessionMetadataConflict(error: unknown): error is SessionMetadataConflictError;
/** Conflict details carried by `SessionAppendConflictError`. Carries no secrets. */
export interface SessionAppendConflict {
    readonly code: typeof SESSION_APPEND_CONFLICT_CODE;
    readonly expectedParentId?: string;
    readonly currentLeafId?: string;
    readonly idempotencyDuplicate?: boolean;
}
/**
 * Thrown when `SessionStore.append` rejects an entry under `SessionAppendOptions`
 * (dangling/stale `expectedParentId`, stricter adapter CAS failure, or duplicate
 * idempotency key for the same parent). Recognize via the stable `code` and
 * `isSessionAppendConflict`, not message text.
 */
export declare class SessionAppendConflictError extends Error {
    readonly conflict: SessionAppendConflict;
    readonly code: "session_append_conflict";
    constructor(conflict: SessionAppendConflict);
}
/** Type guard keyed off the stable `code` (works across bundles; not message text). */
export declare function isSessionAppendConflict(error: unknown): error is SessionAppendConflictError;
