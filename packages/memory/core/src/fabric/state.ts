import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { MemoryInvalidationRecord, MemoryShareGrant, SourceAccessGrant } from "../types.js";

/** Control state and derived file index sidecars for the markdown store. */

export interface ThreadState {
  invalidations: Record<string, MemoryInvalidationRecord>;
  grants: Record<string, SourceAccessGrant>;
  shares: Record<string, MemoryShareGrant>;
  generation?: number | { readonly $bigint: string };
}

export interface ResourceState {
  readonly version: 1;
  readonly tenantId: string;
  readonly resourceId: string;
  threads: Record<string, ThreadState>;
  /** Per-resource counters (the scope clock); canonical here because files cannot derive them. */
  counters?: Record<string, number>;
}

export interface IndexedFile {
  readonly path: string;
  readonly id: string;
  readonly scope: { readonly tenantId: string; readonly resourceId: string; readonly threadId: string };
  readonly mtimeMs: number;
  readonly size: number;
  readonly hash: string;
  readonly kind?: string;
  readonly title: string;
  readonly description: string;
  readonly dir: string;
  /** Trust-scan flags from the last indexed version; lets the store log a `flagged` transition. */
  readonly flags?: readonly string[];
  /** Why this version cannot read the note (for example `version>1`); the file is kept as written. */
  readonly unreadable?: string;
}

/** Temp file + `rename`, so a crash never leaves a half-written state or map. */
export async function atomicWriteFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function readResourceState(path: string): Promise<ResourceState | undefined> {
  return readJson<ResourceState>(path);
}

export function writeResourceState(path: string, state: ResourceState): Promise<void> {
  return atomicWriteFile(path, `${JSON.stringify(state, null, 2)}\n`);
}

const JOURNAL_VERSION = 1;
/** Journal ops kept before they are folded into the snapshot: `max(this, map size)`, so a write is O(1) amortized. */
const JOURNAL_COMPACT_FLOOR = 1024;

type JournalOp =
  | { readonly v: 1; readonly op: "set"; readonly path: string; readonly entry: IndexedFile }
  | { readonly v: 1; readonly op: "del"; readonly path: string };

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validEntry(value: unknown, path: string): value is IndexedFile {
  return isRecordValue(value) && value.path === path && typeof value.id === "string" && isRecordValue(value.scope);
}

/** Parses the journal; `undefined` for a torn line, a bad op, or a newer format version. */
function parseJournal(content: string): JournalOp[] | undefined {
  if (content.length === 0) return [];
  if (!content.endsWith("\n")) return undefined;
  const ops: JournalOp[] = [];
  for (const line of content.slice(0, -1).split("\n")) {
    let op: unknown;
    try {
      op = JSON.parse(line);
    } catch {
      return undefined;
    }
    if (!isRecordValue(op) || op.v !== JOURNAL_VERSION || typeof op.path !== "string") return undefined;
    if (op.op === "set" && validEntry(op.entry, op.path)) ops.push(op as JournalOp);
    else if (op.op === "del") ops.push(op as JournalOp);
    else return undefined;
  }
  return ops;
}

/**
 * The derived path → entry map: a snapshot (`.index-files.json`) plus an append-only journal of changed
 * entries beside it. Mutations mark paths dirty; {@link FileIndex.flush} appends one op per dirty path, and
 * folds the journal into the snapshot once it outgrows the map. Ops are whole entries, so replaying a
 * journal the snapshot already holds is harmless. Keeps an id → paths index in step with every mutation.
 */
export class FileIndex {
  readonly #snapshotPath: string;
  readonly #journalPath: string;
  readonly #entries = new Map<string, IndexedFile>();
  readonly #byId = new Map<string, Set<string>>();
  readonly #dirty = new Set<string>();
  #journalOps = 0;

  private constructor(snapshotPath: string, journalPath: string) {
    this.#snapshotPath = snapshotPath;
    this.#journalPath = journalPath;
  }

  /**
   * Loads the snapshot and replays the journal. `intact` is false when the journal is torn, unparsable or
   * from a newer version: the map is then empty and the caller must run a full reconcile (fail closed).
   */
  static async load(snapshotPath: string, journalPath: string): Promise<{ readonly index: FileIndex; readonly intact: boolean }> {
    const index = new FileIndex(snapshotPath, journalPath);
    const snapshot = await readJson<unknown>(snapshotPath);
    const journal = await readFile(journalPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    const ops = parseJournal(journal);
    if (ops === undefined) return { index, intact: false };
    if (isRecordValue(snapshot)) {
      for (const [path, entry] of Object.entries(snapshot)) if (validEntry(entry, path)) index.#put(path, entry);
    }
    for (const op of ops) {
      if (op.op === "set") index.#put(op.path, op.entry);
      else index.#remove(op.path);
    }
    index.#journalOps = ops.length;
    return { index, intact: true };
  }

  get size(): number {
    return this.#entries.size;
  }

  get(path: string): IndexedFile | undefined {
    return this.#entries.get(path);
  }

  entries(): IterableIterator<[string, IndexedFile]> {
    return this.#entries.entries();
  }

  values(): IterableIterator<IndexedFile> {
    return this.#entries.values();
  }

  /** The entry indexed under `id`; the first path still holding it when an external copy shares the id. */
  findById(id: string): IndexedFile | undefined {
    const paths = this.#byId.get(id);
    if (paths === undefined) return undefined;
    for (const path of paths) return this.#entries.get(path);
    return undefined;
  }

  set(path: string, entry: IndexedFile): void {
    this.#put(path, entry);
    this.#dirty.add(path);
  }

  delete(path: string): void {
    if (!this.#entries.has(path)) return;
    this.#remove(path);
    this.#dirty.add(path);
  }

  /** Drops every entry; the next flush rewrites the snapshot. */
  clear(): void {
    for (const path of this.#entries.keys()) this.#dirty.add(path);
    this.#entries.clear();
    this.#byId.clear();
    this.#journalOps = Number.POSITIVE_INFINITY;
  }

  /** Persists dirty entries: a journal append, or a snapshot rewrite when `compact` or the journal outgrew the map. */
  async flush(options: { readonly compact?: boolean } = {}): Promise<void> {
    if (options.compact !== true && this.#dirty.size === 0) return;
    const ops = this.#journalOps + this.#dirty.size;
    if (options.compact === true || ops > Math.max(JOURNAL_COMPACT_FLOOR, this.#entries.size)) {
      await atomicWriteFile(this.#snapshotPath, `${JSON.stringify(Object.fromEntries(this.#entries), null, 2)}\n`);
      await rm(this.#journalPath, { force: true });
      this.#journalOps = 0;
      this.#dirty.clear();
      return;
    }
    let text = "";
    for (const path of this.#dirty) {
      const entry = this.#entries.get(path);
      const op: JournalOp = entry === undefined ? { v: JOURNAL_VERSION, op: "del", path } : { v: JOURNAL_VERSION, op: "set", path, entry };
      text += `${JSON.stringify(op)}\n`;
    }
    await mkdir(dirname(this.#journalPath), { recursive: true, mode: 0o700 });
    await appendFile(this.#journalPath, text, { encoding: "utf8", mode: 0o600 });
    this.#journalOps = ops;
    this.#dirty.clear();
  }

  #put(path: string, entry: IndexedFile): void {
    const previous = this.#entries.get(path);
    if (previous !== undefined && previous.id !== entry.id) this.#unlinkId(previous.id, path);
    this.#entries.set(path, entry);
    let paths = this.#byId.get(entry.id);
    if (paths === undefined) {
      paths = new Set();
      this.#byId.set(entry.id, paths);
    }
    paths.add(path);
  }

  #remove(path: string): void {
    const previous = this.#entries.get(path);
    if (previous === undefined) return;
    this.#entries.delete(path);
    this.#unlinkId(previous.id, path);
  }

  #unlinkId(id: string, path: string): void {
    const paths = this.#byId.get(id);
    if (paths === undefined) return;
    paths.delete(path);
    if (paths.size === 0) this.#byId.delete(id);
  }
}

export function serializeGeneration(value: bigint | number): number | { readonly $bigint: string } {
  return typeof value === "bigint" ? { $bigint: value.toString() } : value;
}

export function deserializeGeneration(value: ThreadState["generation"]): bigint | number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  return /^\d+$/.test(value.$bigint) ? BigInt(value.$bigint) : undefined;
}
