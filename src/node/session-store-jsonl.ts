import { mkdir, readFile, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  SESSION_APPEND_CONFLICT_CODE,
  SessionAppendConflictError,
  SessionSearchUnsupportedError,
  isSessionEntryKind,
  SESSION_ENTRY_SCHEMA_VERSION,
  type Message,
  type ModelConfig,
  type SessionAppendOptions,
  type SessionEntry,
  type SessionStore,
} from "../contracts.js";
import { isNodeErrorCode } from "./config.js";

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

  return {
    append(entry, appendOptions) {
      appendChain = appendChain.then(async () => {
        if (options.createDirectory !== false) await mkdir(dirname(path), { recursive: true });
        const readResult = await readJsonlSessionEntries(path);
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
        if (appendOptions?.expectedParentId !== undefined && !entries.some((existing) => existing.id === appendOptions.expectedParentId)) {
          throw new SessionAppendConflictError({ code: SESSION_APPEND_CONFLICT_CODE, expectedParentId: appendOptions.expectedParentId });
        }
        if (entries.some((existing) => existing.id === entry.id)) throw new Error(`Duplicate session entry id: ${entry.id}`);
        if (dedupKey !== undefined) idempotencySeen.add(dedupKey);
        await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
      });
      return appendChain;
    },
    async list(sessionId) {
      return (await readEntries(path)).filter((entry) => entry.sessionId === sessionId);
    },
    async get(id) {
      return findEntry(path, id);
    },
    async searchSessions() {
      throw new SessionSearchUnsupportedError("JSONL session store does not support searchSessions");
    },
  };
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

async function findEntry(path: string, id: string): Promise<SessionEntry | undefined> {
  return (await readEntries(path)).find((entry) => entry.id === id);
}

async function readEntries(path: string): Promise<SessionEntry[]> {
  return (await readJsonlSessionEntries(path)).entries;
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
    return { ok: false, error: { line: lineNumber, message: "Invalid session entry: expected object with id, sessionId, timestamp, and kind", raw } };
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
      if (!isMessage(entry.message)) return { ok: false, error: { line: lineNumber, message: "Invalid message entry: expected Message object", raw } };
      break;
    case "summary":
      if (typeof entry.summary !== "string") return { ok: false, error: { line: lineNumber, message: "Invalid summary entry: expected string summary", raw } };
      break;
    case "model_change":
      if (!isModelConfig(entry.model)) return { ok: false, error: { line: lineNumber, message: "Invalid model_change entry: expected ModelConfig object", raw } };
      break;
    case "custom":
      if (!isPlainObject(entry.data)) return { ok: false, error: { line: lineNumber, message: "Invalid custom entry: expected object data", raw } };
      break;
    case "compaction":
      if (typeof entry.summary !== "string") return { ok: false, error: { line: lineNumber, message: "Invalid compaction entry: expected string summary", raw } };
      if (!isPlainObject(entry.data)) return { ok: false, error: { line: lineNumber, message: "Invalid compaction entry: expected object data", raw } };
      break;
    case "label":
      if (typeof entry.label !== "string") return { ok: false, error: { line: lineNumber, message: "Invalid label entry: expected string label", raw } };
      break;
    case "event":
      if (!isAgentEvent(entry.event)) return { ok: false, error: { line: lineNumber, message: "Invalid event entry: expected AgentEvent object", raw } };
      break;
    case "metadata":
      if (!isPlainObject(entry.data)) return { ok: false, error: { line: lineNumber, message: "Invalid metadata entry: expected object data", raw } };
      break;
  }
  return { ok: true, entry: entry as unknown as SessionEntry };
}

function isBasicSessionEntry(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "string"
    && typeof entry.sessionId === "string"
    && typeof entry.timestamp === "string"
    && typeof entry.kind === "string";
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
