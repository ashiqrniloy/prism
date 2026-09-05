import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHashEmbedder, createMemoryVectorStore } from "../../index.js";
import { chunkText, createTeiReranker, RagLimitError, RagValidationError, replaceSource, retrieveContext } from "../index.js";
import { readBody, reliefHit, withRerankServer } from "./rerank-fixtures.js";

const scope = { tenantId: "tenant-a", resourceId: "docs", corpusId: "handbook" };

describe("createTeiReranker", () => {
  it("reorders hits by TEI scores while preserving provenance/trust references", async () => {
    const hits = [reliefHit("src#0001", 0.1, 0), reliefHit("src#0002", 0.5, 1), reliefHit("src#0003", 0.9, 2)];
    let received = "";
    await withRerankServer(
      async (req, res) => {
        received = await readBody(req);
        assert.equal(req.url, "/rerank");
        const payload = JSON.parse(received);
        assert.equal(payload.raw_scores, false);
        assert.deepEqual(
          payload.texts,
          hits.map((h) => h.text),
        );
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            model: "x",
            results: [
              { index: 2, score: 0.9 },
              { index: 0, score: 0.1 },
              { index: 1, score: 0.5 },
            ],
          }),
        );
      },
      async (port) => {
        const reranker = createTeiReranker({ baseUrl: `http://127.0.0.1:${port}`, allowLoopback: true });
        const ordered = await reranker.rerank({ query: "q", hits });
        assert.deepEqual(
          ordered.map((h) => h.id),
          ["src#0003", "src#0002", "src#0001"],
        );
        // Same object references — provenance/trust untouched.
        assert.equal(ordered[0], hits[2]);
        assert.equal(ordered[0]!.provenance, hits[2]!.provenance);
        assert.equal(ordered[0]!.trust, hits[2]!.trust);
      },
    );
  });

  it("fails closed on short, duplicate, or out-of-range indices and non-finite scores", async () => {
    const hits = [reliefHit("src#0001", 0.1, 0), reliefHit("src#0002", 0.5, 1)];
    for (const results of [
      [{ index: 0, score: 0.2 }], // short
      [
        { index: 0, score: 0.2 },
        { index: 0, score: 0.3 },
      ], // duplicate
      [
        { index: 0, score: 0.2 },
        { index: 9, score: 0.3 },
      ], // out of range
      [
        { index: 0, score: 0.2 },
        { index: 1, score: NaN },
      ], // non-finite (JSON.stringify NaN→null)
      [
        { index: 0, score: 0.2 },
        { index: 1, score: null },
      ],
    ]) {
      await withRerankServer(
        async (_req, res) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ results }));
        },
        async (port) => {
          const reranker = createTeiReranker({ baseUrl: `http://127.0.0.1:${port}`, allowLoopback: true });
          await assert.rejects(reranker.rerank({ query: "q", hits }), RagValidationError);
        },
      );
    }
    await withRerankServer(
      async (_req, res) => {
        res.writeHead(500);
        res.end("boom");
      },
      async (port) => {
        const reranker = createTeiReranker({ baseUrl: `http://127.0.0.1:${port}`, allowLoopback: true });
        await assert.rejects(reranker.rerank({ query: "q", hits }), RagValidationError);
      },
    );
    await withRerankServer(
      async (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("not json {");
      },
      async (port) => {
        const reranker = createTeiReranker({ baseUrl: `http://127.0.0.1:${port}`, allowLoopback: true });
        await assert.rejects(reranker.rerank({ query: "q", hits }), RagValidationError);
      },
    );
  });

  it("bounds response bodies and times out within option bound", async () => {
    const hits = [reliefHit("src#0001", 0.1, 0), reliefHit("src#0002", 0.5, 1)];
    await withRerankServer(
      async (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            results: [
              { index: 0, score: 0.2 },
              { index: 1, score: 0.3 },
            ],
            padding: "x".repeat(4096),
          }),
        );
      },
      async (port) => {
        const reranker = createTeiReranker({ baseUrl: `http://127.0.0.1:${port}`, allowLoopback: true, maxResponseBytes: 256 });
        await assert.rejects(reranker.rerank({ query: "q", hits }), RagLimitError);
      },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 100)); // let the server flush before close
    await withRerankServer(
      async (_req, res) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      },
      async (port) => {
        const reranker = createTeiReranker({ baseUrl: `http://127.0.0.1:${port}`, allowLoopback: true, timeoutMs: 50 });
        await assert.rejects(reranker.rerank({ query: "q", hits }), RagLimitError);
      },
    );
  });

  it("rejects malformed construction and oversized seam inputs before any fetch", async () => {
    assert.throws(() => createTeiReranker({ baseUrl: "" }), RagValidationError);
    assert.throws(() => createTeiReranker({ baseUrl: "ftp://tei.svc" }), RagValidationError);
    assert.throws(() => createTeiReranker({ baseUrl: "https://user:pass@tei.svc" }), RagValidationError);
    assert.throws(() => createTeiReranker({ baseUrl: "https://tei.svc/rerank", timeoutMs: 0 }), RagValidationError);

    const embedder = createHashEmbedder({ dimensions: 8 });
    let fetched = false;
    const reranker = createTeiReranker({
      baseUrl: "http://127.0.0.1:1",
      allowLoopback: true,
      fetch: async () => {
        fetched = true;
        return new Response("{}", { status: 200 });
      },
    });
    // Seam cap rejects before the adapter ever fetches.
    const store = createMemoryVectorStore();
    await replaceSource({
      sourceId: "doc",
      chunks: chunkText("alpha beta gamma delta epsilon", { sourceId: "doc", size: 6, overlap: 0 }),
      embedder,
      store,
      scope,
    });
    await assert.rejects(retrieveContext("alpha", { embedder, store, scope, reranker, maxRerankBytes: 32 }), RagLimitError);
    assert.equal(fetched, false);
  });
});
