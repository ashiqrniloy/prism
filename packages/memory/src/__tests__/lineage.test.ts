import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectInvalidationIds,
  createHashEmbedder,
  createMemory,
  createMemoryVectorStore,
  HARD_LINEAGE_EDGES,
  LINEAGE_META_KEY,
  MemoryLimitError,
  MemoryScopeError,
  MemoryValidationError,
  recordBlocked,
  revokedIdsAbsent,
} from "../index.js";
import type { MemoryVectorRecord } from "../types.js";

const scope = { tenantId: "t1", resourceId: "r1", threadId: "th1" };

function record(overrides: Partial<MemoryVectorRecord> & Pick<MemoryVectorRecord, "id">): MemoryVectorRecord {
  return {
    tenantId: "t1",
    resourceId: "r1",
    threadId: "th1",
    text: overrides.id,
    embedding: [1, 0],
    sequence: 0,
    metadata: {},
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

describe("memory lineage", () => {
  it("forget source excludes derived recall and keeps legal hold bodies", async () => {
    const vectorStore = createMemoryVectorStore();
    const memory = createMemory({
      ...scope,
      embedder: createHashEmbedder({ dimensions: 2 }),
      vectorStore,
    });
    await memory.remember(
      {
        entries: [
          { id: "src", text: "secret salary is 9 million", lineage: { sourceIds: ["msg-1"] } },
          { id: "derived", text: "salary summary 9 million", lineage: { sourceIds: ["src"] } },
          { id: "unrelated", text: "preferred editor is vim" },
        ],
      },
      { wait: true },
    );
    const before = await memory.recall("salary", { topK: 5, explain: true });
    assert.ok(before.hits.some((hit) => hit.id === "derived"));
    assert.ok(before.explanations?.some((item) => item.id === "derived" && item.sourceIds.includes("src")));

    assert.equal(await memory.forget({ ids: ["src"] }), 2);
    const after = await memory.recall("salary", { topK: 5 });
    assert.equal(
      after.hits.some((hit) => hit.id === "src" || hit.id === "derived" || hit.text.includes("9 million")),
      false,
    );
    assert.ok((await memory.recall("vim", { topK: 5 })).hits.some((hit) => hit.id === "unrelated"));

    await memory.remember({ entries: [{ id: "held", text: "held evidence body" }] }, { wait: true });
    assert.equal(await memory.forget({ ids: ["held"], hold: true }), 0);
    assert.equal(
      (await memory.recall("held evidence", { topK: 5 })).hits.some((hit) => hit.id === "held"),
      false,
    );
    assert.equal(
      (await vectorStore.getByThread(scope)).some((item) => item.id === "held"),
      true,
    );
    const exported = await memory.exportMemory({ identity: scope });
    assert.equal(
      exported.entries.some((item) => item.id === "held" || item.text.includes("9 million")),
      false,
    );
  });

  it("correct keeps source and drops dependents; consent revoke blocks recall and stays deletable", async () => {
    const memory = createMemory({
      ...scope,
      embedder: createHashEmbedder({ dimensions: 2 }),
    });
    await memory.remember(
      {
        entries: [
          { id: "fact", text: "badge color is red" },
          { id: "sum", text: "the badge is red", lineage: { sourceIds: ["fact"] } },
        ],
      },
      { wait: true },
    );
    await memory.correct("fact", "badge color is blue");
    const hits = await memory.recall("badge color", { topK: 5 });
    assert.equal(
      hits.hits.some((hit) => hit.id === "fact" && hit.text.includes("blue")),
      true,
    );
    assert.equal(
      hits.hits.some((hit) => hit.id === "sum" || hit.text.includes("red")),
      false,
    );

    await memory.setConsent("fact", { visible: false });
    assert.equal(
      (await memory.recall("badge", { topK: 5 })).hits.some((hit) => hit.id === "fact"),
      false,
    );
    // Revocation is not a legal hold: re-granting restores it, and forget still purges it.
    await memory.setConsent("fact", { visible: true });
    assert.equal(
      (await memory.recall("badge color", { topK: 5 })).hits.some((hit) => hit.id === "fact"),
      true,
    );
    // Re-granting must not clear a correction: the corrected dependents stay dropped.
    await memory.setConsent("fact", { visible: true });
    assert.equal(
      (await memory.recall("badge is red", { topK: 5 })).hits.some((hit) => hit.id === "sum"),
      false,
    );
    await memory.setConsent("fact", { visible: false });
    // Revocation is not a legal hold: transitive purge removes fact and its dependent.
    assert.equal(await memory.forget({ ids: ["fact"] }), 2);
    assert.equal(
      (await memory.recall("badge", { topK: 5 })).hits.some((hit) => hit.id === "fact" || hit.id === "sum"),
      false,
    );
  });

  it("share grants are child-scoped, expiring, and skip siblings", async () => {
    const vectorStore = createMemoryVectorStore();
    const parent = createMemory({
      ...scope,
      embedder: createHashEmbedder({ dimensions: 2 }),
      vectorStore,
    });
    const child = createMemory({
      ...scope,
      threadId: "child",
      embedder: createHashEmbedder({ dimensions: 2 }),
      vectorStore,
    });
    const sibling = createMemory({
      ...scope,
      threadId: "sibling",
      embedder: createHashEmbedder({ dimensions: 2 }),
      vectorStore,
    });
    await parent.remember(
      {
        entries: [
          { id: "shared", text: "parent only recipe" },
          { id: "secret", text: "parent secret sauce" },
        ],
      },
      { wait: true },
    );
    await parent.shareWith("child", ["shared"]);
    const allowed = await child.recall("recipe", { topK: 5, shareFromParentThreadId: "th1" });
    assert.deepEqual(
      allowed.hits.map((hit) => hit.id),
      ["shared"],
    );
    await assert.rejects(sibling.recall("recipe", { shareFromParentThreadId: "th1" }), MemoryScopeError);
    await parent.shareWith("child", ["shared"], { expiresAt: new Date(0).toISOString() });
    await assert.rejects(child.recall("recipe", { shareFromParentThreadId: "th1" }), MemoryValidationError);
    await parent.revokeShare("child");
    await assert.rejects(child.recall("recipe", { shareFromParentThreadId: "th1" }), MemoryScopeError);
  });

  it("transaction rolls back invalidation; walk caps fail closed; legacy is self-only", async () => {
    const store = createMemoryVectorStore();
    await store.upsert([record({ id: "a", sequence: 1 })]);
    await assert.rejects(
      store.transaction(async (txn) => {
        await txn.invalidate!(scope, [{ id: "a", reason: "forgotten", at: new Date(0).toISOString() }]);
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(
      (await store.query({ ...scope, embedding: [1, 0], topK: 3 })).some((hit) => hit.id === "a"),
      true,
    );

    const bush: MemoryVectorRecord[] = [record({ id: "root", sequence: 0 })];
    for (let index = 0; index < HARD_LINEAGE_EDGES; index += 1) {
      bush.push(
        record({
          id: `d${index}`,
          sequence: index + 1,
          metadata: { [LINEAGE_META_KEY]: { v: 1, sourceIds: ["root"] } },
        }),
      );
    }
    assert.throws(() => collectInvalidationIds(bush, ["root"]), MemoryLimitError);

    assert.equal(recordBlocked(record({ id: "legacy" }), new Map([["other", { id: "other", reason: "forgotten", at: "t" }]])), false);
    assert.equal(recordBlocked(record({ id: "legacy" }), new Map([["legacy", { id: "legacy", reason: "forgotten", at: "t" }]])), true);
  });

  it("onInvalidate fires before body delete", async () => {
    const seen: string[] = [];
    const memory = createMemory({
      ...scope,
      embedder: createHashEmbedder({ dimensions: 2 }),
      onInvalidate: (event) => {
        seen.push(`${event.reason}:${event.ids.join(",")}`);
      },
    });
    await memory.remember({ entries: [{ id: "x", text: "to forget" }] }, { wait: true });
    await memory.forget({ ids: ["x"] });
    assert.equal(seen[0], "forgotten:x");
    assert.equal(revokedIdsAbsent({ injectedIds: [] }, ["x"]).score, 1);
  });
});
