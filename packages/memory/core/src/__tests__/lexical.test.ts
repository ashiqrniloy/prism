import { expect, test } from "bun:test";
import { createMemoryVectorStore, lexicalCoverage, lexicalDice, lexicalKeys, lexicalTerms, stemLexical } from "../index.js";

test("lexical_terms_stem_and_drop_stopwords", () => {
  expect([...lexicalTerms("Running the deploys and the Classes, quickly")]).toEqual(["run", "deploy", "class", "quick"]);
  expect(stemLexical("stopped")).toBe("stop");
  expect(stemLexical("installed")).toBe("install");
  expect(stemLexical("status")).toBe("status");
  expect(stemLexical("stories")).toBe("story");
  expect([...lexicalTerms("Café 2026 a I")]).toEqual(["café", "2026"]);
});

test("lexical_coverage_and_dice_bounds", () => {
  const query = lexicalTerms("deploy staging server");
  expect(lexicalCoverage(query, lexicalTerms("we deployed the staging box"))).toBeCloseTo(2 / 3);
  expect(lexicalCoverage(new Set(), lexicalTerms("anything"))).toBe(0);
  expect(lexicalDice(lexicalTerms("red apple pie"), lexicalTerms("red apple pie"))).toBe(1);
  expect(lexicalDice(new Set(), new Set())).toBe(0);
  expect(lexicalDice(lexicalTerms("red apple"), lexicalTerms("blue sky"))).toBe(0);
});

test("lexical_keys_read_fabric_keywords_tags_context_path", () => {
  const metadata = { fabric: { v: 1, kind: "fact", keywords: ["k8s"], tags: ["infra"], context: "ops", path: "notes/a.md", ignored: 3 } };
  expect(lexicalKeys({ metadata })).toBe("k8s\ninfra\nops\nnotes/a.md");
  expect(lexicalKeys({})).toBe("");
});

test("stores_accept_embeddingless_records_and_empty_vector_query_returns_nothing", async () => {
  const store = createMemoryVectorStore();
  const scope = { tenantId: "t", resourceId: "r", threadId: "a" };
  await store.upsert([{ ...scope, id: "n1", text: "Deployed the staging servers", embedding: [], sequence: 1, createdAt: "2026-10-19T00:00:00Z" }]);
  expect(await store.query({ ...scope, embedding: [], topK: 5 })).toEqual([]);
  const hits = await store.lexicalQuery!({ ...scope, text: "deploy server", topK: 5 });
  expect(hits.map((hit) => [hit.id, hit.coverage])).toEqual([["n1", 1]]);
  await expect(
    store.upsert([{ ...scope, id: "n2", text: "x", embedding: [], embedderId: "e", sequence: 2, createdAt: "2026-10-19T00:00:00Z" }]),
  ).rejects.toThrow("embedderId");
});
