import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { describe, it } from "node:test";
import { createHashEmbedder, createMemoryVectorStore } from "../../index.js";
import { chunkText, createTeiReranker, RagLimitError, RagValidationError, replaceSource, retrieveContext } from "../index.js";
import type { RagHit } from "../types.js";

const scope = { tenantId: "tenant-a", resourceId: "docs", corpusId: "handbook" };

type ServerHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;

function reliefHit(id: string, score: number, retrievalRank: number): RagHit {
  return {
    id,
    citationId: id,
    sourceId: "src",
    index: Number(id.split("#")[1]!.slice(1)) - 1,
    start: 0,
    end: 4,
    text: `text ${id}`,
    score,
    retrievalRank,
    provenance: {
      sourceId: "src",
      chunkId: id,
      citationId: id,
      provider: "host",
      tenantId: "t",
      resourceId: "r",
      corpusId: "c",
      retrieval: "vector",
      retrievedAt: "0",
    },
    trust: { untrusted: true, inert: true, injectionCapable: true },
  };
}

async function withRerankServer(handler: ServerHandler, fn: (port: number) => Promise<void>): Promise<void> {
  const server: Server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await fn(port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => resolve(body));
  });
}
