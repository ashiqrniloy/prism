/**
 * Verbatim chunks (plan 217 Task 2, design I2–I3): the exact source text a memory record cites, kept outside the
 * session branch in a deletable, reference-counted store shared by every tier (STM records, WM items, LTM notes).
 *
 * This module owns the whole mechanism: the verbatim check, redaction and caps a chunk passes before it is written,
 * the {@link ChunkStore} contract, and the default SQLite store. The branch carries only `chunkRefs`
 * (`MemoryChunkRef`); the text never enters the ledger, the context block or a shared store.
 *
 * Deletion is by referrer only: `unref` removes one referrer, and at zero referrers the chunk is hard-deleted in the
 * same transaction with `secure_delete` on, so its bytes leave the file's free pages. No caller deletes a chunk
 * directly.
 */
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { redactSecrets, type SessionEntry } from "@arnilo/prism";
import { truncateWorkerText } from "@arnilo/prism-memory-core";
import { normalizeEventText } from "./session/normalize.js";
import { serializeSessionEntry } from "./session/serialize.js";
import type { MemoryChunkRef } from "./session/types.js";

/** Chunks one STM event may carry (`stm.maxChunksPerEvent`, tuning). */
export const DEFAULT_MAX_CHUNKS_PER_EVENT = 2;
export const HARD_MAX_CHUNKS_PER_EVENT = 8;
/** Bytes one stored chunk may take, truncation marker included (`stm.maxChunkBytes`, tuning). */
export const DEFAULT_MAX_CHUNK_BYTES = 4_096;
export const HARD_MAX_CHUNK_BYTES = 65_536;
/**
 * Share of a batch's serialized transcript bytes its accepted chunks may take. A fixed rule, not a setting: it is what
 * keeps stored chunk bytes under 25% of the transcript they cover, whatever the per-chunk caps are.
 */
export const MAX_CHUNK_SHARE = 0.25;

/** The service a package provides to replace the default store (`ChunkStore`). Resolved at first use. */
export const MEMORY_CHUNK_STORE_SERVICE = "memory.chunks";

/** Who holds a chunk: one record of one tier, in one session. A fork adds its own referrers. */
export interface ChunkReferrer {
  readonly kind: "stm" | "wm" | "ltm";
  readonly id: string;
  readonly sessionId: string;
}

/** A chunk that passed {@link prepareChunks}: redacted, capped, hashed. `text` is what the store keeps. */
export interface PreparedChunk extends MemoryChunkRef {
  readonly text: string;
}

/** A stored chunk as `get` returns it. */
export interface StoredChunk {
  readonly id: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly text: string;
}

export type ChunkOp =
  | { readonly op: "put"; readonly chunk: PreparedChunk; readonly by: ChunkReferrer }
  | { readonly op: "ref"; readonly id: string; readonly by: ChunkReferrer }
  | { readonly op: "unref"; readonly id: string; readonly by: ChunkReferrer };

/**
 * The chunk store. `apply` runs its ops in order in one transaction (one per memory pass); `put`, `ref` and `unref`
 * are single-op forms. `ref` on a chunk that no longer exists does nothing and answers `false`: a referrer never
 * resurrects a deleted chunk. `get` answers only when `sessionId` holds a referrer, so an id from another session
 * reads as absent.
 */
export interface ChunkStore {
  put(chunk: PreparedChunk, by: ChunkReferrer): Promise<void>;
  ref(id: string, by: ChunkReferrer): Promise<boolean>;
  unref(id: string, by: ChunkReferrer): Promise<{ readonly deleted: boolean }>;
  apply(ops: readonly ChunkOp[]): Promise<{ readonly deleted: readonly string[] }>;
  get(id: string, sessionId: string): Promise<StoredChunk | undefined>;
  list(sessionId: string): Promise<readonly Omit<StoredChunk, "text">[]>;
  close?(): void | Promise<void>;
}

export type ChunkPrepareFailure = "invalid_chunks" | "too_many_chunks" | "chunk_unknown_entry" | "empty_chunk" | "chunk_not_verbatim";

export interface PrepareChunksOptions {
  /** The batch's entries: a chunk must cite one of them. */
  readonly entries: readonly SessionEntry[];
  readonly secrets?: readonly (string | undefined)[];
  readonly maxChunks: number;
  readonly maxChunkBytes: number;
}

/**
 * Validates a `record_event` `chunks` argument. Each `{ sourceEntryId, text }` must cite an entry of the batch, and
 * its text, redacted and whitespace-normalised, must be a substring of that entry as the worker saw it (the
 * serialized line) or of the entry's own text (its string fields joined, unescaped). An accepted chunk is redacted
 * with the session's secrets, then capped at `maxChunkBytes`; the truncation marker names sizes only.
 */
export function prepareChunks(
  value: unknown,
  options: PrepareChunksOptions,
): { readonly ok: true; readonly chunks: readonly PreparedChunk[] } | { readonly ok: false; readonly reason: ChunkPrepareFailure } {
  if (value === undefined) return { ok: true, chunks: [] };
  if (!Array.isArray(value)) return { ok: false, reason: "invalid_chunks" };
  if (value.length > options.maxChunks) return { ok: false, reason: "too_many_chunks" };
  const secrets = options.secrets ?? [];
  const chunks: PreparedChunk[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || typeof item.sourceEntryId !== "string" || typeof item.text !== "string")
      return { ok: false, reason: "invalid_chunks" };
    const entry = options.entries.find((candidate) => candidate.id === item.sourceEntryId);
    if (!entry) return { ok: false, reason: "chunk_unknown_entry" };
    const text = redactSecrets(item.text.trim(), secrets);
    const needle = normalizeEventText(text);
    if (!needle) return { ok: false, reason: "empty_chunk" };
    if (!verbatimSources(entry, secrets).some((haystack) => haystack.includes(needle))) return { ok: false, reason: "chunk_not_verbatim" };
    chunks.push(prepared(entry.id, capChunk(text, options.maxChunkBytes)));
  }
  return { ok: true, chunks };
}

function verbatimSources(entry: SessionEntry, secrets: readonly (string | undefined)[]): readonly string[] {
  const value = entry.message ?? entry.summary ?? entry.data ?? entry.event ?? entry.metadata ?? {};
  const leaves: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") leaves.push(node);
    else if (Array.isArray(node)) for (const child of node) walk(child);
    else if (typeof node === "object" && node !== null) for (const child of Object.values(node)) walk(child);
  };
  walk(value);
  return [serializeSessionEntry(entry, secrets), redactSecrets(leaves.join("\n"), secrets)].map(normalizeEventText);
}

/** Cuts `text` to `maxBytes` with a marker that names the sizes, never the cut bytes. */
export function capChunk(text: string, maxBytes: number): string {
  const size = Buffer.byteLength(text, "utf8");
  if (size <= maxBytes) return text;
  const marker = `\n[chunk truncated: ${size} bytes, kept the first part]`;
  return `${truncateWorkerText(text, Math.max(0, maxBytes - Buffer.byteLength(marker, "utf8")))}${marker}`;
}

function prepared(sourceEntryId: string, text: string): PreparedChunk {
  const sha256 = createHash("sha256").update(text, "utf8").digest("hex");
  return { id: sha256.slice(0, 24), sourceEntryId, sha256, bytes: Buffer.byteLength(text, "utf8"), text };
}

/** `application_id` of a chunk store file ("PCK1"); another SQLite file at the path fails closed. */
const CHUNK_STORE_APPLICATION_ID = 0x50434b31;

const DDL = `
CREATE TABLE chunks (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, text TEXT NOT NULL) STRICT;
CREATE TABLE chunk_referrers (
  chunk_id TEXT NOT NULL REFERENCES chunks(id), kind TEXT NOT NULL, referrer_id TEXT NOT NULL, session_id TEXT NOT NULL,
  PRIMARY KEY (chunk_id, kind, referrer_id, session_id)) STRICT;
CREATE INDEX chunk_referrers_session ON chunk_referrers(session_id, chunk_id);
PRAGMA application_id = ${CHUNK_STORE_APPLICATION_ID};
PRAGMA user_version = 1;`;

/** The default {@link ChunkStore}: one SQLite file (mode 0600), or `:memory:` for the process lifetime. */
export class SqliteChunkStore implements ChunkStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async put(chunk: PreparedChunk, by: ChunkReferrer): Promise<void> {
    await this.apply([{ op: "put", chunk, by }]);
  }

  async ref(id: string, by: ChunkReferrer): Promise<boolean> {
    return this.#run(() => this.#ref(id, by));
  }

  async unref(id: string, by: ChunkReferrer): Promise<{ readonly deleted: boolean }> {
    const { deleted } = await this.apply([{ op: "unref", id, by }]);
    return { deleted: deleted.length > 0 };
  }

  async apply(ops: readonly ChunkOp[]): Promise<{ readonly deleted: readonly string[] }> {
    if (!ops.length) return { deleted: [] };
    return this.#run(() => {
      const deleted: string[] = [];
      for (const op of ops) {
        if (op.op === "put") {
          this.#db
            .query("INSERT OR IGNORE INTO chunks (id, sha256, bytes, text) VALUES (?, ?, ?, ?)")
            .run(op.chunk.id, op.chunk.sha256, op.chunk.bytes, op.chunk.text);
          this.#ref(op.chunk.id, op.by);
        } else if (op.op === "ref") {
          this.#ref(op.id, op.by);
        } else {
          this.#db
            .query("DELETE FROM chunk_referrers WHERE chunk_id = ? AND kind = ? AND referrer_id = ? AND session_id = ?")
            .run(op.id, op.by.kind, op.by.id, op.by.sessionId);
          const left = this.#db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM chunk_referrers WHERE chunk_id = ?").get(op.id);
          if (left?.n === 0 && this.#exists(op.id)) {
            this.delete(op.id);
            deleted.push(op.id);
          }
        }
      }
      return { deleted };
    });
  }

  async get(id: string, sessionId: string): Promise<StoredChunk | undefined> {
    return (
      this.#db
        .query<StoredChunk, [string, string]>(
          "SELECT id, sha256, bytes, text FROM chunks c WHERE c.id = ? AND EXISTS (SELECT 1 FROM chunk_referrers r WHERE r.chunk_id = c.id AND r.session_id = ?)",
        )
        .get(id, sessionId) ?? undefined
    );
  }

  async list(sessionId: string): Promise<readonly Omit<StoredChunk, "text">[]> {
    return this.#db
      .query<Omit<StoredChunk, "text">, [string]>(
        "SELECT id, sha256, bytes FROM chunks c WHERE EXISTS (SELECT 1 FROM chunk_referrers r WHERE r.chunk_id = c.id AND r.session_id = ?) ORDER BY id",
      )
      .all(sessionId);
  }

  /**
   * Hard-deletes a chunk row. Internal to the zero-referrer path of `apply`: nothing else calls it, and a test
   * spies on it to prove that. With `secure_delete` on, the freed pages are zeroed.
   */
  delete(id: string): void {
    this.#db.query("DELETE FROM chunks WHERE id = ?").run(id);
  }

  close(): void {
    this.#db.close();
  }

  #ref(id: string, by: ChunkReferrer): boolean {
    if (!this.#exists(id)) return false;
    this.#db
      .query("INSERT OR IGNORE INTO chunk_referrers (chunk_id, kind, referrer_id, session_id) VALUES (?, ?, ?, ?)")
      .run(id, by.kind, by.id, by.sessionId);
    return true;
  }

  #exists(id: string): boolean {
    return this.#db.query("SELECT 1 FROM chunks WHERE id = ?").get(id) !== null;
  }

  #run<T>(fn: () => T): T {
    return this.#db.transaction(fn)();
  }
}

/** Opens (or creates) the default chunk store. A path that holds another SQLite schema fails closed. */
export async function createSqliteChunkStore(options: { readonly path: string }): Promise<SqliteChunkStore> {
  const { openSqliteDatabase } = await import("@arnilo/prism-memory-core/sqlite");
  const path = options.path === ":memory:" ? options.path : resolve(options.path);
  const db = await openSqliteDatabase(path);
  try {
    db.exec("PRAGMA secure_delete = ON");
    db.exec("PRAGMA foreign_keys = ON");
    db.transaction(() => {
      const app = db.query<{ application_id: number }, []>("PRAGMA application_id").get()?.application_id;
      const tables = db.query("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
      if (app === 0 && tables.length === 0) db.exec(DDL);
      else if (app !== CHUNK_STORE_APPLICATION_ID) throw new Error("memory-system: the chunk store path holds another SQLite schema");
    })();
    return new SqliteChunkStore(db);
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Where the default store lives: `"memory"` (process lifetime) or a SQLite file the host names. */
export type ChunkStoreLocation = "memory" | { readonly sqlite: { readonly path: string } };

/**
 * One package instance's chunk store, opened at first use: a `memory.chunks` service when a package provides one,
 * else the default SQLite store at `location`. Every operation is queued in call order, so a fork's referrers
 * (added when the fork opens) land before any later drop in the parent.
 */
export interface ChunkStoreHandle {
  run<T>(fn: (store: ChunkStore) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createChunkStoreHandle(location: ChunkStoreLocation, consumeService: () => ChunkStore | undefined): ChunkStoreHandle {
  let opened: Promise<{ store: ChunkStore; owned: boolean }> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const open = () =>
    (opened ??= (async () => {
      const service = consumeService();
      if (service) return { store: service, owned: false };
      const path = location === "memory" ? ":memory:" : location.sqlite.path;
      return { store: await createSqliteChunkStore({ path }), owned: true };
    })());
  return {
    run(fn) {
      const next = queue.then(async () => fn((await open()).store));
      queue = next.catch(() => undefined);
      return next;
    },
    async close() {
      await queue;
      if (!opened) return;
      const { store, owned } = await opened.catch(() => ({ store: undefined, owned: false }));
      if (owned) await store?.close?.();
    },
  };
}
