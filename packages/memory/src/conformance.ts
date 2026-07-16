import assert from "node:assert/strict";
import type { Embedder, VectorStore, WorkingMemoryStore } from "./types.js";
import { createMemory } from "./memory.js";
import { MemoryConflictError, MemoryScopeError, MemoryValidationError } from "./errors.js";

export interface MemoryConformanceStores {
  readonly embedder: Embedder;
  readonly vectorStore: VectorStore;
  readonly workingStore: WorkingMemoryStore;
}

/**
 * Shared network-free conformance for Embedder + VectorStore + WorkingMemoryStore trios.
 */
export async function runMemoryConformance(
  createStores: () => Promise<MemoryConformanceStores> | MemoryConformanceStores,
): Promise<void> {
  const stores = await createStores();
  const memory = createMemory({
    tenantId: "tenant-a",
    resourceId: "resource-a",
    threadId: "thread-a",
    embedder: stores.embedder,
    vectorStore: stores.vectorStore,
    workingStore: stores.workingStore,
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        preferences: {
          type: "object",
          properties: { format: { type: "string" } },
          required: ["format"],
          additionalProperties: false,
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  });

  await assert.rejects(
    memory.updateWorking({ preferences: { format: "concise" } }),
    MemoryValidationError,
  );

  const created = await memory.updateWorking({ name: "Ada", preferences: { format: "concise" } });
  assert.equal(created.version, 1);
  assert.equal(created.value.name, "Ada");

  const merged = await memory.updateWorking({ preferences: { format: "bullets" } }, { mode: "merge" });
  assert.equal(merged.version, 2);
  assert.equal(merged.value.name, "Ada");
  assert.deepEqual(merged.value.preferences, { format: "bullets" });

  await assert.rejects(
    memory.updateWorking({ name: "Ada", preferences: { format: "x" } }, { expectedVersion: 1 }),
    MemoryConflictError,
  );

  const replaced = await memory.updateWorking(
    { name: "Ada", preferences: { format: "short" } },
    { mode: "replace", expectedVersion: 2 },
  );
  assert.equal(replaced.version, 3);

  const otherThread = createMemory({
    tenantId: "tenant-a",
    resourceId: "resource-a",
    threadId: "thread-b",
    embedder: stores.embedder,
    vectorStore: stores.vectorStore,
    workingStore: stores.workingStore,
  });
  assert.equal(await otherThread.getWorking(), undefined);

  await memory.remember(
    {
      entries: [
        { id: "1", text: "preferred response format is concise bullet points", sequence: 1 },
        { id: "2", text: "User lives in Lisbon and likes coffee", sequence: 2 },
        { id: "3", text: "Deployment window is Tuesday evenings", sequence: 3 },
      ],
    },
    { wait: true },
  );

  const recalled = await memory.recall("preferred response format is concise bullet points", { topK: 2, messageRange: 1 });
  assert.ok(recalled.hits.length >= 1);
  assert.equal(recalled.hits[0]!.id, "1");
  assert.ok(recalled.hits.every((hit) => hit.tenantId === "tenant-a" && hit.threadId === "thread-a"));
  assert.ok(recalled.adjacent.every((item) => item.threadId === "thread-a"));
  if (recalled.hits.length > 1) {
    assert.ok(recalled.hits[0]!.score >= recalled.hits[1]!.score);
  }

  const empty = await memory.recall("zzzz-no-match-token-xyz", { topK: 3 });
  assert.ok(Array.isArray(empty.hits));

  const foreign = createMemory({
    tenantId: "tenant-b",
    resourceId: "resource-a",
    threadId: "thread-a",
    embedder: stores.embedder,
    vectorStore: stores.vectorStore,
    workingStore: stores.workingStore,
  });
  const foreignRecall = await foreign.recall("concise answers", { topK: 5 });
  assert.equal(foreignRecall.hits.length, 0);

  const noThread = createMemory({
    tenantId: "tenant-a",
    resourceId: "resource-a",
    embedder: stores.embedder,
    vectorStore: stores.vectorStore,
    workingStore: stores.workingStore,
  });
  await assert.rejects(noThread.recall("x"), MemoryScopeError);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(memory.recall("concise", { signal: controller.signal }), /aborted/i);
}
