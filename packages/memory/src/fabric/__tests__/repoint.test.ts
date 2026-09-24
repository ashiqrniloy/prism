/**
 * Plan 102 Task 11: fabric notes follow a moved source path, and die with a deleted one.
 *
 * The notes are store-backed metadata (`metadata.fabric.path`), so the lineage walk can never find
 * them — these legs are the only path. Covers the move (id, text, and embedding reused, only the
 * path rewritten, non-file and other-path notes untouched), the retire (tombstoned through the
 * propagator's invalidation path, recall stops serving them), the transaction/plain-write split,
 * the no-op count, and the scope guard that keeps a mis-wired composition from cross-writing.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RepointStore } from "../../repoint.js";
import type { DeletionPropagationContext } from "../../propagation.js";
import type { MemoryScope, MemoryVectorRecord, VectorStore } from "../../types.js";
import {
  createDeletionPropagator,
  createHashEmbedder,
  createMemory,
  createMemoryVectorStore,
  createMemoryWorkingStore,
  MemoryScopeError,
  type RagAccessConstraint,
  repointSource,
} from "../../index.js";
import { createFabricRepointHandler, createMemoryFabric, parseMemoryNoteMetadata } from "../index.js";

const thread: Required<MemoryScope> = { tenantId: "t1", resourceId: "r1", threadId: "th1" };
const alice: RagAccessConstraint = { principalId: "alice", tenantId: thread.tenantId };

function makeHarness() {
  const vectors = createMemoryVectorStore();
  const working = createMemoryWorkingStore();
  const base = createHashEmbedder();
  let embedCalls = 0;
  const embedder = {
    id: base.id,
    dimensions: base.dimensions,
    async embed(texts: readonly string[], options?: { readonly signal?: AbortSignal }) {
      embedCalls += 1;
      return base.embed(texts, options);
    },
  };
  const memory = createMemory({ ...thread, embedder, vectorStore: vectors, workingStore: working });
  return { vectors, memory, fabric: createMemoryFabric({ memory }), embedCalls: () => embedCalls };
}

/** Grant both sides so the store-level move passes its ACL check; notes carry no `_rag.sourceId`. */
async function grantBoth(vectors: VectorStore, from: string, to: string): Promise<void> {
  await vectors.setSourceAccess?.(thread, [
    { sourceId: from, principalIds: ["alice"], accessVersion: 1 },
    { sourceId: to, principalIds: ["alice"], accessVersion: 1 },
  ]);
}

function counted(store: RepointStore) {
  let transactions = 0;
  let upserts = 0;
  const view = (target: VectorStore): VectorStore => ({
    ...target,
    async upsert(...args: Parameters<VectorStore["upsert"]>) {
      upserts += 1;
      return target.upsert(...args);
    },
  });
  return {
    store: {
      ...store,
      async transaction<T>(operation: (target: VectorStore) => Promise<T>, options?: { readonly signal?: AbortSignal }) {
        transactions += 1;
        return store.transaction?.((target) => operation(view(target)), options) as Promise<T>;
      },
    } as RepointStore,
    transactions: () => transactions,
    upserts: () => upserts,
  };
}

function notePath(record: MemoryVectorRecord | undefined): string | undefined {
  if (record === undefined) return undefined;
  return parseMemoryNoteMetadata(record.metadata)?.path;
}

function noteKind(record: MemoryVectorRecord | undefined): string | undefined {
  if (record === undefined) return undefined;
  return parseMemoryNoteMetadata(record.metadata)?.kind;
}

describe("fabric note re-point handler", () => {
  it("rewrites the path of a moved file note and leaves every other note alone", async () => {
    const { fabric, vectors, embedCalls } = makeHarness();
    const fileNote = await fabric.remember({
      kind: "file",
      content: "Deploy steps for the payroll service",
      path: "docs/a.md",
      sourceEntryIds: ["m1"],
    });
    const otherFile = await fabric.remember({ kind: "file", content: "Runbook for the on-call rotation", path: "docs/c.md" });
    const fact = await fabric.remember({ kind: "fact", content: "The payroll service is called ledger" });
    const before = await vectors.getByThread(thread);
    const embeddingBefore = before.find((record) => record.id === fileNote.id)?.embedding;
    const embedsBefore = embedCalls();
    await grantBoth(vectors, "docs/a.md", "docs/b.md");

    const result = await repointSource({
      scope: thread,
      vectorStore: vectors,
      from: "docs/a.md",
      to: "docs/b.md",
      authorization: alice,
      handlers: [createFabricRepointHandler({ scope: thread, vectorStore: vectors })],
    });

    assert.deepEqual(result.layers, { fabric: 1 });
    const after = await vectors.getByThread(thread);
    const moved = after.find((record) => record.id === fileNote.id);
    assert.ok(moved, "the note keeps its id");
    assert.equal(notePath(moved), "docs/b.md");
    assert.equal(moved.text, fileNote.content, "content is reused, never re-written");
    assert.deepEqual(moved.embedding, embeddingBefore, "the stored embedding is reused verbatim");
    assert.deepEqual(parseMemoryNoteMetadata(moved.metadata)?.sourceEntryIds, ["m1"], "provenance survives the move");
    assert.equal(notePath(after.find((record) => record.id === otherFile.id)), "docs/c.md");
    assert.equal(noteKind(after.find((record) => record.id === fact.id)), "fact");
    assert.equal(embedCalls(), embedsBefore, "a path move never calls the embedder");

    const { hits } = await fabric.recall("Deploy steps for the payroll service");
    assert.equal(hits[0]?.path, "docs/b.md", "recall serves the note under its new path");
  });

  it("does one transaction when the store has one and a plain write when it does not", async () => {
    const { fabric, vectors } = makeHarness();
    const note = await fabric.remember({ kind: "file", content: "Ledger runbook", path: "docs/a.md" });
    await grantBoth(vectors, "docs/a.md", "docs/b.md");

    const batched = counted(vectors as unknown as RepointStore);
    const first = await repointSource({
      scope: thread,
      vectorStore: batched.store,
      from: "docs/a.md",
      to: "docs/b.md",
      authorization: alice,
      handlers: [createFabricRepointHandler({ scope: thread, vectorStore: batched.store })],
    });
    assert.equal(first.layers.fabric, 1);
    assert.equal(batched.transactions(), 1, "the note write joins one store transaction");
    assert.equal(batched.upserts(), 1);

    const empty = counted(vectors as unknown as RepointStore);
    const noop = await repointSource({
      scope: thread,
      vectorStore: empty.store,
      from: "docs/a.md",
      to: "docs/b.md",
      authorization: alice,
      handlers: [createFabricRepointHandler({ scope: thread, vectorStore: empty.store })],
    });
    assert.equal(noop.layers.fabric, 0, "an empty move reports zero");
    assert.equal(empty.transactions(), 0, "and opens no transaction");
    assert.equal(empty.upserts(), 0);
    assert.equal(notePath((await vectors.getByThread(thread)).find((record) => record.id === note.id)), "docs/b.md");
  });

  it("moves notes on a store that cannot open a transaction, without one", async () => {
    const { fabric, vectors } = makeHarness();
    const note = await fabric.remember({ kind: "file", content: "Ledger rollback", path: "docs/a.md" });
    await grantBoth(vectors, "docs/a.md", "docs/b.md");
    const { transaction: _omitted, ...withoutTransaction } = vectors as unknown as RepointStore;

    const result = await repointSource({
      scope: thread,
      vectorStore: withoutTransaction,
      from: "docs/a.md",
      to: "docs/b.md",
      authorization: alice,
      handlers: [createFabricRepointHandler({ scope: thread, vectorStore: withoutTransaction })],
    });

    assert.equal(result.layers.fabric, 1);
    assert.equal(result.batched, false);
    assert.equal(notePath((await vectors.getByThread(thread)).find((record) => record.id === note.id)), "docs/b.md");
  });

  it("tombstones the notes of a deleted path so recall stops serving them", async () => {
    const { fabric, vectors } = makeHarness();
    const note = await fabric.remember({ kind: "file", content: "Deploy steps for the payroll service", path: "docs/a.md" });
    const survivor = await fabric.remember({ kind: "file", content: "Runbook for the on-call rotation", path: "docs/c.md" });
    await vectors.setSourceAccess?.(thread, [{ sourceId: "docs/a.md", principalIds: ["alice"], accessVersion: 1 }]);

    const propagator = createDeletionPropagator({
      scope: thread,
      vectorStore: vectors,
      authorization: alice,
      handlers: [createFabricRepointHandler({ scope: thread, vectorStore: vectors })],
    });
    const result = await propagator.propagate("docs/a.md");

    assert.equal(result.layers.fabric, 1);
    assert.equal(result.tombstoned, 1, "the path itself is the only lineage id — the note is not in the walk");
    const tombstones = await vectors.listInvalidated?.(thread);
    assert.deepEqual(
      tombstones?.map((entry) => [entry.id, entry.reason]),
      [
        ["docs/a.md", "forgotten"],
        [note.id, "forgotten"],
      ],
    );
    const afterDelete = await fabric.recall("Deploy steps for the payroll service");
    assert.equal(
      afterDelete.hits.some((hit) => hit.id === note.id),
      false,
      "recall stops serving the note of the deleted path",
    );
    assert.equal((await fabric.recall("Runbook for the on-call rotation")).hits[0]?.id, survivor.id, "other paths survive");
  });

  it("mirrors the propagator's reason into the note tombstones with no handler option", async () => {
    const { fabric, vectors } = makeHarness();
    const note = await fabric.remember({ kind: "file", content: "Subpoenaed ledger design", path: "docs/a.md" });
    await vectors.setSourceAccess?.(thread, [{ sourceId: "docs/a.md", principalIds: ["alice"], accessVersion: 1 }]);

    await createDeletionPropagator({
      scope: thread,
      vectorStore: vectors,
      authorization: alice,
      reason: "legal_hold",
      handlers: [createFabricRepointHandler({ scope: thread, vectorStore: vectors })],
    }).propagate("docs/a.md");

    const tombstones = await vectors.listInvalidated?.(thread);
    assert.deepEqual(
      tombstones?.map((entry) => [entry.id, entry.reason, entry.hold]),
      [
        ["docs/a.md", "legal_hold", true],
        [note.id, "legal_hold", true],
      ],
    );
  });

  it("lets the propagator's reason win over the handler's own, in both directions", async () => {
    // A weaker handler reason under a legal_hold walk is still a hold.
    const held = makeHarness();
    const heldNote = await held.fabric.remember({ kind: "file", content: "Held ledger", path: "docs/a.md" });
    await held.vectors.setSourceAccess?.(thread, [{ sourceId: "docs/a.md", principalIds: ["alice"], accessVersion: 1 }]);
    await createDeletionPropagator({
      scope: thread,
      vectorStore: held.vectors,
      authorization: alice,
      reason: "legal_hold",
      handlers: [createFabricRepointHandler({ scope: thread, vectorStore: held.vectors, reason: "forgotten" })],
    }).propagate("docs/a.md");
    assert.deepEqual(
      (await held.vectors.listInvalidated?.(thread))?.map((entry) => [entry.id, entry.reason, entry.hold]),
      [
        ["docs/a.md", "legal_hold", true],
        [heldNote.id, "legal_hold", true],
      ],
    );

    // A stronger handler reason under a default walk invents nothing.
    const plain = makeHarness();
    const plainNote = await plain.fabric.remember({ kind: "file", content: "Ordinary ledger", path: "docs/a.md" });
    await plain.vectors.setSourceAccess?.(thread, [{ sourceId: "docs/a.md", principalIds: ["alice"], accessVersion: 1 }]);
    await createDeletionPropagator({
      scope: thread,
      vectorStore: plain.vectors,
      authorization: alice,
      handlers: [createFabricRepointHandler({ scope: thread, vectorStore: plain.vectors, reason: "legal_hold" })],
    }).propagate("docs/a.md");
    assert.deepEqual(
      (await plain.vectors.listInvalidated?.(thread))?.map((entry) => [entry.id, entry.reason, entry.hold]),
      [
        ["docs/a.md", "forgotten", undefined],
        [plainNote.id, "forgotten", undefined],
      ],
    );
  });

  it("keeps a hand-built context without a reason valid and falls back to the handler's option", async () => {
    const { fabric, vectors } = makeHarness();
    const note = await fabric.remember({ kind: "file", content: "Hand-built retire", path: "docs/a.md" });
    const context: DeletionPropagationContext = { sourceId: "docs/a.md", ids: ["docs/a.md"], scope: thread };
    const handler = createFabricRepointHandler({ scope: thread, vectorStore: vectors });
    assert.equal(await handler.delete(context), 1);
    assert.deepEqual(
      (await vectors.listInvalidated?.(thread))?.map((entry) => [entry.id, entry.reason, entry.hold]),
      [[note.id, "forgotten", undefined]],
    );

    const heldNote = await fabric.remember({ kind: "file", content: "Hand-built hold", path: "docs/b.md" });
    const held = createFabricRepointHandler({ scope: thread, vectorStore: vectors, reason: "legal_hold" });
    assert.equal(await held.delete({ sourceId: "docs/b.md", ids: ["docs/b.md"], scope: thread }), 1);
    const rows = (await vectors.listInvalidated?.(thread)) ?? [];
    assert.equal(rows.find((entry) => entry.id === heldNote.id)?.reason, "legal_hold");
    assert.equal(rows.find((entry) => entry.id === heldNote.id)?.hold, true);
  });

  it("never touches another scope, and refuses a composition whose scope does not match", async () => {
    const { fabric, vectors } = makeHarness();
    const mine = await fabric.remember({ kind: "file", content: "Ledger notes here", path: "docs/a.md" });
    const otherThread = { tenantId: thread.tenantId, resourceId: thread.resourceId, threadId: "th2" };
    const otherMemory = createMemory({
      ...otherThread,
      embedder: createHashEmbedder(),
      vectorStore: vectors,
      workingStore: createMemoryWorkingStore(),
    });
    const otherFabric = createMemoryFabric({ memory: otherMemory });
    const theirs = await otherFabric.remember({ kind: "file", content: "Same path, other thread", path: "docs/a.md" });
    await grantBoth(vectors, "docs/a.md", "docs/b.md");

    const result = await repointSource({
      scope: thread,
      vectorStore: vectors,
      from: "docs/a.md",
      to: "docs/b.md",
      authorization: alice,
      handlers: [createFabricRepointHandler({ scope: thread, vectorStore: vectors })],
    });
    assert.equal(result.layers.fabric, 1, "only the caller's scope was rewritten");
    const stored = await vectors.getByThread(otherThread);
    assert.equal(notePath(stored.find((record) => record.id === theirs.id)), "docs/a.md");
    assert.equal(notePath((await vectors.getByThread(thread)).find((record) => record.id === mine.id)), "docs/b.md");

    await grantBoth(vectors, "docs/b.md", "docs/c.md");
    await assert.rejects(
      () =>
        repointSource({
          scope: thread,
          vectorStore: vectors,
          from: "docs/b.md",
          to: "docs/c.md",
          authorization: alice,
          handlers: [createFabricRepointHandler({ scope: otherThread, vectorStore: vectors })],
        }),
      (error: unknown) => error instanceof MemoryScopeError && /does not match/.test((error as Error).message),
    );
  });
});
