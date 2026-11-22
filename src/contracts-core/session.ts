/** Contracts-core session family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */
import type { AgentEvent } from "../contracts-protocol.js";
import type { Message, ModelConfig } from "./content.js";
import type { OwnershipScope, PersistencePage, PersistenceQuery } from "./persistence.js";
import type { RunLimitBreach } from "./run-limits.js";

export type SessionEntryKind =
  | "message"
  | "event"
  | "summary"
  | "metadata"
  | "model_change"
  | "label"
  | "custom"
  | "compaction"
  | "suspended_run"
  | "run_checkpoint"
  | "session_limits"
  | "package_state"
  | "external_state";

export const SESSION_ENTRY_KINDS: readonly SessionEntryKind[] = [
  "message",
  "event",
  "summary",
  "metadata",
  "model_change",
  "label",
  "custom",
  "compaction",
  "suspended_run",
  "run_checkpoint",
  "session_limits",
  "package_state",
  "external_state",
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
  readonly kind: SessionEntryKind | (string & {});
  readonly schemaVersion?: number;
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
  /**
   * Declares that `append` enforces `SessionAppendOptions.tip`: one linear child per parent, checked
   * atomically with the insert. Not a method, so it is declared, not derived. A store without it accepts
   * a stale-tip append as a branch, as before. `inspect()` reports it as the `tipCheck` capability.
   */
  readonly tipCheck?: boolean;
  /**
   * Optional batch append (plan 230 Task 5): writes every entry or none. The entries belong to one session
   * and are in branch order; each `parentId` is an earlier entry of the batch, an entry already in that
   * session, or undefined. A missing parent throws `SessionAppendConflictError` and a taken id throws as
   * `append` does. Batch entries are not tip-checked and carry no idempotency key. `session.fork()` uses it.
   */
  appendMany?(entries: readonly SessionEntry[], options?: SessionAppendManyOptions): Promise<void>;
}

export interface SessionAppendManyOptions {
  readonly signal?: AbortSignal;
}

/** Who drives a session: Prism itself, or an external agent a driver runs. Set by the host, never derived. */
export interface SessionActor {
  readonly kind: "prism" | "external";
  readonly agent: string;
  /** Opaque, set by the driver. */
  readonly vendor?: string;
}

/** Link ids are opaque strings; one id may be at most this many characters. */
export const MAX_SESSION_LINK_ID_LENGTH = 256;

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
  /**
   * How many parent links lie between this session and its root (1 for a child of a root). Stamped by the kernel when
   * a session opens with `parent.sessionId`, never taken from the caller, so a resumed child reads it without walking
   * its ancestors. Absent on a root, and on links written before it existed (read as 1 when `sessionId` is set).
   */
  readonly depth?: number;
}

/** The deepest link chain the kernel stamps. `PackageAPI.sessions.open` past it fails closed. */
export const MAX_SESSION_LINK_DEPTH = 16;

/**
 * An entry a new child session starts with (`PackageAPI.sessions.open({ seed })`). Only conversation content: the
 * kernel stamps the id, the chain, the session id and the ownership scope, and appends the seed after the links entry.
 */
export type SessionSeedEntry =
  | { readonly kind: "message"; readonly message: Message }
  | { readonly kind: "summary"; readonly summary: string };

/** At most this many seed entries per `sessions.open`. */
export const MAX_SESSION_SEED_ENTRIES = 512;

/** `data` key of the `metadata` entry holding a session's `SessionLinks`. The entry is the source of truth; SQL stores index it. */
export const SESSION_LINKS_DATA_KEY = "links" as const;

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

export const DEFAULT_SESSION_LIST_LIMIT = 20;
export const HARD_MAX_SESSION_LIST_LIMIT = 100;

/** The optional `agent.sessions` methods a store implements, plus the declared `tipCheck` append guard. */
export type SessionStoreCapability = "listSessions" | "deleteSession" | "searchSessions" | "tipCheck" | "appendMany";

/** `ErrorInfo.code` of a run that failed because another writer moved the session's tip (plan 230 Task 2). */
export const SESSION_CONFLICT_CODE = "session_conflict" as const;

export const UNSUPPORTED_STORE_CAPABILITY_CODE = "unsupported_store_capability" as const;

/** Thrown by `agent.sessions` when the resolved `store` slot does not declare the capability the call needs. */
export class UnsupportedStoreCapabilityError extends Error {
  readonly code = UNSUPPORTED_STORE_CAPABILITY_CODE;
  constructor(readonly capability: SessionStoreCapability) {
    super(`The session store does not support ${capability}; agent.sessions needs a store that declares it`);
    this.name = "UnsupportedStoreCapabilityError";
  }
}

export function isUnsupportedStoreCapability(error: unknown): error is UnsupportedStoreCapabilityError {
  return error instanceof Error && (error as { code?: unknown }).code === UNSUPPORTED_STORE_CAPABILITY_CODE;
}

/** Host-written `SessionRecord.metadata` / session metadata key for workspace filtering. */
export const SESSION_SEARCH_WORKSPACE_METADATA_KEY = "workspaceRoot" as const;

/** Host-written session metadata key for the human-readable session title (first prompt or `/rename`). */
export const SESSION_TITLE_METADATA_KEY = "title" as const;

/** Maximum title length in characters a host should store under `SESSION_TITLE_METADATA_KEY`. */
export const SESSION_TITLE_MAX_LENGTH = 80;

export const DEFAULT_SESSION_SEARCH_LIMIT = 20;
export const HARD_MAX_SESSION_SEARCH_LIMIT = 100;
export const HARD_MAX_SESSION_SEARCH_QUERY_BYTES = 16 * 1024;
export const DEFAULT_MAX_SESSION_SEARCH_SNIPPET_BYTES = 512;
export const HARD_MAX_SESSION_SEARCH_CURSOR_BYTES = 4 * 1024;
export const DEFAULT_MAX_SESSION_SEARCH_LINEAR_SESSIONS = 1_000;
export const DEFAULT_MAX_SESSION_SEARCH_LINEAR_ENTRIES = 10_000;
export const DEFAULT_MAX_SESSION_SEARCH_LINEAR_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_SESSION_SEARCH_FTS_CANDIDATES = 1_000;

/**
 * A store's list and search ceilings (plan 239 Task 4). A store is host-constructed, so these are set on its
 * factory (`createMemorySessionStore({ queryLimits })`, and each store package's options) and only the host
 * raises one. Omitted keys keep the shipped value in brackets.
 */
export interface SessionQueryLimits {
  /** Largest `SessionListQuery.limit` [`HARD_MAX_SESSION_LIST_LIMIT`, 100]. */
  readonly maxListLimit?: number;
  /** Largest `SessionSearchQuery.limit` [`HARD_MAX_SESSION_SEARCH_LIMIT`, 100]. */
  readonly maxSearchLimit?: number;
  /** UTF-8 bytes of the search text and each string filter [`HARD_MAX_SESSION_SEARCH_QUERY_BYTES`, 16 KiB]. */
  readonly maxSearchQueryBytes?: number;
  /** UTF-8 bytes of a search cursor [`HARD_MAX_SESSION_SEARCH_CURSOR_BYTES`, 4 KiB]. */
  readonly maxSearchCursorBytes?: number;
  /** UTF-8 bytes of one hit's snippet [`DEFAULT_MAX_SESSION_SEARCH_SNIPPET_BYTES`, 512]. */
  readonly searchSnippetBytes?: number;
  /** Full-text candidate rows a database store ranks per search [`DEFAULT_MAX_SESSION_SEARCH_FTS_CANDIDATES`, 1,000]. */
  readonly ftsCandidates?: number;
}

/** Every store query limit resolved. */
export type ResolvedSessionQueryLimits = { readonly [K in keyof SessionQueryLimits]-?: number };

const QUERY_LIMIT_NAMES = [
  "maxListLimit",
  "maxSearchLimit",
  "maxSearchQueryBytes",
  "maxSearchCursorBytes",
  "searchSnippetBytes",
  "ftsCandidates",
] as const satisfies readonly (keyof SessionQueryLimits)[];

/** Resolve a store's `queryLimits`: each a positive safe integer, an unknown key rejected, omitted keys at the default. */
export function resolveSessionQueryLimits(limits?: SessionQueryLimits): ResolvedSessionQueryLimits {
  const resolved: { -readonly [K in keyof ResolvedSessionQueryLimits]: number } = {
    maxListLimit: HARD_MAX_SESSION_LIST_LIMIT,
    maxSearchLimit: HARD_MAX_SESSION_SEARCH_LIMIT,
    maxSearchQueryBytes: HARD_MAX_SESSION_SEARCH_QUERY_BYTES,
    maxSearchCursorBytes: HARD_MAX_SESSION_SEARCH_CURSOR_BYTES,
    searchSnippetBytes: DEFAULT_MAX_SESSION_SEARCH_SNIPPET_BYTES,
    ftsCandidates: DEFAULT_MAX_SESSION_SEARCH_FTS_CANDIDATES,
  };
  if (limits === undefined) return Object.freeze(resolved);
  const known = new Set<string>(QUERY_LIMIT_NAMES);
  for (const key of Object.keys(limits)) {
    if (!known.has(key)) throw new TypeError(`queryLimits.${key} is not a store query limit`);
  }
  for (const name of QUERY_LIMIT_NAMES) {
    const value = limits[name];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`queryLimits.${name} must be a positive safe integer`);
    resolved[name] = value;
  }
  return Object.freeze(resolved);
}

/** The page size of a `listSessions` call: `query.limit` or the default, at most `limits.maxListLimit`. */
export function resolveSessionListLimit(
  query: Pick<SessionListQuery, "limit">,
  limits: ResolvedSessionQueryLimits = resolveSessionQueryLimits(),
): number {
  const limit = query.limit ?? Math.min(DEFAULT_SESSION_LIST_LIMIT, limits.maxListLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > limits.maxListLimit) {
    throw new TypeError(`SessionListQuery.limit must be a safe integer from 1 to ${limits.maxListLimit}`);
  }
  return limit;
}

/** Clip a search snippet to `maxBytes` UTF-8 bytes. */
export function clipSessionSearchSnippet(value: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maxBytes) return value;
  return new TextDecoder().decode(encoded.slice(0, maxBytes));
}

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
export function resolveSessionSearchQuery(
  query: SessionSearchQuery,
  limits: ResolvedSessionQueryLimits = resolveSessionQueryLimits(),
): ResolvedSessionSearchQuery {
  const limit = query.limit === undefined ? Math.min(DEFAULT_SESSION_SEARCH_LIMIT, limits.maxSearchLimit) : query.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > limits.maxSearchLimit) {
    throw new TypeError(`SessionSearchQuery.limit must be a safe integer from 1 to ${limits.maxSearchLimit}`);
  }
  const queryBytes = limits.maxSearchQueryBytes;
  const order = query.order ?? "desc";
  if (order !== "asc" && order !== "desc") {
    throw new TypeError('SessionSearchQuery.order must be "asc" or "desc"');
  }
  assertSearchStringBytes(query.query, "query", queryBytes);
  assertSearchStringBytes(query.cursor, "cursor", limits.maxSearchCursorBytes);
  assertSearchStringBytes(query.workspaceRoot, "workspaceRoot", queryBytes);
  assertSearchStringBytes(query.provider, "provider", queryBytes);
  assertSearchStringBytes(query.model, "model", queryBytes);
  assertSearchStringBytes(query.label, "label", queryBytes);
  assertSearchStringBytes(query.summary, "summary", queryBytes);
  assertSearchStringBytes(query.tenantId, "tenantId", queryBytes);
  assertSearchStringBytes(query.accountId, "accountId", queryBytes);
  assertSearchStringBytes(query.userId, "userId", queryBytes);
  assertSearchStringBytes(query.fromUpdatedAt, "fromUpdatedAt", queryBytes);
  assertSearchStringBytes(query.toUpdatedAt, "toUpdatedAt", queryBytes);
  assertSessionLinkFilter(query);
  return { ...query, limit, order, kind: resolveSessionSearchKinds(query.kind) };
}

/** Fail closed on a link filter that is not a bounded string (or a known actor kind). */
export function assertSessionLinkFilter(filter: SessionLinkFilter): void {
  for (const key of ["agentId", "parentSessionId", "workflowRunId", "delegationId", "actorAgent"] as const) {
    const value = filter[key];
    if (value !== undefined && (typeof value !== "string" || value.length > MAX_SESSION_LINK_ID_LENGTH)) {
      throw new TypeError(`${key} must be a string of at most ${MAX_SESSION_LINK_ID_LENGTH} characters`);
    }
  }
  if (filter.actorKind !== undefined && filter.actorKind !== "prism" && filter.actorKind !== "external") {
    throw new TypeError('actorKind must be "prism" or "external"');
  }
}

/** Validate the links a session is opened with. Ids are opaque; only length and type are checked. */
export function assertSessionLinks(links: SessionLinks): void {
  for (const key of ["sessionId", "agentId", "workflowRunId", "delegationId"] as const) {
    const value = links[key];
    if (value !== undefined && (typeof value !== "string" || value.length === 0 || value.length > MAX_SESSION_LINK_ID_LENGTH)) {
      throw new TypeError(`SessionOptions.parent.${key} must be a non-empty string of at most ${MAX_SESSION_LINK_ID_LENGTH} characters`);
    }
  }
  if (links.depth !== undefined && (!Number.isSafeInteger(links.depth) || links.depth < 1 || links.depth > MAX_SESSION_LINK_DEPTH)) {
    throw new TypeError(`SessionLinks.depth must be an integer from 1 to ${MAX_SESSION_LINK_DEPTH}`);
  }
  const actor = links.actor;
  if (actor !== undefined) {
    if (actor.kind !== "prism" && actor.kind !== "external") throw new TypeError('SessionOptions.actor.kind must be "prism" or "external"');
    for (const key of ["agent", "vendor"] as const) {
      const value = actor[key];
      if (value !== undefined && (typeof value !== "string" || value.length === 0 || value.length > MAX_SESSION_LINK_ID_LENGTH)) {
        throw new TypeError(`SessionOptions.actor.${key} must be a non-empty string of at most ${MAX_SESSION_LINK_ID_LENGTH} characters`);
      }
    }
  }
}

/** Normalize `kind` to concrete entry kinds (`undefined` = any). Unknown or mixed `"any"` fails closed. */
function resolveSessionSearchKinds(kind: SessionSearchQuery["kind"]): readonly SessionEntryKind[] | undefined {
  if (kind === undefined || kind === "any") return undefined;
  const values: readonly SessionSearchKind[] = typeof kind === "string" ? [kind] : kind;
  const kinds: SessionEntryKind[] = [];
  for (const value of values) {
    if (value === "any") throw new TypeError('SessionSearchQuery.kind cannot mix "any" with entry kinds');
    if (!isSessionEntryKind(value)) {
      throw new TypeError(`SessionSearchQuery.kind must be a session entry kind or "any"; got ${JSON.stringify(value)}`);
    }
    if (!kinds.includes(value)) kinds.push(value);
  }
  if (kinds.length === 0) throw new TypeError("SessionSearchQuery.kind must name at least one entry kind");
  return kinds;
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

/** Thrown when a store opts out of `searchSessions` (memory `sessionSearchMode: "unsupported"`). */
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

export const SESSION_NOT_FOUND_CODE = "session_not_found" as const;

/** Thrown when `agent.session({ id, create: true })` cannot find the requested session or its branch in the store slot, or across ownership scopes. */
export class SessionNotFoundError extends Error {
  readonly code = SESSION_NOT_FOUND_CODE;
  constructor(
    readonly sessionId: string,
    message = `Session "${sessionId}" was not found`,
  ) {
    super(message);
    this.name = "SessionNotFoundError";
  }
}

export function isSessionNotFound(error: unknown): error is SessionNotFoundError {
  return error instanceof Error && (error as { code?: unknown }).code === SESSION_NOT_FOUND_CODE;
}

export const SESSION_BRANCH_READ_LIMIT_CODE = "branch_read_limit" as const;

/**
 * Thrown when a paged branch read would follow more than `ceilings.branchReadPages` pages (plan 239 Task 4).
 * The branch is never returned short: a long branch fails closed instead of being read in part.
 */
export class SessionBranchReadLimitError extends Error {
  readonly code = SESSION_BRANCH_READ_LIMIT_CODE;
  constructor(
    readonly sessionId: string,
    readonly maxPages: number,
  ) {
    super(`Branch read of session "${sessionId}" exceeded ceilings.branchReadPages (${maxPages} pages)`);
    this.name = "SessionBranchReadLimitError";
  }
}

export const SESSION_LIMITS_ENTRY_SCHEMA_VERSION = 1 as const;

/** Persisted counters for session-wide limits (plan 239 Task 8). Carries counts only, never message content. */
export interface SessionLimitsEntryData {
  readonly schemaVersion: typeof SESSION_LIMITS_ENTRY_SCHEMA_VERSION;
  readonly runs: number;
  readonly totalTokens: number;
  readonly cost: number;
  readonly currency?: string;
}

export const SESSION_LIMIT_CODE = "session_limit" as const;

/**
 * Raised at run start when a session-wide budget (`SessionOptions.limits` / `AgentConfig.sessionLimits`) is
 * already exhausted. Nothing is appended and no `run.started` event fires.
 */
export class SessionLimitError extends Error {
  readonly code = SESSION_LIMIT_CODE;
  constructor(
    readonly breach: RunLimitBreach,
    message = `Session limit exceeded: ${breach.limit}`,
  ) {
    super(message);
    this.name = "SessionLimitError";
  }
}

export const SESSION_LIMITS_UNREADABLE_CODE = "session_limits_unreadable" as const;

/** Raised fail-closed when a stored `session_limits` entry (or checkpoint snapshot) is unreadable or malformed. */
export class SessionLimitsUnreadableError extends Error {
  readonly code = SESSION_LIMITS_UNREADABLE_CODE;
  constructor(message = "Malformed session_limits entry") {
    super(message);
    this.name = "SessionLimitsUnreadableError";
  }
}

export const OWNERSHIP_WIDEN_CODE = "ERR_PRISM_OWNERSHIP_WIDEN" as const;

/**
 * Thrown when a session or run ownership scope sets a field the enclosing scope already fixed to a
 * different value (plan 177 Task 4): scope narrows, never widens.
 */
export class OwnershipScopeError extends Error {
  readonly code = OWNERSHIP_WIDEN_CODE;
  constructor(message = "ownership scope widens the declared scope") {
    super(message);
    this.name = "OwnershipScopeError";
  }
}

/** Query for a single branch's ancestor chain (DB-friendly: one recursive/ancestor query
 *  instead of a full-session scan). Honored by `SessionStore.readBranchPath` and the pure
 *  branch helpers' reader overload. `leafId` is optional (omit for the latest leaf). */
export interface SessionBranchRead {
  readonly sessionId: string;
  readonly leafId?: string;
  readonly cursor?: string;
  readonly limit?: number;
  /**
   * `"compaction"` asks for the branch's tail only (plan 230 Task 3): the walk from the leaf stops at the
   * newest `compaction` entry's `throughEntryId` (that entry included), and the entries the compaction's
   * `keepEntryIds` name before it are added first. Items stay in branch order with the leaf last. A branch
   * with no compaction, or a compaction without `throughEntryId`, is returned whole. A store that ignores
   * it returns the whole branch, which the kernel accepts.
   */
  readonly from?: "compaction";
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
  /**
   * A linear append at the writer's branch tip (plan 230 Task 2). A store that declares `tipCheck`
   * marks the row linear and rejects the append with `SessionAppendConflictError` (carrying
   * `expectedParentId` and the session's current leaf) when `expectedParentId` already has a linear
   * child: a second writer moved the tip. An exact idempotent retry is deduplicated first. Appends
   * without `tip` (a deliberate branch, a fork copy) are never tip-checked and never block a later
   * tip append. Ignored without `expectedParentId`, and by stores that do not declare `tipCheck`.
   */
  readonly tip?: boolean;
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
