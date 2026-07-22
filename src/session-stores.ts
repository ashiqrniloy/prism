import {
  DEFAULT_MAX_SESSION_SEARCH_LINEAR_BYTES,
  DEFAULT_MAX_SESSION_SEARCH_LINEAR_ENTRIES,
  DEFAULT_MAX_SESSION_SEARCH_LINEAR_SESSIONS,
  DEFAULT_MAX_SESSION_SEARCH_SNIPPET_BYTES,
  SESSION_APPEND_CONFLICT_CODE,
  SESSION_SEARCH_WORKSPACE_METADATA_KEY,
  SessionAppendConflictError,
  SessionSearchUnsupportedError,
  resolveSessionSearchQuery,
  type CompactionEntryData,
  type Message,
  type PersistencePage,
  type SessionAppendOptions,
  type SessionBranchRead,
  type BranchReader,
  type SessionEntry,
  type SessionSearchHit,
  type SessionSearchQuery,
  type SessionStore,
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

// ponytail: max pages the reader path will follow before stopping. Guards against a buggy/
// malicious reader that never ends `nextCursor`. Ancestor chains are short in practice; bump
// this if a legitimate branch exceeds it.
const MAX_BRANCH_PAGES = 64;

export function getSessionBranchEntries(reader: BranchReader, query: SessionBranchRead): Promise<readonly SessionEntry[]>;
export function getSessionBranchEntries(entries: readonly SessionEntry[], options?: SessionBranchOptions): readonly SessionEntry[];
export function getSessionBranchEntries(
  input: readonly SessionEntry[] | BranchReader,
  options: SessionBranchOptions | SessionBranchRead = {},
): readonly SessionEntry[] | Promise<readonly SessionEntry[]> {
  return typeof input === "function" ? readBranchFromReader(input, options as SessionBranchRead) : getSessionBranchEntriesCore(input, options as SessionBranchOptions);
}

async function readBranchFromReader(reader: BranchReader, query: SessionBranchRead): Promise<readonly SessionEntry[]> {
  const items: SessionEntry[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_BRANCH_PAGES; page++) {
    const result = await reader(cursor ? { ...query, cursor } : query);
    items.push(...result.items);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  // Reuse the validated in-memory walk: the reader returns the ancestor SET (any order);
  // indexEntries + the parentId walk order it and still reject missing parents / dupes.
  return getSessionBranchEntriesCore(items, { leafId: query.leafId });
}

function getSessionBranchEntriesCore(entries: readonly SessionEntry[], options: SessionBranchOptions = {}): readonly SessionEntry[] {
  const index = indexEntries(entries);
  const leafId = options.leafId ?? entries.at(-1)?.id;
  if (!leafId) return [];
  if (!index.byId.has(leafId)) throw new Error(`Unknown session leaf: ${leafId}`);

  const branch: SessionEntry[] = [];
  for (let id: string | undefined = leafId; id;) {
    const entry = index.byId.get(id);
    if (!entry) throw new Error(`Missing session parent: ${id}`);
    branch.push(entry);
    id = entry.parentId;
  }
  return branch.reverse().map(cloneEntry);
}

export function listSessionBranches(entries: readonly SessionEntry[]): readonly SessionBranch[] {
  const index = indexEntries(entries);
  return entries
    .filter((entry) => !index.parentIds.has(entry.id))
    .map((entry) => ({ leafId: entry.id, entries: getSessionBranchEntries(entries, { leafId: entry.id }) }));
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
  // ponytail: pass the drained branch back through the sync core so compaction logic has ONE
  // code path; the redundant re-walk is O(branch length) and branch chains are short.
  const branch = await readBranchFromReader(reader, query);
  return rebuildSessionContextCore(branch, { leafId: query.leafId });
}

function rebuildSessionContextCore(entries: readonly SessionEntry[], options: SessionBranchOptions = {}): SessionContextSnapshot {
  const branch = getSessionBranchEntriesCore(entries, options);
  const compaction = [...branch].reverse().find((entry) => entry.kind === "compaction" && entry.summary && isCompactionEntryData(entry.data));
  if (!compaction || !isCompactionEntryData(compaction.data)) {
    return {
      leafId: branch.at(-1)?.id,
      entries: branch,
      messages: branch.flatMap((entry) => entry.kind === "message" && entry.message ? [entry.message] : []),
      summaries: branch.flatMap((entry) => entry.kind === "summary" && entry.summary ? [entry.summary] : []),
    };
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
    if (entry.kind === "message" && entry.message && (afterThrough || keepIds.has(entry.id))) messages.push(cloneEntry(entry.message));
    if (entry.kind === "summary" && entry.summary && afterThrough) summaries.push(entry.summary);
  }

  return { leafId: branch.at(-1)?.id, entries: branch, messages, summaries };
}

export type MemorySessionSearchMode = "linear" | "unsupported";

export interface CreateMemorySessionStoreOptions {
  /** Default `"linear"`: capped in-process scan. `"unsupported"`: typed throw. */
  readonly sessionSearchMode?: MemorySessionSearchMode;
}

export function createMemorySessionStore(
  initialEntries: readonly SessionEntry[] = [],
  options: CreateMemorySessionStoreOptions = {},
): SessionStore {
  const byId = new Map<string, SessionEntry>();
  const bySession = new Map<string, SessionEntry[]>();
  const leafBySession = new Map<string, string>();
  const idempotencySeen = new Set<string>();
  const mode = options.sessionSearchMode ?? "linear";

  for (const entry of initialEntries) add(entry);

  return {
    async append(entry, appendOptions) {
      add(entry, appendOptions);
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
      return searchMemorySessionsLinear(bySession, leafBySession, query);
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
    // expectedParentId is existence validation (the parent must already be in the
    // store or be undefined for a root). Tip-CAS is intentionally NOT used: prism
    // allows branching from any existing leaf (checkout + append), so a stale-but-
    // existing parent is a valid branch, not a conflict. DB adapters may layer
    // stricter tip-CAS via unique constraints for linear-only sessions.
    if (options?.expectedParentId !== undefined && !byId.has(options.expectedParentId)) {
      throw new SessionAppendConflictError({
        code: SESSION_APPEND_CONFLICT_CODE,
        expectedParentId: options.expectedParentId,
        currentLeafId: leafBySession.get(entry.sessionId),
      });
    }
    if (byId.has(entry.id)) throw new Error(`Duplicate session entry id: ${entry.id}`);
    if (dedupKey !== undefined) idempotencySeen.add(dedupKey);
    byId.set(entry.id, entry);
    const entries = bySession.get(entry.sessionId) ?? [];
    entries.push(entry);
    bySession.set(entry.sessionId, entries);
    leafBySession.set(entry.sessionId, entry.id);
  }
}

function searchMemorySessionsLinear(
  bySession: Map<string, SessionEntry[]>,
  leafBySession: Map<string, string>,
  query: SessionSearchQuery,
): PersistencePage<SessionSearchHit> {
  const q = resolveSessionSearchQuery(query);
  q.signal?.throwIfAborted();

  let sessionsScanned = 0;
  let entriesScanned = 0;
  let bytesScanned = 0;
  const matches: SessionSearchHit[] = [];

  for (const [sessionId, entries] of bySession) {
    if (sessionsScanned >= DEFAULT_MAX_SESSION_SEARCH_LINEAR_SESSIONS) break;
    if (entriesScanned >= DEFAULT_MAX_SESSION_SEARCH_LINEAR_ENTRIES) break;
    if (bytesScanned >= DEFAULT_MAX_SESSION_SEARCH_LINEAR_BYTES) break;
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
    let snippetSource: string | undefined;

    for (const entry of entries) {
      if (entriesScanned >= DEFAULT_MAX_SESSION_SEARCH_LINEAR_ENTRIES) break;
      if (bytesScanned >= DEFAULT_MAX_SESSION_SEARCH_LINEAR_BYTES) break;
      entriesScanned += 1;
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
      if (q.query) {
        const hay = `${entry.label ?? ""}\n${entry.summary ?? ""}\n${text}`;
        if (hay.includes(q.query)) {
          matchedQuery = true;
          snippetSource ??= entry.label ?? entry.summary ?? text;
        }
      }
      if (q.provider && (entry.model?.provider === q.provider || metaProvider(entry) === q.provider)) matchedProvider = true;
      if (q.model && entry.model?.model === q.model) matchedModel = true;
    }

    if (q.workspaceRoot && workspaceRoot !== q.workspaceRoot) continue;
    if (q.tenantId && tenantId !== q.tenantId) continue;
    if (q.accountId && accountId !== q.accountId) continue;
    if (q.userId && userId !== q.userId) continue;
    if (q.label && !matchedLabel) continue;
    if (q.summary && !matchedSummary) continue;
    if (q.query && !matchedQuery) continue;
    if (q.provider && !matchedProvider) continue;
    if (q.model && !matchedModel) continue;
    if (q.fromUpdatedAt && updatedAt < q.fromUpdatedAt) continue;
    if (q.toUpdatedAt && updatedAt > q.toUpdatedAt) continue;

    matches.push({
      sessionId,
      leafId: leafBySession.get(sessionId),
      updatedAt: updatedAt || undefined,
      label,
      summary,
      snippet: clipSnippet(snippetSource ?? label ?? summary),
      metadata: workspaceRoot !== undefined ? { [SESSION_SEARCH_WORKSPACE_METADATA_KEY]: workspaceRoot } : undefined,
    });
  }

  matches.sort((a, b) => compareSearchHit(a, b, q.order));
  const afterCursor = q.cursor ? decodeSearchCursor(q.cursor) : undefined;
  const filtered = afterCursor
    ? matches.filter((hit) => isAfterSearchCursor(hit, afterCursor, q.order))
    : matches;
  const page = filtered.slice(0, q.limit);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor: filtered.length > q.limit && last?.updatedAt
      ? encodeSearchCursor(last.updatedAt, last.sessionId)
      : undefined,
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

function clipSnippet(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= DEFAULT_MAX_SESSION_SEARCH_SNIPPET_BYTES) return value;
  return new TextDecoder().decode(encoded.slice(0, DEFAULT_MAX_SESSION_SEARCH_SNIPPET_BYTES));
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

function isAfterSearchCursor(
  hit: SessionSearchHit,
  cursor: { updatedAt: string; sessionId: string },
  order: "asc" | "desc",
): boolean {
  const at = hit.updatedAt ?? "";
  if (order === "asc") {
    return at > cursor.updatedAt || (at === cursor.updatedAt && hit.sessionId > cursor.sessionId);
  }
  return at < cursor.updatedAt || (at === cursor.updatedAt && hit.sessionId < cursor.sessionId);
}

function cloneEntry<T>(entry: T): T {
  return structuredClone(entry);
}

function isCompactionEntryData(value: unknown): value is CompactionEntryData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (data.throughEntryId === undefined || typeof data.throughEntryId === "string")
    && (data.keepEntryIds === undefined || (Array.isArray(data.keepEntryIds) && data.keepEntryIds.every((item) => typeof item === "string")));
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
