import {
  type BranchReader,
  assertSessionLinkFilter,
  type CompactionEntryData,
  DEFAULT_MAX_SESSION_SEARCH_LINEAR_BYTES,
  DEFAULT_MAX_SESSION_SEARCH_LINEAR_ENTRIES,
  DEFAULT_MAX_SESSION_SEARCH_LINEAR_SESSIONS,
  clipSessionSearchSnippet,
  type Message,
  type OwnershipScope,
  type PersistencePage,
  type ResolvedSessionQueryLimits,
  resolveSessionListLimit,
  resolveSessionQueryLimits,
  resolveSessionSearchQuery,
  SESSION_APPEND_CONFLICT_CODE,
  SESSION_LINKS_DATA_KEY,
  SESSION_SEARCH_WORKSPACE_METADATA_KEY,
  SESSION_TITLE_METADATA_KEY,
  SessionAppendConflictError,
  type SessionAppendOptions,
  type SessionBranchRead,
  SessionBranchReadLimitError,
  type SessionEntry,
  type SessionLinkFilter,
  type SessionLinks,
  type SessionListQuery,
  type SessionQueryLimits,
  type SessionSearchHit,
  type SessionSearchQuery,
  SessionSearchUnsupportedError,
  type SessionStore,
  type SessionStoreCapability,
  type SessionSummary,
} from "./contracts.js";
import { createId } from "./ids.js";

export interface CreateSessionEntryOptions extends Omit<SessionEntry, "id" | "timestamp"> {
  readonly id?: string;
  readonly timestamp?: string;
  readonly createId?: () => string;
  readonly now?: () => Date;
}

export interface SessionBranchOptions {
  readonly leafId?: string;
}

export interface SessionBranch {
  readonly leafId: string;
  readonly entries: readonly SessionEntry[];
}

export interface SessionContextSnapshot {
  readonly leafId?: string;
  readonly entries: readonly SessionEntry[];
  readonly messages: readonly Message[];
  readonly summaries: readonly string[];
}

export function createSessionEntry(options: CreateSessionEntryOptions): SessionEntry {
  const { createId, now, ...entry } = options;
  return {
    ...entry,
    id: entry.id ?? createId?.() ?? randomId("entry"),
    timestamp: entry.timestamp ?? (now?.() ?? new Date()).toISOString(),
  };
}

/**
 * Shipped `ceilings.branchReadPages`: the most pages a paged branch read follows. Guards against a buggy or
 * malicious reader that never ends `nextCursor`. First-party stores answer a branch in one page.
 */
export const DEFAULT_MAX_BRANCH_PAGES = 64;

/** Options for a paged branch read (plan 239 Task 4). */
export interface BranchReadOptions {
  /** Pages to follow before the read fails with `SessionBranchReadLimitError`. Default {@link DEFAULT_MAX_BRANCH_PAGES}. */
  readonly maxPages?: number;
}

export function getSessionBranchEntries(
  reader: BranchReader,
  query: SessionBranchRead,
  options?: BranchReadOptions,
): Promise<readonly SessionEntry[]>;
export function getSessionBranchEntries(entries: readonly SessionEntry[], options?: SessionBranchOptions): readonly SessionEntry[];
export function getSessionBranchEntries(
  input: readonly SessionEntry[] | BranchReader,
  options: SessionBranchOptions | SessionBranchRead = {},
  read?: BranchReadOptions,
): readonly SessionEntry[] | Promise<readonly SessionEntry[]> {
  return typeof input === "function"
    ? readBranchFromReader(input, options as SessionBranchRead, read)
    : getSessionBranchEntriesCore(input, options as SessionBranchOptions);
}

async function readBranchFromReader(
  reader: BranchReader,
  query: SessionBranchRead,
  options?: BranchReadOptions,
): Promise<readonly SessionEntry[]> {
  // Reader returns an ancestor set in any order. Order once and keep those objects.
  // Detachment is the store's clone (readBranchPath / list), not a second walk here.
  return orderBranch(await readBranchPages(reader, query, options), { leafId: query.leafId });
}

async function readBranchPages(reader: BranchReader, query: SessionBranchRead, options?: BranchReadOptions): Promise<SessionEntry[]> {
  const maxPages = options?.maxPages ?? DEFAULT_MAX_BRANCH_PAGES;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new TypeError("maxPages must be a positive safe integer");
  const items: SessionEntry[] = [];
  let cursor: string | undefined;
  for (let page = 0; ; page++) {
    // A cursor left after the last allowed page means the branch is longer than the read may follow:
    // fail closed rather than return a short branch.
    if (page >= maxPages) throw new SessionBranchReadLimitError(query.sessionId, maxPages);
    const result = await reader(cursor ? { ...query, cursor } : query);
    items.push(...result.items);
    cursor = result.nextCursor;
    if (!cursor) return items;
  }
}

type CompactionCheckpoint = NonNullable<CompactionEntryData["checkpoint"]>;

/**
 * Plan 230 Task 3: a snapshot built from a tail read holds only the branch from its newest compaction's
 * `throughEntryId` on (plus pinned entries). The compaction's checkpoint stands for the part before it, and
 * `compactionIndex` is the compaction entry's index in `snapshot.entries`.
 */
interface TailBase {
  readonly checkpoint: CompactionCheckpoint;
  readonly compactionIndex: number;
}
const tailBases = new WeakMap<SessionContextSnapshot, TailBase>();

/**
 * Kernel-internal (plan 230 Task 3): the snapshot of `query`'s branch, read from its newest compaction on
 * when the store implements `readBranchPath`. A store that ignores `from`, a branch with no compaction, or a
 * compaction written without a checkpoint yields the whole branch, as `rebuildSessionContext` would.
 */
export async function readSessionSnapshot(
  store: SessionStore,
  query: SessionBranchRead,
  options?: BranchReadOptions,
): Promise<SessionContextSnapshot> {
  const read = store.readBranchPath;
  if (!read) return rebuildSessionContextCore(await store.list(query.sessionId), { leafId: query.leafId });
  const reader: BranchReader = (page) => read.call(store, page);
  const tail = snapshotFromTail(await readBranchPages(reader, { ...query, from: "compaction" }, options), query.leafId);
  return tail ?? snapshotFromBranch(await readBranchFromReader(reader, { ...query, from: undefined }, options));
}

/** The snapshot of a `from: "compaction"` read, or `undefined` when the tail cannot stand alone (no usable checkpoint). */
function snapshotFromTail(items: readonly SessionEntry[], leafId: string | undefined): SessionContextSnapshot | undefined {
  const leaf = leafId ?? items.at(-1)?.id;
  // Nothing stored for the session (or the leaf): the caller decides whether that is an unknown leaf.
  if (!leaf || items.length === 0) return snapshotFromBranch([]);
  const byId = new Map(items.map((entry) => [entry.id, entry]));
  if (!byId.has(leaf)) throw new Error(`Unknown session leaf: ${leaf}`);
  const chain: SessionEntry[] = [];
  for (let entry = byId.get(leaf); entry; entry = entry.parentId === undefined ? undefined : byId.get(entry.parentId)) chain.push(entry);
  chain.reverse();
  const first = chain[0];
  // The walk reached the root: this is the whole branch.
  if (!first || first.parentId === undefined) return snapshotFromBranch(chain);
  let compactionIndex = chain.length - 1;
  while (compactionIndex >= 0 && chain[compactionIndex]?.kind !== "compaction") compactionIndex -= 1;
  const compaction = chain[compactionIndex];
  const data = compaction && isCompactionEntryData(compaction.data) ? compaction.data : undefined;
  if (!compaction?.summary || !data || !isCompactionCheckpoint(data.checkpoint) || data.throughEntryId !== first.id) return undefined;
  const pinned: SessionEntry[] = [];
  for (const id of data.checkpoint.pinnedEntryIds) {
    const entry = byId.get(id);
    if (!entry) return undefined;
    pinned.push(entry);
  }
  const snapshot = snapshotFromBranch([...pinned, ...chain]);
  tailBases.set(snapshot, { checkpoint: data.checkpoint, compactionIndex: pinned.length + compactionIndex });
  return snapshot;
}

function isCompactionCheckpoint(value: unknown): value is CompactionCheckpoint {
  if (!value || typeof value !== "object") return false;
  const checkpoint = value as Record<string, unknown>;
  return (
    checkpoint.version === 1 &&
    Number.isSafeInteger(checkpoint.branchLength) &&
    (checkpoint.branchLength as number) >= 0 &&
    Array.isArray(checkpoint.packageState) &&
    Array.isArray(checkpoint.pinnedEntryIds) &&
    checkpoint.pinnedEntryIds.every((id) => typeof id === "string") &&
    Array.isArray(checkpoint.externalState) &&
    checkpoint.externalState.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof item.vendor === "string" &&
        typeof item.key === "string" &&
        Number.isSafeInteger(item.count) &&
        Number.isSafeInteger(item.bytes) &&
        Number.isSafeInteger(item.seq),
    )
  );
}

/**
 * Kernel-internal (plan 230 Task 3): the branch tail a `from: "compaction"` read returns, in branch order with
 * the leaf last. The walk from `leafId` stops at the newest compaction's `throughEntryId` (included); the
 * entries its `keepEntryIds` name that the walk did not reach come first. `get` answers this session's entries.
 */
function collectBranchTail(get: (id: string) => SessionEntry | undefined, leafId: string): SessionEntry[] {
  const chain: SessionEntry[] = [];
  let compaction: CompactionEntryData | undefined;
  let stopped = false;
  for (let id: string | undefined = leafId; id !== undefined; ) {
    const entry = get(id);
    if (!entry) throw new Error(id === leafId ? `Unknown session leaf: ${id}` : `Missing session parent: ${id}`);
    chain.push(entry);
    if (compaction?.throughEntryId === entry.id) {
      stopped = true;
      break;
    }
    if (!compaction && entry.kind === "compaction") compaction = isCompactionEntryData(entry.data) ? entry.data : {};
    id = entry.parentId;
  }
  chain.reverse();
  if (!stopped) return chain;
  const walked = new Set(chain.map((entry) => entry.id));
  const pinned = (compaction?.keepEntryIds ?? []).flatMap((id) => {
    const entry = walked.has(id) ? undefined : get(id);
    if (entry) walked.add(id);
    return entry ? [entry] : [];
  });
  return [...pinned, ...chain];
}

/**
 * Kernel-internal (plan 230 Task 3): what the snapshot stands for beyond its entries. `branchLength` counts the
 * whole branch, compacted part included. Package and external state fold from the checkpoint's `packageState`
 * and `externalState`, then from `entries`: those after a tail snapshot's compaction, or the whole branch.
 */
export function snapshotTail(snapshot: SessionContextSnapshot): {
  readonly branchLength: number;
  readonly packageState: CompactionCheckpoint["packageState"];
  readonly externalState: CompactionCheckpoint["externalState"];
  readonly entries: readonly SessionEntry[];
} {
  const base = tailBases.get(snapshot);
  if (!base) return { branchLength: snapshot.entries.length, packageState: [], externalState: [], entries: snapshot.entries };
  return {
    branchLength: base.checkpoint.branchLength + snapshot.entries.length - base.compactionIndex,
    packageState: base.checkpoint.packageState,
    externalState: base.checkpoint.externalState,
    entries: snapshot.entries.slice(base.compactionIndex + 1),
  };
}

type SessionIndex = { byId: Map<string, SessionEntry>; parentIds: Set<string> };

function orderBranch(
  entries: readonly SessionEntry[],
  options: SessionBranchOptions = {},
  index: SessionIndex = indexEntries(entries),
): SessionEntry[] {
  const leafId = options.leafId ?? entries.at(-1)?.id;
  if (!leafId) return [];
  if (!index.byId.has(leafId)) throw new Error(`Unknown session leaf: ${leafId}`);

  const branch: SessionEntry[] = [];
  for (let id: string | undefined = leafId; id; ) {
    const entry = index.byId.get(id);
    if (!entry) throw new Error(`Missing session parent: ${id}`);
    branch.push(entry);
    id = entry.parentId;
  }
  branch.reverse();
  return branch;
}

function getSessionBranchEntriesCore(
  entries: readonly SessionEntry[],
  options: SessionBranchOptions = {},
  index: SessionIndex = indexEntries(entries),
): readonly SessionEntry[] {
  return orderBranch(entries, options, index).map(cloneEntry);
}

export function listSessionBranches(entries: readonly SessionEntry[]): readonly SessionBranch[] {
  const index = indexEntries(entries);
  return entries
    .filter((entry) => !index.parentIds.has(entry.id))
    .map((entry) => ({ leafId: entry.id, entries: getSessionBranchEntriesCore(entries, { leafId: entry.id }, index) }));
}

export function rebuildSessionContext(reader: BranchReader, query: SessionBranchRead): Promise<SessionContextSnapshot>;
export function rebuildSessionContext(entries: readonly SessionEntry[], options?: SessionBranchOptions): SessionContextSnapshot;
export function rebuildSessionContext(
  input: readonly SessionEntry[] | BranchReader,
  options: SessionBranchOptions | SessionBranchRead = {},
): SessionContextSnapshot | Promise<SessionContextSnapshot> {
  if (typeof input === "function") {
    return rebuildSessionContextFromReader(input, options as SessionBranchRead);
  }
  return rebuildSessionContextCore(input, options as SessionBranchOptions);
}

async function rebuildSessionContextFromReader(reader: BranchReader, query: SessionBranchRead): Promise<SessionContextSnapshot> {
  // ponytail: one order pass on the reader's pages. No second walk and no second clone —
  // stores that implement readBranchPath already detach. Upgrade path: clone here again if a
  // host reader returns live store objects and a snapshot mutation is observed in the store.
  return snapshotFromBranch(await readBranchFromReader(reader, query));
}

function rebuildSessionContextCore(entries: readonly SessionEntry[], options: SessionBranchOptions = {}): SessionContextSnapshot {
  return snapshotFromBranch(getSessionBranchEntriesCore(entries, options));
}

/**
 * Snapshots whose next appended entry `snapshotFromBranch` would include as-is: no compaction on
 * the branch, or every entry after the newest compaction's `throughEntryId` counts. Only these can
 * be extended in O(1) by {@link extendSnapshot}; any other snapshot is rebuilt.
 */
const extendableSnapshots = new WeakSet<SessionContextSnapshot>();

function snapshotFromBranch(branch: readonly SessionEntry[]): SessionContextSnapshot {
  const compaction = [...branch]
    .reverse()
    .find((entry) => entry.kind === "compaction" && entry.summary && isCompactionEntryData(entry.data));
  if (!compaction || !isCompactionEntryData(compaction.data)) {
    const snapshot: SessionContextSnapshot = {
      leafId: branch.at(-1)?.id,
      entries: branch,
      messages: branch.flatMap((entry) => (entry.kind === "message" && entry.message ? [entry.message] : [])),
      summaries: branch.flatMap((entry) => (entry.kind === "summary" && entry.summary ? [entry.summary] : [])),
    };
    extendableSnapshots.add(snapshot);
    return snapshot;
  }

  const keepIds = new Set(compaction.data.keepEntryIds ?? []);
  let afterThrough = !compaction.data.throughEntryId;
  const messages: Message[] = [];
  const summaries: string[] = [compaction.summary!];
  for (const entry of branch) {
    if (entry.id === compaction.data.throughEntryId) {
      afterThrough = true;
      continue;
    }
    if (entry.id === compaction.id) continue;
    if (entry.kind === "message" && entry.message && (afterThrough || keepIds.has(entry.id))) messages.push(entry.message);
    if (entry.kind === "summary" && entry.summary && afterThrough) summaries.push(entry.summary);
  }

  const snapshot: SessionContextSnapshot = { leafId: branch.at(-1)?.id, entries: branch, messages, summaries };
  if (afterThrough) extendableSnapshots.add(snapshot);
  return snapshot;
}

/**
 * Kernel-internal (plan 210 Task 0.3): the snapshot `snapshotFromBranch` would build for
 * `snapshot`'s branch plus `entry` appended at its tip, in O(1). `entry` must be a detached copy
 * whose `parentId` is `snapshot.leafId`. Returns `undefined` when the result could differ from a
 * rebuild (a compaction entry, or a snapshot whose tail is not past its compaction), so the
 * caller rebuilds. The result has new arrays; `snapshot` is never mutated.
 */
export function extendSnapshot(snapshot: SessionContextSnapshot, entry: SessionEntry): SessionContextSnapshot | undefined {
  if (!extendableSnapshots.has(snapshot) || entry.kind === "compaction") return undefined;
  if (snapshot.leafId === undefined || entry.parentId !== snapshot.leafId) return undefined;
  const next: SessionContextSnapshot = {
    leafId: entry.id,
    entries: [...snapshot.entries, entry],
    messages: entry.kind === "message" && entry.message ? [...snapshot.messages, entry.message] : [...snapshot.messages],
    summaries: entry.kind === "summary" && entry.summary ? [...snapshot.summaries, entry.summary] : [...snapshot.summaries],
  };
  extendableSnapshots.add(next);
  const base = tailBases.get(snapshot);
  if (base) tailBases.set(next, base);
  return next;
}

export type MemorySessionSearchMode = "linear" | "unsupported";

export interface CreateMemorySessionStoreOptions {
  /** Default `"linear"`: capped in-process scan. `"unsupported"`: typed throw. */
  readonly sessionSearchMode?: MemorySessionSearchMode;
  /**
   * Ceilings of the capped in-process scan; the store is host-constructed, so only the host sets them.
   * Defaults are the contract `DEFAULT_MAX_SESSION_SEARCH_LINEAR_*` caps. A value that is not a positive
   * safe integer fails store construction closed with a `TypeError`.
   */
  readonly search?: {
    readonly maxLinearSessions?: number;
    readonly maxLinearEntries?: number;
    readonly maxLinearBytes?: number;
  };
  /** List and search ceilings (plan 239 Task 4). See {@link SessionQueryLimits}. */
  readonly queryLimits?: SessionQueryLimits;
}

/** Resolved bounds for the capped linear session scan. */
export interface LinearSearchCaps {
  readonly sessions: number;
  readonly entries: number;
  readonly bytes: number;
}

function resolveLinearSearchCaps(search: CreateMemorySessionStoreOptions["search"]): LinearSearchCaps {
  return {
    sessions: assertLinearCap(search?.maxLinearSessions, "maxLinearSessions", DEFAULT_MAX_SESSION_SEARCH_LINEAR_SESSIONS),
    entries: assertLinearCap(search?.maxLinearEntries, "maxLinearEntries", DEFAULT_MAX_SESSION_SEARCH_LINEAR_ENTRIES),
    bytes: assertLinearCap(search?.maxLinearBytes, "maxLinearBytes", DEFAULT_MAX_SESSION_SEARCH_LINEAR_BYTES),
  };
}

function assertLinearCap(value: number | undefined, name: string, fallback: number): number {
  const cap = value ?? fallback;
  if (!Number.isSafeInteger(cap) || cap < 1) {
    throw new TypeError(`CreateMemorySessionStoreOptions.search.${name} must be a positive safe integer`);
  }
  return cap;
}

/**
 * The optional `agent.sessions` capabilities a store implements, in contract order. The kernel derives
 * capabilities from method presence: `inspect()` reports them, and a store that implements none leaves
 * `agent.sessions` failing closed with `UnsupportedStoreCapabilityError`.
 */
export function sessionStoreCapabilities(store: SessionStore): readonly SessionStoreCapability[] {
  const methods = (["listSessions", "deleteSession", "searchSessions", "appendMany"] as const).filter(
    (capability) => typeof store[capability] === "function",
  );
  // `tipCheck` is a declared append guard, not a method (plan 230 Task 2).
  return store.tipCheck === true ? [...methods, "tipCheck"] : methods;
}

/** What a store checks before writing an `appendMany` batch: its session and the parents it must already hold. */
export interface SessionAppendBatch {
  readonly sessionId: string;
  /** Distinct `parentId`s not in the batch: each must already be an entry of `sessionId`. */
  readonly externalParentIds: readonly string[];
}

/**
 * The store-independent part of `SessionStore.appendMany` validation (plan 230 Task 5): one session, no id
 * twice, and the parents the batch does not carry itself. `undefined` for an empty batch. A store then checks
 * the external parents and the ids against what it holds, as `append` does, before writing anything.
 */
export function validateSessionAppendBatch(entries: readonly SessionEntry[]): SessionAppendBatch | undefined {
  const first = entries[0];
  if (!first) return undefined;
  const ids = new Set<string>();
  const external = new Set<string>();
  for (const entry of entries) {
    if (entry.sessionId !== first.sessionId) throw new TypeError("appendMany entries must belong to one session");
    if (ids.has(entry.id)) throw new Error(`Duplicate session entry id: ${entry.id}`);
    if (entry.parentId !== undefined && !ids.has(entry.parentId)) external.add(entry.parentId);
    ids.add(entry.id);
  }
  return { sessionId: first.sessionId, externalParentIds: [...external] };
}

export function createMemorySessionStore(
  initialEntries: readonly SessionEntry[] = [],
  options: CreateMemorySessionStoreOptions = {},
): SessionStore {
  const byId = new Map<string, SessionEntry>();
  const bySession = new Map<string, SessionEntry[]>();
  const leafBySession = new Map<string, string>();
  const idempotencySeen = new Set<string>();
  /** Parent id → its one linear (tip-checked) child. Entry ids are store-unique, so the parent id is the key. */
  const linearChild = new Map<string, string>();
  const mode = options.sessionSearchMode ?? "linear";
  const searchCaps = resolveLinearSearchCaps(options.search);
  const queryLimits = resolveSessionQueryLimits(options.queryLimits);

  for (const entry of initialEntries) add(entry);

  return {
    tipCheck: true,
    async append(entry, appendOptions) {
      add(entry, appendOptions);
    },
    async appendMany(entries, manyOptions) {
      manyOptions?.signal?.throwIfAborted();
      const batch = validateSessionAppendBatch(entries);
      if (!batch) return;
      // Every check runs before the first write, so a rejected batch writes nothing.
      for (const parentId of batch.externalParentIds) {
        if (byId.get(parentId)?.sessionId !== batch.sessionId) {
          throw new SessionAppendConflictError({ code: SESSION_APPEND_CONFLICT_CODE, expectedParentId: parentId });
        }
      }
      for (const entry of entries) if (byId.has(entry.id)) throw new Error(`Duplicate session entry id: ${entry.id}`);
      for (const entry of entries) add(entry);
    },
    async list(sessionId) {
      return (bySession.get(sessionId) ?? []).map(cloneEntry);
    },
    async get(id) {
      const entry = byId.get(id);
      return entry ? cloneEntry(entry) : undefined;
    },
    async searchSessions(query) {
      if (mode === "unsupported") throw new SessionSearchUnsupportedError();
      return searchLinearSessions(bySession, leafBySession, query, searchCaps, queryLimits);
    },
    async listSessions(query) {
      query.signal?.throwIfAborted();
      return listMemorySessions(bySession, leafBySession, query, queryLimits);
    },
    async deleteSession(sessionId, scope) {
      const entries = bySession.get(sessionId);
      // Fail closed and non-enumerating: an absent session and another scope's session answer alike.
      if (!entries || entries.length === 0 || !entriesInScope(entries, scope)) return false;
      for (const entry of entries) {
        byId.delete(entry.id);
        linearChild.delete(entry.id);
      }
      bySession.delete(sessionId);
      leafBySession.delete(sessionId);
      return true;
    },
    async readBranchPath(query) {
      const entries = bySession.get(query.sessionId) ?? [];
      const leafId = query.leafId ?? tipLeafId(entries);
      if (!leafId) return { items: [] };
      const chain =
        query.from === "compaction"
          ? collectBranchTail((id) => {
              const entry = byId.get(id);
              return entry?.sessionId === query.sessionId ? entry : undefined;
            }, leafId)
          : orderBranch(entries, { leafId });
      const start = query.cursor !== undefined ? decodeBranchOffset(query.cursor) : 0;
      const limit = query.limit ?? chain.length;
      const items = chain.slice(start, start + limit).map(cloneEntry);
      const next = start + items.length;
      return { items, nextCursor: next < chain.length ? String(next) : undefined };
    },
  };

  function add(entry: SessionEntry, options?: SessionAppendOptions): void {
    // ponytail: idempotency dedup keyed on (session, key, expectedParentId) so a
    // run-level key shared across distinct linear appends (each at a different
    // parentId) does not collapse them; only an exact retry at the same position
    // deduplicates. DB adapters may enforce stricter per-key uniqueness.
    const dedupKey = options?.idempotencyKey
      ? `${entry.sessionId}\u0000${options.idempotencyKey}\u0000${options.expectedParentId ?? ""}`
      : undefined;
    if (dedupKey !== undefined && idempotencySeen.has(dedupKey)) {
      throw new SessionAppendConflictError({ code: SESSION_APPEND_CONFLICT_CODE, idempotencyDuplicate: true });
    }
    // expectedParentId is same-session existence validation (the parent must already
    // be in the store for THIS session, or be undefined for a root). A parent from
    // another session is rejected: the write would be unreadable, since every branch
    // walk is per-session. A stale-but-existing parent is a valid branch (checkout +
    // append) unless the append says `tip`: then a parent that already has a linear
    // child means another writer moved the tip (plan 230 Task 2).
    const linearParent = options?.tip === true ? options.expectedParentId : undefined;
    if (options?.expectedParentId !== undefined) {
      const parent = byId.get(options.expectedParentId);
      if (!parent || parent.sessionId !== entry.sessionId || (linearParent !== undefined && linearChild.has(linearParent))) {
        throw new SessionAppendConflictError({
          code: SESSION_APPEND_CONFLICT_CODE,
          expectedParentId: options.expectedParentId,
          currentLeafId: leafBySession.get(entry.sessionId),
        });
      }
    }
    if (byId.has(entry.id)) throw new Error(`Duplicate session entry id: ${entry.id}`);
    const snapshot = cloneEntry(entry);
    if (dedupKey !== undefined) rememberIdempotencyKey(idempotencySeen, dedupKey);
    if (linearParent !== undefined) linearChild.set(linearParent, snapshot.id);
    byId.set(snapshot.id, snapshot);
    const entries = bySession.get(snapshot.sessionId) ?? [];
    entries.push(snapshot);
    bySession.set(snapshot.sessionId, entries);
    leafBySession.set(snapshot.sessionId, snapshot.id);
  }
}

/**
 * Shared linear (unindexed) session search over already-grouped entries: the memory store's default
 * mode and the JSONL store's implementation. `caps` defaults to the contract linear caps, `limits` to the
 * shipped store query limits.
 */
export function searchLinearSessions(
  bySession: Map<string, SessionEntry[]>,
  leafBySession: Map<string, string>,
  query: SessionSearchQuery,
  caps: LinearSearchCaps = resolveLinearSearchCaps(undefined),
  limits: ResolvedSessionQueryLimits = resolveSessionQueryLimits(),
): PersistencePage<SessionSearchHit> {
  const q = resolveSessionSearchQuery(query, limits);
  q.signal?.throwIfAborted();

  let sessionsScanned = 0;
  let entriesScanned = 0;
  let bytesScanned = 0;
  const matches: SessionSearchHit[] = [];

  for (const [sessionId, entries] of bySession) {
    if (sessionsScanned >= caps.sessions) break;
    if (entriesScanned >= caps.entries) break;
    if (bytesScanned >= caps.bytes) break;
    q.signal?.throwIfAborted();
    sessionsScanned += 1;

    let updatedAt = "";
    let label: string | undefined;
    let summary: string | undefined;
    let workspaceRoot: string | undefined;
    let tenantId: string | undefined;
    let accountId: string | undefined;
    let userId: string | undefined;
    let matchedLabel = false;
    let matchedSummary = false;
    let matchedQuery = false;
    let matchedProvider = false;
    let matchedModel = false;
    let matchedKind = false;
    let matchedEntry: { entry: SessionEntry; turn: number } | undefined;
    let snippetSource: string | undefined;
    let turn = 0;

    for (const entry of entries) {
      if (entriesScanned >= caps.entries) break;
      if (bytesScanned >= caps.bytes) break;
      entriesScanned += 1;
      turn += 1;
      const kindMatches = q.kind === undefined || (q.kind as readonly string[]).includes(entry.kind);
      if (kindMatches) matchedKind = true;
      const text = entrySearchText(entry);
      bytesScanned += utf8Bytes(text) + utf8Bytes(entry.label) + utf8Bytes(entry.summary);

      if (entry.timestamp > updatedAt) updatedAt = entry.timestamp;
      if (entry.label) label = entry.label;
      if (entry.summary) summary = entry.summary;
      const meta = entry.metadata;
      if (meta) {
        if (typeof meta[SESSION_SEARCH_WORKSPACE_METADATA_KEY] === "string") {
          workspaceRoot = meta[SESSION_SEARCH_WORKSPACE_METADATA_KEY] as string;
        }
        if (typeof meta.tenantId === "string") tenantId = meta.tenantId;
        if (typeof meta.accountId === "string") accountId = meta.accountId;
        if (typeof meta.userId === "string") userId = meta.userId;
      }
      if (q.label && entry.label?.includes(q.label)) matchedLabel = true;
      if (q.summary && entry.summary?.includes(q.summary)) matchedSummary = true;
      if (q.query && kindMatches) {
        const hay = `${entry.label ?? ""}\n${entry.summary ?? ""}\n${text}`;
        if (hay.includes(q.query)) {
          matchedQuery = true;
          matchedEntry ??= { entry, turn };
          snippetSource ??= [entry.label, entry.summary, text].find((part) => part?.includes(q.query as string)) ?? hay;
        }
      }
      if (q.provider && (entry.model?.provider === q.provider || metaProvider(entry) === q.provider)) matchedProvider = true;
      if (q.model && entry.model?.model === q.model) matchedModel = true;
    }

    if (q.workspaceRoot && workspaceRoot !== q.workspaceRoot) continue;
    if (!sessionLinksMatch(sessionLinksOf(entries), q)) continue;
    if (q.tenantId && tenantId !== q.tenantId) continue;
    if (q.accountId && accountId !== q.accountId) continue;
    if (q.userId && userId !== q.userId) continue;
    if (q.label && !matchedLabel) continue;
    if (q.summary && !matchedSummary) continue;
    if (q.query && !matchedQuery) continue;
    if (q.kind && (q.query ? matchedEntry === undefined : !matchedKind)) continue;
    if (q.provider && !matchedProvider) continue;
    if (q.model && !matchedModel) continue;
    if (q.fromUpdatedAt && updatedAt < q.fromUpdatedAt) continue;
    if (q.toUpdatedAt && updatedAt > q.toUpdatedAt) continue;

    matches.push({
      sessionId,
      leafId: leafBySession.get(sessionId),
      entryId: matchedEntry?.entry.id,
      runId: matchedEntry?.entry.runId,
      turn: matchedEntry?.turn,
      updatedAt: updatedAt || undefined,
      label,
      summary,
      snippet: clipSnippet(snippetSource ?? label ?? summary, limits.searchSnippetBytes),
      metadata: workspaceRoot !== undefined ? { [SESSION_SEARCH_WORKSPACE_METADATA_KEY]: workspaceRoot } : undefined,
    });
  }

  matches.sort((a, b) => compareSearchHit(a, b, q.order));
  const afterCursor = q.cursor ? decodeSearchCursor(q.cursor) : undefined;
  const filtered = afterCursor ? matches.filter((hit) => isAfterSearchCursor(hit, afterCursor, q.order)) : matches;
  const page = filtered.slice(0, q.limit);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor: filtered.length > q.limit && last?.updatedAt ? encodeSearchCursor(last.updatedAt, last.sessionId) : undefined,
  };
}

function entrySearchText(entry: SessionEntry): string {
  if (!entry.message?.content) return "";
  const parts: string[] = [];
  for (const block of entry.message.content) {
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}

function metaProvider(entry: SessionEntry): string | undefined {
  const value = entry.metadata?.provider;
  return typeof value === "string" ? value : undefined;
}

function utf8Bytes(value: string | undefined): number {
  return value ? new TextEncoder().encode(value).byteLength : 0;
}

function clipSnippet(value: string | undefined, maxBytes: number): string | undefined {
  return value ? clipSessionSearchSnippet(value, maxBytes) : undefined;
}

function encodeSearchCursor(updatedAt: string, sessionId: string): string {
  return `${updatedAt}\t${sessionId}`;
}

function decodeSearchCursor(cursor: string): { updatedAt: string; sessionId: string } {
  const tab = cursor.indexOf("\t");
  if (tab <= 0 || tab === cursor.length - 1) throw new TypeError("SessionSearchQuery.cursor is invalid");
  return { updatedAt: cursor.slice(0, tab), sessionId: cursor.slice(tab + 1) };
}

function compareSearchHit(a: SessionSearchHit, b: SessionSearchHit, order: "asc" | "desc"): number {
  const aAt = a.updatedAt ?? "";
  const bAt = b.updatedAt ?? "";
  const cmp = aAt < bAt ? -1 : aAt > bAt ? 1 : a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0;
  return order === "asc" ? cmp : -cmp;
}

function isAfterSearchCursor(hit: SessionSearchHit, cursor: { updatedAt: string; sessionId: string }, order: "asc" | "desc"): boolean {
  const at = hit.updatedAt ?? "";
  if (order === "asc") {
    return at > cursor.updatedAt || (at === cursor.updatedAt && hit.sessionId > cursor.sessionId);
  }
  return at < cursor.updatedAt || (at === cursor.updatedAt && hit.sessionId < cursor.sessionId);
}

/** Dedup only covers retries near the append. Older keys append as new entries. */
const IDEMPOTENCY_SEEN_MAX = 4_096;

function rememberIdempotencyKey(seen: Set<string>, key: string): void {
  if (seen.size >= IDEMPOTENCY_SEEN_MAX) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  seen.add(key);
}

function cloneEntry<T>(entry: T): T {
  return structuredClone(entry);
}

function decodeBranchOffset(cursor: string): number {
  const value = Number(cursor);
  if (!Number.isInteger(value) || value < 0) throw new Error("Invalid branch pagination cursor");
  return value;
}

/** Tip with the latest timestamp, then highest id. Matches SQLite `findLatestLeafId`. */
function tipLeafId(entries: readonly SessionEntry[]): string | undefined {
  const parents = new Set<string>();
  for (const entry of entries) if (entry.parentId) parents.add(entry.parentId);
  let best: SessionEntry | undefined;
  for (const entry of entries) {
    if (parents.has(entry.id)) continue;
    if (!best || entry.timestamp > best.timestamp || (entry.timestamp === best.timestamp && entry.id > best.id)) best = entry;
  }
  return best?.id;
}

function isCompactionEntryData(value: unknown): value is CompactionEntryData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (
    (data.throughEntryId === undefined || typeof data.throughEntryId === "string") &&
    (data.keepEntryIds === undefined || (Array.isArray(data.keepEntryIds) && data.keepEntryIds.every((item) => typeof item === "string")))
  );
}

function indexEntries(entries: readonly SessionEntry[]): { byId: Map<string, SessionEntry>; parentIds: Set<string> } {
  const byId = new Map<string, SessionEntry>();
  const parentIds = new Set<string>();
  for (const entry of entries) {
    if (byId.has(entry.id)) throw new Error(`Duplicate session entry id: ${entry.id}`);
    byId.set(entry.id, entry);
    if (entry.parentId) parentIds.add(entry.parentId);
  }
  for (const parentId of parentIds) {
    if (!byId.has(parentId)) throw new Error(`Missing session parent: ${parentId}`);
  }
  return { byId, parentIds };
}

const randomId = createId;

/** The `OwnershipScope` fields, in stamp order. Shared with `narrowScope` so the two never drift. */
export const OWNERSHIP_SCOPE_KEYS = ["tenantId", "accountId", "userId"] as const;

/**
 * Whether every entry carries each field of `scope` with the same value. An undefined scope (or an undefined
 * field) constrains nothing; an entry written without the stamp is outside any scope that names the field.
 */
export function entriesInScope(entries: readonly SessionEntry[], scope: OwnershipScope | undefined): boolean {
  if (!scope) return true;
  return entries.every((entry) => OWNERSHIP_SCOPE_KEYS.every((key) => scope[key] === undefined || entry.metadata?.[key] === scope[key]));
}

/** The links a `metadata` entry carries in `data[SESSION_LINKS_DATA_KEY]`, or `undefined`. */
export function sessionLinksOfEntry(entry: SessionEntry): SessionLinks | undefined {
  if (entry.kind !== "metadata" || !entry.data || typeof entry.data !== "object") return undefined;
  const raw = (entry.data as Record<string, unknown>)[SESSION_LINKS_DATA_KEY];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as SessionLinks) : undefined;
}

/** The links a session was opened with: the first links entry among `entries`, or `undefined`. */
export function sessionLinksOf(entries: readonly SessionEntry[]): SessionLinks | undefined {
  for (const entry of entries) {
    const links = sessionLinksOfEntry(entry);
    if (links) return links;
  }
  return undefined;
}

/** Whether `links` satisfy every link filter field set on `filter`. A session without links matches no set field. */
export function sessionLinksMatch(links: SessionLinks | undefined, filter: SessionLinkFilter): boolean {
  if (filter.agentId !== undefined && links?.agentId !== filter.agentId) return false;
  if (filter.parentSessionId !== undefined && links?.sessionId !== filter.parentSessionId) return false;
  if (filter.workflowRunId !== undefined && links?.workflowRunId !== filter.workflowRunId) return false;
  if (filter.delegationId !== undefined && links?.delegationId !== filter.delegationId) return false;
  if (filter.actorKind !== undefined && links?.actor?.kind !== filter.actorKind) return false;
  if (filter.actorAgent !== undefined && links?.actor?.agent !== filter.actorAgent) return false;
  return true;
}

/** The summary fields a session's links contribute. */
export function summaryLinkFields(links: SessionLinks | undefined): Partial<SessionSummary> {
  if (!links) return {};
  return {
    ...(links.agentId !== undefined ? { agentId: links.agentId } : {}),
    ...(links.sessionId !== undefined ? { parentSessionId: links.sessionId } : {}),
    ...(links.workflowRunId !== undefined ? { workflowRunId: links.workflowRunId } : {}),
    ...(links.delegationId !== undefined ? { delegationId: links.delegationId } : {}),
    ...(links.actor !== undefined ? { actor: links.actor } : {}),
  };
}

/** Summary of one session from its entries: no transcript, only counts, times, and display metadata. */
export function summarizeSession(sessionId: string, entries: readonly SessionEntry[], leafId: string | undefined): SessionSummary {
  let createdAt: string | undefined;
  let updatedAt: string | undefined;
  let messageCount = 0;
  let title: string | undefined;
  let workspaceRoot: string | undefined;
  for (const entry of entries) {
    if (createdAt === undefined || entry.timestamp < createdAt) createdAt = entry.timestamp;
    if (updatedAt === undefined || entry.timestamp > updatedAt) updatedAt = entry.timestamp;
    if (entry.kind === "message") messageCount += 1;
    const meta = entry.metadata;
    if (typeof meta?.[SESSION_TITLE_METADATA_KEY] === "string") title = meta[SESSION_TITLE_METADATA_KEY] as string;
    if (typeof meta?.[SESSION_SEARCH_WORKSPACE_METADATA_KEY] === "string")
      workspaceRoot = meta[SESSION_SEARCH_WORKSPACE_METADATA_KEY] as string;
  }
  return {
    sessionId,
    ...(leafId !== undefined ? { leafId } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    messageCount,
    ...(title !== undefined ? { title } : {}),
    ...(workspaceRoot !== undefined ? { metadata: { [SESSION_SEARCH_WORKSPACE_METADATA_KEY]: workspaceRoot } } : {}),
    ...summaryLinkFields(sessionLinksOf(entries)),
  };
}

function listMemorySessions(
  bySession: Map<string, SessionEntry[]>,
  leafBySession: Map<string, string>,
  query: SessionListQuery,
  limits: ResolvedSessionQueryLimits,
): PersistencePage<SessionSummary> {
  const limit = resolveSessionListLimit(query, limits);
  const order = query.order ?? "desc";
  if (order !== "asc" && order !== "desc") throw new TypeError('SessionListQuery.order must be "asc" or "desc"');
  assertSessionLinkFilter(query);
  const summaries: SessionSummary[] = [];
  for (const [sessionId, entries] of bySession) {
    if (entries.length === 0 || !entriesInScope(entries, query)) continue;
    if (!sessionLinksMatch(sessionLinksOf(entries), query)) continue;
    summaries.push(summarizeSession(sessionId, entries, leafBySession.get(sessionId)));
  }
  const key = (summary: SessionSummary) => `${summary.updatedAt ?? ""}\t${summary.sessionId}`;
  summaries.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * (order === "asc" ? 1 : -1));
  let start = 0;
  if (query.cursor !== undefined) {
    // The cursor is the key of the last row served; resume strictly after it in the sort order.
    if (typeof query.cursor !== "string" || !query.cursor.includes("\t")) throw new TypeError("SessionListQuery.cursor is invalid");
    start = summaries.findIndex((summary) => (order === "asc" ? key(summary) > query.cursor! : key(summary) < query.cursor!));
    if (start < 0) start = summaries.length;
  }
  const page = summaries.slice(start, start + limit);
  const last = page.at(-1);
  return { items: page, nextCursor: start + page.length < summaries.length && last ? key(last) : undefined };
}
