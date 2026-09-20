/**
 * Plan 102 Task 5: durable deletion-propagation and re-point legs.
 *
 * The in-memory suites prove the contract; this leg proves it over the wire on a real pgvector
 * store: 1,001 tombstoned rows (one source chunk + 1,000 derived rows carrying the lineage edge)
 * commit in ONE transaction, the SQL predicate (not only the in-app tombstone guard) hides them
 * from every query leg, and the grant checks fail closed before the first write.
 *
 * Skipped with a named reason when `PRISM_TEST_POSTGRES_URL` is unset; registered in
 * `packages/memory/package.json` (`test:postgres`) and counted by `scripts/postgres-evidence.mjs`.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { Pool } from "pg";
import {
  createDeletionPropagator,
  createHashEmbedder,
  createPostgresVectorStore,
  HARD_INVALIDATION_BATCH,
  type MemoryScope,
  MemoryScopeError,
  type MemoryVectorRecord,
  repointSource,
} from "../index.js";
import { chunkText, createRagDeletionHandler, indexChunks, retrieveContext } from "../rag/index.js";
import type { RagScope } from "../rag/types.js";

const postgresUrl = process.env.PRISM_TEST_POSTGRES_URL;
const SKIP_REASON = "set PRISM_TEST_POSTGRES_URL to run the durable deletion-propagation leg";

const scope: Required<MemoryScope> = { tenantId: "t1", resourceId: "r1", threadId: "th1" };
const ragScope: RagScope = { tenantId: scope.tenantId, resourceId: scope.resourceId, corpusId: scope.threadId };
const alice = { principalId: "alice", tenantId: scope.tenantId };
const VECTOR = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
const SOURCE = "doc:large";
const DERIVED = 1_000;
const LARGE_TEXT =
  "ERP lead approval policy for the finance team: the ERP lead approves every purchase above the quarterly threshold, records the decision in the finance ledger, and notifies procurement.";
const OPEN_TEXT = "handbook approval policy for the open corpus: anyone may read the onboarding handbook.";

/** The durable store declares the optional vector-store methods it actually implements; assert it once, use them freely. */
type DurableStore = Awaited<ReturnType<typeof createPostgresVectorStore>>;
type Store = DurableStore & Required<Pick<DurableStore, "query" | "setSourceAccess" | "listInvalidated" | "getByThread">>;

interface PoolCounts {
  begin: number;
  commit: number;
  rollback: number;
  statements: number;
}

/** Counts store transactions on the same seam `runVectorTransaction` uses: BEGIN/COMMIT on a pooled client. */
function countingPool(pool: Pool): { pool: Pool; counts: PoolCounts } {
  const counts: PoolCounts = { begin: 0, commit: 0, rollback: 0, statements: 0 };
  const forwardQuery = pool.query.bind(pool) as (text: string, values?: unknown[]) => Promise<unknown>;
  const tally = (text: unknown): void => {
    const statement = String(text ?? "")
      .trim()
      .toUpperCase();
    counts.statements += 1;
    if (statement === "BEGIN") counts.begin += 1;
    else if (statement === "COMMIT") counts.commit += 1;
    else if (statement === "ROLLBACK") counts.rollback += 1;
  };
  const wrapper = {
    query: (text: string, values?: unknown[]) => {
      tally(text);
      return forwardQuery(text, values);
    },
    connect: async () => {
      const client = await pool.connect();
      return new Proxy(client, {
        get(target, property, receiver) {
          if (property === "query") {
            return (text: string, values?: unknown[]) => {
              tally(text);
              return (target.query as (text: string, values?: unknown[]) => Promise<unknown>)(text, values);
            };
          }
          return Reflect.get(target, property, receiver);
        },
      });
    },
  };
  return { pool: wrapper as unknown as Pool, counts };
}

describe("postgres deletion propagation integration", { skip: postgresUrl ? false : SKIP_REASON }, () => {
  const pools: Pool[] = [];

  after(async () => {
    for (;;) {
      const pool = pools.pop();
      if (!pool) break;
      await pool.end().catch(() => undefined);
    }
  });

  function record(id: string, sourceIds: readonly string[] = []): MemoryVectorRecord {
    return {
      id,
      ...scope,
      text: id,
      embedding: VECTOR,
      sequence: 0,
      createdAt: new Date(0).toISOString(),
      metadata: sourceIds.length === 0 ? {} : { _lineage: { v: 1, sourceIds: [...sourceIds] } },
    };
  }

  function lineageOf(row: MemoryVectorRecord | undefined): readonly string[] {
    const lineage = row?.metadata?._lineage;
    if (lineage === null || typeof lineage !== "object" || Array.isArray(lineage)) return [];
    const sourceIds = (lineage as { sourceIds?: unknown }).sourceIds;
    return Array.isArray(sourceIds) ? sourceIds.map((id) => String(id)) : [];
  }

  function ragOf(row: MemoryVectorRecord | undefined): { sourceId?: string; citationId?: string } {
    const rag = row?.metadata?._rag;
    if (rag === null || typeof rag !== "object" || Array.isArray(rag)) return {};
    return rag as { sourceId?: string; citationId?: string };
  }

  /** A derived chunk row: a real chunk of a derived source, carrying the lineage edge back to the deleted document. */
  function derivedChunk(summaryId: string, sequence: number): MemoryVectorRecord {
    const chunk = chunkText(`derived digest of ${summaryId} about the ERP lead approval policy`, { sourceId: summaryId })[0];
    assert.ok(chunk, "chunkText must produce at least one chunk");
    return {
      id: chunk.id,
      ...scope,
      text: chunk.text,
      embedding: VECTOR,
      sequence,
      embedderId: "hash",
      createdAt: new Date(0).toISOString(),
      metadata: {
        _rag: { sourceId: chunk.sourceId, citationId: chunk.citationId, chunkIndex: chunk.index, start: chunk.start, end: chunk.end },
        _lineage: { v: 1, sourceIds: [SOURCE] },
      },
    };
  }

  async function createStore() {
    const pool = new Pool({ connectionString: postgresUrl, max: 4 });
    pools.push(pool);
    try {
      await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    } catch {
      console.log("skip: pgvector extension unavailable");
      return undefined;
    }
    const schema = `prism_prop_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const counting = countingPool(pool);
    const store = (await createPostgresVectorStore({ pool: counting.pool, schema, dimension: VECTOR.length })) as Store;
    return { store, counts: counting.counts };
  }

  function propagator(store: Store) {
    return createDeletionPropagator({ scope, vectorStore: store, authorization: alice });
  }

  async function grant(store: Store, sourceIds: readonly string[]): Promise<void> {
    await store.setSourceAccess(
      scope,
      sourceIds.map((sourceId) => ({ sourceId, principalIds: [alice.principalId], accessVersion: 1 })),
    );
  }

  it("tombstones 1k derived rows in one durable transaction, and no query leg returns them afterwards", async () => {
    const created = await createStore();
    if (!created) return;
    const { store, counts } = created;
    const embedder = createHashEmbedder({ dimensions: VECTOR.length });

    // Real flow: 1,000 derived chunk rows carry the lineage edge, and the registered RAG handler
    // physically removes the source's own chunk rows in the same pass.
    const sourceChunks = chunkText(LARGE_TEXT, { sourceId: SOURCE });
    await indexChunks({ chunks: sourceChunks, embedder, store, scope: ragScope });
    await store.upsert(
      Array.from({ length: DERIVED }, (_, index) => derivedChunk(`summary:large:${String(index).padStart(4, "0")}`, index)),
    );
    await grant(store, [SOURCE]);
    assert.equal(store.authorization, "acl");

    // Control: before the delete the derived chunk rows are visible to the store query leg and to retrieval.
    assert.ok((await store.query({ ...scope, embedding: VECTOR, topK: 5 })).length > 0);
    const before = await retrieveContext(LARGE_TEXT.slice(0, 48), {
      embedder,
      store,
      scope: ragScope,
      lexical: "off",
      authorization: alice,
    });
    assert.ok(before.hits.length > 0, "the derived rows are retrievable before the delete");

    counts.begin = 0;
    counts.commit = 0;
    counts.rollback = 0;
    counts.statements = 0;
    const started = Date.now();
    const propagator = createDeletionPropagator({
      scope,
      vectorStore: store,
      authorization: alice,
      handlers: [createRagDeletionHandler({ store, scope: ragScope })],
    });
    const result = await propagator.propagate(SOURCE);
    const elapsed = Date.now() - started;

    assert.equal(result.tombstoned, 1 + DERIVED);
    assert.equal(result.batched, true);
    assert.equal(result.layers.rag, sourceChunks.length, "the RAG handler removes the source's own chunk rows");
    assert.equal(counts.begin, 1, "1k tombstones must commit in one transaction");
    assert.equal(counts.commit, 1);
    assert.equal(counts.rollback, 0);
    assert.ok(
      counts.statements <= 2 + Math.ceil((1 + DERIVED) / HARD_INVALIDATION_BATCH) + 8,
      `tombstones are batched by ${HARD_INVALIDATION_BATCH}, not one statement per row (saw ${counts.statements} statements)`,
    );
    assert.ok(elapsed < 2_000, `durable propagation of ${1 + DERIVED} rows took ${elapsed}ms`);
    console.log(`durable propagation: ${1 + DERIVED} tombstones, ${counts.statements} statements, 1 transaction, ${elapsed}ms`);

    assert.equal((await store.listInvalidated(scope)).length, 1 + DERIVED, "every derived row carries a durable tombstone");
    const rows = await store.getByThread(scope);
    assert.equal(rows.length, DERIVED, "source rows are physically gone; derived rows are tombstoned, never purged");
    assert.equal(
      rows.some((row) => row.id.startsWith(`${SOURCE}#`)),
      false,
    );

    // The durable predicate hides the tombstoned rows: the SQL legs, not only the in-app guard, are the first line.
    assert.equal((await store.query({ ...scope, embedding: VECTOR, topK: 5 })).length, 0);
    const after = await retrieveContext(LARGE_TEXT.slice(0, 48), {
      embedder,
      store,
      scope: ragScope,
      lexical: "off",
      authorization: alice,
    });
    assert.equal(after.hits.length, 0, "retrieval returns zero hits for the deleted source");
  });

  it("re-points on the durable store in one transaction and keeps propagation correct on both sides", async () => {
    const created = await createStore();
    if (!created) return;
    const { store, counts } = created;
    const embedder = createHashEmbedder({ dimensions: VECTOR.length });
    const chunkIds = chunkText(OPEN_TEXT, { sourceId: "doc:a" }).map((chunk) => chunk.id);
    const derivedIds = ["summary:a:0001", "summary:a:0002", "summary:a:0003"];

    await indexChunks({ chunks: chunkText(OPEN_TEXT, { sourceId: "doc:a" }), embedder, store, scope: ragScope });
    await store.upsert(derivedIds.map((id) => record(id, ["doc:a"])));
    await grant(store, ["doc:a", "doc:b"]);
    const seeded = await store.getByThread(scope);
    const sourceRow = seeded.find((row) => row.id.startsWith("doc:a#"));
    assert.ok(sourceRow, "the fixture seeds at least one source chunk row");

    counts.begin = 0;
    counts.commit = 0;
    counts.rollback = 0;
    counts.statements = 0;
    const started = Date.now();
    const moved = await repointSource({ scope, vectorStore: store, from: "doc:a", to: "doc:b", authorization: alice });
    const elapsed = Date.now() - started;

    assert.equal(moved.movedChunks, chunkIds.length);
    assert.equal(moved.rewrittenEdges, derivedIds.length);
    assert.equal(moved.batched, true);
    assert.equal(counts.begin, 1, "the whole move commits in one transaction");
    assert.equal(counts.commit, 1);
    assert.equal(counts.rollback, 0);
    console.log(`durable re-point: ${chunkIds.length} chunk rows + ${derivedIds.length} lineage edges, 1 transaction, ${elapsed}ms`);

    const movedRows = await store.getByThread(scope);
    assert.equal(movedRows.length, seeded.length, "nothing is duplicated or dropped");
    assert.equal(
      movedRows.some((row) => row.id.startsWith("doc:a#")),
      false,
      "old chunk ids are retired",
    );
    for (const chunkId of chunkIds) {
      const row = movedRows.find((entry) => entry.id === chunkId.replace("doc:a#", "doc:b#"));
      assert.ok(row, `re-keyed row ${chunkId.replace("doc:a#", "doc:b#")} must exist`);
      assert.equal(ragOf(row).sourceId, "doc:b");
      assert.equal(ragOf(row).citationId, row.id);
      assert.equal(row.text, sourceRow.text, "text is reused verbatim (no re-embed)");
      assert.deepEqual(row.embedding, sourceRow.embedding);
    }
    for (const id of derivedIds) {
      assert.deepEqual(lineageOf(movedRows.find((row) => row.id === id)), ["doc:b"], `lineage edge on ${id} must move`);
    }

    // Both sides of the move: the old source no longer reaches the derived rows, the new one does.
    const stale = await propagator(store).propagate("doc:a");
    assert.equal(stale.ids.includes(derivedIds[0] ?? ""), false, "the moved edges no longer hang off doc:a");
    const fresh = await propagator(store).propagate("doc:b");
    for (const id of derivedIds) assert.ok(fresh.ids.includes(id), `propagating doc:b must tombstone ${id}`);
    assert.equal((await store.listInvalidated(scope)).length, 1 + chunkIds.length + derivedIds.length);
    const after = await retrieveContext(OPEN_TEXT.slice(0, 40), { embedder, store, scope: ragScope, lexical: "off", authorization: alice });
    assert.equal(after.hits.length, 0);
  });

  it("fails closed on the durable store: no grant means no propagation and no partial re-point", async () => {
    const created = await createStore();
    if (!created) return;
    const { store, counts } = created;
    const embedder = createHashEmbedder({ dimensions: VECTOR.length });

    await indexChunks({ chunks: chunkText(LARGE_TEXT, { sourceId: "doc:secret" }), embedder, store, scope: ragScope });
    await indexChunks({ chunks: chunkText(OPEN_TEXT, { sourceId: "doc:a" }), embedder, store, scope: ragScope });
    await grant(store, ["doc:a", "doc:b"]);

    counts.begin = 0;
    counts.commit = 0;
    counts.rollback = 0;
    counts.statements = 0;

    await assert.rejects(() => propagator(store).propagate("doc:secret"), MemoryScopeError);
    assert.equal(counts.begin, 0, "a denied propagation must not open a transaction");
    assert.deepEqual(await store.listInvalidated(scope), []);
    assert.ok((await store.query({ ...scope, embedding: VECTOR, topK: 5 })).some((hit) => hit.id.startsWith("doc:secret#")));

    await assert.rejects(
      () => repointSource({ scope, vectorStore: store, from: "doc:a", to: "doc:c", authorization: alice }),
      MemoryScopeError,
    );
    assert.equal(counts.begin, 0, "an ungranted destination must fail before the first write");
    const rows = await store.getByThread(scope);
    assert.ok(
      rows.some((row) => row.id.startsWith("doc:a#")),
      "the source chunk stays under its old id",
    );
    assert.equal(
      rows.some((row) => row.id.startsWith("doc:c#")),
      false,
      "no partial move to the ungranted destination",
    );
    assert.equal(
      rows.some((row) => ragOf(row).sourceId === "doc:c"),
      false,
    );
  });
});
