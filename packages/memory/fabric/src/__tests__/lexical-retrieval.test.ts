import { afterAll as after, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import type { ContextDraft, HookContext, JsonObject, ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { createMemoryVectorStore, type Embedder, MemoryValidationError, type VectorStore } from "@arnilo/prism-memory-core";
import { createFabricContext } from "../context.js";
import { createMemory, createMemoryFabric, createMemoryWorkingStore } from "../index.js";

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
    const anchor = await lexical.remember({ kind: "file", path: "notes/a.md", content: "alpha beta gamma delta" });
    const unrelated = await lexical.remember({ kind: "file", path: "notes/a.md", content: "zulu yankee xray whiskey" });
    assert.notEqual(unrelated.id, anchor.id, "Dice 0 is below the 0.9 lexical threshold, so the path is not refreshed in place");

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
    const hybridAnchor = await hybrid.remember({ kind: "file", path: "notes/a.md", content: "alpha beta gamma delta" });
    const hybridUnrelated = await hybrid.remember({ kind: "file", path: "notes/a.md", content: "zulu yankee xray whiskey" });
    assert.equal(hybridUnrelated.id, hybridAnchor.id, "cosine 1 clears the hybrid threshold, so the path is refreshed in place");
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

  it("memory_recall_empty_and_weak_results_abstain", async () => {
    const memory = lexicalMemory();
    const fabric = createMemoryFabric({ memory, consolidate: false });
    await fabric.remember({ kind: "fact", content: "canary rollout protects deploys" });
    const recall = fabric.tools().find((definition) => definition.name === "memory.recall")!;
    const empty = (await recall.execute({ query: "kubernetes helm" } as JsonObject, toolContext)) as ToolResult;
    assert.match(okText(empty), /^no matching memory/);
    assert.deepEqual((empty.value as { unmatchedTerms: string[] }).unmatchedTerms, ["kubernete", "helm"]);
    const weak = (await recall.execute({ query: "canary billing auth" } as JsonObject, toolContext)) as ToolResult;
    assert.equal((weak.value as { hits: unknown[] }).hits.length, 0, "a weak-only result is an abstention, not a guess");
    assert.match(okText(weak), /^no matching memory for: canary billing auth; scopes: project$/);
    assert.deepEqual((weak.value as { unmatchedTerms: string[] }).unmatchedTerms, ["canary", "bill", "auth"]);
  });

  it("recall_summary_counts_sessions_and_pages", async () => {
    const memory = lexicalMemory();
    const fabric = createMemoryFabric({ memory, consolidate: false });
    for (let index = 0; index < 7; index += 1) {
      await fabric.remember({
        kind: "fact",
        content: `needle item ${index}`,
        session: `s${index % 3}`,
        tRef: `2026-01-0${index + 1}T00:00:00.000Z`,
      });
    }
    const recall = fabric.tools().find((definition) => definition.name === "memory.recall")!;
    assert.match(recall.description ?? "", /list the instances and their ids before counting or totalling/);
    const first = (await recall.execute({ query: "needle", topK: 2 } as JsonObject, toolContext)) as ToolResult;
    const firstText = okText(first);
    assert.match(
      firstText,
      /^7 matches in 3 sessions \(2026-01-01…2026-01-07\); showing 2; 5 more not shown; page with \{ query: "needle", page: 1 \}\./,
    );
    assert.match(firstText, /Sessions: s0×3 \(2026-01-01…2026-01-07\), s1×2 \(2026-01-02…2026-01-05\), s2×2 \(2026-01-03…2026-01-06\)\./);
    const firstIds = (first.value as { hits: Array<{ id: string }> }).hits.map((hit) => hit.id);
    assert.equal(firstIds.length, 2);
    const second = (await recall.execute({ query: "needle", topK: 2, page: 1 } as JsonObject, toolContext)) as ToolResult;
    assert.match(okText(second), /showing 2; 5 more not shown; page with \{ query: "needle", page: 2 \}\./);
    const secondIds = (second.value as { hits: Array<{ id: string }> }).hits.map((hit) => hit.id);
    assert.equal(secondIds.length, 2);
    assert.deepEqual(
      firstIds.filter((id) => secondIds.includes(id)),
      [],
    );
    await assert.rejects(
      async () => recall.execute({ query: "needle", topK: 2, page: 16 } as JsonObject, toolContext),
      /outside the 32-hit recall window/,
    );
  });

  it("summary_fits_rendered_token_budget", async () => {
    const memory = lexicalMemory();
    const fabric = createMemoryFabric({ memory, consolidate: false });
    for (let index = 0; index < 12; index += 1) {
      await fabric.remember({ kind: "fact", content: `needle ${index} ${"filler ".repeat(120)}`, session: `s${index % 4}` });
    }
    const recall = fabric.tools().find((definition) => definition.name === "memory.recall")!;
    const result = (await recall.execute({ query: "needle", topK: 12, budget: 1200 } as JsonObject, toolContext)) as ToolResult;
    const value = result.value as { summary?: string; hits: unknown[] };
    assert.ok(value.summary, "the summary is present");
    assert.ok(Math.ceil(value.summary!.length / 4) <= 200, "the summary stays within 200 rendered tokens");
    const rendered = okText(result)
      .split("\n")
      .filter((line) => line.includes("matched=["))
      .reduce((sum, line) => sum + Math.ceil(line.length / 4), 0);
    assert.ok(rendered + Math.ceil(value.summary!.length / 4) <= 1200, "summary and snippets share the recall budget");
  });

  it("empty_recall_reports_terms_and_scopes", async () => {
    const memory = lexicalMemory();
    const fabric = createMemoryFabric({
      memory,
      scopes: [
        { level: "project", memory },
        { level: "user", memory },
      ],
      consolidate: false,
    });
    const recall = fabric.tools().find((definition) => definition.name === "memory.recall")!;
    const output = okText((await recall.execute({ query: "kubernetes helm" } as JsonObject, toolContext)) as ToolResult);
    assert.equal(output, "no matching memory for: kubernetes helm; scopes: project, user");
  });
});
