import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createFakeReranker,
  createOpenAiCompatibleReranker,
  createVoyageReranker,
  RagLimitError,
  RagValidationError,
  runRerankerConformance,
} from "../index.js";
import { readBody, reliefHit, withRerankServer } from "./rerank-fixtures.js";

const hits = [reliefHit("src#0001", 0.1, 0), reliefHit("src#0002", 0.5, 1), reliefHit("src#0003", 0.9, 2)];

/** Identity transport: mirrors the document count received in the request body. */
function identityTransport(resultsKey: string): typeof fetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { documents: unknown[] };
    return new Response(JSON.stringify({ [resultsKey]: body.documents.map((_, index) => ({ index, relevance_score: 0.5 })) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

/** Identity response body for the module-level 3-hit fixture. */
const identity = (resultsKey: string) => JSON.stringify({ [resultsKey]: hits.map((_hit, index) => ({ index, relevance_score: 0.5 })) });

describe("createOpenAiCompatibleReranker", () => {
  it("posts {model, query, documents} to <baseUrl>/rerank and reorders by relevance_score", async () => {
    let received = "";
    let auth = "";
    let path = "";
    await withRerankServer(
      async (req, res) => {
        path = req.url ?? "";
        auth = req.headers.authorization ?? "";
        received = await readBody(req);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            results: [
              { index: 2, relevance_score: 0.9 },
              { index: 0, relevance_score: 0.1 },
              { index: 1, relevance_score: 0.5 },
            ],
          }),
        );
      },
      async (port) => {
        const reranker = createOpenAiCompatibleReranker({
          baseUrl: `http://127.0.0.1:${port}/v1`,
          model: "jina-reranker-v2",
          apiKey: "secret-key",
          allowLoopback: true,
        });
        const ordered = await reranker.rerank({ query: "q", hits });
        assert.equal(path, "/v1/rerank");
        assert.equal(auth, "Bearer secret-key");
        const payload = JSON.parse(received) as Record<string, unknown>;
        assert.equal(payload.top_k, undefined); // retrieval seam owns top-K
        assert.deepEqual(payload, { model: "jina-reranker-v2", query: "q", documents: hits.map((h) => h.text) });
        assert.deepEqual(
          ordered.map((h) => h.id),
          ["src#0003", "src#0002", "src#0001"],
        );
        assert.equal(ordered[0], hits[2]); // same references — provenance/trust untouched
      },
    );
  });

  it("omits model/authorization when not configured", async () => {
    let received = "";
    let auth = "";
    await withRerankServer(
      async (req, res) => {
        auth = req.headers.authorization ?? "";
        received = await readBody(req);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(identity("results"));
      },
      async (port) => {
        const reranker = createOpenAiCompatibleReranker({ baseUrl: `http://127.0.0.1:${port}`, allowLoopback: true });
        await reranker.rerank({ query: "q", hits });
        assert.equal(auth, "");
        assert.deepEqual(JSON.parse(received), { query: "q", documents: hits.map((h) => h.text) });
      },
    );
  });

  it("fails closed on malformed results, HTTP errors, bad JSON, oversized bodies, and timeouts", async () => {
    for (const results of [
      [{ index: 0, relevance_score: 0.2 }], // short
      [
        { index: 0, relevance_score: 0.5 },
        { index: 1, relevance_score: 0.5 },
      ], // missing hit
      [
        { index: 0, relevance_score: 0.2 },
        { index: 0, relevance_score: 0.3 },
        { index: 1, relevance_score: 0.3 },
      ], // duplicate
      [
        { index: 0, relevance_score: 0.2 },
        { index: 9, relevance_score: 0.3 },
        { index: 1, relevance_score: 0.3 },
      ], // out of range
      [
        { index: 0, relevance_score: 0.2 },
        { index: 1, relevance_score: NaN },
        { index: 2, relevance_score: 0.3 },
      ], // non-finite
      [
        { index: 0, relevance_score: 0.2 },
        { index: 1, relevance_score: null },
        { index: 2, relevance_score: 0.3 },
      ],
    ]) {
      await withRerankServer(
        async (_req, res) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ results }));
        },
        async (port) => {
          const reranker = createOpenAiCompatibleReranker({ baseUrl: `http://127.0.0.1:${port}`, allowLoopback: true });
          await assert.rejects(reranker.rerank({ query: "q", hits }), RagValidationError);
        },
      );
    }
    await withRerankServer(
      async (_req, res) => {
        res.writeHead(503);
        res.end("unavailable");
      },
      async (port) => {
        const reranker = createOpenAiCompatibleReranker({ baseUrl: `http://127.0.0.1:${port}`, allowLoopback: true });
        await assert.rejects(reranker.rerank({ query: "q", hits }), RagValidationError);
      },
    );
    await withRerankServer(
      async (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("not json {");
      },
      async (port) => {
        const reranker = createOpenAiCompatibleReranker({ baseUrl: `http://127.0.0.1:${port}`, allowLoopback: true });
        await assert.rejects(reranker.rerank({ query: "q", hits }), RagValidationError);
      },
    );
    await withRerankServer(
      async (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ results: hits.map((_, index) => ({ index, relevance_score: 0.5 })), padding: "x".repeat(4096) }));
      },
      async (port) => {
        const reranker = createOpenAiCompatibleReranker({
          baseUrl: `http://127.0.0.1:${port}`,
          allowLoopback: true,
          maxResponseBytes: 256,
        });
        await assert.rejects(reranker.rerank({ query: "q", hits }), RagLimitError);
      },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 100)); // let the server flush before close
    await withRerankServer(
      async (_req, res) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(identity("results"));
      },
      async (port) => {
        const reranker = createOpenAiCompatibleReranker({ baseUrl: `http://127.0.0.1:${port}`, allowLoopback: true, timeoutMs: 50 });
        await assert.rejects(reranker.rerank({ query: "q", hits }), RagLimitError);
      },
    );
  });

  it("rejects malformed construction before any fetch", () => {
    assert.throws(() => createOpenAiCompatibleReranker({ baseUrl: "" }), RagValidationError);
    assert.throws(() => createOpenAiCompatibleReranker({ baseUrl: "ftp://gw/v1" }), RagValidationError);
    assert.throws(() => createOpenAiCompatibleReranker({ baseUrl: "https://user:pass@gw/v1" }), RagValidationError);
    assert.throws(() => createOpenAiCompatibleReranker({ baseUrl: "https://gw/v1", timeoutMs: 0 }), RagValidationError);
    assert.throws(() => createOpenAiCompatibleReranker({ baseUrl: "https://gw/v1", apiKey: "a\nb" }), RagValidationError);
  });

  it("passes reranker conformance through an injected transport", async () => {
    await runRerankerConformance(() =>
      createOpenAiCompatibleReranker({
        baseUrl: "http://127.0.0.1:1",
        fetch: identityTransport("results"),
      }),
    );
  });
});

describe("createVoyageReranker", () => {
  it("parses the Voyage `data` envelope and requires an apiKey", async () => {
    let auth = "";
    await withRerankServer(
      async (req, res) => {
        auth = req.headers.authorization ?? "";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            data: [
              { index: 1, relevance_score: 0.95 },
              { index: 2, relevance_score: 0.2 },
              { index: 0, relevance_score: 0.4 },
            ],
          }),
        );
      },
      async (port) => {
        const reranker = createVoyageReranker({
          baseUrl: `http://127.0.0.1:${port}/v1`,
          model: "rerank-2",
          apiKey: "voyage-key",
          allowLoopback: true,
        });
        const ordered = await reranker.rerank({ query: "q", hits });
        assert.equal(auth, "Bearer voyage-key");
        assert.deepEqual(
          ordered.map((h) => h.id),
          ["src#0002", "src#0001", "src#0003"],
        );
      },
    );
  });

  it("fails closed on malformed data envelopes and rejects missing keys at construction", async () => {
    await withRerankServer(
      async (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ results: hits.map((_, index) => ({ index, relevance_score: 0.5 })) })); // wrong envelope
      },
      async (port) => {
        const reranker = createVoyageReranker({ baseUrl: `http://127.0.0.1:${port}`, apiKey: "k", allowLoopback: true });
        await assert.rejects(reranker.rerank({ query: "q", hits }), RagValidationError);
      },
    );
    await withRerankServer(
      async (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(identity("data"));
      },
      async (port) => {
        assert.throws(
          () =>
            createVoyageReranker({ baseUrl: `http://127.0.0.1:${port}`, allowLoopback: true } as Parameters<
              typeof createVoyageReranker
            >[0]),
          RagValidationError,
        );
      },
    );
  });

  it("passes reranker conformance through an injected transport", async () => {
    await runRerankerConformance(() =>
      createVoyageReranker({
        baseUrl: "http://127.0.0.1:1",
        apiKey: "k",
        fetch: identityTransport("data"),
      }),
    );
  });
});

describe("createFakeReranker + runRerankerConformance", () => {
  it("ranks by query-term overlap with stable ties and passes conformance", async () => {
    await runRerankerConformance(createFakeReranker);
    const reranker = createFakeReranker();
    const overlap = [reliefHit("src#0001", 0, 0), reliefHit("src#0002", 0, 1), reliefHit("src#0003", 0, 2)];
    (overlap[0] as { text: string }).text = "leave balance policy";
    (overlap[1] as { text: string }).text = "vacation accrual";
    (overlap[2] as { text: string }).text = "leave accrual rules";
    const ordered = await reranker.rerank({ query: "leave accrual", hits: overlap });
    assert.deepEqual(
      ordered.map((h) => h.id),
      ["src#0003", "src#0001", "src#0002"], // c overlaps both terms, a one, b none — ties keep retrieval order
    );
    assert.equal(ordered[0], overlap[2]);
  });

  it("caps reject oversized input at the seam before the reranker is invoked", async () => {
    const { createHashEmbedder, createMemoryVectorStore } = await import("../../index.js");
    const { chunkText, replaceSource, retrieveContext } = await import("../index.js");
    const scope = { tenantId: "tenant-a", resourceId: "docs", corpusId: "handbook" };
    const embedder = createHashEmbedder({ dimensions: 8 });
    const store = createMemoryVectorStore();
    await replaceSource({
      sourceId: "doc",
      chunks: chunkText("alpha beta gamma delta epsilon", { sourceId: "doc", size: 6, overlap: 0 }),
      embedder,
      store,
      scope,
    });
    await assert.rejects(
      retrieveContext("alpha", { embedder, store, scope, reranker: createFakeReranker(), maxRerankBytes: 32 }),
      RagLimitError,
    );
  });
});
