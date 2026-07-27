import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSecretRedactor, resolveContextProviders } from "@arnilo/prism";
import { MemoryConflictError, MemoryLimitError, MemoryValidationError } from "../errors.js";
import {
  assertFiniteVector,
  createHashEmbedder,
  createMemory,
  createMemoryVectorStore,
  createMemoryWorkingStore,
  createPostgresMemoryStores,
  HARD_TOP_K_CAP,
  packageName,
  resolveMemoryLimits,
  runMemoryConformance,
  validateAgainstJsonSchema,
  validateIdentifier,
} from "../index.js";

describe("@arnilo/prism-memory", () => {
  it("exports package name and resolves default limits", () => {
    assert.equal(packageName, "@arnilo/prism-memory");
    const limits = resolveMemoryLimits();
    assert.equal(limits.topK, 5);
    assert.equal(limits.messageRange, 0);
    assert.throws(() => resolveMemoryLimits({ topK: HARD_TOP_K_CAP + 1 }), MemoryLimitError);
  });

  it("validates working-memory JSON Schema subset", () => {
    validateAgainstJsonSchema(
      { name: "Ada", preferences: { format: "concise" } },
      {
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
    );
    assert.throws(
      () => validateAgainstJsonSchema({ name: 1 }, { type: "object", properties: { name: { type: "string" } } }),
      MemoryValidationError,
    );
    assert.throws(() => validateAgainstJsonSchema({}, { $ref: "https://example.com/schema.json" } as never), /remote refs/i);
  });

  it("passes shared in-memory conformance", async () => {
    await runMemoryConformance(() => ({
      embedder: createHashEmbedder({ dimensions: 32 }),
      vectorStore: createMemoryVectorStore(),
      workingStore: createMemoryWorkingStore(),
    }));
  });

  it("rejects non-finite vectors before embedding, storage, or scoring", async () => {
    for (const vector of [[NaN], [Infinity], [-Infinity], ["x"]] as const) {
      assert.throws(() => assertFiniteVector(vector, "vector"), MemoryValidationError);
    }
    assert.throws(() => assertFiniteVector([], "vector"), MemoryValidationError);
    assert.throws(() => assertFiniteVector([1], "vector", 2), MemoryValidationError);

    const store = createMemoryVectorStore();
    const record = {
      tenantId: "t",
      resourceId: "r",
      threadId: "th",
      id: "id",
      text: "text",
      embedding: [1, 0],
      sequence: 1,
      createdAt: new Date().toISOString(),
    };
    await assert.rejects(store.upsert([{ ...record, embedding: [NaN] }]), MemoryValidationError);
    await assert.rejects(
      store.query({ tenantId: "t", resourceId: "r", threadId: "th", embedding: [Infinity], topK: 1 }),
      MemoryValidationError,
    );

    const memory = createMemory({
      tenantId: "t",
      resourceId: "r",
      threadId: "th",
      embedder: {
        dimensions: 2,
        async embed() {
          return [[1, NaN]];
        },
      },
    });
    await assert.rejects(memory.remember({ entries: [{ id: "bad", text: "bad" }] }, { wait: true }), MemoryValidationError);
  });

  it("enforces working-memory merge/replace, conflicts, and thread isolation", async () => {
    const memory = createMemory({
      tenantId: "t1",
      resourceId: "u1",
      threadId: "th1",
      embedder: createHashEmbedder(),
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          city: { type: "string" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    });

    await memory.updateWorking({ name: "Ada" });
    await memory.updateWorking({ city: "Lisbon" }, { mode: "merge" });
    assert.deepEqual((await memory.getWorking())?.value, { name: "Ada", city: "Lisbon" });

    await assert.rejects(memory.updateWorking({ name: "Ada" }, { expectedVersion: 99 }), MemoryConflictError);

    const replaced = await memory.updateWorking({ name: "Ada" }, { mode: "replace", expectedVersion: 2 });
    assert.deepEqual(replaced.value, { name: "Ada" });

    const sharedWorking = createMemoryWorkingStore();
    const sharedVectors = createMemoryVectorStore();
    const embedder = createHashEmbedder();
    const threadOne = createMemory({
      tenantId: "t1",
      resourceId: "u1",
      threadId: "th-shared-1",
      embedder,
      workingStore: sharedWorking,
      vectorStore: sharedVectors,
    });
    const threadTwo = createMemory({
      tenantId: "t1",
      resourceId: "u1",
      threadId: "th-shared-2",
      embedder,
      workingStore: sharedWorking,
      vectorStore: sharedVectors,
    });
    await threadOne.updateWorking({ name: "Ada" });
    assert.equal((await threadOne.getWorking())?.value.name, "Ada");
    assert.equal(await threadTwo.getWorking(), undefined);
  });

  it("orders semantic top-K and returns adjacent entries", async () => {
    const memory = createMemory({
      tenantId: "t1",
      resourceId: "u1",
      threadId: "th1",
      embedder: createHashEmbedder({ dimensions: 64 }),
    });

    await memory.remember(
      {
        entries: [
          { id: "a", text: "favorite color is blue", sequence: 1 },
          { id: "b", text: "prefers concise bullet answers", sequence: 2 },
          { id: "c", text: "timezone is Europe/Lisbon", sequence: 3 },
        ],
      },
      { wait: true },
    );

    const recalled = await memory.recall("concise bullet answers", { topK: 1, messageRange: 1 });
    assert.equal(recalled.hits.length, 1);
    assert.match(recalled.hits[0]!.text, /concise/i);
    assert.ok(recalled.adjacent.some((entry) => entry.id === "a" || entry.id === "c"));
  });

  it("redacts canary secrets from working and semantic memory", async () => {
    const canary = "SECRET_CANARY_VALUE_9f3a";
    const memory = createMemory({
      tenantId: "t1",
      resourceId: "u1",
      threadId: "th1",
      embedder: createHashEmbedder(),
      secrets: [canary],
      redactor: createSecretRedactor([canary]),
    });

    await memory.updateWorking({ name: `Ada ${canary}` });
    const working = await memory.getWorking();
    assert.ok(working);
    assert.equal(JSON.stringify(working.value).includes(canary), false);

    await memory.remember({ entries: [{ id: "1", text: `token ${canary} stored`, metadata: { note: canary } }] }, { wait: true });
    const recalled = await memory.recall("token stored", { topK: 3 });
    assert.ok(recalled.hits.length >= 1);
    assert.equal(JSON.stringify(recalled).includes(canary), false);
  });

  it("supports async remember by default and respects abort", async () => {
    const memory = createMemory({
      tenantId: "t1",
      resourceId: "u1",
      threadId: "th1",
      embedder: createHashEmbedder(),
    });
    const result = await memory.remember({
      entries: [{ id: "1", text: "async index me" }],
    });
    assert.equal(result.pending, true);
    await result.done;
    const recalled = await memory.recall("async index");
    assert.ok(recalled.hits.length >= 1);

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(memory.recall("x", { signal: controller.signal }), /aborted/i);
  });

  it("injects working and semantic memory through ContextProvider", async () => {
    const memory = createMemory({
      tenantId: "t1",
      resourceId: "u1",
      threadId: "th1",
      embedder: createHashEmbedder(),
      workingMemoryTemplate: "Name: {{name}}; Format: {{preferences.format}}",
    });
    await memory.updateWorking({ name: "Ada", preferences: { format: "concise" } });
    await memory.remember({ entries: [{ id: "1", text: "Prefers concise answers" }] }, { wait: true });

    const blocks = await resolveContextProviders({
      providers: [memory.createContextProvider({ includeWorking: true, includeSemantic: true })],
      messages: [{ role: "user", content: [{ type: "text", text: "What format do I prefer?" }] }],
    });
    assert.ok(blocks.some((block) => String(block.content).includes("Ada")));
    assert.ok(blocks.some((block) => String(block.content).toLowerCase().includes("concise")));
  });

  it("runs an opt-in working-memory processor from host extract callback", async () => {
    const memory = createMemory({
      tenantId: "t1",
      resourceId: "u1",
      threadId: "th1",
      embedder: createHashEmbedder(),
    });
    const processor = memory.createWorkingMemoryProcessor({
      extract: (messages) => {
        const last = messages.at(-1);
        const text =
          last && Array.isArray(last.content)
            ? last.content.map((block) => ("text" in block && typeof block.text === "string" ? block.text : "")).join("")
            : "";
        const match = /my name is ([A-Za-z]+)/i.exec(text);
        return match ? { name: match[1]! } : undefined;
      },
    });
    const updated = await processor.process([{ role: "user", content: [{ type: "text", text: "Hi, my name is Ada" }] }]);
    assert.equal(updated?.value.name, "Ada");
  });

  it("denies unsafe postgres identifiers and validates factory inputs offline", async () => {
    assert.throws(() => validateIdentifier("bad-name;", "schema"), MemoryValidationError);
    await assert.rejects(createPostgresMemoryStores({ connectionString: "" }), MemoryValidationError);
  });

  it("rejects oversized working memory and entry text", async () => {
    const memory = createMemory({
      tenantId: "t1",
      resourceId: "u1",
      threadId: "th1",
      embedder: createHashEmbedder(),
      limits: { maxWorkingMemoryBytes: 64, maxEntryTextChars: 8 },
    });
    await assert.rejects(memory.updateWorking({ name: "x".repeat(200) }), MemoryLimitError);
    await assert.rejects(memory.remember({ entries: [{ id: "1", text: "too-long-text" }] }, { wait: true }), MemoryLimitError);
  });

  it("exports only redacted, consented entries and rebuilds one resumable page", async () => {
    const canary = "MEMORY_EXPORT_SECRET";
    const base = createHashEmbedder({ dimensions: 8 });
    let rebuildCalls = 0;
    const embedder = {
      dimensions: base.dimensions,
      async embed(texts: readonly string[], options?: { readonly signal?: AbortSignal }) {
        rebuildCalls += 1;
        return base.embed(texts, options);
      },
    };
    const memory = createMemory({
      tenantId: "t1",
      resourceId: "u1",
      threadId: "th1",
      embedder,
      secrets: [canary],
      redactor: createSecretRedactor([canary]),
    });
    await memory.remember(
      {
        entries: [
          { id: "one", text: `visible ${canary}`, consent: { source: "user", scope: "thread", visible: true } },
          { id: "two", text: "hidden", consent: { visible: false } },
        ],
      },
      { wait: true },
    );
    rebuildCalls = 0;

    const exported = await memory.exportMemory({
      identity: { tenantId: "t1", resourceId: "u1", threadId: "th1" },
      limit: 1,
    });
    assert.equal(exported.entries.length, 1);
    assert.equal(exported.entries[0]?.id, "one");
    assert.equal(JSON.stringify(exported).includes(canary), false);
    await assert.rejects(memory.exportMemory({ identity: { tenantId: "other", resourceId: "u1", threadId: "th1" } }), /boundary/i);

    const first = await memory.rebuildIndex({ batchSize: 1 });
    assert.equal(first.rebuilt, 1);
    assert.ok(first.nextCursor);
    assert.equal(rebuildCalls, 1);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(memory.rebuildIndex({ cursor: first.nextCursor, signal: controller.signal }), /aborted/i);
    const second = await memory.rebuildIndex({ cursor: first.nextCursor, batchSize: 1 });
    assert.equal(second.rebuilt, 1);

    const backing = createMemoryVectorStore();
    const legacyStore = {
      upsert: backing.upsert,
      query: backing.query,
      delete: backing.delete,
      getByThread: backing.getByThread,
    };
    const noPaging = createMemory({ tenantId: "t1", resourceId: "u1", threadId: "legacy", embedder, vectorStore: legacyStore });
    await assert.rejects(noPaging.exportMemory({ identity: { tenantId: "t1", resourceId: "u1", threadId: "legacy" } }), /listByThread/i);
    await assert.rejects(noPaging.applyRetention({ maxEntries: 1 }), /countByThread/i);
  });

  it("keeps revoked/invisible memories out of prompt injection and honors strict consent", async () => {
    const memory = createMemory({
      tenantId: "t1",
      resourceId: "u1",
      threadId: "th1",
      embedder: createHashEmbedder(),
    });
    await memory.remember(
      {
        entries: [
          { id: "open", text: "favorite color is teal" },
          { id: "secret", text: "favorite color is teal", consent: { visible: false } },
        ],
      },
      { wait: true },
    );

    const blocks = await resolveContextProviders({
      providers: [memory.createContextProvider({ includeWorking: false, includeSemantic: true })],
      messages: [{ role: "user", content: [{ type: "text", text: "favorite color is teal" }] }],
    });
    const injected = blocks.map((block) => String(block.content)).join("\n");
    const recalled = await memory.recall("favorite color is teal", { topK: 8 });
    assert.ok(recalled.hits.some((hit) => hit.id === "open"));
    assert.ok(
      recalled.hits.every((hit) => hit.id !== "secret"),
      "invisible memory must not be recalled",
    );
    assert.ok(!injected.includes("secret"));

    // Re-grant makes it injectable again.
    await memory.setConsent("secret", { visible: true });
    const regranted = await memory.recall("favorite color is teal", { topK: 8 });
    assert.ok(regranted.hits.some((hit) => hit.id === "secret"));

    // Strict mode drops consent-less entries; default mode keeps them.
    const vectorStore = createMemoryVectorStore();
    await vectorStore.upsert([
      {
        tenantId: "t1",
        resourceId: "u1",
        threadId: "th-strict",
        id: "legacy",
        text: "legacy note",
        embedding: [1, 0],
        sequence: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    const strictMemory = createMemory({
      tenantId: "t1",
      resourceId: "u1",
      threadId: "th-strict",
      embedder: createHashEmbedder({ dimensions: 2 }),
      vectorStore,
      requireConsent: true,
    });
    const lenientMemory = createMemory({
      tenantId: "t1",
      resourceId: "u1",
      threadId: "th-strict",
      embedder: createHashEmbedder({ dimensions: 2 }),
      vectorStore,
    });
    assert.equal((await strictMemory.recall("legacy note", { topK: 4 })).hits.length, 0);
    assert.equal((await lenientMemory.recall("legacy note", { topK: 4 })).hits.length, 1);
  });
});
