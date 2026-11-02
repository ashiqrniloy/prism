import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { JsonObject } from "@arnilo/prism";
import {
  type Embedder,
  embedBatched,
  type Memory,
  type MemoryInvalidationRecord,
  type MemoryScope,
  MemoryScopeError,
  MemoryValidationError,
  type MemoryVectorRecord,
  type VectorStore,
  type WorkingMemoryStore,
} from "@arnilo/prism-memory-core";
import { noteMemoryRetraction } from "./directory.js";
import { emitMemoryRetract } from "./ontology/retract.js";
import { scanScopedMemoryContent } from "./scoped/trust.js";
import {
  encodeMemoryNoteMetadata,
  MEMORY_NOTE_METADATA_KEY,
  parseMemoryNoteMetadata,
  stampProvenance,
  unreadableNoteReason,
} from "./types.js";

/**
 * OKF export and import for any store (plan 188.1 Task 7). The bundle is the Task 4 markdown layout, written by the
 * same store, so there is one format: notes, working memory, `.state.json`, `index.md`, and `log.md`. Embeddings are
 * never written; an import re-embeds only when the target has an embedder.
 */

/** The stores behind a memory; `Memory` itself does not expose them, and holds and tombstones live there. */
export interface MemoryOkfStores {
  readonly vectorStore: VectorStore;
  readonly workingStore?: WorkingMemoryStore;
}

export interface ExportMemoryOkfOptions {
  /** Bundle directory. The caller jails it (the `memory:export` command resolves it inside `tools.root`). */
  readonly dir: string;
  readonly stores: MemoryOkfStores;
  readonly signal?: AbortSignal;
}

export interface ExportMemoryOkfResult {
  readonly notes: number;
  readonly invalidations: number;
  readonly working: boolean;
}

export interface ImportMemoryOkfOptions {
  readonly dir: string;
  readonly stores: MemoryOkfStores;
  /** `merge` adds and overwrites by id; `replace` also removes the target's other notes. Holds always survive. */
  readonly mode: "merge" | "replace";
  /** Set when the target memory is hybrid; imported notes are embedded in batches of `limits.embedBatchSize`. */
  readonly embedder?: Embedder;
  readonly signal?: AbortSignal;
}

export interface ImportMemoryOkfResult {
  readonly imported: number;
  /** Notes whose text tripped the trust scan; imported as candidates. */
  readonly flagged: number;
  readonly removed: number;
  /** Notes skipped because the target holds them under legal hold. */
  readonly held: number;
  readonly invalidations: number;
}

const DERIVED_FILES = [".index.sqlite", ".index.sqlite-wal", ".index.sqlite-shm", ".index-files.json", ".lock"] as const;
const INVALIDATION_BATCH = 64;

function fullScope(memory: Memory): Required<MemoryScope> {
  const { tenantId, resourceId, threadId } = memory.scope;
  if (!tenantId || !resourceId || !threadId)
    throw new MemoryScopeError("OKF export and import need a memory with tenant, resource, and thread");
  return { tenantId, resourceId, threadId };
}

function assertAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new MemoryValidationError("OKF bundle operation aborted");
}

function requireListing(store: VectorStore): NonNullable<VectorStore["listByThread"]> {
  if (!store.listByThread) throw new MemoryScopeError("OKF export and import need a listByThread-capable vector store");
  return store.listByThread.bind(store);
}

async function* pages(
  store: VectorStore,
  scope: Required<MemoryScope>,
  batch: number,
  signal?: AbortSignal,
): AsyncGenerator<readonly MemoryVectorRecord[]> {
  const list = requireListing(store);
  let cursor: string | undefined;
  do {
    assertAborted(signal);
    const page = await list({ ...scope, limit: batch, ...(cursor === undefined ? {} : { cursor }), signal });
    if (page.records.length > 0) yield page.records;
    cursor = page.nextCursor;
  } while (cursor !== undefined);
}

function withoutEmbedding(record: MemoryVectorRecord): MemoryVectorRecord {
  const { embedderId: _drop, ...rest } = record;
  return { ...rest, embedding: [] };
}

/** Writes the memory's thread to `dir` in the markdown layout. Embeddings are dropped. */
export async function exportMemoryOkf(memory: Memory, options: ExportMemoryOkfOptions): Promise<ExportMemoryOkfResult> {
  const scope = fullScope(memory);
  const { vectorStore, workingStore } = options.stores;
  const { createMarkdownMemoryStores } = await import("@arnilo/prism-memory-core/fabric");
  const bundle = await createMarkdownMemoryStores({ root: options.dir, limits: memory.limits });
  let notes = 0;
  let invalidations = 0;
  let working = false;
  try {
    for await (const records of pages(vectorStore, scope, memory.limits.rebuildBatchSize, options.signal)) {
      await bundle.vectorStore.upsert(records.map(withoutEmbedding), { signal: options.signal });
      notes += records.length;
    }
    const tombstones = (await vectorStore.listInvalidated?.(scope, { signal: options.signal })) ?? [];
    for (let offset = 0; offset < tombstones.length; offset += INVALIDATION_BATCH) {
      await bundle.vectorStore.invalidate(scope, tombstones.slice(offset, offset + INVALIDATION_BATCH), { signal: options.signal });
    }
    invalidations = tombstones.length;
    const generation = await vectorStore.getCurrentGeneration?.(scope);
    if (generation !== undefined) await bundle.vectorStore.setCurrentGeneration(scope, generation);
    const record = await workingStore?.get(scope, { signal: options.signal });
    if (record) {
      await bundle.workingStore.set(record, { signal: options.signal });
      working = true;
    }
  } finally {
    await bundle.close();
  }
  // The index and file map are derived; a portable bundle is files only, and an import rebuilds them.
  await Promise.all(DERIVED_FILES.map((name) => rm(join(options.dir, name), { force: true })));
  return { notes, invalidations, working };
}

/** Marks a note imported, and quarantines it as a candidate when its text trips the trust scan. */
function stampImported(record: MemoryVectorRecord, at: string): { readonly record: MemoryVectorRecord; readonly flagged: boolean } {
  const scan = scanScopedMemoryContent(record.text);
  const generated = stampProvenance("import", at);
  if (scan.ok) return { record: { ...record, metadata: { ...(record.metadata ?? {}), generated } }, flagged: false };
  const note = parseMemoryNoteMetadata(record.metadata);
  const metadata: JsonObject = {
    ...(record.metadata ?? {}),
    generated,
    status: "candidate",
    ...(note
      ? { [MEMORY_NOTE_METADATA_KEY]: encodeMemoryNoteMetadata({ ...note, flags: [...new Set([...(note.flags ?? []), scan.class])] }) }
      : {}),
  };
  return { record: { ...record, metadata }, flagged: true };
}

/** Reads the bundle at `dir` into the memory's stores. Imported notes are `generated.by: import` and scanned. */
export async function importMemoryOkf(memory: Memory, options: ImportMemoryOkfOptions): Promise<ImportMemoryOkfResult> {
  if (options.mode !== "merge" && options.mode !== "replace") throw new MemoryValidationError('import mode must be "merge" or "replace"');
  const scope = fullScope(memory);
  const { vectorStore, workingStore } = options.stores;
  requireListing(vectorStore);
  const { createMarkdownMemoryStores } = await import("@arnilo/prism-memory-core/fabric");
  const bundle = await createMarkdownMemoryStores({ root: options.dir, limits: memory.limits });
  const at = new Date().toISOString();
  // A target hold survives everything: held ids are never overwritten or removed.
  const held = new Set(
    ((await vectorStore.listInvalidated?.(scope, { signal: options.signal })) ?? [])
      .filter((e) => e.hold === true || e.reason === "legal_hold")
      .map((e) => e.id),
  );
  const keep = new Set<string>();
  let imported = 0;
  let flagged = 0;
  let skippedHeld = 0;
  let removed = 0;
  let invalidations = 0;
  const doomed: string[] = [];
  let tombstoned: readonly MemoryInvalidationRecord[] = [];
  noteMemoryRetraction(memory);
  try {
    for await (const records of pages(bundle.vectorStore, scope, memory.limits.rebuildBatchSize, options.signal)) {
      const batch: MemoryVectorRecord[] = [];
      for (const source of records) {
        keep.add(source.id);
        if (held.has(source.id)) {
          skippedHeld += 1;
          continue;
        }
        // A note a newer version wrote is carried as written: no trust stamp, no re-render.
        if (unreadableNoteReason(source.metadata) !== undefined) {
          batch.push(source);
          continue;
        }
        const stamped = stampImported(source, at);
        if (stamped.flagged) flagged += 1;
        batch.push(stamped.record);
      }
      const embedder = options.embedder;
      const embedded =
        embedder && batch.length > 0
          ? await embedBatched(
              embedder,
              batch.map((r) => r.text),
              memory.limits.embedBatchSize,
              {
                signal: options.signal,
                maxDimensions: memory.limits.maxVectorDimensions,
              },
            )
          : undefined;
      const ready = batch.map((record, index) =>
        embedder && embedded ? { ...record, embedding: embedded[index]!, embedderId: embedder.id } : record,
      );
      if (ready.length > 0) await vectorStore.upsert(ready, { signal: options.signal });
      imported += ready.length;
    }
    if (options.mode === "replace") {
      for await (const records of pages(vectorStore, scope, memory.limits.rebuildBatchSize, options.signal)) {
        // Replace never deletes a note this version cannot read; only `memory.forget` does.
        for (const record of records) {
          if (!keep.has(record.id) && !held.has(record.id) && unreadableNoteReason(record.metadata) === undefined) doomed.push(record.id);
        }
      }
      for (let offset = 0; offset < doomed.length; offset += memory.limits.rebuildBatchSize) {
        removed += await vectorStore.delete(
          { ...scope, ids: doomed.slice(offset, offset + memory.limits.rebuildBatchSize) },
          { signal: options.signal },
        );
      }
    }
    // Tombstones and holds are added, never cleared; an imported hold becomes a target hold.
    const tombstones: readonly MemoryInvalidationRecord[] = await bundle.vectorStore.listInvalidated(scope, { signal: options.signal });
    tombstoned = tombstones;
    if (vectorStore.invalidate) {
      for (let offset = 0; offset < tombstones.length; offset += INVALIDATION_BATCH) {
        await vectorStore.invalidate(scope, tombstones.slice(offset, offset + INVALIDATION_BATCH), { signal: options.signal });
      }
      invalidations = tombstones.length;
    }
    if (workingStore) {
      const incoming = await bundle.workingStore.get(scope, { signal: options.signal });
      if (incoming && (options.mode === "replace" || !(await workingStore.get(scope, { signal: options.signal })))) {
        await workingStore.set(incoming, { signal: options.signal });
      }
    }
  } finally {
    noteMemoryRetraction(memory);
    await bundle.close();
  }
  // The ontology cascade: removed notes and imported tombstones take their citing claims with them, and an import
  // always refreshes the concept index (concept files arrive with it).
  await emitMemoryRetract(memory, { ids: doomed, reason: "import" });
  await emitMemoryRetract(memory, { ids: tombstoned.filter((entry) => entry.hold !== true).map((entry) => entry.id), reason: "forgotten" });
  return { imported, flagged, removed, held: skippedHeld, invalidations };
}
