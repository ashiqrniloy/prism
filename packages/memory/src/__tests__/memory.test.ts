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
  resolveRecallScoring,
  runMemoryConformance,
  validateAgainstJsonSchema,
  validateIdentifier,
} from "../index.js";
import type { MemoryVectorRecord } from "../types.js";

describe("@arnilo/prism-memory", () => {
  it("returns tokenized-overlap fts hits scoped to the thread", async () => {
    const store = createMemoryVectorStore();
    const record = (overrides: Partial<MemoryVectorRecord> & Pick<MemoryVectorRecord, "id">): MemoryVectorRecord => ({
      tenantId: "t1",
      resourceId: "r1",
      threadId: "th1",
      text: "",
      embedding: [1, 0],
      sequence: 0,
      embedderId: "m",
      metadata: {},
      createdAt: new Date(0).toISOString(),
      ...overrides,
    });
    await store.upsert([
      record({ id: "a", text: "approval policy requires current authorization", sequence: 1 }),
      record({ id: "b", text: "cooking pasta gets approval rating", sequence: 2 }),
      record({ id: "c", text: "approval policy draft", sequence: 3, tenantId: "other" }),
    ]);
    const hits = await store.lexicalQuery!({ tenantId: "t1", resourceId: "r1", threadId: "th1", text: "approval policy", topK: 5 });
    assert.deepEqual(
      hits.map((entry) => entry.id),
      ["a", "b"],
    );
    assert.equal(hits[0]?.score, 1); // both query terms matched
    assert.ok(hits[1] && hits[1].score < 1);
    assert.equal(
      (await store.lexicalQuery!({ tenantId: "t1", resourceId: "r1", threadId: "th1", text: "approval policy", topK: 1 })).length,
      1,
    );
    assert.equal((await store.lexicalQuery!({ tenantId: "t1", resourceId: "r1", threadId: "th1", text: "zzz qqq", topK: 5 })).length, 0);
    assert.equal(
      (await store.lexicalQuery!({ tenantId: "other", resourceId: "r1", threadId: "th1", text: "approval policy", topK: 5 }))[0]?.id,
      "c",
    );
  });

  it("hash embedder carries a stable test id and records validate embedderId", async () => {
    const embedder = createHashEmbedder();
    assert.equal(embedder.id, "prism-hash-embedder");
    assert.equal(createHashEmbedder({ id: "custom-id" }).id, "custom-id");

    const store = createMemoryVectorStore();
    const scope = { tenantId: "t", resourceId: "r", threadId: "th" };
    const base = {
      tenantId: scope.tenantId,
      resourceId: scope.resourceId,
      threadId: scope.threadId,
      text: "x",
      embedding: [1, 0],
      sequence: 0,
      metadata: {},
      createdAt: new Date(0).toISOString(),
    };
    await store.upsert([{ ...base, id: "a", embedderId: "m1" }]);
    assert.equal((await store.getByThread(scope))[0]?.embedderId, "m1");
    await assert.rejects(store.upsert([{ ...base, id: "b", embedderId: "" }]), MemoryValidationError);
    await assert.rejects(store.upsert([{ ...base, id: "c", embedderId: "x".repeat(257) }]), MemoryValidationError);
  });

  it("generation visibility: current generation only, legacy rows stay, explicit pointer enables rollback", async () => {
    const store = createMemoryVectorStore();
    const scope = { tenantId: "t", resourceId: "r", threadId: "gen" };
    const record = (id: string, text: string, generation?: bigint | number): MemoryVectorRecord => ({
      tenantId: scope.tenantId,
      resourceId: scope.resourceId,
      threadId: scope.threadId,
      id,
      text,
      embedding: [1, 0],
      sequence: 0,
      metadata: {},
      createdAt: new Date(0).toISOString(),
      ...(generation === undefined ? {} : { generation }),
    });

    // No generations at all: everything visible.
    await store.upsert([record("legacy-1", "legacy one")]);
    assert.equal((await store.query({ ...scope, embedding: [1, 0], topK: 10 })).length, 1);
    assert.equal(await store.getCurrentGeneration?.(scope), undefined);

    // Generation 1 lands; legacy row stays retrievable.
    await store.upsert([record("g1-a", "gen one a", 1)]);
    await store.upsert([record("legacy-2", "legacy two")]);
    let ids = (await store.query({ ...scope, embedding: [1, 0], topK: 10 })).map((hit) => hit.id).sort();
    assert.deepEqual(ids, ["g1-a", "legacy-1", "legacy-2"]);
    assert.equal(await store.getCurrentGeneration?.(scope), 1); // derived from max present

    // Generation 2 swap: gen-1 rows vanish from retrieval but remain via getBySource.
    await store.upsert([record("g2-a", "gen two a", 2), record("g2-b", "gen two b", 2n)]);
    ids = (await store.query({ ...scope, embedding: [1, 0], topK: 10 })).map((hit) => hit.id).sort();
    assert.deepEqual(ids, ["g2-a", "g2-b", "legacy-1", "legacy-2"]);
    assert.equal(await store.getCurrentGeneration?.(scope), 2);

    // Explicit pointer rollback: back to generation 1 without touching rows.
    await store.setCurrentGeneration?.(scope, 1);
    ids = (await store.query({ ...scope, embedding: [1, 0], topK: 10 })).map((hit) => hit.id).sort();
    assert.deepEqual(ids, ["g1-a", "legacy-1", "legacy-2"]);
    assert.equal(await store.getCurrentGeneration?.(scope), 1);

    // Validation: integer only.
    await assert.rejects(store.upsert([record("bad", "x", 1.5)]), MemoryValidationError);
    await assert.rejects(store.upsert([record("bad", "x", -1)]), MemoryValidationError);
    await assert.rejects(store.setCurrentGeneration!(scope, -3), MemoryValidationError);

    // Transactional pointer writes roll back with the records.
    await assert.rejects(
      store.transaction(async (tx) => {
        await tx.setCurrentGeneration!(scope, 9);
        throw new Error("abort");
      }),
      /abort/,
    );
    assert.equal(await store.getCurrentGeneration?.(scope), 1);

    // Scope isolation: another scope is unaffected by this scope's pointer.
    const other = { tenantId: "t", resourceId: "r", threadId: "other-gen" };
    await store.upsert([{ ...record("o1", "other", 5), threadId: other.threadId }]);
    assert.equal(await store.getCurrentGeneration?.(other), 5);
  });

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
        id: "test-nan",
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
      id: "test-rebuild",
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

  /** Stub embedder + store so similarity is fixed at 1 and ordering hinges on recency/importance alone. */
  function flatEmbedder() {
    return {
      id: "stub",
      dimensions: 2,
      async embed(texts: readonly string[]) {
        return texts.map(() => [1, 0]);
      },
    } as const;
  }

  function scoredVectorRecord(overrides: Partial<MemoryVectorRecord> & Pick<MemoryVectorRecord, "id" | "threadId">): MemoryVectorRecord {
    return {
      tenantId: "t1",
      resourceId: "u1",
      text: `text ${overrides.id}`,
      embedding: [1, 0],
      sequence: 1,
      createdAt: new Date(0).toISOString(),
      ...overrides,
    };
  }

  it("keeps default ordering and hit shape when scoring is disabled", async () => {
    const memory = createMemory({
      tenantId: "t1",
      resourceId: "u1",
      threadId: "th-score-off",
      embedder: flatEmbedder(),
    });
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
    ); // tie-break: sequence asc, as before
    assert.ok(plain.hits.every((hit) => !("similarity" in hit) && !("recency" in hit)));
  });

  it("demotes stale-but-similar facts under recency blending and exposes components", async () => {
    const vectorStore = createMemoryVectorStore();
    const now = Date.now();
    await vectorStore.upsert([
      scoredVectorRecord({ id: "stale", threadId: "th-recency", sequence: 1, createdAt: new Date(now - 10_000_000).toISOString() }),
      scoredVectorRecord({ id: "fresh", threadId: "th-recency", sequence: 2, createdAt: new Date(now + 1_000).toISOString() }), // future-dated: recall cannot age it, recency stays exactly 1
    ]);
    const memory = createMemory({
      tenantId: "t1",
      resourceId: "u1",
      threadId: "th-recency",
      embedder: flatEmbedder(),
      vectorStore,
    });
    const blended = await memory.recall("text", { topK: 5, scoring: { recencyWeight: 0.4, halfLifeMs: 1_000 } });
    assert.deepEqual(
      blended.hits.map((hit) => hit.id),
      ["fresh", "stale"],
    );
    const fresh = blended.hits[0]!;
    const stale = blended.hits[1]!;
    assert.equal(fresh.similarity, 1);
    assert.equal(fresh.recency, 1);
    assert.equal(fresh.importance, 1); // neutral for records without stored importance
    assert.ok(Math.abs(fresh.score - 1) < 1e-9);
    assert.ok(stale.score < fresh.score);
  });

  it("orders by clamped stored importance under importance blending", async () => {
    const vectorStore = createMemoryVectorStore();
    const now = new Date().toISOString();
    await vectorStore.upsert([
      scoredVectorRecord({ id: "cold", threadId: "th-importance", sequence: 1, createdAt: now, importance: 0 }),
      scoredVectorRecord({ id: "hot", threadId: "th-importance", sequence: 2, createdAt: now, importance: 2 }), // clamps to 1 at write
    ]);
    const memory = createMemory({
      tenantId: "t1",
      resourceId: "u1",
      threadId: "th-importance",
      embedder: flatEmbedder(),
      vectorStore,
    });
    assert.deepEqual(
      (await memory.recall("text", { topK: 5 })).hits.map((hit) => hit.id),
      ["cold", "hot"],
    ); // default tie-break
    const blended = await memory.recall("text", { topK: 5, scoring: { importanceWeight: 0.5 } });
    assert.deepEqual(
      blended.hits.map((hit) => hit.id),
      ["hot", "cold"],
    );
    assert.equal(blended.hits[0]!.importance, 1);
    assert.equal(blended.hits[1]!.importance, 0);
  });

  it("validates scoring weights and sum-normalizes via the resolver", async () => {
    assert.equal(resolveRecallScoring(undefined), undefined);
    assert.equal(resolveRecallScoring({}), undefined);
    assert.deepEqual(resolveRecallScoring({ recencyWeight: 0.3, importanceWeight: 0.2, halfLifeMs: 1_000 }), {
      similarity: 0.5,
      recency: 0.3,
      importance: 0.2,
      halfLifeMs: 1_000,
    });
    assert.deepEqual(resolveRecallScoring({ recencyWeight: 0.8, importanceWeight: 0.8, halfLifeMs: 1 }), {
      similarity: 0,
      recency: 0.5,
      importance: 0.5,
      halfLifeMs: 1,
    });
    assert.throws(() => resolveRecallScoring({ recencyWeight: Number.NaN, halfLifeMs: 1 }), MemoryValidationError);
    assert.throws(() => resolveRecallScoring({ recencyWeight: 1.5, halfLifeMs: 1 }), MemoryValidationError);
    assert.throws(() => resolveRecallScoring({ importanceWeight: -0.1 }), MemoryValidationError);
    assert.throws(() => resolveRecallScoring({ recencyWeight: 0.5 }), MemoryValidationError); // halfLifeMs required
    assert.throws(() => resolveRecallScoring({ recencyWeight: 0.5, halfLifeMs: 0 }), MemoryValidationError);

    const memory = createMemory({ tenantId: "t1", resourceId: "u1", threadId: "th-score-bad", embedder: flatEmbedder() });
    await assert.rejects(memory.recall("x", { scoring: { recencyWeight: 2, halfLifeMs: 1 } }), MemoryValidationError);
  });

  it("validates and clamps stored importance at the memory store boundary", async () => {
    const store = createMemoryVectorStore();
    await store.upsert([
      scoredVectorRecord({ id: "hi", threadId: "th-imp-store", importance: 3 }),
      scoredVectorRecord({ id: "lo", threadId: "th-imp-store", importance: -5 }),
      scoredVectorRecord({ id: "absent", threadId: "th-imp-store" }),
    ]);
    const rows = await store.getByThread({ tenantId: "t1", resourceId: "u1", threadId: "th-imp-store" });
    assert.equal(rows.find((row) => row.id === "hi")?.importance, 1);
    assert.equal(rows.find((row) => row.id === "lo")?.importance, 0);
    assert.ok(!("importance" in rows.find((row) => row.id === "absent")!));
    await assert.rejects(
      store.upsert([scoredVectorRecord({ id: "bad", threadId: "th-imp-store", importance: Number.NaN })]),
      MemoryValidationError,
    );
    await assert.rejects(
      store.upsert([scoredVectorRecord({ id: "bad2", threadId: "th-imp-store", importance: "3" as unknown as number })]),
      MemoryValidationError,
    );
  });

  it("derives importance from reflection payloads at write time only", async () => {
    const hookCalls: unknown[] = [];
    const memory = createMemory({
      tenantId: "t1",
      resourceId: "u1",
      threadId: "th-derive",
      embedder: flatEmbedder(),
      // Recipe example (documented, not shipped default): frequency of mentions, no LLM.
      importanceFrom: (reflection) => {
        hookCalls.push(reflection);
        const mentions = Number(reflection.mentions ?? 1);
        return Number.isFinite(mentions) ? mentions / 10 : 1;
      },
      vectorStore: createMemoryVectorStore(),
    });
    await memory.remember(
      {
        entries: [
          {
            id: "hot",
            text: "frequent reflection",
            sequence: 1,
            reflection: { content: "user workflow", mentions: 7 },
          },
        ],
      },
      { wait: true },
    );
    assert.equal(hookCalls.length, 1); // write path only
    const recalled = await memory.recall("reflection", { topK: 5, scoring: { importanceWeight: 0.5 } });
    assert.equal(recalled.hits[0]!.id, "hot");
    assert.equal(recalled.hits[0]!.importance, 0.7); // clamped/normalized host heuristic result
    // Recall path never calls out.
    await memory.recall("reflection", { topK: 5, scoring: { importanceWeight: 0.5 } });
    assert.equal(hookCalls.length, 1);
  });

  it("falls back to neutral importance without a hook and honors explicit entry importance", async () => {
    const memory = createMemory({ tenantId: "t1", resourceId: "u1", threadId: "th-neutral", embedder: flatEmbedder() });
    await memory.remember(
      {
        entries: [
          { id: "plain", text: "plain note", sequence: 1 },
          { id: "orphan", text: "reflection without hook", sequence: 2, reflection: { content: "x", mentions: 9 } },
        ],
      },
      { wait: true },
    );
    const recalled = await memory.recall("note", { topK: 5, scoring: { importanceWeight: 0.5 } });
    for (const hit of recalled.hits) {
      assert.equal(hit.importance, 1); // absent hook / absent reflection → neutral at scoring
    }
  });

  it("clamps hook output and explicit entry importance at write", async () => {
    const memory = createMemory({
      tenantId: "t1",
      resourceId: "u1",
      threadId: "th-clamp",
      embedder: flatEmbedder(),
      importanceFrom: () => 5, // clamped to 1
    });
    await memory.remember(
      {
        entries: [
          { id: "hooked", text: "hooked clamp", sequence: 1, reflection: { content: "x" } },
          { id: "explicit-high", text: "explicit high", sequence: 2, importance: 4 },
          { id: "explicit-low", text: "explicit low", sequence: 3, importance: -0.2 },
          { id: "override", text: "both sources", sequence: 4, reflection: { mentions: 5 }, importance: 0.4 },
        ],
      },
      { wait: true },
    );
    const recalled = await memory.recall("clamp", { topK: 5, scoring: { importanceWeight: 0.5 } });
    const byId = new Map(recalled.hits.map((hit) => [hit.id, hit]));
    assert.equal(byId.get("hooked")!.importance, 1);
    assert.equal(byId.get("explicit-high")!.importance, 1);
    assert.equal(byId.get("explicit-low")!.importance, 0);
    assert.equal(byId.get("override")!.importance, 0.4); // explicit entry.importance wins over the hook
    await assert.rejects(
      memory.remember({ entries: [{ id: "bad", text: "bad", importance: "3" as unknown as number }] }, { wait: true }),
      MemoryValidationError,
    );
  });

  it("passes redacted reflections to the importance hook", async () => {
    const canary = "HOOK_CANARY_44c1";
    const seen: unknown[] = [];
    const memory = createMemory({
      tenantId: "t1",
      resourceId: "u1",
      threadId: "th-redact-hook",
      embedder: flatEmbedder(),
      secrets: [canary],
      redactor: createSecretRedactor([canary]),
      importanceFrom: (reflection) => {
        seen.push(reflection);
        return 0.5;
      },
    });
    await memory.remember(
      { entries: [{ id: "red", text: `note ${canary}`, sequence: 1, reflection: { content: `secret ${canary}` } }] },
      { wait: true },
    );
    assert.equal(seen.length, 1);
    assert.equal(JSON.stringify(seen[0]).includes(canary), false);
  });

  it("cuts the oversized re-rank candidate batch back to topK", async () => {
    const vectorStore = createMemoryVectorStore();
    const now = new Date().toISOString();
    await vectorStore.upsert(
      Array.from({ length: 8 }, (_, index) =>
        scoredVectorRecord({ id: `r${index}`, threadId: "th-oversample", sequence: index + 1, createdAt: now }),
      ),
    );
    const memory = createMemory({
      tenantId: "t1",
      resourceId: "u1",
      threadId: "th-oversample",
      embedder: flatEmbedder(),
      vectorStore,
    });
    const blended = await memory.recall("text", { topK: 3, scoring: { recencyWeight: 0.2, halfLifeMs: 1_000 } });
    assert.equal(blended.hits.length, 3);
    assert.ok(blended.hits.every((hit) => hit.id.startsWith("r")));
  });
});
