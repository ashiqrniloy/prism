/**
 * Plan 102 Task 11: fabric notes follow the files they were written from.
 *
 * A `file` note names its document by `metadata.fabric.path`, and that path is the *only* link
 * between the note and the file — notes are store-backed metadata, not derived chunk rows, so the
 * lineage walk (`_lineage`) can never find them. This handler is therefore the only path that keeps
 * notes honest when a source path moves, and the only path that tombstones notes for a deleted one.
 *
 * Both legs act on the same records — `kind: "file"` notes whose `path` is the moved/deleted id —
 * and both reuse the stored row verbatim: id, text, embedding, `sourceEntryIds`, and every other
 * metadata field survive, only `path` changes. Nothing is re-embedded, nothing is re-scored, and no
 * `_lineage` field is invented (the walk stays for records that really are derived).
 */
import { MemoryScopeError, MemoryValidationError } from "../errors.js";
import { HARD_INVALIDATION_BATCH } from "../lineage.js";
import type { DeletionPropagationContext, DeletionPropagationHandler, DeletionPropagationStore } from "../propagation.js";
import type { RepointContext, RepointHandler, RepointStore } from "../repoint.js";
import type { MemoryInvalidationReason, MemoryScope, MemoryVectorRecord, VectorStore } from "../types.js";
import { assertNotAborted, requireScope } from "../util.js";
import {
  encodeMemoryNoteMetadata,
  MEMORY_NOTE_METADATA_KEY,
  type MemoryNoteMetadata,
  noteFields,
  parseMemoryNoteMetadata,
} from "./types.js";

/** Mirrors the propagator's default reason; a host that passes `reason` there should pass it here. */
const DELETION_REASON: MemoryInvalidationReason = "forgotten";

/** The `file` note a record holds, when that note is recorded against `matches`. */
function fileNoteFor(record: MemoryVectorRecord, matches: (path: string) => boolean): MemoryNoteMetadata | undefined {
  const note = parseMemoryNoteMetadata(record.metadata);
  if (note === undefined || note.kind !== "file" || typeof note.path !== "string") return undefined;
  return matches(note.path) ? note : undefined;
}

/** The scope read both legs start from; fail closed rather than reading nothing. */
function requireScopeReader(store: RepointStore): NonNullable<RepointStore["getByThread"]> {
  const getByThread = store.getByThread?.bind(store);
  if (getByThread === undefined) {
    throw new MemoryScopeError("fabric re-point requires a store that can read a scope (getByThread)");
  }
  return getByThread;
}

/**
 * A re-point *and* deletion handler for fabric notes, registered on both seams with `kind: "fabric"`.
 * The host passes its own note `scope` (the fabric's thread scope) and the store the notes live in —
 * the same store, not a copy, or the recall path keeps serving the old path.
 */
export function createFabricRepointHandler(options: {
  readonly scope: MemoryScope;
  readonly vectorStore: RepointStore & DeletionPropagationStore;
  /** Tombstone reason for the retire leg; default `forgotten`. */
  readonly reason?: MemoryInvalidationReason;
}): RepointHandler & DeletionPropagationHandler {
  if (options === null || typeof options !== "object") throw new MemoryValidationError("createFabricRepointHandler requires options");
  const scope = requireScope(options.scope, true) as Required<MemoryScope>;
  const store = options.vectorStore;
  if (!store || typeof store !== "object") throw new MemoryValidationError("createFabricRepointHandler requires a vector store");
  const reason = options.reason ?? DELETION_REASON;
  const readScope = requireScopeReader(store);
  if (typeof store.upsert !== "function") {
    throw new MemoryScopeError("fabric re-point requires a store that can write rows (upsert)");
  }

  /** Fail closed on a mis-wired composition: the handler may only ever touch its own scope. */
  function assertCallerScope(caller: Required<MemoryScope>, seam: string): void {
    if (caller.tenantId !== scope.tenantId || caller.resourceId !== scope.resourceId || caller.threadId !== scope.threadId) {
      throw new MemoryScopeError(`fabric ${seam} handler scope does not match the ${seam} scope`);
    }
  }

  /** One read of the scope: the notes are selected by `metadata.fabric.path`, never by content. */
  async function selectedNotes(
    matches: (path: string) => boolean,
    signal?: AbortSignal,
  ): Promise<readonly { readonly record: MemoryVectorRecord; readonly note: MemoryNoteMetadata }[]> {
    const records = await readScope(scope, { signal });
    assertNotAborted(signal);
    const selected: { record: MemoryVectorRecord; note: MemoryNoteMetadata }[] = [];
    for (const record of records) {
      const note = fileNoteFor(record, matches);
      if (note !== undefined) selected.push({ record, note });
    }
    return selected;
  }

  /** One store transaction when the store has one; the same batched write unwrapped otherwise. */
  async function commit(operation: (target: VectorStore) => Promise<void>, signal?: AbortSignal): Promise<void> {
    const transaction = store.transaction?.bind(store);
    if (transaction) await transaction(operation, { signal });
    else await operation(store);
  }

  return {
    kind: "fabric",

    /** Path moved: rewrite `metadata.fabric.path` in place, keeping id, text, and embedding. */
    async repoint({ from, to, scope: callerScope, signal }: RepointContext) {
      assertCallerScope(callerScope, "re-point");
      assertNotAborted(signal);
      const selected = await selectedNotes((path) => path === from, signal);
      const moved: MemoryVectorRecord[] = selected.map(({ record, note }) => ({
        ...record,
        metadata: {
          ...record.metadata,
          [MEMORY_NOTE_METADATA_KEY]: encodeMemoryNoteMetadata({ ...noteFields(note), kind: note.kind, path: to }),
        },
      }));
      if (moved.length === 0) return 0;
      await commit((target) => target.upsert(moved, { signal }), signal);
      return moved.length;
    },

    /** Path deleted: tombstone the notes recorded against it, through the store's invalidation path. */
    async delete({ ids, scope: callerScope, signal }: DeletionPropagationContext) {
      assertCallerScope(callerScope, "deletion");
      assertNotAborted(signal);
      const invalidate = store.invalidate;
      if (typeof invalidate !== "function") {
        throw new MemoryScopeError("fabric retire requires an invalidation-capable store (invalidate)");
      }
      const paths = new Set(ids);
      const selected = await selectedNotes((path) => paths.has(path), signal);
      if (selected.length === 0) return 0;
      const at = new Date().toISOString();
      const entries = selected.map(({ record }) => ({
        id: record.id,
        reason,
        at,
        ...(reason === "legal_hold" ? { hold: true as const } : {}),
      }));
      const write = async (target: VectorStore): Promise<void> => {
        const writeTarget = target.invalidate;
        if (typeof writeTarget !== "function") {
          throw new MemoryScopeError("fabric retire requires an invalidation-capable store (invalidate)");
        }
        for (let offset = 0; offset < entries.length; offset += HARD_INVALIDATION_BATCH) {
          await writeTarget.call(target, scope, entries.slice(offset, offset + HARD_INVALIDATION_BATCH), { signal });
        }
      };
      await commit(write, signal);
      return entries.length;
    },
  };
}
