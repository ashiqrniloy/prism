import assert from "node:assert/strict";
import { test } from "bun:test";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { createSqliteMemoryStores } from "@arnilo/prism-memory-core/sqlite";
import { createMemory } from "../../index.js";

for (const adapter of ["memory", "sqlite"] as const) {
  test(`${adapter}: recall never touches; touch changes only access time in one batch`, async () => {
    const sqlite = adapter === "sqlite" ? await createSqliteMemoryStores({ path: ":memory:" }) : undefined;
    const store = sqlite?.vectorStore ?? createMemoryVectorStore();
    const scope = { tenantId: "t", resourceId: "r", threadId: "c" };
    let batches = 0;
    const memory = createMemory({
      ...scope,
      embedder: createHashEmbedder({ dimensions: 4 }),
      vectorStore: {
        ...store,
        async upsert(records, options) {
          batches++;
          await store.upsert(records, options);
        },
      },
    });
    try {
      await memory.remember(
        {
          entries: [
            { id: "a", text: "alpha", importance: 0.8 },
            { id: "b", text: "beta" },
          ],
        },
        { wait: true },
      );
      await memory.setConsent("a", { visible: true });
      const before = await store.getByThread!(scope);
      batches = 0;
      await memory.recall("alpha", { scoring: { recencyWeight: 1, halfLifeMs: 1000 } });
      assert.equal(batches, 0);
      assert.deepEqual(await store.getByThread!(scope), before);
      await memory.touch(["a", "b", "a", "missing"]);
      assert.equal(batches, 1);
      const after = await store.getByThread!(scope);
      assert.ok(after[0]!.lastAccessedAt);
      assert.equal(after[0]!.lastAccessedAt, after[1]!.lastAccessedAt);
      assert.deepEqual(
        after.map(({ lastAccessedAt, ...record }) => record),
        before,
      );
      await memory.touch([]);
      assert.equal(batches, 1);
      await memory.setConsent("a", { visible: false });
      const revoked = await store.getByThread!(scope);
      batches = 0;
      await memory.touch(["a"]);
      assert.equal(batches, 0);
      assert.deepEqual(await store.getByThread!(scope), revoked);
      await assert.rejects(memory.touch([""]), /entryId/);
      await assert.rejects(memory.touch(["a"], { signal: AbortSignal.abort() }));
    } finally {
      sqlite?.close();
    }
  });
}
