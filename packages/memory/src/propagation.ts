/**
 * Plan 089 Task 1: deletion propagation through derived artifacts.
 *
 * One orchestration over the lineage graph: a deleted source id is expanded to
 * every record that lists it in `_lineage.sourceIds` (transitively), the closed
 * set is tombstoned in a single batched store transaction, and every registered
 * derived-artifact handler runs against that same set. Writers register here
 * instead of scattering ad-hoc deletes: RAG chunk rows, wiki pages, summaries,
 * and observational-memory entries all hang off this seam.
 */
import { assertAccessConstraint } from "./acl.js";
import { MemoryScopeError, MemoryValidationError } from "./errors.js";
import { collectInvalidationIds, HARD_INVALIDATION_BATCH } from "./lineage.js";
import type { MemoryInvalidationReason, MemoryScope, RagAccessConstraint, VectorStore } from "./types.js";
import { assertNotAborted, requireNonEmptyString, requireScope } from "./util.js";

/** Tombstone reason stamped for a deleted source; `recordBlocked` treats it as a hard exclusion. */
export const DELETION_REASON: MemoryInvalidationReason = "forgotten";

/**
 * Privileged delete ceiling. One propagation may mark far more than the interactive
 * 256-edge walk; 4096 keeps a single-pass, fail-closed bound (over the cap the whole
 * delete rejects, so nothing is left half-tombstoned).
 */
export const HARD_PROPAGATION_EDGES = 4_096;

/** Store contract: lineage invalidation plus an optional atomic transaction wrapper. */
export interface DeletionPropagationStore extends VectorStore {
  transaction?<T>(operation: (store: VectorStore) => Promise<T>, options?: { readonly signal?: AbortSignal }): Promise<T>;
}

export interface DeletionPropagationContext {
  readonly sourceId: string;
  /** Lineage-closed ids: the deleted source plus every derived record that lists it. */
  readonly ids: readonly string[];
  readonly scope: Required<MemoryScope>;
  /**
   * The reason the propagator resolved for this pass (`options.reason`, default `forgotten`). It
   * rides the one context object every registered handler receives, so a handler tombstones its
   * own artifacts with the walk's reason instead of a second configured copy — the propagator's
   * reason always wins over a handler's own `reason` option, which is only the fallback for a
   * hand-built context that carries none. `legal_hold` handlers stamp `hold: true`.
   */
  readonly reason?: MemoryInvalidationReason;
  readonly signal?: AbortSignal;
}

export interface DeletionPropagationHandler {
  /** Layer name surfaced in `DeletionPropagationResult.layers`, e.g. `rag`, `wiki`, `observational`. */
  readonly kind: string;
  /** Returns how many artifacts this layer removed; 0 is a valid no-op. */
  delete(context: DeletionPropagationContext): number | Promise<number>;
}

export interface DeletionPropagationResult {
  readonly sourceId: string;
  /** Ids tombstoned by the lineage walk (includes `sourceId`). */
  readonly ids: readonly string[];
  readonly tombstoned: number;
  /** Per-handler-kind removal counts. */
  readonly layers: Readonly<Record<string, number>>;
  /** True when the tombstone batch committed inside one store transaction. */
  readonly batched: boolean;
}

export interface DeletionPropagatorOptions {
  readonly scope: MemoryScope;
  readonly vectorStore: DeletionPropagationStore;
  /** Host-verified principal. Deletion is privileged; the retrieval paths never construct one of these. */
  readonly authorization: RagAccessConstraint;
  readonly handlers?: readonly DeletionPropagationHandler[];
  /** Tombstone reason; default `forgotten`. */
  readonly reason?: MemoryInvalidationReason;
}

export interface DeletionPropagator {
  register(handler: DeletionPropagationHandler): void;
  readonly kinds: readonly string[];
  propagate(sourceId: string, options?: { readonly signal?: AbortSignal }): Promise<DeletionPropagationResult>;
}

export function createDeletionPropagator(options: DeletionPropagatorOptions): DeletionPropagator {
  if (options === null || typeof options !== "object") throw new MemoryValidationError("createDeletionPropagator requires options");
  const scope = requireScope(options.scope, true) as Required<MemoryScope>;
  const store = options.vectorStore;
  if (!store || typeof store !== "object") throw new MemoryValidationError("createDeletionPropagator requires a vector store");
  if (store.lineage !== "invalidation" || typeof store.invalidate !== "function") {
    throw new MemoryScopeError("deletion propagation requires an invalidation-capable vector store");
  }
  if (typeof store.getByThread !== "function") {
    throw new MemoryScopeError("deletion propagation requires a getByThread-capable vector store");
  }
  const authorization = assertAccessConstraint(options.authorization);
  if (authorization.tenantId !== scope.tenantId) {
    throw new MemoryScopeError("deletion authorization tenantId does not match the propagation scope");
  }
  const reason = options.reason ?? DELETION_REASON;
  const handlers = new Map<string, DeletionPropagationHandler>();

  function register(handler: DeletionPropagationHandler): void {
    if (handler === null || typeof handler !== "object") throw new MemoryValidationError("deletion handler must be an object");
    const kind = requireNonEmptyString(handler.kind, "handler.kind");
    if (typeof handler.delete !== "function") throw new MemoryValidationError(`deletion handler ${kind} needs a delete function`);
    if (handlers.has(kind)) throw new MemoryValidationError(`deletion handler ${kind} is already registered`);
    handlers.set(kind, handler);
  }
  for (const handler of options.handlers ?? []) register(handler);

  /** Fail closed: ACL-capable stores must grant this principal the source; other stores keep host privilege. */
  async function authorizeSource(sourceId: string, signal?: AbortSignal): Promise<void> {
    if (store.authorization !== "acl") return;
    if (typeof store.checkSourceAccess !== "function") {
      throw new MemoryScopeError("deletion propagation requires an ACL-capable store or a store without ACL enforcement");
    }
    const allowed = await store.checkSourceAccess(scope, sourceId, authorization, { signal });
    if (!allowed) throw new MemoryScopeError(`deletion propagation denied for source ${sourceId}`);
  }

  async function propagate(
    sourceIdInput: string,
    propagateOptions: { readonly signal?: AbortSignal } = {},
  ): Promise<DeletionPropagationResult> {
    const sourceId = requireNonEmptyString(sourceIdInput, "sourceId");
    const signal = propagateOptions.signal;
    assertNotAborted(signal);
    await authorizeSource(sourceId, signal);
    assertNotAborted(signal);
    const getByThread = store.getByThread;
    if (typeof getByThread !== "function" || typeof store.invalidate !== "function") {
      throw new MemoryScopeError("deletion propagation requires a lineage-capable vector store (getByThread/invalidate)");
    }
    const records = await getByThread.call(store, scope);
    assertNotAborted(signal);
    const ids = collectInvalidationIds(records, [sourceId], { maxEdges: HARD_PROPAGATION_EDGES });
    const at = new Date().toISOString();
    const entries = ids.map((id) => ({
      id,
      reason,
      at,
      ...(reason === "legal_hold" ? { hold: true as const } : {}),
    }));
    const write = async (target: VectorStore): Promise<void> => {
      const writeTarget = target.invalidate;
      if (typeof writeTarget !== "function")
        throw new MemoryScopeError("deletion propagation requires a lineage-capable vector store (getByThread/invalidate)");
      for (let offset = 0; offset < entries.length; offset += HARD_INVALIDATION_BATCH) {
        await writeTarget.call(target, scope, entries.slice(offset, offset + HARD_INVALIDATION_BATCH), { signal });
      }
    };
    const transaction = store.transaction?.bind(store);
    const batched = typeof transaction === "function";
    if (transaction) await transaction((target) => write(target), { signal });
    else await write(store);

    const layers: Record<string, number> = {};
    for (const handler of handlers.values()) {
      assertNotAborted(signal);
      const removed = await handler.delete({ sourceId, ids, scope, reason, signal });
      if (!Number.isInteger(removed) || removed < 0) {
        throw new MemoryValidationError(`deletion handler ${handler.kind} returned an invalid count`);
      }
      layers[handler.kind] = removed;
    }
    return Object.freeze({
      sourceId,
      ids,
      tombstoned: ids.length,
      layers: Object.freeze(layers),
      batched,
    });
  }

  return {
    register,
    get kinds() {
      return Object.freeze([...handlers.keys()]);
    },
    propagate,
  };
}
