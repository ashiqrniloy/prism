/** Contracts-core session family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */
import type { AgentEvent } from "../contracts-protocol.js";
import type { Message, ModelConfig } from "./content.js";
import type { OwnershipScope, PersistencePage, PersistenceQuery } from "./persistence.js";

export type SessionEntryKind = "message" | "event" | "summary" | "metadata" | "model_change" | "label" | "custom" | "compaction";

export const SESSION_ENTRY_KINDS: readonly SessionEntryKind[] = [
  "message",
  "event",
  "summary",
  "metadata",
  "model_change",
  "label",
  "custom",
  "compaction",
];

const SESSION_ENTRY_KIND_SET: ReadonlySet<SessionEntryKind> = new Set(SESSION_ENTRY_KINDS);

export const SESSION_ENTRY_SCHEMA_VERSION = 1;

export function isSessionEntryKind(value: unknown): value is SessionEntryKind {
  return typeof value === "string" && SESSION_ENTRY_KIND_SET.has(value as SessionEntryKind);
}

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
   *  built-in memory/JSONL stores omit it and the runtime falls back to `list()`. */
  readBranchPath?(query: SessionBranchRead): Promise<PersistencePage<SessionEntry>>;
  /**
   * Optional bounded session search. Prefer implementing this **or** returning a companion
   * `SessionIndex` from the adapter factory — hosts must not need both. Call
   * `resolveSessionSearchQuery` before scan/query. Memory defaults to capped linear
   * search (`sessionSearchMode: "unsupported"` throws). JSONL throws unsupported.
   */
  searchSessions?(query: SessionSearchQuery): Promise<PersistencePage<SessionSearchHit>>;
}

/** Host-written `SessionRecord.metadata` / session metadata key for workspace filtering. */
export const SESSION_SEARCH_WORKSPACE_METADATA_KEY = "workspaceRoot" as const;

export const DEFAULT_SESSION_SEARCH_LIMIT = 20;
export const HARD_MAX_SESSION_SEARCH_LIMIT = 100;
export const DEFAULT_MAX_SESSION_SEARCH_QUERY_BYTES = 4 * 1024;
export const HARD_MAX_SESSION_SEARCH_QUERY_BYTES = 16 * 1024;
export const DEFAULT_MAX_SESSION_SEARCH_SNIPPET_BYTES = 512;
export const HARD_MAX_SESSION_SEARCH_SNIPPET_BYTES = 4 * 1024;
export const DEFAULT_MAX_SESSION_SEARCH_CURSOR_BYTES = 1 * 1024;
export const HARD_MAX_SESSION_SEARCH_CURSOR_BYTES = 4 * 1024;
export const DEFAULT_MAX_SESSION_SEARCH_LINEAR_SESSIONS = 1_000;
export const HARD_MAX_SESSION_SEARCH_LINEAR_SESSIONS = 5_000;
export const DEFAULT_MAX_SESSION_SEARCH_LINEAR_ENTRIES = 10_000;
export const HARD_MAX_SESSION_SEARCH_LINEAR_ENTRIES = 50_000;
export const DEFAULT_MAX_SESSION_SEARCH_LINEAR_BYTES = 8 * 1024 * 1024;
export const HARD_MAX_SESSION_SEARCH_LINEAR_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_SESSION_SEARCH_FTS_CANDIDATES = 1_000;
export const HARD_MAX_SESSION_SEARCH_FTS_CANDIDATES = 5_000;

/** Bounded session search filters. Workspace matches host-written `metadata.workspaceRoot`. */
export interface SessionSearchQuery extends PersistenceQuery, OwnershipScope {
  readonly workspaceRoot?: string;
  /** Optional full-text / message+summary query (adapter-defined matching). */
  readonly query?: string;
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
 * `leafId` is the branch tip for `session.checkout` when known.
 */
export interface SessionSearchHit {
  readonly sessionId: string;
  readonly leafId?: string;
  readonly updatedAt?: string;
  readonly label?: string;
  readonly summary?: string;
  readonly snippet?: string;
  /** Safe display fields only (e.g. workspaceRoot); never credentials. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Narrow search seam; adapters may implement this instead of `SessionStore.searchSessions`. */
export interface SessionIndex {
  search(query: SessionSearchQuery): Promise<PersistencePage<SessionSearchHit>>;
}

/** Validated search query with finite `limit` / `order` filled in. */
export interface ResolvedSessionSearchQuery extends SessionSearchQuery {
  readonly limit: number;
  readonly order: "asc" | "desc";
}

/**
 * O(1) validation before any scan/query. Applies default page limit; rejects NaN,
 * non-positive limits, oversize query/cursor/filter strings, and invalid order.
 */
export function resolveSessionSearchQuery(query: SessionSearchQuery): ResolvedSessionSearchQuery {
  const limit = query.limit === undefined ? DEFAULT_SESSION_SEARCH_LIMIT : query.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > HARD_MAX_SESSION_SEARCH_LIMIT) {
    throw new TypeError(`SessionSearchQuery.limit must be a safe integer from 1 to ${HARD_MAX_SESSION_SEARCH_LIMIT}`);
  }
  const order = query.order ?? "desc";
  if (order !== "asc" && order !== "desc") {
    throw new TypeError('SessionSearchQuery.order must be "asc" or "desc"');
  }
  assertSearchStringBytes(query.query, "query", HARD_MAX_SESSION_SEARCH_QUERY_BYTES);
  assertSearchStringBytes(query.cursor, "cursor", HARD_MAX_SESSION_SEARCH_CURSOR_BYTES);
  assertSearchStringBytes(query.workspaceRoot, "workspaceRoot", HARD_MAX_SESSION_SEARCH_QUERY_BYTES);
  assertSearchStringBytes(query.provider, "provider", HARD_MAX_SESSION_SEARCH_QUERY_BYTES);
  assertSearchStringBytes(query.model, "model", HARD_MAX_SESSION_SEARCH_QUERY_BYTES);
  assertSearchStringBytes(query.label, "label", HARD_MAX_SESSION_SEARCH_QUERY_BYTES);
  assertSearchStringBytes(query.summary, "summary", HARD_MAX_SESSION_SEARCH_QUERY_BYTES);
  assertSearchStringBytes(query.tenantId, "tenantId", HARD_MAX_SESSION_SEARCH_QUERY_BYTES);
  assertSearchStringBytes(query.accountId, "accountId", HARD_MAX_SESSION_SEARCH_QUERY_BYTES);
  assertSearchStringBytes(query.userId, "userId", HARD_MAX_SESSION_SEARCH_QUERY_BYTES);
  assertSearchStringBytes(query.fromUpdatedAt, "fromUpdatedAt", HARD_MAX_SESSION_SEARCH_QUERY_BYTES);
  assertSearchStringBytes(query.toUpdatedAt, "toUpdatedAt", HARD_MAX_SESSION_SEARCH_QUERY_BYTES);
  return { ...query, limit, order };
}

function assertSearchStringBytes(value: string | undefined, name: string, hardMax: number): void {
  if (value === undefined) return;
  if (typeof value !== "string") {
    throw new TypeError(`SessionSearchQuery.${name} must be a string`);
  }
  // ponytail: UTF-8 byte length via TextEncoder; upgrade only if a non-Unicode host appears.
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes > hardMax) {
    throw new TypeError(`SessionSearchQuery.${name} exceeds ${hardMax} bytes`);
  }
}

export const SESSION_SEARCH_UNSUPPORTED_CODE = "session_search_unsupported" as const;

/** Thrown when a store opts out of `searchSessions` (memory `unsupported`, JSONL). */
export class SessionSearchUnsupportedError extends Error {
  readonly code = SESSION_SEARCH_UNSUPPORTED_CODE;
  constructor(message = "session search is unsupported by this store") {
    super(message);
    this.name = "SessionSearchUnsupportedError";
  }
}

export function isSessionSearchUnsupported(error: unknown): error is SessionSearchUnsupportedError {
  return error instanceof Error && (error as { code?: unknown }).code === SESSION_SEARCH_UNSUPPORTED_CODE;
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
export const SESSION_APPEND_CONFLICT_CODE = "session_append_conflict" as const;

/** CAS conflict code for `appendSession` metadata writes. Stable and message-independent. */
export const SESSION_METADATA_CONFLICT_CODE = "metadata_conflict" as const;

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
export class SessionMetadataConflictError extends Error {
  readonly code = SESSION_METADATA_CONFLICT_CODE;
  constructor(readonly conflict: SessionMetadataConflict) {
    super(`session metadata conflict: expected version ${conflict.expectedVersion}, current ${conflict.currentVersion}`);
    this.name = "SessionMetadataConflictError";
  }
}

/** Type guard keyed off the stable `code` (works across bundles; not message text). */
export function isSessionMetadataConflict(error: unknown): error is SessionMetadataConflictError {
  return error instanceof Error && (error as { code?: unknown }).code === SESSION_METADATA_CONFLICT_CODE;
}

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
export class SessionAppendConflictError extends Error {
  readonly code = SESSION_APPEND_CONFLICT_CODE;
  constructor(readonly conflict: SessionAppendConflict) {
    const detail = conflict.idempotencyDuplicate
      ? `idempotency key already used`
      : conflict.currentLeafId !== undefined
        ? `expected parent ${conflict.expectedParentId ?? "<none>"} does not match current leaf ${conflict.currentLeafId}`
        : `expected parent ${conflict.expectedParentId ?? "<none>"} is unavailable`;
    super(`session append conflict: ${detail}`);
    this.name = "SessionAppendConflictError";
  }
}

/** Type guard keyed off the stable `code` (works across bundles; not message text). */
export function isSessionAppendConflict(error: unknown): error is SessionAppendConflictError {
  return error instanceof Error && (error as { code?: unknown }).code === SESSION_APPEND_CONFLICT_CODE;
}
