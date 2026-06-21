import { mkdir, readFile, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Message, ModelConfig, SessionEntry, SessionStore } from "../contracts.js";

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

  return {
    append(entry) {
      appendChain = appendChain.then(async () => {
        if (options.createDirectory !== false) await mkdir(dirname(path), { recursive: true });
        if (await findEntry(path, entry.id)) throw new Error(`Duplicate session entry id: ${entry.id}`);
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
  };
}

/** Read a JSONL session file and return both valid entries and per-line parse errors. */
export async function readJsonlSessionEntries(path: string): Promise<SessionEntryReadResult> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return { entries: [], errors: [] };
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
  const entry = value as unknown as SessionEntry;
  if (entry.parentId !== undefined && typeof entry.parentId !== "string") {
    return { ok: false, error: { line: lineNumber, message: "Invalid parentId: expected string", raw } };
  }
  switch (entry.kind) {
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
  }
  return { ok: true, entry };
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
