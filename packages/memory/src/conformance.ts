import assert from "node:assert/strict";
import type { Embedder, VectorStore, WorkingMemoryStore } from "./types.js";
import { createMemory } from "./memory.js";
import { MemoryConflictError, MemoryScopeError, MemoryValidationError } from "./errors.js";

export interface MemoryConformanceStores {
  readonly embedder: Embedder;
  readonly vectorStore: VectorStore & Required<Pick<VectorStore, "listByThread" | "countByThread">>;
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

  // Consent + lifecycle: invisible entries never inject; grant/correct/forget/retention are real.
  await memory.remember(
    { entries: [{ id: "c1", text: "hidden preference do not inject", consent: { source: "user", scope: "thread", visible: false } }] },
    { wait: true },
  );
  const hidden = await memory.recall("hidden preference do not inject", { topK: 8 });
  assert.ok(hidden.hits.every((hit) => hit.id !== "c1"), "invisible memory must not inject");

  const granted = await memory.setConsent("c1", { visible: true });
  assert.equal(granted.consent?.visible, true);
  assert.ok(granted.consent?.grantedAt);
  const visible = await memory.recall("hidden preference do not inject", { topK: 8 });
  assert.ok(visible.hits.some((hit) => hit.id === "c1"), "granted memory must inject");

  const revoked = await memory.setConsent("c1", { visible: false });
  assert.equal(revoked.consent?.visible, false);
  assert.ok(revoked.consent?.revokedAt);
  const revokedRecall = await memory.recall("hidden preference do not inject", { topK: 8 });
  assert.ok(revokedRecall.hits.every((hit) => hit.id !== "c1"), "revoked memory must not inject");

  await memory.setConsent("c1", { visible: true });
  const corrected = await memory.correct("c1", "preferred snack is almonds");
  assert.match(corrected.text, /almonds/);
  assert.equal(corrected.consent?.visible, true);

  const forgotten = await memory.forget({ ids: ["c1"] });
  assert.equal(forgotten, 1);
  const afterForget = await memory.recall("almonds", { topK: 8 });
  assert.ok(afterForget.hits.every((hit) => hit.id !== "c1"), "forgotten memory must be gone");

  await memory.remember(
    {
      entries: [
        { id: "r1", text: "retention one", sequence: 101, createdAt: "2020-01-01T00:00:00.000Z" },
        { id: "r2", text: "retention two", sequence: 102, createdAt: "2020-01-02T00:00:00.000Z" },
        { id: "r3", text: "retention three", sequence: 103, createdAt: new Date().toISOString() },
      ],
    },
    { wait: true },
  );
  const swept = await memory.applyRetention({ maxAgeDays: 30, batchSize: 10 });
  assert.ok(swept.deleted >= 2, "aged entries must be real-deleted");
  const afterSweep = await memory.recall("retention", { topK: 8 });
  assert.ok(afterSweep.hits.every((hit) => hit.id !== "r1" && hit.id !== "r2"));

  const exported = await memory.exportMemory({
    identity: { tenantId: "tenant-a", resourceId: "resource-a", threadId: "thread-a" },
    limit: 1,
  });
  assert.ok(exported.entries.length <= 1);
  assert.ok(exported.entries.every((entry) => entry.consent?.visible === true));
  await assert.rejects(
    memory.exportMemory({ identity: { tenantId: "tenant-b", resourceId: "resource-a", threadId: "thread-a" } }),
    MemoryScopeError,
  );

  let cursor: string | undefined;
  let rebuilt = 0;
  do {
    const page = await memory.rebuildIndex({ cursor, batchSize: 1 });
    rebuilt += page.rebuilt;
    cursor = page.nextCursor;
  } while (cursor);
  assert.ok(rebuilt >= 1, "bounded rebuild must re-embed at least one retained entry");

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
