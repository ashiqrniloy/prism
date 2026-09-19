/**
 * Plan 089 Task 3: grant-change re-pointing.
 *
 * When a source's grant identity moves (`doc:a` → `doc:b`, or a document is
 * re-filed under a new source id / corpus), the derived artifacts that point at
 * it must follow without paying for a re-embed: the content is byte-identical, so
 * every chunk row keeps its text and embedding and only its key, `_rag.sourceId`,
 * and citation id change in a single store transaction. Lineage edges
 * (`_lineage.sourceIds`) on records derived from the moved source are rewritten in
 * the same pass, which is what keeps `createDeletionPropagator` correct afterwards:
 * deleting the new source still tombstones the derived rows, deleting the old one
 * no longer touches them.
 *
 * Re-pointing is privileged like propagation: on a store that declares
 * `authorization: "acl"` the caller must present an `authorization` and both the
 * source and the destination must already be granted to it. Re-point never creates
 * or copies grants, so an ungranted destination fails closed before any write.
 */
import type { JsonObject } from "@arnilo/prism";
import { assertAccessConstraint } from "./acl.js";
import { MemoryLimitError, MemoryValidationError, MemoryScopeError } from "./errors.js";
import { parseLineage } from "./lineage.js";
import type { MemoryScope, MemoryVectorRecord, RagAccessConstraint, VectorStore } from "./types.js";
import { assertNotAborted, requireNonEmptyString, requireScope } from "./util.js";

/** One re-point pass. Over the cap the whole move rejects, so nothing is half-moved. */
export const HARD_REPOINT_RECORDS = 4_096;

const ID_MAX = 256;

/** Store contract: reads the whole scope, writes through an optional transaction wrapper. */
export interface RepointStore extends VectorStore {
  getByThread?(scope: Required<MemoryScope>, options?: { readonly signal?: AbortSignal }): Promise<readonly MemoryVectorRecord[]>;
  transaction?<T>(operation: (store: VectorStore) => Promise<T>, options?: { readonly signal?: AbortSignal }): Promise<T>;
}

export interface RepointContext {
  readonly from: string;
  readonly to: string;
  readonly scope: Required<MemoryScope>;
  /** Ids whose lineage edge moved (derived rows), plus the re-keyed source rows. */
  readonly ids: readonly string[];
  readonly movedChunks: number;
  readonly signal?: AbortSignal;
}

/** Derived layer hook (wiki projections, summaries, fabric notes) run after the store write. */
export interface RepointHandler {
  readonly kind: string;
  repoint(context: RepointContext): number | Promise<number>;
}

export interface RepointSourceOptions {
  readonly scope: MemoryScope;
  readonly vectorStore: RepointStore;
  readonly from: string;
  readonly to: string;
  /** Required on ACL stores; must admit both `from` and `to`. */
  readonly authorization?: RagAccessConstraint;
  readonly handlers?: readonly RepointHandler[];
  readonly signal?: AbortSignal;
  /** Overrides `HARD_REPOINT_RECORDS`; still fail-closed over the cap. */
  readonly maxRecords?: number;
}

export interface RepointSourceResult {
  readonly from: string;
  readonly to: string;
  /** Chunk rows re-keyed to `to` with their embeddings reused verbatim. */
  readonly movedChunks: number;
  /** Derived records whose `_lineage.sourceIds` edge moved from `from` to `to`. */
  readonly rewrittenEdges: number;
  /** Per-handler-kind artifact counts. */
  readonly layers: Readonly<Record<string, number>>;
  /** True when the store write committed inside one transaction. */
  readonly batched: boolean;
}

function requireId(value: unknown, label: string): string {
  const id = requireNonEmptyString(value, label);
  if (id.length > ID_MAX) throw new MemoryValidationError(`${label} exceeds ${ID_MAX} characters`);
  if (id.includes("\0")) throw new MemoryValidationError(`${label} must not contain NUL`);
  return id;
}

/** Source-owned rows carry `_rag.sourceId`; derived rows carry the lineage edge. */
function chunkSourceId(record: MemoryVectorRecord): string | undefined {
  const rag = record.metadata?._rag;
  if (rag === null || typeof rag !== "object" || Array.isArray(rag)) return undefined;
  const sourceId = (rag as { sourceId?: unknown }).sourceId;
  return typeof sourceId === "string" ? sourceId : undefined;
}

/**
 * Chunk ids are `${sourceId}#NNNN` (`chunkText`); the citation id must stay equal to the
 * row id. Ids a host supplied under another scheme are kept and only re-sourced.
 */
function rekeyId(id: string, from: string, to: string): string {
  return id.startsWith(`${from}#`) ? `${to}${id.slice(from.length)}` : id;
}

/** Move one lineage edge, preserving order and never duplicating the destination. */
function rewriteLineage(metadata: JsonObject | undefined, from: string, to: string): JsonObject | undefined {
  const parsed = parseLineage(metadata);
  if (parsed === undefined || parsed === "invalid") return undefined;
  if (!parsed.sourceIds.includes(from)) return undefined;
  const sourceIds: string[] = [];
  for (const id of parsed.sourceIds) {
    const next = id === from ? to : id;
    if (!sourceIds.includes(next)) sourceIds.push(next);
  }
  return { ...(metadata ?? {}), _lineage: { v: parsed.v, sourceIds, ...(parsed.reason ? { reason: parsed.reason } : {}) } };
}

async function assertRepointAccess(options: RepointSourceOptions, scope: Required<MemoryScope>, from: string, to: string): Promise<void> {
  const store = options.vectorStore;
  if (store.authorization !== "acl") return;
  if (typeof store.checkSourceAccess !== "function") {
    throw new MemoryScopeError("re-point requires a store with checkSourceAccess when ACL mode is declared");
  }
  if (!options.authorization) {
    throw new MemoryScopeError("re-point on an ACL store requires authorization for both source ids");
  }
  const auth = assertAccessConstraint(options.authorization);
  if (auth.tenantId !== scope.tenantId) throw new MemoryScopeError("authorization tenantId does not match re-point scope");
  for (const sourceId of [from, to]) {
    assertNotAborted(options.signal);
    const allowed = await store.checkSourceAccess(scope, sourceId, auth, { signal: options.signal });
    if (!allowed) throw new MemoryScopeError(`re-point denied: no live grant for ${sourceId === from ? "from" : "to"} source`);
  }
}

export async function repointSource(options: RepointSourceOptions): Promise<RepointSourceResult> {
  if (options === null || typeof options !== "object") throw new MemoryValidationError("repointSource requires options");
  const scope = requireScope(options.scope, true) as Required<MemoryScope>;
  const from = requireId(options.from, "from");
  const to = requireId(options.to, "to");
  if (from === to) throw new MemoryValidationError("re-point from and to must differ");
  const maxRecords = options.maxRecords ?? HARD_REPOINT_RECORDS;
  if (!Number.isInteger(maxRecords) || maxRecords < 1) throw new MemoryValidationError("maxRecords must be a positive integer");
  const store = options.vectorStore;
  if (!store || typeof store !== "object") throw new MemoryValidationError("repointSource requires a vector store");
  if (typeof store.getByThread !== "function") {
    throw new MemoryScopeError("re-point requires a store that can read a scope (getByThread)");
  }
  const handlers = new Map<string, RepointHandler>();
  for (const handler of options.handlers ?? []) {
    const kind = requireNonEmptyString(handler?.kind, "handler.kind");
    if (typeof handler.repoint !== "function") throw new MemoryValidationError(`re-point handler ${kind} needs a repoint function`);
    if (handlers.has(kind)) throw new MemoryValidationError(`re-point handler ${kind} is already registered`);
    handlers.set(kind, handler);
  }
  await assertRepointAccess(options, scope, from, to);
  assertNotAborted(options.signal);

  const records = await store.getByThread(scope, { signal: options.signal });
  assertNotAborted(options.signal);
  if (records.length > maxRecords) throw new MemoryLimitError(`re-point scope exceeds record cap ${maxRecords}`);

  const updates: MemoryVectorRecord[] = [];
  const retiredIds: string[] = [];
  const movedIds: string[] = [];
  let movedChunks = 0;
  let rewrittenEdges = 0;
  const byId = new Map(records.map((record) => [record.id, record]));

  for (const record of records) {
    if (record.tenantId !== scope.tenantId || record.resourceId !== scope.resourceId || record.threadId !== scope.threadId) {
      throw new MemoryScopeError("re-point read crossed tenant/resource/thread boundary");
    }
    const metadata = record.metadata;
    if (chunkSourceId(record) === from) {
      const id = rekeyId(record.id, from, to);
      const occupant = byId.get(id);
      if (id !== record.id && occupant && chunkSourceId(occupant) !== from) {
        throw new MemoryValidationError(`re-point destination already holds record ${id}`);
      }
      const rag = { ...(metadata?._rag as JsonObject), sourceId: to, citationId: id };
      const lineage = rewriteLineage(metadata, from, to);
      updates.push({
        ...record,
        id,
        metadata: { ...(metadata ?? {}), ...(lineage ?? {}), _rag: rag },
      });
      if (id !== record.id) retiredIds.push(record.id);
      movedIds.push(id);
      movedChunks += 1;
      continue;
    }
    const lineage = rewriteLineage(metadata, from, to);
    if (!lineage) continue;
    updates.push({ ...record, metadata: lineage });
    movedIds.push(record.id);
    rewrittenEdges += 1;
  }

  const write = async (target: VectorStore): Promise<void> => {
    if (updates.length > 0) await target.upsert(updates, { signal: options.signal });
    if (retiredIds.length > 0) {
      await target.delete(
        { tenantId: scope.tenantId, resourceId: scope.resourceId, threadId: scope.threadId, ids: retiredIds },
        { signal: options.signal },
      );
    }
  };
  const batched = typeof store.transaction === "function";
  const transaction = store.transaction?.bind(store);
  if (transaction) await transaction(write, { signal: options.signal });
  else await write(store);

  const layers: Record<string, number> = {};
  for (const handler of handlers.values()) {
    assertNotAborted(options.signal);
    const count = await handler.repoint({
      from,
      to,
      scope,
      ids: Object.freeze(movedIds),
      movedChunks,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!Number.isInteger(count) || count < 0) {
      throw new MemoryValidationError(`re-point handler ${handler.kind} returned an invalid count`);
    }
    layers[handler.kind] = count;
  }

  return Object.freeze({
    from,
    to,
    movedChunks,
    rewrittenEdges,
    layers: Object.freeze(layers),
    batched,
  });
}
