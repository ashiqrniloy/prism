import { it } from "bun:test";
import assert from "node:assert/strict";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { createMemory, createMemoryFabric } from "../index.js";

it("hybrid recall applies cosine floor before fusion and admits lexical-only identifiers", async () => {
  const store = createMemoryVectorStore();
  const memory = createMemory({
    tenantId: "t",
    resourceId: "r",
    threadId: "s",
    vectorStore: store,
    embedder: {
      id: "fixture",
      dimensions: 2,
      async embed(texts) {
        return texts.map((text) => (text === "the" ? [0, -1] : text === "unrelated" ? [0, 1] : [1, 0]));
      },
    },
  });
  const fabric = createMemoryFabric({ memory, consolidate: false });
  await fabric.remember({ kind: "fact", content: "unrelated" });
  const exact = await fabric.remember({ kind: "fact", content: "needle" });
  assert.deepEqual(
    (await fabric.recall("needle", { minSimilarity: 0.9 })).hits.map((hit) => hit.id),
    [exact.id],
  );
  assert.equal((await fabric.recall("the", { minSimilarity: 0.9 })).hits.length, 0);
});

it("link expansion fetches outside the batch and filters consent and validity", async () => {
  const store = createMemoryVectorStore();
  let gets = 0;
  const memory = createMemory({
    tenantId: "t",
    resourceId: "r",
    threadId: "s",
    embedder: createHashEmbedder(),
    vectorStore: {
      ...store,
      async query(query) {
        return (await store.query(query)).filter((hit) => hit.text === "seed");
      },
      async lexicalQuery(query) {
        return (await store.lexicalQuery!(query)).filter((hit) => hit.text === "seed");
      },
      async getByIds(scope, ids, options) {
        gets++;
        return store.getByIds(scope, ids, options);
      },
    },
  });
  const fabric = createMemoryFabric({ memory, consolidate: false });
  const target = await fabric.remember({ kind: "fact", content: "distant detail" });
  const seed = await fabric.remember({ kind: "fact", content: "seed", links: [{ id: target.id }] });
  assert.ok((await fabric.recall("seed", { topK: 1 })).hits.some((hit) => hit.id === target.id));
  assert.equal(gets, 1);
  await memory.setConsent(target.id, { visible: false });
  assert.deepEqual(
    (await memory.get([seed.id, target.id])).map((record) => record.id),
    [seed.id],
  );
  assert.deepEqual(
    (await fabric.recall("seed", { topK: 1 })).hits.map((hit) => hit.id),
    [seed.id],
  );
  await memory.setConsent(target.id, { visible: true });
  await memory.forget({ ids: [target.id], hold: true });
  assert.deepEqual(
    (await fabric.recall("seed", { topK: 1 })).hits.map((hit) => hit.id),
    [seed.id],
  );
  const future = await fabric.remember({ kind: "fact", content: "future", validFrom: "2099-01-01T00:00:00Z" });
  await fabric.remember({ kind: "fact", id: seed.id, content: "seed", links: [{ id: future.id }] });
  assert.deepEqual(
    (await fabric.recall("seed", { topK: 1 })).hits.map((hit) => hit.id),
    [seed.id],
  );
});

it("lexical-only exact identifiers survive vector misses; stopwords do not", async () => {
  const store = createMemoryVectorStore();
  const memory = createMemory({
    tenantId: "t",
    resourceId: "r",
    threadId: "s",
    embedder: createHashEmbedder(),
    vectorStore: {
      ...store,
      async query() {
        return [];
      },
    },
  });
  const fabric = createMemoryFabric({ memory, consolidate: false });
  const note = await fabric.remember({ kind: "fact", content: "the XQ_9917 identifier" });
  const result = await fabric.recall("XQ_9917", { minSimilarity: 0.99 });
  assert.deepEqual(
    result.hits.map((hit) => hit.id),
    [note.id],
  );
  assert.equal(result.hits[0]?.retrieval, "lexical");
  assert.equal(result.hits[0]?.similarity, undefined);
  const scored = await fabric.recall("XQ_9917", { scoring: { importanceWeight: 0.2 } });
  assert.equal(scored.hits[0]?.retrieval, "lexical");
  assert.equal(scored.hits[0]?.similarity, undefined);
  assert.equal((await fabric.recall("the")).hits.length, 0);
});

it("augmented keys preserve stored text through correction and rebuild", async () => {
  const texts: string[] = [];
  const base = createHashEmbedder();
  const memory = createMemory({
    tenantId: "t",
    resourceId: "r",
    threadId: "s",
    embedder: {
      ...base,
      async embed(input, options) {
        texts.push(...input);
        return base.embed(input, options);
      },
    },
  });
  const fabric = createMemoryFabric({ memory, consolidate: false });
  const note = await fabric.remember({ kind: "fact", content: "body", keywords: ["key"], tags: ["tag"], context: "context" });
  assert.equal(texts.at(-1), "body\nkey\ntag\ncontext");
  assert.equal((await memory.get([note.id]))[0]?.text, "body");
  await memory.correct(note.id, "corrected");
  assert.equal(texts.at(-1), "corrected\nkey\ntag\ncontext");
  await memory.rebuildIndex();
  assert.equal(texts.at(-1), "corrected\nkey\ntag\ncontext");
});
