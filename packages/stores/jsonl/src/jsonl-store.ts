import { appendFile, mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createMemorySessionStore,
  DEFAULT_SESSION_LIST_LIMIT,
  HARD_MAX_SESSION_LIST_LIMIT,
  isSessionEntryKind,
  type Message,
  type ModelConfig,
  type OwnershipScope,
  type PersistencePage,
  SESSION_APPEND_CONFLICT_CODE,
  SESSION_ENTRY_SCHEMA_VERSION,
  SESSION_SEARCH_WORKSPACE_METADATA_KEY,
  SESSION_TITLE_METADATA_KEY,
  SessionAppendConflictError,
  type SessionEntry,
  type SessionListQuery,
  type SessionStore,
  type SessionSummary,
} from "@arnilo/prism";

const IDEMPOTENCY_SEEN_MAX = 4_096;
const IDEMPOTENCY_FILE = ".idempotency.json";
const EDGE_CHUNK_BYTES = 64 * 1024;
/**
 * Session ids are file names, so the accepted alphabet is deliberately narrow: it starts with an
 * alphanumeric and carries no separator, which rules out `..`, `a/b`, and absolute paths.
 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SESSION_FILE_SUFFIX = ".jsonl";
const OWNERSHIP_KEYS = ["tenantId", "accountId", "userId"] as const;

/** A JSONL store failure that names its code. `invalid_session_id` is the fail-closed path guard. */
export class JsonlSessionStoreError extends Error {
  readonly code: "invalid_session_id";
  constructor(code: "invalid_session_id", message: string) {
    super(message);
    this.name = "JsonlSessionStoreError";
    this.code = code;
  }
}

export interface JsonlSessionStoreOptions {
  /** Directory holding one JSONL file per session (`<dir>/<sessionId>.jsonl`). Resolved against the cwd. */
  readonly dir: string;
}

export interface SessionEntryParseError {
  readonly line: number;
  readonly message: string;
  readonly raw?: string;
}

export interface SessionEntryReadResult {
  readonly entries: SessionEntry[];
  readonly errors: SessionEntryParseError[];
}

/** Test-only counters on the store instance. Not `SessionStore` fields. */
export const JSONL_FILE_READS = Symbol.for("prism.jsonl.fileReads");
export const JSONL_BYTES_READ = Symbol.for("prism.jsonl.bytesRead");

function sessionPath(dir: string, sessionId: string): string {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new JsonlSessionStoreError(
      "invalid_session_id",
      `Invalid session id ${JSON.stringify(sessionId)}: the JSONL store writes one file per session and accepts only [A-Za-z0-9][A-Za-z0-9._-]{0,127}`,
    );
  }
  return join(dir, `${sessionId}${SESSION_FILE_SUFFIX}`);
}

function rememberIdempotencyKey(seen: Set<string>, key: string): void {
  if (seen.size >= IDEMPOTENCY_SEEN_MAX) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  seen.add(key);
}

/** The two sampled lines of one session file, newest last. `entries` is deduplicated for one-line files. */
interface SessionEdges {
  readonly entries: readonly SessionEntry[];
  readonly first: SessionEntry;
  readonly last: SessionEntry;
}

/**
 * A durable, single-process `SessionStore` over one JSONL file per session.
 *
 * ```ts
 * const store = createJsonlSessionStore({ dir: ".prism/sessions" });
 * ```
 *
 * Reads of one session parse that session's file; `listSessions` samples the first and last line of
 * each file, and `deleteSession` removes one file. `searchSessions` scans the whole directory.
 *
 * ponytail: single-process only. Appends are serialized by one in-process chain and the idempotency
 * set is in memory, so two processes writing the same directory can still race and a restart forgets
 * exact retries. Multi-writer safety is host-owned (a database adapter or an external lock).
 */
export function createJsonlSessionStore(options: JsonlSessionStoreOptions): SessionStore {
  const dir = options.dir;
  let appendChain = Promise.resolve();
  const idempotencySeen = new Set<string>();
  let keysLoaded: Promise<void> | undefined;
  // ponytail: cache key is (size, mtimeMs). A same-size rewrite inside one filesystem timestamp tick
  // is invisible. Upgrade: hash the file.
  const cache = new Map<string, { size: number; mtimeMs: number; entries: SessionEntry[] }>();
  let fileReads = 0;
  let bytesRead = 0;

  const countBytes = (bytes: number): void => {
    bytesRead += bytes;
  };

  async function readParsed(path: string): Promise<SessionEntryReadResult> {
    fileReads++;
    return readJsonlSessionEntries(path, countBytes);
  }

  async function readEntries(sessionId: string): Promise<SessionEntry[]> {
    const path = sessionPath(dir, sessionId);
    let size: number;
    let mtimeMs: number;
    try {
      const info = await stat(path);
      size = info.size;
      mtimeMs = info.mtimeMs;
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) {
        cache.delete(sessionId);
        return [];
      }
      throw new Error(`Failed to read session store ${path}: ${errorMessage(error)}`);
    }
    const cached = cache.get(sessionId);
    if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached.entries;
    const result = await readParsed(path);
    cache.set(sessionId, { size, mtimeMs, entries: result.entries });
    return result.entries;
  }

  /** Every valid session id in `dir`, sorted. A missing directory is an empty store. */
  async function sessionIds(): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) return [];
      throw new Error(`Failed to read session store directory ${dir}: ${errorMessage(error)}`);
    }
    return names
      .filter((name) => name.endsWith(SESSION_FILE_SUFFIX))
      .map((name) => name.slice(0, -SESSION_FILE_SUFFIX.length))
      .filter((sessionId) => SESSION_ID_PATTERN.test(sessionId))
      .sort();
  }

  async function readAllEntries(): Promise<SessionEntry[]> {
    const entries: SessionEntry[] = [];
    for (const sessionId of await sessionIds()) {
      const result = await readParsed(sessionPath(dir, sessionId));
      entries.push(...result.entries);
    }
    return entries;
  }

  /** The first and last line of a session file, parsed. A line that does not parse drops the session. */
  async function readEdges(sessionId: string): Promise<SessionEdges | undefined> {
    const path = sessionPath(dir, sessionId);
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) return undefined;
      throw new Error(`Failed to read session store ${path}: ${errorMessage(error)}`);
    }
    if (size === 0) return undefined;
    const head = await readEdge(path, size, "first", countBytes);
    const first = parseEdge(head);
    if (!first) return undefined;
    const tail = await readEdge(path, size, "last", countBytes);
    const last = head === tail ? first : parseEdge(tail);
    if (!last) return undefined;
    return { entries: head === tail ? [first] : [first, last], first, last };
  }

  /**
   * Summarize from the two sampled lines only: the kernel's own `listSessions` counts every entry, the
   * JSONL store trades that for two line reads per session. `title` and `workspaceRoot` are taken from
   * either end, times and the branch tip from the newest append, and `messageCount` counts the sampled
   * message entries (0–2).
   */
  function summarizeEdges(sessionId: string, edges: SessionEdges): SessionSummary {
    let title: string | undefined;
    let workspaceRoot: string | undefined;
    let messageCount = 0;
    for (const entry of edges.entries) {
      if (entry.kind === "message") messageCount += 1;
      const meta = entry.metadata;
      if (typeof meta?.[SESSION_TITLE_METADATA_KEY] === "string") title = meta[SESSION_TITLE_METADATA_KEY] as string;
      if (typeof meta?.[SESSION_SEARCH_WORKSPACE_METADATA_KEY] === "string") {
        workspaceRoot = meta[SESSION_SEARCH_WORKSPACE_METADATA_KEY] as string;
      }
    }
    return {
      sessionId,
      leafId: edges.last.id,
      createdAt: edges.first.timestamp < edges.last.timestamp ? edges.first.timestamp : edges.last.timestamp,
      updatedAt: edges.first.timestamp < edges.last.timestamp ? edges.last.timestamp : edges.first.timestamp,
      messageCount,
      ...(title !== undefined ? { title } : {}),
      ...(workspaceRoot !== undefined ? { metadata: { [SESSION_SEARCH_WORKSPACE_METADATA_KEY]: workspaceRoot } } : {}),
    };
  }

  /**
   * Durable exact-retry dedup: the small key file beside the session files survives a restart, so a
   * retried append after a crash is still rejected. A missing or unreadable file only loses dedup.
   */
  async function loadIdempotencyKeys(): Promise<void> {
    keysLoaded ??= (async () => {
      try {
        const parsed: unknown = JSON.parse(await readFile(join(dir, IDEMPOTENCY_FILE), "utf8"));
        if (Array.isArray(parsed)) {
          for (const key of parsed) if (typeof key === "string") idempotencySeen.add(key);
        }
      } catch {
        // Fail soft: a corrupt or absent key file costs dedup, never an append.
      }
    })();
    return keysLoaded;
  }

  async function persistIdempotencyKeys(): Promise<void> {
    const path = join(dir, IDEMPOTENCY_FILE);
    const temp = `${path}.tmp`;
    await writeFile(temp, JSON.stringify([...idempotencySeen]), "utf8");
    await rename(temp, path);
  }

  const store: SessionStore = {
    append(entry, appendOptions) {
      const operation = appendChain
        .catch(() => undefined)
        .then(async () => {
          const path = sessionPath(dir, entry.sessionId);
          await mkdir(dir, { recursive: true });
          await loadIdempotencyKeys();
          let beforeSize = 0;
          try {
            beforeSize = (await stat(path)).size;
          } catch (error) {
            if (!isNodeErrorCode(error, "ENOENT")) throw error;
          }
          const readResult = await readParsed(path);
          const parseError = readResult.errors[0];
          if (parseError) throw new Error(`Invalid JSONL at line ${parseError.line}: ${parseError.message}`);
          const entries = readResult.entries;
          const dedupKey = appendOptions?.idempotencyKey
            ? `${entry.sessionId}\u0000${appendOptions.idempotencyKey}\u0000${appendOptions.expectedParentId ?? ""}`
            : undefined;
          if (dedupKey !== undefined && idempotencySeen.has(dedupKey)) {
            throw new SessionAppendConflictError({ code: SESSION_APPEND_CONFLICT_CODE, idempotencyDuplicate: true });
          }
          if (
            appendOptions?.expectedParentId !== undefined &&
            !entries.some((existing) => existing.id === appendOptions.expectedParentId)
          ) {
            throw new SessionAppendConflictError({
              code: SESSION_APPEND_CONFLICT_CODE,
              expectedParentId: appendOptions.expectedParentId,
            });
          }
          if (entries.some((existing) => existing.id === entry.id)) {
            throw new Error(`Duplicate session entry id: ${entry.id}`);
          }
          if (dedupKey !== undefined) {
            rememberIdempotencyKey(idempotencySeen, dedupKey);
            await persistIdempotencyKeys();
          }
          const line = `${JSON.stringify(entry)}\n`;
          await appendFile(path, line, "utf8");
          const info = await stat(path);
          if (info.size === beforeSize + Buffer.byteLength(line)) {
            cache.set(entry.sessionId, { size: info.size, mtimeMs: info.mtimeMs, entries: entries.concat(entry) });
          } else {
            cache.delete(entry.sessionId);
          }
        });
      appendChain = operation.catch(() => undefined);
      return operation;
    },
    async list(sessionId) {
      const entries = await readEntries(sessionId);
      return entries.filter((entry) => entry.sessionId === sessionId);
    },
    async get(id) {
      for (const sessionId of await sessionIds()) {
        const found = (await readEntries(sessionId)).find((entry) => entry.id === id);
        if (found) return found;
      }
      return undefined;
    },
    async searchSessions(query) {
      // ponytail: no index. Every search reads and parses the whole directory, then reuses the kernel's
      // linear matcher and caps through a scratch memory store, so JSONL and memory results stay identical.
      const scratch = createMemorySessionStore(await readAllEntries());
      const search = scratch.searchSessions;
      if (!search) throw new Error("the kernel memory store must implement searchSessions");
      return search.call(scratch, query);
    },
    async listSessions(query) {
      query.signal?.throwIfAborted();
      const limit = query.limit ?? DEFAULT_SESSION_LIST_LIMIT;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > HARD_MAX_SESSION_LIST_LIMIT) {
        throw new TypeError(`SessionListQuery.limit must be a safe integer from 1 to ${HARD_MAX_SESSION_LIST_LIMIT}`);
      }
      const order = query.order ?? "desc";
      if (order !== "asc" && order !== "desc") throw new TypeError('SessionListQuery.order must be "asc" or "desc"');
      const summaries: SessionSummary[] = [];
      for (const sessionId of await sessionIds()) {
        const edges = await readEdges(sessionId);
        if (!edges || !edgesInScope(edges.entries, query)) continue;
        summaries.push(summarizeEdges(sessionId, edges));
      }
      const key = (summary: SessionSummary) => `${summary.updatedAt ?? ""}\t${summary.sessionId}`;
      summaries.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * (order === "asc" ? 1 : -1));
      let start = 0;
      const cursor = query.cursor;
      if (cursor !== undefined) {
        if (typeof cursor !== "string" || !cursor.includes("\t")) {
          throw new TypeError("SessionListQuery.cursor is invalid");
        }
        start = summaries.findIndex((summary) => (order === "asc" ? key(summary) > cursor : key(summary) < cursor));
        if (start < 0) start = summaries.length;
      }
      const page = summaries.slice(start, start + limit);
      const last = page.at(-1);
      return {
        items: page,
        nextCursor: start + page.length < summaries.length && last ? key(last) : undefined,
      } satisfies PersistencePage<SessionSummary>;
    },
    async deleteSession(sessionId, scope) {
      const path = sessionPath(dir, sessionId);
      const edges = await readEdges(sessionId);
      // Fail closed and non-enumerating: an absent session and another scope's session answer alike.
      if (!edges || !edgesInScope(edges.entries, scope)) return false;
      await unlink(path);
      cache.delete(sessionId);
      return true;
    },
  };
  Object.defineProperty(store, JSONL_FILE_READS, { get: () => fileReads });
  Object.defineProperty(store, JSONL_BYTES_READ, { get: () => bytesRead });
  return store;
}

/**
 * Mirrors the kernel's `entriesInScope` over the sampled lines: an undefined scope constrains nothing,
 * and a field a scope names must appear with that value on every sampled entry.
 */
function edgesInScope(entries: readonly SessionEntry[], scope: OwnershipScope | undefined): boolean {
  if (!scope) return true;
  return entries.every((entry) =>
    OWNERSHIP_KEYS.every((key) => scope[key] === undefined || entry.metadata?.[key] === scope[key]),
  );
}

function parseEdge(text: string): SessionEntry | undefined {
  const parsed = parseEntry(text, 1);
  return parsed.ok ? parsed.entry : undefined;
}

/** Read one end of a file: the first line or the last line, in chunks, counting the bytes read. */
async function readEdge(
  path: string,
  size: number,
  end: "first" | "last",
  countBytes: (bytes: number) => void,
): Promise<string> {
  const handle = await open(path, "r");
  let total = 0;
  try {
    let joined = Buffer.alloc(0);
    let cursor = end === "first" ? 0 : size;
    for (;;) {
      const length = end === "first" ? Math.min(EDGE_CHUNK_BYTES, size - cursor) : Math.min(EDGE_CHUNK_BYTES, cursor);
      if (length <= 0) break;
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead: read } = await handle.read(buffer, 0, length, end === "first" ? cursor : cursor - length);
      if (read === 0) break;
      total += read;
      const chunk = buffer.subarray(0, read);
      if (end === "first") {
        joined = Buffer.concat([joined, chunk]);
        cursor += read;
        if (firstLineEnd(joined) !== undefined || cursor >= size) break;
      } else {
        joined = Buffer.concat([chunk, joined]);
        cursor -= read;
        if (lastLineStart(joined) !== undefined || cursor <= 0) break;
      }
    }
    if (end === "first") {
      const stop = firstLineEnd(joined) ?? joined.length;
      return joined.subarray(0, stop).toString("utf8").trimEnd();
    }
    const start = lastLineStart(joined) ?? 0;
    return joined.subarray(start).toString("utf8").trimEnd();
  } finally {
    await handle.close();
    countBytes(total);
  }
}

/** The byte index of the first newline, when this chunk already holds one. */
function firstLineEnd(buffer: Buffer): number | undefined {
  const index = buffer.indexOf(0x0a);
  return index < 0 ? undefined : index;
}

/** The byte index just past the last newline that ends a complete line, when this chunk holds one. */
function lastLineStart(buffer: Buffer): number | undefined {
  let end = buffer.length - 1;
  while (end >= 0 && (buffer[end] === 0x0a || buffer[end] === 0x0d)) end -= 1;
  if (end < 0) return undefined;
  const index = buffer.lastIndexOf(0x0a, end);
  return index < 0 ? undefined : index + 1;
}

/** Read a JSONL session file and return both valid entries and per-line parse errors. */
export async function readJsonlSessionEntries(
  path: string,
  onBytesRead?: (bytes: number) => void,
): Promise<SessionEntryReadResult> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return { entries: [], errors: [] };
    throw new Error(`Failed to read session store ${path}: ${errorMessage(error)}`);
  }
  onBytesRead?.(Buffer.byteLength(text));

  const entries: SessionEntry[] = [];
  const errors: SessionEntryParseError[] = [];
  for (const [index, line] of text.split(/\r?\n/).filter(Boolean).entries()) {
    const parsed = parseEntry(line, index + 1);
    if (parsed.ok) {
      entries.push(parsed.entry);
    } else {
      errors.push(parsed.error);
    }
  }
  return { entries, errors };
}

function parseEntry(line: string, lineNumber: number): { ok: true; entry: SessionEntry } | { ok: false; error: SessionEntryParseError } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    return { ok: false, error: { line: lineNumber, message: `Invalid JSON: ${errorMessage(error)}`, raw: line } };
  }
  return validateSessionEntry(parsed, lineNumber, line);
}

function validateSessionEntry(
  value: unknown,
  lineNumber: number,
  raw: string,
): { ok: true; entry: SessionEntry } | { ok: false; error: SessionEntryParseError } {
  if (!isBasicSessionEntry(value)) {
    return {
      ok: false,
      error: { line: lineNumber, message: "Invalid session entry: expected object with id, sessionId, timestamp, and kind", raw },
    };
  }
  const entry = value as Record<string, unknown>;
  if (entry.parentId !== undefined && typeof entry.parentId !== "string") {
    return { ok: false, error: { line: lineNumber, message: "Invalid parentId: expected string", raw } };
  }
  const schemaVersion = entry.schemaVersion ?? SESSION_ENTRY_SCHEMA_VERSION;
  if (typeof schemaVersion !== "number" || schemaVersion !== SESSION_ENTRY_SCHEMA_VERSION) {
    return { ok: false, error: { line: lineNumber, message: `Unsupported session entry schema version: ${schemaVersion}`, raw } };
  }
  const kind = entry.kind;
  if (!isSessionEntryKind(kind)) {
    return { ok: false, error: { line: lineNumber, message: `Unknown session entry kind: ${kind}`, raw } };
  }
  switch (kind) {
    case "message":
      if (!isMessage(entry.message)) {
        return { ok: false, error: { line: lineNumber, message: "Invalid message entry: expected Message object", raw } };
      }
      break;
    case "summary":
      if (typeof entry.summary !== "string") {
        return { ok: false, error: { line: lineNumber, message: "Invalid summary entry: expected string summary", raw } };
      }
      break;
    case "model_change":
      if (!isModelConfig(entry.model)) {
        return { ok: false, error: { line: lineNumber, message: "Invalid model_change entry: expected ModelConfig object", raw } };
      }
      break;
    case "custom":
      if (!isPlainObject(entry.data)) {
        return { ok: false, error: { line: lineNumber, message: "Invalid custom entry: expected object data", raw } };
      }
      break;
    case "compaction":
      if (typeof entry.summary !== "string") {
        return { ok: false, error: { line: lineNumber, message: "Invalid compaction entry: expected string summary", raw } };
      }
      if (!isPlainObject(entry.data)) {
        return { ok: false, error: { line: lineNumber, message: "Invalid compaction entry: expected object data", raw } };
      }
      break;
    case "label":
      if (typeof entry.label !== "string") {
        return { ok: false, error: { line: lineNumber, message: "Invalid label entry: expected string label", raw } };
      }
      break;
    case "event":
      if (!isAgentEvent(entry.event)) {
        return { ok: false, error: { line: lineNumber, message: "Invalid event entry: expected AgentEvent object", raw } };
      }
      break;
    case "metadata":
      if (!isPlainObject(entry.data)) {
        return { ok: false, error: { line: lineNumber, message: "Invalid metadata entry: expected object data", raw } };
      }
      break;
    case "package_state":
      if (!isPlainObject(entry.data)) {
        return { ok: false, error: { line: lineNumber, message: "Invalid package_state entry: expected object data", raw } };
      }
      break;
    case "suspended_run":
      // `data` is parsed fail-closed by the kernel's resume path, so the line only has to be well-formed JSON.
      break;
  }
  return { ok: true, entry: entry as unknown as SessionEntry };
}

function isBasicSessionEntry(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.sessionId === "string" &&
    typeof entry.timestamp === "string" &&
    typeof entry.kind === "string"
  );
}

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return typeof message.role === "string" && Array.isArray(message.content);
}

function isModelConfig(value: unknown): value is ModelConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const model = value as Record<string, unknown>;
  return typeof model.provider === "string" && typeof model.model === "string";
}

function isAgentEvent(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && typeof value.type === "string";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
