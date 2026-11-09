/**
 * Plan 217 Task 6: the chunk-store meter of gate M-1 ("chunk-store bytes at peak").
 *
 * The STM arm's chunk store is the package default (an in-memory SQLite store); the meter supplies the same store
 * through the `memory.chunks` service and counts the bytes it holds after every operation, so the arm is unchanged
 * and the peak is measured, not estimated. A chunk id is the hash of its stored text, so a second `put` of the same
 * id adds a referrer, not bytes; a deleted id (the zero-referrer path) gives its bytes back.
 *
 * Only the arms built from this tree load it: `@arnilo/prism-memory-system` does not exist in the pinned OM-before
 * tree, which has no chunks.
 */
import { definePackage } from "@arnilo/prism";
import { createSqliteChunkStore, MEMORY_CHUNK_STORE_SERVICE } from "@arnilo/prism-memory-system";

/** A meter shared by every agent of one run: `bytes` now, `peakBytes` since creation, `chunks` held now. */
export function createChunkMeter() {
  return { bytes: 0, peakBytes: 0, chunks: 0, puts: 0, deletes: 0 };
}

/** Wrap a chunk store so every stored and deleted chunk moves the meter. Reads pass through untouched. */
export function meteredChunkStore(store, meter) {
  const held = new Map();
  const add = (chunk) => {
    meter.puts++;
    if (held.has(chunk.id)) return;
    held.set(chunk.id, chunk.bytes);
    meter.bytes += chunk.bytes;
    meter.chunks = held.size;
    meter.peakBytes = Math.max(meter.peakBytes, meter.bytes);
  };
  const remove = (id) => {
    const bytes = held.get(id);
    if (bytes === undefined) return;
    held.delete(id);
    meter.bytes -= bytes;
    meter.chunks = held.size;
    meter.deletes++;
  };
  return {
    async put(chunk, by) {
      await store.put(chunk, by);
      add(chunk);
    },
    ref: (id, by) => store.ref(id, by),
    async unref(id, by) {
      const result = await store.unref(id, by);
      if (result.deleted) remove(id);
      return result;
    },
    async apply(ops) {
      const result = await store.apply(ops);
      for (const op of ops) if (op.op === "put") add(op.chunk);
      for (const id of result.deleted) remove(id);
      return result;
    },
    get: (id, sessionId) => store.get(id, sessionId),
    list: (sessionId) => store.list(sessionId),
    close: () => store.close?.(),
  };
}

/** The package that supplies one metered in-memory store as `memory.chunks` for one agent. */
export async function chunkMeterPackage(meter) {
  const store = meteredChunkStore(await createSqliteChunkStore({ path: ":memory:" }), meter);
  return definePackage({
    name: "memory-bench-chunk-meter",
    version: "0.13.0",
    requires: { api: 1 },
    setup(prism) {
      prism.services.provide(MEMORY_CHUNK_STORE_SERVICE, store);
    },
  })();
}
