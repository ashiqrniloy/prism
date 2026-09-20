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
import { MemoryLimitError, MemoryScopeError, MemoryValidationError } from "./errors.js";
import { parseLineage } from "./lineage.js";
import type { MemoryScope, MemoryVectorRecord, RagAccessConstraint, VectorStore } from "./types.js";
import { assertNotAborted, requireNonEmptyString, requireScope } from "./util.js";

/** Default page size: the most records one `repointSource` call considers. Over it the call returns a cursor. */
export const HARD_REPOINT_RECORDS = 4_096;

const ID_MAX = 256;
const CURSOR_VERSION = 1;
const CURSOR_MAX = 4_096;

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
  /**
   * Records considered per page; defaults to and is bounded by `HARD_REPOINT_RECORDS` only as a page
   * size. A scope larger than one page no longer rejects — the call returns a `cursor` for the rest.
   */
  readonly pageSize?: number;
  /** Resume a paged move from the previous page's `cursor`. Another scope or source pair is rejected. */
  readonly cursor?: string;
  /** Opt-in all-or-nothing bound: over this many records in the scope the call rejects instead of paging. */
  readonly maxRecords?: number;
}

export interface RepointSourceResult {
  readonly from: string;
  readonly to: string;
  /** Chunk rows re-keyed to `to` with their embeddings reused verbatim. */
  readonly movedChunks: number;
  /** Derived records whose `_lineage.sourceIds` edge moved from `from` to `to`. */
  readonly rewrittenEdges: number;
  /** Per-handler-kind artifact counts for this page. */
  readonly layers: Readonly<Record<string, number>>;
  /** True when the store write committed inside one transaction (or there was nothing left to write). */
  readonly batched: boolean;
  /** Present while the scope holds records past this page: pass it back as `cursor` to continue. */
  readonly cursor?: string;
}

function requireId(value: unknown, label: string): string {
  const id = requireNonEmptyString(value, label);
  if (id.length > ID_MAX) throw new MemoryValidationError(`${label} exceeds ${ID_MAX} characters`);
  if (id.includes("\0")) throw new MemoryValidationError(`${label} must not contain NUL`);
  return id;
}

/**
 * Resume token for a paged move: the last record id the call considered, bound to the scope and the
 * source pair so a cursor cannot be replayed against a different move. Opaque to hosts (a string they
 * hand back unchanged) and not a secret — a caller who can pass `authorization` can already choose a
 * page size and stop early.
 */
interface RepointCursor {
  readonly v: number;
  readonly from: string;
  readonly to: string;
  readonly tenantId: string;
  readonly resourceId: string;
  readonly threadId: string;
  readonly after: string;
}

function requireCursorToken(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new MemoryValidationError("cursor must be a non-empty string");
  if (value.length > CURSOR_MAX) throw new MemoryValidationError(`cursor exceeds ${CURSOR_MAX} characters`);
  return value;
}

function encodeCursor(cursor: RepointCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** Rejects a malformed, tampered, or foreign cursor before any read of the store. */
function decodeCursor(value: string, scope: Required<MemoryScope>, from: string, to: string): RepointCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new MemoryValidationError("cursor is not a re-point resume token");
  }
  const candidate = (parsed ?? {}) as Partial<RepointCursor>;
  if (
    candidate.v !== CURSOR_VERSION ||
    candidate.from !== from ||
    candidate.to !== to ||
    candidate.tenantId !== scope.tenantId ||
    candidate.resourceId !== scope.resourceId ||
    candidate.threadId !== scope.threadId ||
    typeof candidate.after !== "string" ||
    candidate.after.length === 0
  ) {
    throw new MemoryValidationError("cursor belongs to another scope or source pair");
  }
  return candidate as RepointCursor;
}

/** Ascending record id, independent of the order a store happens to return. */
function compareIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
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

/** The loop's write conditions: a record that still needs re-keying or an edge rewrite. */
function touchesSource(record: MemoryVectorRecord, from: string): boolean {
  if (chunkSourceId(record) === from) return true;
  const lineage = parseLineage(record.metadata);
  return lineage !== undefined && lineage !== "invalid" && lineage.sourceIds.includes(from);
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
  const maxRecords = options.maxRecords;
  if (maxRecords !== undefined && (!Number.isInteger(maxRecords) || maxRecords < 1)) {
    throw new MemoryValidationError("maxRecords must be a positive integer");
  }
  const pageSize = options.pageSize ?? HARD_REPOINT_RECORDS;
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new MemoryValidationError("pageSize must be a positive integer");
  const resumeFrom = options.cursor === undefined ? undefined : decodeCursor(requireCursorToken(options.cursor), scope, from, to);
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
  if (maxRecords !== undefined && records.length > maxRecords) {
    throw new MemoryLimitError(`re-point scope exceeds record cap ${maxRecords}`);
  }

  // One page = a window of ids past the cursor holding only what still needs work. The whole scope is
  // read every page (the store exposes no ranged read), but only the window is written, so the
  // transaction stays bounded and no row is ever re-embedded. Rows an earlier page already moved no
  // longer touch `from`, so they fall out of the window instead of filling it — which is what makes a
  // stale resume a no-op and keeps the page count honest.
  const remaining = [...records]
    .sort((left, right) => compareIds(left.id, right.id))
    .filter((record) => resumeFrom === undefined || compareIds(record.id, resumeFrom.after) > 0)
    .filter((record) => touchesSource(record, from));
  const page = remaining.slice(0, pageSize);
  const last = page.at(-1);
  const nextCursor =
    remaining.length > page.length && last ? encodeCursor({ v: CURSOR_VERSION, from, to, ...scope, after: last.id }) : undefined;

  const updates: MemoryVectorRecord[] = [];
  const retiredIds: string[] = [];
  const movedIds: string[] = [];
  let movedChunks = 0;
  let rewrittenEdges = 0;
  const byId = new Map(records.map((record) => [record.id, record]));

  for (const record of page) {
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
  if (updates.length === 0 && retiredIds.length === 0) {
    // Stale resume: nothing on this page still needs moving, so no transaction is opened at all.
    assertNotAborted(options.signal);
  } else if (transaction) await transaction(write, { signal: options.signal });
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
    ...(nextCursor === undefined ? {} : { cursor: nextCursor }),
  });
}

/** Plan 102 Task 7: one host-owned identity move. Ids are validated as a set, so a batch is order-free. */
export interface SourceRename {
  readonly from: string;
  readonly to: string;
}

/**
 * One rename's audit record, shaped like the retrieval denial sink: ids and outcome only, never rows.
 * A failed rename carries the error instead of counts — `repointSource` may have committed its store write
 * before a handler failed, so counts on a failure would be a guess. Re-running a committed rename is
 * idempotent and reports `movedChunks: 0`.
 */
export type SourceRenameEvent =
  | {
      readonly from: string;
      readonly to: string;
      readonly outcome: "moved";
      readonly movedChunks: number;
      readonly rewrittenEdges: number;
      readonly layers: Readonly<Record<string, number>>;
    }
  | { readonly from: string; readonly to: string; readonly outcome: "failed"; readonly error: string };

export interface ApplySourceRenamesOptions extends Omit<RepointSourceOptions, "from" | "to" | "cursor"> {
  /** Host-owned `{ from, to }` pairs. Every id is claimed once: no duplicates, no chains, no overlap. */
  readonly renames: readonly SourceRename[];
  /** Report a failed rename in `failures` and keep going instead of throwing. Default: fail fast. */
  readonly continueOnError?: boolean;
  /** Audit sink, called once per rename when it settles — successes and failures alike. */
  readonly onRenamed?: (event: SourceRenameEvent) => void;
  /** Redacts error messages before they reach `onRenamed` and `failures`. */
  readonly redact?: (value: string) => string;
}

export interface ApplySourceRenamesResult {
  /** Per-rename results in the order applied, with every page already folded in (no `cursor`). */
  readonly results: readonly RepointSourceResult[];
  /** Renames that threw, in the order attempted; empty in fail-fast mode (the first failure throws). */
  readonly failures: readonly { readonly from: string; readonly to: string; readonly error: string }[];
}

const RENAME_ERROR_MAX = 256;

/**
 * One rename, fully applied: walks the page loop so a rename above one page still moves everything.
 * Each page is its own `repointSource` call — one ACL check, one transaction, one handler pass per page —
 * and the counts are folded into a single result so the batch reports a rename, not a page.
 */
async function applyOne(from: string, to: string, options: ApplySourceRenamesOptions): Promise<RepointSourceResult> {
  let cursor: string | undefined;
  let result: RepointSourceResult | undefined;
  let movedChunks = 0;
  let rewrittenEdges = 0;
  const layers: Record<string, number> = {};
  do {
    const page = await repointSource({
      scope: options.scope,
      vectorStore: options.vectorStore,
      authorization: options.authorization,
      handlers: options.handlers,
      signal: options.signal,
      pageSize: options.pageSize,
      maxRecords: options.maxRecords,
      from,
      to,
      ...(cursor === undefined ? {} : { cursor }),
    });
    cursor = page.cursor;
    movedChunks += page.movedChunks;
    rewrittenEdges += page.rewrittenEdges;
    for (const [kind, count] of Object.entries(page.layers)) layers[kind] = (layers[kind] ?? 0) + count;
    result = page;
  } while (cursor !== undefined);
  return Object.freeze({
    from,
    to,
    movedChunks,
    rewrittenEdges,
    layers: Object.freeze(layers),
    batched: result?.batched ?? false,
  });
}

/**
 * Plan 102 Task 7: apply a batch of host-owned source renames.
 *
 * A thin, audited loop over `repointSource` — no second re-key path and no new store method. Validation is
 * whole-batch and runs before the first store read, so a malformed list writes nothing; each pair is then
 * handed to `repointSource`, which re-checks its own ACLs, cap, and abort. Fail-fast (the default) surfaces
 * the original error after the failed pair's audit event; `continueOnError` collects failures instead. Aborts
 * stop the batch either way and are never reported as rename failures.
 */
export async function applySourceRenames(options: ApplySourceRenamesOptions): Promise<ApplySourceRenamesResult> {
  if (options === null || typeof options !== "object") throw new MemoryValidationError("applySourceRenames requires options");
  const renames = parseRenames(options.renames);
  const results: RepointSourceResult[] = [];
  const failures: { from: string; to: string; error: string }[] = [];

  for (const { from, to } of renames) {
    assertNotAborted(options.signal);
    try {
      const result = await applyOne(from, to, options);
      results.push(result);
      options.onRenamed?.(
        Object.freeze({
          from,
          to,
          outcome: "moved",
          movedChunks: result.movedChunks,
          rewrittenEdges: result.rewrittenEdges,
          layers: result.layers,
        }),
      );
    } catch (error) {
      assertNotAborted(options.signal);
      const message = error instanceof Error ? error.message : String(error);
      const redacted = (options.redact ? options.redact(message) : message).slice(0, RENAME_ERROR_MAX);
      failures.push({ from, to, error: redacted });
      options.onRenamed?.(Object.freeze({ from, to, outcome: "failed", error: redacted }));
      if (options.continueOnError !== true) throw error;
    }
  }

  return Object.freeze({ results: Object.freeze(results), failures: Object.freeze(failures) });
}

/** Every id claimed once: a duplicate, a chain (`a→b`, `b→c`), or an overlap rejects the whole batch. */
function parseRenames(renames: readonly SourceRename[] | undefined): readonly SourceRename[] {
  if (!Array.isArray(renames)) throw new MemoryValidationError("applySourceRenames requires a renames array");
  const claimed = new Set<string>();
  const parsed: SourceRename[] = [];
  for (const rename of renames) {
    if (rename === null || typeof rename !== "object") throw new MemoryValidationError("each rename must be a { from, to } pair");
    const from = requireId(rename.from, "rename.from");
    const to = requireId(rename.to, "rename.to");
    if (from === to) throw new MemoryValidationError("rename from and to must differ");
    for (const id of [from, to]) {
      if (claimed.has(id)) throw new MemoryValidationError(`rename id ${id} appears twice in one call`);
      claimed.add(id);
    }
    parsed.push({ from, to });
  }
  return parsed;
}
