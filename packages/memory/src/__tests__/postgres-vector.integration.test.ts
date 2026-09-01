import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { Pool } from "pg";
import {
  buildMemoryDdl,
  buildVectorSearchDdl,
  createMemory,
  createPostgresMemoryStores,
  createPostgresVectorStore,
  MemoryValidationError,
  type MemoryVectorRecord,
  validateIdentifier,
} from "../index.js";

const postgresUrl = process.env.PRISM_TEST_POSTGRES_URL;
const describeIntegration = postgresUrl ? describe : describe.skip;

function baseRecord(overrides: Partial<MemoryVectorRecord> & Pick<MemoryVectorRecord, "id" | "embedding">): MemoryVectorRecord {
  return {
    tenantId: "t1",
    resourceId: "r1",
    threadId: "th1",
    text: `text for ${overrides.id}`,
    sequence: 0,
    metadata: {},
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

/** Deterministic pseudo-random vectors so expected cosine order is stable. */
function seededVectors(seed: number, count: number, dims: number): number[][] {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648 - 0.5;
  };
  return Array.from({ length: count }, () => Array.from({ length: dims }, next));
}

function cosineRanking(query: number[], candidates: readonly { id: string; embedding: number[] }[], topK: number): string[] {
  const dot = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  const norm = (a: number[]) => Math.sqrt(dot(a, a));
  const scored = candidates.map((candidate) => ({
    id: candidate.id,
    score: dot(query, candidate.embedding) / (norm(query) * norm(candidate.embedding)),
  }));
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, topK).map((entry) => entry.id);
}

describe("postgres vector ddl and identifiers", () => {
  it("rejects identifier injection attempts", () => {
    assert.throws(() => validateIdentifier('foo"; DROP TABLE x;--', "table"), MemoryValidationError);
    assert.throws(() => buildMemoryDdl("prism; DROP SCHEMA public CASCADE"), MemoryValidationError);
    assert.throws(() => buildVectorSearchDdl("ok", 'x"; DROP TABLE x;--'), MemoryValidationError);
    assert.throws(() => buildMemoryDdl("has space"), MemoryValidationError);
  });

  it("emits lexical, drift columns, generation pointer table, and conditional hnsw", () => {
    const core = buildMemoryDdl("s1", "t1");
    const all = `${core}\n${buildVectorSearchDdl("s1", "t1")}`;
    assert.match(all, /text_tsv TSVECTOR GENERATED ALWAYS AS \(to_tsvector\('english', text\)\) STORED/);
    assert.match(all, /USING gin \(text_tsv\)/);
    assert.doesNotMatch(buildVectorSearchDdl("s1", "t1"), /hnsw/); // untyped vector column cannot take HNSW
    assert.match(buildVectorSearchDdl("s1", "t1", 768), /USING hnsw \(embedding vector_cosine_ops\)/);
    assert.throws(() => buildVectorSearchDdl("s1", "t1", 0), MemoryValidationError);
    assert.match(all, /ADD COLUMN IF NOT EXISTS embedder_id TEXT/);
    assert.match(all, /ADD COLUMN IF NOT EXISTS content_hash TEXT/);
    assert.match(all, /ADD COLUMN IF NOT EXISTS generation INTEGER/);
    assert.match(all, /ADD COLUMN IF NOT EXISTS importance REAL/);
    assert.match(all, /CREATE TABLE IF NOT EXISTS "s1"\."t1_rag_scope_generations"/);
    assert.match(core, /CREATE TABLE IF NOT EXISTS "s1"\."t1"/);
  });
});

describeIntegration("createPostgresVectorStore integration", () => {
  const pools: Pool[] = [];

  after(async () => {
    while (pools.length > 0) {
      const pool = pools.pop()!;
      await pool.end().catch(() => undefined);
    }
  });

  function createPool(): Pool {
    const pool = new Pool({ connectionString: postgresUrl, max: 5 });
    pools.push(pool);
    return pool;
  }

  async function createStore(dimension?: number, table?: string) {
    const pool = createPool();
    if (!(await pgvectorAvailable(pool))) {
      console.log("skip: pgvector extension unavailable");
      return undefined;
    }
    const schema = `prism_vec_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const store = await createPostgresVectorStore({ pool, schema, ...(table ? { table } : {}), ...(dimension ? { dimension } : {}) });
    return { store, schema, pool };
  }

  async function pgvectorAvailable(pool: Pool): Promise<boolean> {
    try {
      await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
      return true;
    } catch {
      return false;
    }
  }

  it("generation visibility: pointer filters query and lexical legs, rollback via setCurrentGeneration, legacy rows always visible", async () => {
    const created = await createStore(2);
    if (!created) return;
    const { store, schema, pool } = created;
    const scope = { tenantId: "t1", resourceId: "r1", threadId: "th1" };
    try {
      await store.upsert([
        baseRecord({ id: "gen1-a", embedding: [1, 0], generation: 1 }),
        baseRecord({ id: "legacy-a", embedding: [1, 0] }),
      ]);
      // Durable adapter: no pointer row yet → everything visible.
      let ids = (await store.query({ ...scope, embedding: [1, 0], topK: 10 })).map((hit) => hit.id).sort();
      assert.deepEqual(ids, ["gen1-a", "legacy-a"]);

      await store.upsert([baseRecord({ id: "gen2-a", embedding: [0.9, 0.1], generation: 2 })]);
      await store.setCurrentGeneration!(scope, 2);
      ids = (await store.query({ ...scope, embedding: [1, 0], topK: 10 })).map((hit) => hit.id).sort();
      assert.deepEqual(ids, ["gen2-a", "legacy-a"]);
      if (store.lexicalModes?.includes("fts")) {
        const hidden = await store.lexicalQuery!({ ...scope, text: "text for gen1-a", topK: 10 });
        assert.deepEqual(
          hidden.map((hit) => hit.id),
          [],
        ); // gen-1 text hidden from the lexical leg too
        const visible = await store.lexicalQuery!({ ...scope, text: "text for gen2-a", topK: 10 });
        assert.deepEqual(
          visible.map((hit) => hit.id),
          ["gen2-a"],
        );
      }
      assert.equal(await store.getCurrentGeneration?.(scope), 2);

      // Rollback pointer to generation 1.
      await store.setCurrentGeneration!(scope, 1);
      ids = (await store.query({ ...scope, embedding: [1, 0], topK: 10 })).map((hit) => hit.id).sort();
      assert.deepEqual(ids, ["gen1-a", "legacy-a"]);
      assert.equal(await store.getCurrentGeneration?.(scope), 1);

      // Validation.
      await assert.rejects(store.setCurrentGeneration!(scope, -1), MemoryValidationError);
      await assert.rejects(store.upsert([baseRecord({ id: "bad", embedding: [1, 0], generation: 2.5 })]), MemoryValidationError);
    } finally {
      await store.close();
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });

  it("commits atomically: rolled-back transactions leave prior chunks retrievable", async () => {
    const created = await createStore();
    if (!created) return;
    const { store, schema, pool } = created;
    try {
      const original = baseRecord({ id: "src#0001", embedding: [1, 0], sequence: 0 });
      await store.upsert([original]);

      await assert.rejects(
        store.transaction(async (tx) => {
          await tx.upsert([baseRecord({ id: "src#0002", embedding: [0, 1], sequence: 1 })]);
          throw new Error("boom mid-operation");
        }),
        /boom/,
      );
      assert.deepEqual(
        (await store.getByThread({ tenantId: "t1", resourceId: "r1", threadId: "th1" })).map((record) => record.id),
        ["src#0001"],
      );

      const countInsideTxn = await store.transaction(async (tx) => {
        await tx.delete({ tenantId: "t1", resourceId: "r1", threadId: "th1" });
        await tx.upsert([baseRecord({ id: "src#0003", embedding: [0, 1], sequence: 2 })]);
        return tx.countByThread({ tenantId: "t1", resourceId: "r1", threadId: "th1" });
      });
      assert.equal(countInsideTxn, 1);
      assert.deepEqual(
        (await store.getByThread({ tenantId: "t1", resourceId: "r1", threadId: "th1" })).map((record) => record.id),
        ["src#0003"],
      );
    } finally {
      await store.close();
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });

  it("keeps multi-record upsert batches atomic on failure", async () => {
    const created = await createStore(2);
    if (!created) return;
    const { store, schema, pool } = created;
    try {
      await assert.rejects(
        store.upsert([
          baseRecord({ id: "a", embedding: [1, 0] }),
          baseRecord({ id: "b", embedding: [1, 0, 0] }), // dimension drift against pinned column
        ]),
        /expected 2/,
      );
      assert.equal(await store.countByThread({ tenantId: "t1", resourceId: "r1", threadId: "th1" }), 0);
      const indexes = await pool.query("SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'semantic_memory'", [
        schema,
      ]);
      assert.ok(indexes.rows.some((row) => String(row.indexname).endsWith("_embedding_hnsw")));
    } finally {
      await store.close();
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });

  it("returns exact-scope getBySource results and never leaks across tenants", async () => {
    const created = await createStore();
    if (!created) return;
    const { store, schema, pool } = created;
    try {
      const ragMeta = (sourceId: string) => ({ _rag: { sourceId, citationId: `${sourceId}#0000`, chunkIndex: 0, start: 0, end: 5 } });
      await store.upsert([
        baseRecord({ id: "policy#0001", sequence: 1, metadata: ragMeta("policy"), embedding: [1, 0] }),
        baseRecord({ id: "policy#0002", sequence: 2, metadata: ragMeta("policy"), embedding: [0.9, 0.1] }),
        baseRecord({ id: "other#0001", sequence: 3, metadata: ragMeta("other"), embedding: [0.8, 0.2] }),
      ]);
      const scope = { tenantId: "t1", resourceId: "r1", threadId: "th1" };
      assert.deepEqual(
        (await store.getBySource(scope, "policy")).map((record) => record.id),
        ["policy#0001", "policy#0002"],
      );
      assert.equal((await store.getBySource(scope, "missing")).length, 0);
      assert.equal((await store.getBySource({ tenantId: "foreign", resourceId: "r1", threadId: "th1" }, "policy")).length, 0);

      // Records from tenant t1 are invisible to foreign-scope queries.
      await store.upsert([baseRecord({ tenantId: "t2", id: "t2rec", embedding: [1, 0] })]);
      assert.equal(
        (await store.query({ ...scope, embedding: [1, 0], topK: 10 })).every((hit) => hit.tenantId === "t1"),
        true,
      );
      const foreignRows = await store.getByThread({ tenantId: "t2", resourceId: "r1", threadId: "th1" });
      assert.deepEqual(
        foreignRows.map((row) => row.id),
        ["t2rec"],
      );
    } finally {
      await store.close();
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });

  it("serves fts lexical queries from the tsvector leg when available", async () => {
    const created = await createStore();
    if (!created) return;
    const { store, schema, pool } = created;
    try {
      if (store.lexicalModes?.includes("fts") !== true) {
        console.log("skip: text_tsv column unavailable");
        return;
      }
      await store.upsert([
        baseRecord({
          id: "policy#0001",
          sequence: 1,
          text: "approval policy requires current authorization",
          embedding: [1, 0],
          metadata: { _rag: { sourceId: "policy", citationId: "policy#0001", chunkIndex: 0, start: 0, end: 5 } },
        }),
        baseRecord({
          id: "food#0001",
          sequence: 2,
          text: "cooking pasta requires boiling water",
          embedding: [0, 1],
          metadata: { _rag: { sourceId: "food", citationId: "food#0001", chunkIndex: 0, start: 0, end: 5 } },
        }),
      ]);
      const hits = await store.lexicalQuery!({ tenantId: "t1", resourceId: "r1", threadId: "th1", text: "approval + policy", topK: 5 });
      assert.deepEqual(
        hits.map((entry) => entry.id),
        ["policy#0001"],
      );
      assert.ok(Number.isFinite(hits[0]?.score));
      assert.equal(
        (await store.lexicalQuery!({ tenantId: "foreign", resourceId: "r1", threadId: "th1", text: "approval policy", topK: 5 })).length,
        0,
      );
    } finally {
      await store.close();
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });

  it("orders cosine query results nearest-first matching brute force", async () => {
    const created = await createStore();
    if (!created) return;
    const { store, schema, pool } = created;
    try {
      const vectors = seededVectors(42, 40, 8);
      await store.upsert(
        vectors.map((embedding, index) => baseRecord({ id: `v#${String(index).padStart(4, "0")}`, embedding, sequence: index })),
      );
      const query = seededVectors(7, 1, 8)[0]!;
      const hits = await store.query({ tenantId: "t1", resourceId: "r1", threadId: "th1", embedding: query, topK: 10 });
      const expected = cosineRanking(
        query,
        vectors.map((embedding, index) => ({ id: `v#${String(index).padStart(4, "0")}`, embedding })),
        10,
      );
      assert.deepEqual(
        hits.map((hit) => hit.id),
        expected,
      );
      const first = hits[0];
      const last = hits.at(-1);
      assert.ok(first && last && first.score > last.score);
    } finally {
      await store.close();
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });

  it("round-trips embedderId and shares statement builders with createPostgresMemoryStores", async () => {
    const created = await createStore();
    if (!created) return;
    const { store, schema, pool } = created;
    try {
      const scope = { tenantId: "t1", resourceId: "r1", threadId: "th1" };
      await store.transaction(async (tx) => {
        await tx.upsert([
          baseRecord({ id: "emb#0001", embedding: [1, 0], embedderId: "nomic-embed-text-v1.5" }),
          baseRecord({ id: "emb#0002", embedding: [0, 1], embedderId: "nomic-embed-text-v1.5" }),
        ]);
      });
      const stored = await store.getByThread(scope);
      assert.equal(stored[0]?.embedderId, "nomic-embed-text-v1.5");

      // Same bundle store gains transaction/getBySource too (backwards-compatible widening).
      const bundle = await createPostgresMemoryStores({ pool, schema, dimensions: 2 });
      await assert.rejects(
        bundle.vectorStore.transaction(async (tx) => {
          await tx.upsert([baseRecord({ id: "bad", embedding: [1, 0], embedderId: "" })]);
        }),
        MemoryValidationError,
      );
      assert.equal(typeof bundle.vectorStore.getBySource, "function");
      await bundle.close();
    } finally {
      await store.close();
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });

  it("persists and clamps importance on durable rows", async () => {
    const created = await createStore(2);
    if (!created) return;
    const { store, schema, pool } = created;
    const scope = { tenantId: "t1", resourceId: "r1", threadId: "th1" };
    try {
      await store.upsert([
        baseRecord({ id: "imp-hi", embedding: [1, 0], importance: 0.25 }),
        baseRecord({ id: "imp-clamp", embedding: [1, 0], importance: 9 }),
        baseRecord({ id: "imp-absent", embedding: [1, 0] }),
      ]);
      const rows = await store.getByThread(scope);
      assert.equal(rows.find((row) => row.id === "imp-hi")?.importance, 0.25);
      assert.equal(rows.find((row) => row.id === "imp-clamp")?.importance, 1);
      assert.ok(!("importance" in rows.find((row) => row.id === "imp-absent")!));
      await assert.rejects(store.upsert([baseRecord({ id: "imp-bad", embedding: [1, 0], importance: Number.NaN })]), MemoryValidationError);
    } finally {
      await store.close();
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });

  it("composite recall order matches the memory adapter through pgvector", async () => {
    const created = await createStore(2);
    if (!created) return;
    const { store, schema, pool } = created;
    try {
      const embedder = {
        id: "stub",
        dimensions: 2,
        async embed(texts: readonly string[]) {
          return texts.map(() => [1, 0]);
        },
      } as const;
      const memory = createMemory({ tenantId: "t1", resourceId: "r1", threadId: "th1", embedder, vectorStore: store });
      const now = Date.now();
      await memory.remember(
        {
          entries: [
            { id: "stale", text: "stale fact", sequence: 1, createdAt: new Date(now - 10_000_000).toISOString() },
            { id: "fresh", text: "fresh fact", sequence: 2, createdAt: new Date(now).toISOString() },
          ],
        },
        { wait: true },
      );
      const plain = await memory.recall("fact", { topK: 5 });
      assert.deepEqual(
        plain.hits.map((hit) => hit.id),
        ["stale", "fresh"],
      ); // same as the in-memory adapter
      const blended = await memory.recall("fact", { topK: 5, scoring: { recencyWeight: 0.4, halfLifeMs: 1_000 } });
      assert.deepEqual(
        blended.hits.map((hit) => hit.id),
        ["fresh", "stale"],
      ); // same flip as the in-memory adapter
    } finally {
      await store.close();
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });
});
