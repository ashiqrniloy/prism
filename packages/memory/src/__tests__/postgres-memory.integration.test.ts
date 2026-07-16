import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { Pool } from "pg";
import {
  createHashEmbedder,
  createMemory,
  createPostgresMemoryStores,
  runMemoryConformance,
} from "../index.js";

const postgresUrl = process.env.PRISM_TEST_POSTGRES_URL;
const describeIntegration = postgresUrl ? describe : describe.skip;

async function pgvectorAvailable(pool: Pool): Promise<boolean> {
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    return true;
  } catch {
    return false;
  }
}

function uniqueSchema(): string {
  return `prism_mem_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

describeIntegration("createPostgresMemoryStores integration", () => {
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

  it("passes shared memory conformance with pgvector", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    if (!(await pgvectorAvailable(pool))) {
      console.log("skip: pgvector extension unavailable");
      return;
    }
    const stores = await createPostgresMemoryStores({
      pool,
      schema,
      dimensions: 32,
    });
    try {
      await runMemoryConformance(() => ({
        embedder: createHashEmbedder({ dimensions: 32 }),
        vectorStore: stores.vectorStore,
        workingStore: stores.workingStore,
      }));
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });

  it("isolates tenants and survives reopen", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    if (!(await pgvectorAvailable(pool))) {
      console.log("skip: pgvector extension unavailable");
      return;
    }
    const first = await createPostgresMemoryStores({ pool, schema, dimensions: 32 });
    const embedder = createHashEmbedder({ dimensions: 32 });
    const memoryA = createMemory({
      tenantId: "tenant-a",
      resourceId: "user-1",
      threadId: "thread-1",
      embedder,
      vectorStore: first.vectorStore,
      workingStore: first.workingStore,
    });
    await memoryA.updateWorking({ name: "Ada" });
    await memoryA.remember(
      { entries: [{ id: "m1", text: "Prefers concise answers", sequence: 1 }] },
      { wait: true },
    );

    const reopened = await createPostgresMemoryStores({ pool, schema, dimensions: 32, skipMigrations: true });
    const memoryA2 = createMemory({
      tenantId: "tenant-a",
      resourceId: "user-1",
      threadId: "thread-1",
      embedder,
      vectorStore: reopened.vectorStore,
      workingStore: reopened.workingStore,
    });
    assert.equal((await memoryA2.getWorking())?.value.name, "Ada");
    const recalled = await memoryA2.recall("concise answers", { topK: 3 });
    assert.ok(recalled.hits.some((hit) => hit.id === "m1"));

    const memoryB = createMemory({
      tenantId: "tenant-b",
      resourceId: "user-1",
      threadId: "thread-1",
      embedder,
      vectorStore: reopened.vectorStore,
      workingStore: reopened.workingStore,
    });
    assert.equal(await memoryB.getWorking(), undefined);
    assert.equal((await memoryB.recall("concise answers", { topK: 3 })).hits.length, 0);

    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });
});
