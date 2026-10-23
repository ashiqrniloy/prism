import { afterAll as after, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContextDraft, HookContext, JsonObject, ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { createMemoryVectorStore, type Embedder, MemoryValidationError, type VectorStore } from "@arnilo/prism-memory-core";
import { createFabricContext } from "../context.js";
import { createMemory, createMemoryFabric, createMemoryWorkingStore, createScopedMemoryPolicy } from "../index.js";

const scope = { tenantId: "t1", resourceId: "u1", threadId: "th1" };
const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

function lexicalMemory() {
  return createMemory({ ...scope, vectorStore: createMemoryVectorStore(), workingStore: createMemoryWorkingStore() });
}

const toolContext: ToolExecutionContext = { sessionId: "s1", runId: "r1", toolCallId: "c1" };
const okText = (result: ToolResult): string => {
  const block = result.content?.[0];
  assert.equal(block?.type, "text");
  return (block as { text: string }).text;
};

describe("fabric lexical retrieval", () => {
  it("create_memory_without_embedder_or_lexical_store_throws", () => {
    const { lexicalQuery: _lexicalQuery, ...rest } = createMemoryVectorStore();
    assert.throws(() => createMemory({ ...scope, vectorStore: rest as VectorStore }), MemoryValidationError);
  });

  it("lexical memory writes embedding-less records and recalls by coverage", async () => {
    const store = createMemoryVectorStore();
    const memory = createMemory({ ...scope, vectorStore: store, workingStore: createMemoryWorkingStore() });
    assert.equal(memory.retrieval, "lexical");
    const fabric = createMemoryFabric({ memory, consolidate: false });
    const note = await fabric.remember({ kind: "fact", content: "canary rollout protects deploys", keywords: ["release"] });
    const [record] = await memory.get([note.id]);
    assert.deepEqual(record?.embedding, []);
    const hit = (await fabric.recall("canary rollout", { topK: 3 })).hits[0];
    assert.equal(hit?.id, note.id);
    assert.equal(hit?.retrieval, "lexical");
    assert.equal(hit?.coverage, 1);
    assert.equal(hit?.similarity, undefined);
  });

  it("consolidation_uses_dice_in_lexical_mode_and_cosine_in_hybrid", async () => {
    const lexical = createMemoryFabric({ memory: lexicalMemory(), consolidate: { threshold: 0.9 } });
    const anchor = await lexical.remember({ kind: "fact", content: "alpha beta gamma delta" });
    const unrelated = await lexical.remember({ kind: "fact", content: "zulu yankee xray whiskey" });
    assert.equal(unrelated.links, undefined, "Dice 0 is below the 0.9 lexical threshold");
    assert.notEqual(unrelated.id, anchor.id);

    const flat: Embedder = {
      id: "flat",
      dimensions: 2,
      async embed(texts) {
        return texts.map(() => [1, 0]);
      },
    };
    const hybridMemory = createMemory({
      ...scope,
      embedder: flat,
      vectorStore: createMemoryVectorStore(),
      workingStore: createMemoryWorkingStore(),
    });
    assert.equal(hybridMemory.retrieval, "hybrid");
    const hybrid = createMemoryFabric({ memory: hybridMemory, consolidate: { threshold: 0.9 } });
    const hybridAnchor = await hybrid.remember({ kind: "fact", content: "alpha beta gamma delta" });
    const hybridUnrelated = await hybrid.remember({ kind: "fact", content: "zulu yankee xray whiskey" });
    assert.deepEqual(
      hybridUnrelated.links?.map((link) => link.id),
      [hybridAnchor.id],
      "cosine 1 clears the hybrid threshold",
    );
  });

  it("inject_floor_uses_coverage_in_lexical_mode", async () => {
    const memory = lexicalMemory();
    const fabric = createMemoryFabric({ memory, consolidate: false });
    await fabric.remember({ kind: "fact", content: "canary rollout protects deploys" });
    const user = {
      id: "u1",
      sessionId: "s1",
      timestamp: "2026-10-17T12:00:00Z",
      kind: "message" as const,
      message: { role: "user" as const, content: [{ type: "text" as const, text: "canary billing" }] },
    };
    const context = {
      runId: "",
      sessionId: "s1",
      session: { id: "s1", entries: async () => [user] },
      emit() {},
      reject() {},
    } as unknown as HookContext;
    const draft: ContextDraft = { messages: [user.message] };
    const high = await createFabricContext(memory, fabric.recall, { minSimilarity: 0.9 }).build(draft, context);
    assert.equal(JSON.stringify(high).includes("fabric-semantic"), false, "coverage 0.5 is below the 0.9 floor");
    const low = await createFabricContext(memory, fabric.recall, { minSimilarity: 0.4 }).build(draft, context);
    assert.equal(JSON.stringify(low).includes("fabric-semantic"), true, "coverage 0.5 clears the 0.4 floor");
    const blocks = low.messages.flatMap((message) => message.metadata?.contextBlocks ?? []) as Array<{
      coverageById?: Record<string, number>;
    }>;
    assert.deepEqual(
      blocks.flatMap((block) => Object.values(block.coverageById ?? {})),
      [0.5],
    );
  });

  it("multisession_query_retrieves_complementary_evidence", async () => {
    const fabric = createMemoryFabric({ memory: lexicalMemory(), consolidate: false });
    const first = await fabric.remember({ kind: "fact", content: "alpha deployment window" });
    const second = await fabric.remember({ kind: "fact", content: "beta rollback owner" });
    const hits = (await fabric.recall("alpha beta", { topK: 2 })).hits;
    assert.deepEqual(new Set(hits.map((hit) => hit.id)), new Set([first.id, second.id]));
  });

  it("temporal_query_distinguishes_current_and_historical_values", async () => {
    const fabric = createMemoryFabric({ memory: lexicalMemory(), consolidate: false });
    const old = await fabric.remember({ kind: "fact", content: "region = eu-west", tRef: "2025-01-01T00:00:00Z" });
    const current = await fabric.remember({ kind: "fact", content: "region = us-east", tRef: "2026-01-01T00:00:00Z" });
    const hits = (
      await fabric.recall("region", {
        tRef: { from: "2026-01-01T00:00:00Z", to: "2027-01-01T00:00:00Z" },
        topK: 2,
      })
    ).hits;
    assert.deepEqual(
      hits.map((hit) => hit.id),
      [current.id],
    );
    assert.ok(!hits.some((hit) => hit.id === old.id), "a historical value is not returned as current");
  });

  it("scoped_read_policy_applies_coverage_floor_to_lexical_hits", async () => {
    const scopeRoot = await mkdtemp(join(tmpdir(), "fabric-scoped-lexical-"));
    tempDirs.push(scopeRoot);
    // The vector leg misses the identifier; the lexical leg matches it with full coverage.
    const embedder: Embedder = {
      id: "orthogonal",
      dimensions: 2,
      async embed(texts) {
        return texts.map((text) => (text.includes("needle") ? [0, 1] : [1, 0]));
      },
    };
    const memory = createMemory({ tenantId: "t", resourceId: scopeRoot, threadId: "s", embedder, vectorStore: createMemoryVectorStore() });
    const fabric = createMemoryFabric({ memory, consolidate: false });
    await fabric.remember({ kind: "fact", content: "needle XQ_9917" });
    const policy = createScopedMemoryPolicy({ memory, fabric, scopeRoot, policy: { activation: { topK: 3, minSimilarity: 0.9 } } });
    const hit = await policy.recall("XQ_9917");
    assert.equal(hit.abstained, true, "an RRF-fused lexical hit below the activation floor abstains");
    assert.deepEqual(hit.hits, []);
  });
});

describe("memory.recall tool: multi-query, snippets, budget", () => {
  it("memory_recall_multi_query_fuses_and_dedupes", async () => {
    const memory = lexicalMemory();
    const fabric = createMemoryFabric({ memory, consolidate: false });
    const canary = await fabric.remember({ kind: "fact", content: "canary rollout protects deploys" });
    const billing = await fabric.remember({ kind: "fact", content: "billing uses stripe invoices" });
    const recall = fabric.tools().find((definition) => definition.name === "memory.recall")!;
    const result = (await recall.execute({ queries: ["canary rollout", "stripe"] } as JsonObject, toolContext)) as ToolResult;
    const ids = (result.value as { hits: Array<{ id: string }> }).hits.map((hit) => hit.id);
    assert.deepEqual([...ids].sort(), [billing.id, canary.id].sort());
    assert.equal(new Set(ids).size, ids.length, "one note appears once even when two queries match it");
    const both = (await recall.execute({ query: "canary", queries: ["canary", "deploys"] } as JsonObject, toolContext)) as ToolResult;
    assert.deepEqual(
      (both.value as { hits: Array<{ id: string }> }).hits.map((hit) => hit.id),
      [canary.id],
    );
    await assert.rejects(
      async () => recall.execute({ queries: ["a", "b", "c", "d", "e"] } as JsonObject, toolContext),
      MemoryValidationError,
    );
    await assert.rejects(async () => recall.execute({} as JsonObject, toolContext), MemoryValidationError);
  });

  it("memory_recall_snippet_window_paths_and_budget", async () => {
    const memory = lexicalMemory();
    const fabric = createMemoryFabric({ memory, consolidate: false });
    const prefix = "padding ".repeat(80);
    const note = await fabric.remember({
      kind: "file",
      path: "notes/canary.md",
      content: `${prefix}canary rollout protects deploys ${prefix}`,
    });
    const recall = fabric.tools({ root: process.cwd() }).find((definition) => definition.name === "memory.recall")!;
    const result = (await recall.execute({ query: "canary rollout", topK: 5, budget: 10_000 } as JsonObject, toolContext)) as ToolResult;
    const hit = (result.value as { hits: Array<{ id: string }> }).hits[0];
    assert.equal(hit?.id, note.id);
    const text = okText(result);
    assert.match(text, /path=notes\/canary\.md/);
    assert.match(text, /matched=\[canary, rollout\]/);
    assert.ok(text.includes("…"), "the snippet window elides the surrounding padding");
    assert.ok(text.length < `${prefix}canary rollout protects deploys ${prefix}`.length);

    const tight = (await recall.execute({ query: "canary rollout", topK: 5, budget: 1 } as JsonObject, toolContext)) as ToolResult;
    assert.equal((tight.value as { hits: unknown[] }).hits.length, 1, "the best hit is always returned");
  });

  it("memory_recall_weak_result_hint", async () => {
    const memory = lexicalMemory();
    const fabric = createMemoryFabric({ memory, consolidate: false });
    await fabric.remember({ kind: "fact", content: "canary rollout protects deploys" });
    const recall = fabric.tools().find((definition) => definition.name === "memory.recall")!;
    const empty = (await recall.execute({ query: "kubernetes helm" } as JsonObject, toolContext)) as ToolResult;
    assert.equal(okText(empty), "no match in any kind", "an empty default call is one stop line, not a hint");
    const weak = (await recall.execute({ query: "canary billing auth" } as JsonObject, toolContext)) as ToolResult;
    assert.equal((weak.value as { hits: unknown[] }).hits.length, 1, "a weak-but-matching hit is returned so the agent can judge it");
    assert.match(okText(weak), /try synonyms/i);
  });
});
