import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import {
  isSessionEntryKind,
  type Message,
  type ModelConfig,
  SESSION_APPEND_CONFLICT_CODE,
  SESSION_ENTRY_SCHEMA_VERSION,
  SessionAppendConflictError,
  type SessionEntry,
  type SessionStore,
} from "../contracts.js";
import { searchLinearSessions } from "../session-stores.js";
import { isNodeErrorCode } from "./config.js";

const IDEMPOTENCY_SEEN_MAX = 4_096;

function rememberIdempotencyKey(seen: Set<string>, key: string): void {
  if (seen.size >= IDEMPOTENCY_SEEN_MAX) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  seen.add(key);
}

export interface JsonlSessionStoreOptions {
  readonly path: string;
  readonly createDirectory?: boolean;
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

/** Test-only read counter on the store instance. Not a SessionStore field. */
const JSONL_FILE_READS = Symbol.for("prism.jsonl.fileReads");

export function createJsonlSessionStore(pathOrOptions: string | JsonlSessionStoreOptions): SessionStore {
  const options = typeof pathOrOptions === "string" ? { path: pathOrOptions, createDirectory: true } : pathOrOptions;
  const path = options.path;
  let appendChain = Promise.resolve();
  // ponytail: single-process only. The appendChain serializes appends within one
  // process; there is no cross-process lock, so two processes writing the same
  // file can still race. Multi-writer safety is host-owned (DB adapter or external
  // lock). The expectedParentId/idempotency guards below mirror the memory store;
  // a DB adapter enforces them via a conditional transaction + unique index.
  const idempotencySeen = new Set<string>();
  // ponytail: cache key is (size, mtimeMs). A same-size rewrite inside one filesystem
  // timestamp tick is invisible. Upgrade: hash the file. Post-write size !== prior
  // size + bytes written already drops the cache so the next read re-parses.
  let cache: { size: number; mtimeMs: number; entries: SessionEntry[] } | undefined;
  let fileReads = 0;

  async function readParsed(): Promise<SessionEntryReadResult> {
    fileReads++;
    return readJsonlSessionEntries(path);
  }

  async function readEntries(): Promise<SessionEntry[]> {
    let st: { size: number; mtimeMs: number };
    try {
      const info = await stat(path);
      st = { size: info.size, mtimeMs: info.mtimeMs };
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) {
        cache = undefined;
        return [];
      }
      throw new Error(`Failed to read session store ${path}: ${errorMessage(error)}`);
    }
    if (cache && cache.size === st.size && cache.mtimeMs === st.mtimeMs) return cache.entries;
    const result = await readParsed();
    cache = { size: st.size, mtimeMs: st.mtimeMs, entries: result.entries };
    return result.entries;
  }

  const store: SessionStore = {
    append(entry, appendOptions) {
      const operation = appendChain
        .catch(() => undefined)
        .then(async () => {
          if (options.createDirectory !== false) await mkdir(dirname(path), { recursive: true });
          let beforeSize = 0;
          try {
            beforeSize = (await stat(path)).size;
          } catch (error) {
            if (!isNodeErrorCode(error, "ENOENT")) throw error;
          }
          const readResult = await readParsed();
          if (readResult.errors.length > 0) {
            const first = readResult.errors[0]!;
            throw new Error(`Invalid JSONL at line ${first.line}: ${first.message}`);
          }
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
            throw new SessionAppendConflictError({ code: SESSION_APPEND_CONFLICT_CODE, expectedParentId: appendOptions.expectedParentId });
          }
          if (entries.some((existing) => existing.id === entry.id)) throw new Error(`Duplicate session entry id: ${entry.id}`);
          if (dedupKey !== undefined) rememberIdempotencyKey(idempotencySeen, dedupKey);
          const line = `${JSON.stringify(entry)}\n`;
          await appendFile(path, line, "utf8");
          const info = await stat(path);
          if (info.size === beforeSize + Buffer.byteLength(line)) {
            cache = { size: info.size, mtimeMs: info.mtimeMs, entries: entries.concat(entry) };
          } else {
            cache = undefined;
          }
        });
      appendChain = operation.catch(() => undefined);
      return operation;
    },
    async list(sessionId) {
      return (await readEntries()).filter((entry) => entry.sessionId === sessionId);
    },
    async get(id) {
      return (await readEntries()).find((entry) => entry.id === id);
    },
    async searchSessions(query) {
      // ponytail: no index. Cache miss still reads and parses the file (O(corpus)); hit reuses the
      // parsed array. Indexed path is SQLite/Postgres. Corrupt lines stay quarantined like list()/get().
      const entries = await readEntries();
      const bySession = new Map<string, SessionEntry[]>();
      const leafBySession = new Map<string, string>();
      for (const entry of entries) {
        const sessionEntries = bySession.get(entry.sessionId);
        if (sessionEntries) sessionEntries.push(entry);
        else bySession.set(entry.sessionId, [entry]);
        leafBySession.set(entry.sessionId, entry.id);
      }
      return searchLinearSessions(bySession, leafBySession, query);
    },
  };
  Object.defineProperty(store, JSONL_FILE_READS, { get: () => fileReads });
  return store;
}

/** Read a JSONL session file and return both valid entries and per-line parse errors. */
export async function readJsonlSessionEntries(path: string): Promise<SessionEntryReadResult> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return { entries: [], errors: [] };
    throw new Error(`Failed to read session store ${path}: ${errorMessage(error)}`);
  }

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
      if (!isMessage(entry.message))
        return { ok: false, error: { line: lineNumber, message: "Invalid message entry: expected Message object", raw } };
      break;
    case "summary":
      if (typeof entry.summary !== "string")
        return { ok: false, error: { line: lineNumber, message: "Invalid summary entry: expected string summary", raw } };
      break;
    case "model_change":
      if (!isModelConfig(entry.model))
        return { ok: false, error: { line: lineNumber, message: "Invalid model_change entry: expected ModelConfig object", raw } };
      break;
    case "custom":
      if (!isPlainObject(entry.data))
        return { ok: false, error: { line: lineNumber, message: "Invalid custom entry: expected object data", raw } };
      break;
    case "compaction":
      if (typeof entry.summary !== "string")
        return { ok: false, error: { line: lineNumber, message: "Invalid compaction entry: expected string summary", raw } };
      if (!isPlainObject(entry.data))
        return { ok: false, error: { line: lineNumber, message: "Invalid compaction entry: expected object data", raw } };
      break;
    case "label":
      if (typeof entry.label !== "string")
        return { ok: false, error: { line: lineNumber, message: "Invalid label entry: expected string label", raw } };
      break;
    case "event":
      if (!isAgentEvent(entry.event))
        return { ok: false, error: { line: lineNumber, message: "Invalid event entry: expected AgentEvent object", raw } };
      break;
    case "metadata":
      if (!isPlainObject(entry.data))
        return { ok: false, error: { line: lineNumber, message: "Invalid metadata entry: expected object data", raw } };
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
