/**
 * Plan 089 Task 2: deployable local reranker. Proves the seam behaviour the plan
 * promises — conformance pass, one lazy memoized model load, one batched score
 * call per rerank, zero network after load, loud install guidance when no
 * runtime exists, and no silent lexical fallback.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import {
  createLocalReranker,
  createTransformersRerankRuntime,
  DEFAULT_LOCAL_RERANK_MODEL,
  type LocalRerankModel,
  type LocalRerankRuntime,
  RagValidationError,
  resolveReranker,
  runRerankerConformance,
} from "../index.js";
import { reliefHit } from "./rerank-fixtures.js";

const hits = [reliefHit("src#0001", 0.1, 0), reliefHit("src#0002", 0.5, 1), reliefHit("src#0003", 0.9, 2)];

/** Deterministic overlap scorer: the local runtime a host would inject in tests. */
function overlapRuntime(state: { loads: number; scores: number; batched: readonly number[] }): LocalRerankRuntime {
  return {
    async load(model): Promise<LocalRerankModel> {
      state.loads += 1;
      return {
        id: model,
        async score({ query, documents }) {
          state.scores += 1;
          state.batched = documents.map((document) => document.length);
          const terms = new Set(query.toLowerCase().split(/\s+/));
          return documents.map((document) => [...terms].filter((term) => document.toLowerCase().includes(term)).length);
        },
      };
    },
  };
}

describe("createLocalReranker", () => {
  it("passes runRerankerConformance (permutation, provenance, determinism)", async () => {
    const runtime = overlapRuntime({ loads: 0, scores: 0, batched: [] });
    await runRerankerConformance(() => createLocalReranker({ runtime }));
  });

  it("loads once, lazily, and scores all 50 candidates in one batched call with no network", async () => {
    const state = { loads: 0, scores: 0, batched: [] as readonly number[] };
    let fetches = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      fetches += 1;
      throw new Error("local reranker must not touch the network");
    }) as typeof globalThis.fetch;
    try {
      const reranker = createLocalReranker({ runtime: overlapRuntime(state) });
      assert.equal(state.loads, 0, "model load is lazy");
      const candidates = Array.from({ length: 50 }, (_, index) =>
        reliefHit(`src#${String(index + 1).padStart(4, "0")}`, index / 50, index),
      );
      const ordered = await reranker.rerank({ query: "alpha", hits: candidates });
      await reranker.rerank({ query: "alpha", hits: candidates });
      assert.equal(state.loads, 1, "model load is memoized");
      assert.equal(state.scores, 2, "one batched score call per rerank");
      assert.equal(state.batched.length, 50, "every candidate is scored in that one call");
      assert.equal(ordered.length, 50);
      for (const hit of ordered) assert.ok(candidates.includes(hit), "same hit references move");
      assert.equal(fetches, 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("reranks a top-50 candidate set well inside the 300ms median budget on the adapter path", async () => {
    // The cross-encoder leg itself is host-owned (model/runtime choice), so this bounds the
    // part this package owns: hit plumbing, score validation, and ordering. Median of 5 runs.
    const state = { loads: 0, scores: 0, batched: [] as readonly number[] };
    const reranker = createLocalReranker({ runtime: overlapRuntime(state) });
    const candidates = Array.from({ length: 50 }, (_, index) => reliefHit(`src#${String(index + 1).padStart(4, "0")}`, index / 50, index));
    await reranker.rerank({ query: "alpha", hits: candidates });
    const timings: number[] = [];
    for (let round = 0; round < 5; round += 1) {
      const started = performance.now();
      await reranker.rerank({ query: "alpha", hits: candidates });
      timings.push(performance.now() - started);
    }
    const median = timings.sort((a, b) => a - b)[2] ?? Number.POSITIVE_INFINITY;
    assert.ok(median < 300, `adapter median ${median.toFixed(2)}ms exceeded the 300ms budget`);
    assert.equal(state.scores, 6);
  });

  it("fails loud with install guidance instead of falling back to lexical scoring", async () => {
    let loads = 0;
    const broken: LocalRerankRuntime = {
      async load() {
        loads += 1;
        throw new Error("model not found in cache");
      },
    };
    const reranker = createLocalReranker({ runtime: broken, model: "bge-reranker-base" });
    await assert.rejects(
      () => reranker.rerank({ query: "q", hits }),
      (error: unknown) => {
        assert.ok(error instanceof RagValidationError);
        assert.match(error.message, /bge-reranker-base/);
        assert.match(error.message, /npm i @huggingface\/transformers/);
        assert.match(error.message, /model not found in cache/);
        return true;
      },
    );
    await assert.rejects(() => reranker.rerank({ query: "q", hits }));
    assert.equal(loads, 1, "a failed load is cached: no per-query retry storm and no fallback");
  });

  it("rejects a malformed runtime and a runtime that returns no scoring model", async () => {
    assert.throws(() => createLocalReranker({ runtime: { load: "nope" } as unknown as LocalRerankRuntime }), /pass \{ runtime \}/);
    const empty: LocalRerankRuntime = { load: async () => undefined as unknown as LocalRerankModel };
    await assert.rejects(() => createLocalReranker({ runtime: empty }).rerank({ query: "q", hits }), /npm i @huggingface\/transformers/);
  });

  it("reports load timing through opt-in onLoad, never document text", async () => {
    const seen: { model: string; loadMs: number }[] = [];
    const reranker = createLocalReranker({
      model: "custom-reranker",
      runtime: overlapRuntime({ loads: 0, scores: 0, batched: [] }),
      onLoad: (info) => seen.push(info),
    });
    await reranker.rerank({ query: "alpha", hits });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.model, "custom-reranker");
    assert.ok((seen[0]?.loadMs ?? -1) >= 0);
  });

  it("keeps model scores and hit count honest (no silent truncation)", async () => {
    const short: LocalRerankRuntime = { load: async () => ({ id: "m", score: async () => [1] }) };
    await assert.rejects(() => createLocalReranker({ runtime: short }).rerank({ query: "q", hits }), /1 scores for 3 hits/);
    const nan: LocalRerankRuntime = { load: async () => ({ id: "m", score: async () => [1, Number.NaN, 0] }) };
    await assert.rejects(() => createLocalReranker({ runtime: nan }).rerank({ query: "q", hits }), /non-finite score/);
  });

  it("returns [] for empty input without loading a model", async () => {
    const state = { loads: 0, scores: 0, batched: [] as readonly number[] };
    assert.deepEqual(await createLocalReranker({ runtime: overlapRuntime(state) }).rerank({ query: "q", hits: [] }), []);
    assert.equal(state.loads, 0);
  });
});

describe("createTransformersRerankRuntime", () => {
  // The optional runtime is not a declared dependency; when a host does install it, this suite's
  // premise (no runtime present) is gone, so the guidance assertion is skipped rather than faked.
  const installed = ((): boolean => {
    try {
      createRequire(import.meta.url).resolve("@huggingface/transformers");
      return true;
    } catch {
      return false;
    }
  })();

  it("fails loud with install guidance when the optional runtime is absent", { skip: installed }, async () => {
    await assert.rejects(createTransformersRerankRuntime().load(DEFAULT_LOCAL_RERANK_MODEL), (error: unknown) => {
      assert.ok(error instanceof RagValidationError);
      assert.match(error.message, /npm i @huggingface\/transformers/);
      return true;
    });
  });
});

describe("resolveReranker", () => {
  it("maps config kinds to adapters and none/absent to no reranker", async () => {
    assert.equal(resolveReranker(undefined), undefined);
    assert.equal(resolveReranker({ kind: "none" }), undefined);
    assert.ok(resolveReranker({ kind: "fake" }));

    const local = resolveReranker({ kind: "local", runtime: overlapRuntime({ loads: 0, scores: 0, batched: [] }) });
    assert.ok(local);
    assert.equal((await local.rerank({ query: "text src#0003", hits }))[0], hits[2]);

    const tei = resolveReranker({ kind: "tei", baseUrl: "http://127.0.0.1:9" });
    assert.ok(tei);
    const hosted = resolveReranker({ kind: "openai-compatible", baseUrl: "https://rerank.example.test/v1" });
    assert.ok(hosted);
    const voyage = resolveReranker({ kind: "voyage", baseUrl: "https://api.voyageai.test/v1", apiKey: "k" });
    assert.ok(voyage);
  });

  it("rejects an unknown kind loudly", () => {
    assert.throws(() => resolveReranker({ kind: "mystery" } as unknown as { kind: "none" }), /unknown reranker kind/);
  });
});
