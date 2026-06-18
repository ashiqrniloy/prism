import type { CompactionEntryData, Message, SessionEntry, SessionStore } from "./contracts.js";

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

export function getSessionBranchEntries(entries: readonly SessionEntry[], options: SessionBranchOptions = {}): readonly SessionEntry[] {
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
  return branch.reverse();
}

export function listSessionBranches(entries: readonly SessionEntry[]): readonly SessionBranch[] {
  const index = indexEntries(entries);
  return entries
    .filter((entry) => !index.parentIds.has(entry.id))
    .map((entry) => ({ leafId: entry.id, entries: getSessionBranchEntries(entries, { leafId: entry.id }) }));
}

export function rebuildSessionContext(entries: readonly SessionEntry[], options: SessionBranchOptions = {}): SessionContextSnapshot {
  const branch = getSessionBranchEntries(entries, options);
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
    if (entry.kind === "message" && entry.message && (afterThrough || keepIds.has(entry.id))) messages.push(entry.message);
    if (entry.kind === "summary" && entry.summary && afterThrough) summaries.push(entry.summary);
  }

  return { leafId: branch.at(-1)?.id, entries: branch, messages, summaries };
}

export function createMemorySessionStore(initialEntries: readonly SessionEntry[] = []): SessionStore {
  const byId = new Map<string, SessionEntry>();
  const bySession = new Map<string, SessionEntry[]>();

  for (const entry of initialEntries) add(entry);

  return {
    async append(entry) {
      add(entry);
    },
    async list(sessionId) {
      return bySession.get(sessionId) ?? [];
    },
    async get(id) {
      return byId.get(id);
    },
  };

  function add(entry: SessionEntry): void {
    if (byId.has(entry.id)) throw new Error(`Duplicate session entry id: ${entry.id}`);
    byId.set(entry.id, entry);
    const entries = bySession.get(entry.sessionId) ?? [];
    entries.push(entry);
    bySession.set(entry.sessionId, entries);
  }
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

function randomId(prefix: string): string {
  return `${prefix}_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}
