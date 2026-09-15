import { type CheckpointStore, type OwnershipScope } from "@arnilo/prism";
import type { Embedder, SourceAccessGrant } from "../types.js";
import { chunkText } from "./chunk.js";
import { RagLimitError, RagSyncCursorError, RagSyncThrottleError, RagValidationError } from "./errors.js";
import { isValidContentHash } from "./hash.js";
import { ingestionStatus } from "./ingestion-status.js";
import { deleteSource, replaceSource } from "./sources.js";
import type { Chunker, IngestionStatusStore, RagScope, SourceFreshness, TransactionalVectorStore } from "./types.js";
import { assertNotAborted, requireScope, requireSourceId } from "./util.js";

export const DEFAULT_SYNC_PAGE_SIZE = 50;
export const HARD_SYNC_PAGE_SIZE_CAP = 200;
export const DEFAULT_SYNC_MAX_PAGES = 8;
export const HARD_SYNC_MAX_PAGES_CAP = 64;
export const DEFAULT_SYNC_RETRIES = 3;
export const HARD_SYNC_RETRIES_CAP = 8;

export type KnowledgeChange =
  | {
      readonly kind: "upsert";
      readonly sourceId: string;
      readonly text: string;
      readonly contentHash: string;
      readonly grants?: SourceAccessGrant;
      readonly metadata?: import("@arnilo/prism").JsonObject;
    }
  | { readonly kind: "delete"; readonly sourceId: string }
  | { readonly kind: "acl"; readonly sourceId: string; readonly grants: SourceAccessGrant }
  | { readonly kind: "withhold"; readonly sourceId: string; readonly freshness: Exclude<SourceFreshness, "current"> };

export interface KnowledgeChangePage {
  readonly changes: readonly KnowledgeChange[];
  /** Opaque resume token persisted only after this page is fully applied. */
  readonly resumeCursor: string;
  /** True when the connector has no further pages (caught up). */
  readonly done: boolean;
}

export interface KnowledgeConnector {
  listChanges(input: { readonly cursor?: string; readonly limit: number; readonly signal?: AbortSignal }): Promise<KnowledgeChangePage>;
}

export interface SyncKnowledgeOptions {
  readonly connector: KnowledgeConnector;
  readonly checkpoints: CheckpointStore;
  readonly checkpoint: { readonly namespace: string; readonly key: string } & OwnershipScope;
  readonly store: TransactionalVectorStore;
  readonly embedder: Embedder;
  readonly scope: RagScope;
  readonly statusStore?: IngestionStatusStore;
  readonly chunker?: Chunker;
  readonly pageSize?: number;
  readonly maxPages?: number;
  readonly maxRetries?: number;
  readonly onInvalidCursor?: "resync" | "fail";
  readonly sleep?: (ms: number) => Promise<void>;
  readonly signal?: AbortSignal;
}

export interface SyncKnowledgeResult {
  readonly pages: number;
  readonly upserted: number;
  readonly deleted: number;
  readonly skipped: number;
  readonly withheld: number;
  readonly cursor?: string;
  readonly exhausted: boolean;
}

interface SyncCheckpointValue {
  readonly v: 1;
  readonly cursor?: string;
}

export async function syncKnowledge(options: SyncKnowledgeOptions): Promise<SyncKnowledgeResult> {
  const scope = requireScope(options.scope);
  const pageSize = bound(options.pageSize, DEFAULT_SYNC_PAGE_SIZE, HARD_SYNC_PAGE_SIZE_CAP, "pageSize");
  const maxPages = bound(options.maxPages, DEFAULT_SYNC_MAX_PAGES, HARD_SYNC_MAX_PAGES_CAP, "maxPages");
  const maxRetries = bound(options.maxRetries, DEFAULT_SYNC_RETRIES, HARD_SYNC_RETRIES_CAP, "maxRetries", 0);
  const onInvalid = options.onInvalidCursor ?? "resync";
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const chunker = options.chunker ?? chunkText;
  assertNotAborted(options.signal);

  const loaded = await options.checkpoints.loadCheckpoint({ ...options.checkpoint, signal: options.signal });
  let version = loaded?.version ?? 0;
  let cursor = readCursor(loaded?.value);
  let resynced = false;
  let pages = 0;
  let upserted = 0;
  let deleted = 0;
  let skipped = 0;
  let withheld = 0;
  let exhausted = false;

  while (pages < maxPages) {
    assertNotAborted(options.signal);
    let page: KnowledgeChangePage;
    try {
      page = await withRetry(
        () => options.connector.listChanges({ cursor, limit: pageSize, signal: options.signal }),
        maxRetries,
        sleep,
        options.signal,
      );
    } catch (error) {
      if (error instanceof RagSyncCursorError && onInvalid === "resync" && !resynced) {
        resynced = true;
        cursor = undefined;
        continue;
      }
      throw error;
    }
    if (!page.resumeCursor || typeof page.resumeCursor !== "string") {
      throw new RagValidationError("knowledge connector must return a resumeCursor");
    }
    for (const change of page.changes) {
      const counts = await applyChange(change, { ...options, scope, chunker });
      upserted += counts.upserted;
      deleted += counts.deleted;
      skipped += counts.skipped;
      withheld += counts.withheld;
    }
    const saved = await options.checkpoints.saveCheckpoint({
      ...options.checkpoint,
      version: version + 1,
      expectedVersion: version,
      category: "rag-sync",
      value: { v: 1, cursor: page.resumeCursor } satisfies SyncCheckpointValue,
      signal: options.signal,
    });
    version = saved.version;
    cursor = page.resumeCursor;
    pages += 1;
    if (page.done) {
      exhausted = true;
      break;
    }
  }

  return Object.freeze({
    pages,
    upserted,
    deleted,
    skipped,
    withheld,
    ...(cursor ? { cursor } : {}),
    exhausted,
  });
}

async function applyChange(
  change: KnowledgeChange,
  options: {
    readonly store: TransactionalVectorStore;
    readonly embedder: Embedder;
    readonly scope: RagScope;
    readonly statusStore?: IngestionStatusStore;
    readonly chunker: Chunker;
    readonly signal?: AbortSignal;
  },
): Promise<{ upserted: number; deleted: number; skipped: number; withheld: number }> {
  const sourceId = requireSourceId(change.sourceId);
  const thread = { tenantId: options.scope.tenantId, resourceId: options.scope.resourceId, threadId: options.scope.corpusId };
  if (change.kind === "delete") {
    await deleteSource({ sourceId, store: options.store, scope: options.scope, signal: options.signal });
    return { upserted: 0, deleted: 1, skipped: 0, withheld: 0 };
  }
  if (change.kind === "withhold") {
    await withhold(options, thread, sourceId, change.freshness);
    return { upserted: 0, deleted: 0, skipped: 0, withheld: 1 };
  }
  if (change.kind === "acl") {
    await writeGrants(options.store, thread, change.grants, options.signal);
    await options.statusStore?.set(ingestionStatus(options.scope, sourceId, "indexed", 0, 0, undefined, "current"), {
      signal: options.signal,
    });
    return { upserted: 0, deleted: 0, skipped: 0, withheld: 0 };
  }
  if (!isValidContentHash(change.contentHash))
    throw new RagValidationError("upsert contentHash must be a hex digest of 32..128 characters");
  const grants = change.grants;
  if (!grants || emptyGrants(grants)) {
    await withhold(options, thread, sourceId, "unavailable");
    return { upserted: 0, deleted: 0, skipped: 0, withheld: 1 };
  }
  const chunks = options.chunker(change.text, { sourceId, ...(change.metadata ? { metadata: change.metadata } : {}) });
  const result = await replaceSource({
    sourceId,
    chunks,
    embedder: options.embedder,
    store: options.store,
    scope: options.scope,
    statusStore: options.statusStore,
    contentHash: change.contentHash,
    advanceGeneration: false,
    signal: options.signal,
  });
  await writeGrants(options.store, thread, { ...grants, sourceId }, options.signal);
  await options.statusStore?.set(
    ingestionStatus(options.scope, sourceId, "indexed", Buffer.byteLength(change.text, "utf8"), chunks.length, undefined, "current"),
    { signal: options.signal },
  );
  return { upserted: result.skipped ? 0 : 1, deleted: 0, skipped: result.skipped ? 1 : 0, withheld: 0 };
}

async function withhold(
  options: {
    readonly store: TransactionalVectorStore;
    readonly scope: RagScope;
    readonly statusStore?: IngestionStatusStore;
    readonly signal?: AbortSignal;
  },
  thread: { tenantId: string; resourceId: string; threadId: string },
  sourceId: string,
  freshness: Exclude<SourceFreshness, "current">,
): Promise<void> {
  await writeGrants(options.store, thread, { sourceId, principalIds: [], groupIds: [], accessVersion: 1 }, options.signal);
  await options.statusStore?.set(ingestionStatus(options.scope, sourceId, "indexed", 0, 0, undefined, freshness), {
    signal: options.signal,
  });
}

async function writeGrants(
  store: TransactionalVectorStore,
  thread: { tenantId: string; resourceId: string; threadId: string },
  grants: SourceAccessGrant,
  signal?: AbortSignal,
): Promise<void> {
  if (store.authorization !== "acl" || typeof store.setSourceAccess !== "function") {
    throw new RagValidationError('knowledge sync requires a vector store with authorization: "acl"');
  }
  await store.setSourceAccess(thread, [grants], { signal });
}

function emptyGrants(grants: SourceAccessGrant): boolean {
  return (grants.principalIds?.length ?? 0) === 0 && (grants.groupIds?.length ?? 0) === 0;
}

function readCursor(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new RagSyncCursorError();
  const record = value as SyncCheckpointValue;
  if (record.v !== 1) throw new RagSyncCursorError("unsupported knowledge sync checkpoint version");
  if (record.cursor !== undefined && (typeof record.cursor !== "string" || !record.cursor)) throw new RagSyncCursorError();
  return record.cursor;
}

function bound(value: number | undefined, fallback: number, cap: number, label: string, minimum = 1): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum) throw new RagLimitError(`${label} must be an integer >= ${minimum}`);
  if (resolved > cap) throw new RagLimitError(`${label} exceeds hard cap ${cap}`);
  return resolved;
}

async function withRetry<T>(
  run: () => Promise<T>,
  maxRetries: number,
  sleep: (ms: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    assertNotAborted(signal);
    try {
      return await run();
    } catch (error) {
      const wait = error instanceof RagSyncThrottleError ? error.retryAfterMs : undefined;
      if (wait === undefined || attempt >= maxRetries) throw error;
      attempt += 1;
      await sleep(wait * 2 ** (attempt - 1));
    }
  }
}
