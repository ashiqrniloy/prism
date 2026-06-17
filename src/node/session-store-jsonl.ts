import { mkdir, readFile, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SessionEntry, SessionStore } from "../contracts.js";

export interface JsonlSessionStoreOptions {
  readonly path: string;
  readonly createDirectory?: boolean;
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

async function findEntry(path: string, id: string): Promise<SessionEntry | undefined> {
  return (await readEntries(path)).find((entry) => entry.id === id);
}

async function readEntries(path: string): Promise<SessionEntry[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw new Error(`Failed to read session store ${path}: ${errorMessage(error)}`);
  }

  return text.split(/\r?\n/).filter(Boolean).map((line, index) => parseEntry(line, index + 1));
}

function parseEntry(line: string, lineNumber: number): SessionEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new Error(`Invalid JSONL session entry at line ${lineNumber}: ${errorMessage(error)}`);
  }
  if (!isSessionEntry(parsed)) throw new Error(`Invalid JSONL session entry at line ${lineNumber}: expected session entry object`);
  return parsed;
}

function isSessionEntry(value: unknown): value is SessionEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "string"
    && typeof entry.sessionId === "string"
    && typeof entry.timestamp === "string"
    && typeof entry.kind === "string";
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
