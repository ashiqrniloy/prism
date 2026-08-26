import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory";
import { chunkText, indexChunks, replaceSource, retrieveContext } from "../index.js";
import type { RagTelemetry, RagTelemetryAttributeValue, RagTelemetrySpan } from "../telemetry.js";

interface RecordedNode {
  readonly name: string;
  readonly parent?: string;
  attributes: Record<string, RagTelemetryAttributeValue>;
  events: Array<{ name: string; attributes: Record<string, RagTelemetryAttributeValue> }>;
  errors: number;
  ended: boolean;
}

function recordingTelemetry() {
  const nodes: RecordedNode[] = [];
  const records = new WeakMap<RagTelemetrySpan, RecordedNode>();
  const telemetry: RagTelemetry = {
    startSpan(name, attributes, parent) {
      const node: RecordedNode = {
        name,
        ...(parent ? { parent: records.get(parent)?.name } : {}),
        attributes: { ...(attributes ?? {}) },
        events: [],
        errors: 0,
        ended: false,
      };
      nodes.push(node);
      const span: RagTelemetrySpan = {
        setAttribute: (key, value) => {
          node.attributes[key] = value;
        },
        addEvent: (eventName, eventAttributes) => {
          node.events.push({ name: eventName, attributes: { ...(eventAttributes ?? {}) } });
        },
        recordError: () => {
          node.errors += 1;
        },
        end: () => {
          node.ended = true;
        },
      };
      records.set(span, node);
      return span;
    },
  };
  return { telemetry, nodes };
}

const scope = { tenantId: "tenant-a", resourceId: "docs", corpusId: "handbook" };

describe("RAG telemetry seam", () => {
  it("captures the exact hybrid-retrieve span tree, attributes, and chunk events", async () => {
    const { telemetry, nodes } = recordingTelemetry();
    const embedder = createHashEmbedder({ dimensions: 16 });
    const store = createMemoryVectorStore();
    await indexChunks({
      chunks: chunkText("approval policy requires current authorization", { sourceId: "policy" }),
      embedder,
      store,
      scope,
    });

    const result = await retrieveContext("approval policy requires current authorization", {
      embedder,
      store,
      scope,
      telemetry,
    });

    assert.deepEqual(
      nodes.map((node) => node.name),
      ["rag_request", "embedding.query", "retrieval.vector_search", "retrieval.lexical", "retrieval.fusion", "prompt.assembly"],
    );
    const root = nodes[0]!;
    assert.equal(root.attributes["rag.scope.tenant_id"], scope.tenantId);
    assert.equal(root.attributes["rag.scope_count"], 1);
    assert.equal(root.attributes["rag.embedder_id"], "prism-hash-embedder");
    assert.ok(Number.isInteger(root.attributes["rag.top_k"]));
    assert.deepEqual(
      nodes.slice(1).map((node) => node.parent),
      nodes.slice(1).map(() => "rag_request"),
    );
    assert.ok(nodes.every((node) => node.ended && node.errors === 0));

    // chunk_retrieved events carry ids/scores only — never raw text.
    assert.equal(root.events.length, result.hits.length);
    for (const [index, event] of root.events.entries()) {
      assert.equal(event.name, "chunk_retrieved");
      assert.deepEqual(Object.keys(event.attributes).sort(), [
        "rag.chunk.corpus_id",
        "rag.chunk.embedder_id",
        "rag.chunk.id",
        "rag.chunk.rank",
        "rag.chunk.score",
        "rag.chunk.source_id",
        "rag.chunk.tenant_id",
      ]);
      assert.equal(event.attributes["rag.chunk.tenant_id"], scope.tenantId);
      assert.equal(event.attributes["rag.chunk.corpus_id"], scope.corpusId);
      assert.equal(event.attributes["rag.chunk.rank"], index);
      assert.equal(event.attributes["rag.chunk.id"], result.hits[index]?.id);
    }
    assert.doesNotMatch(JSON.stringify(nodes), /current authorization|"text"|title/i);

    const vectorLeg = nodes.find((node) => node.name === "retrieval.vector_search");
    const fusion = nodes.find((node) => node.name === "retrieval.fusion");
    const assembly = nodes.find((node) => node.name === "prompt.assembly");
    assert.ok(typeof vectorLeg?.attributes["rag.vector_candidates"] === "number");
    assert.ok(typeof fusion?.attributes["rag.fused_candidates"] === "number");
    assert.equal(assembly?.attributes["rag.result_count"], result.hits.length);
  });

  it("flags errors on the root span without carrying error text", async () => {
    const { telemetry, nodes } = recordingTelemetry();
    const embedder = createHashEmbedder({ dimensions: 8 });
    const store = createMemoryVectorStore();
    await indexChunks({
      chunks: chunkText("legacy content", { sourceId: "old" }),
      embedder: createHashEmbedder({ dimensions: 8, id: "legacy-model" }),
      store,
      scope,
    });
    await assert.rejects(retrieveContext("query", { embedder, store, scope, telemetry }), /embedder mismatch/);
    const root = nodes[0]!;
    assert.equal(root.name, "rag_request");
    assert.equal(root.errors, 1);
    assert.equal(root.ended, true);
    assert.doesNotMatch(JSON.stringify(nodes), /legacy-model/); // error text stays inside the host
  });

  it("reports rag.index_generation on retrieve and index traces when the store tracks generations", async () => {
    const store = createMemoryVectorStore();
    const embedder = createHashEmbedder({ dimensions: 8 });
    const chunks = chunkText("generation aware body", { sourceId: "doc" });

    const first = recordingTelemetry();
    await replaceSource({ sourceId: "doc", chunks, embedder, store, scope, contentHash: "ab".repeat(32), telemetry: first.telemetry });
    assert.equal(first.nodes[0]!.attributes["rag.index_generation"], 1);

    const second = recordingTelemetry();
    await replaceSource({
      sourceId: "doc",
      chunks: chunkText("generation aware body two", { sourceId: "doc" }),
      embedder,
      store,
      scope,
      contentHash: "ef".repeat(32),
      telemetry: second.telemetry,
    });
    assert.equal(second.nodes[0]!.attributes["rag.index_generation"], 2);

    const retrieval = recordingTelemetry();
    await retrieveContext("generation aware body two", { embedder, store, scope, telemetry: retrieval.telemetry });
    assert.equal(retrieval.nodes[0]!.name, "rag_request");
    assert.equal(retrieval.nodes[0]!.attributes["rag.index_generation"], 2);
  });

  it("opens rag_index with an embedded.index child and skips the child when unchanged", async () => {
    const store = createMemoryVectorStore();
    const embedder = createHashEmbedder({ dimensions: 8 });
    const chunks = chunkText("stable document body", { sourceId: "doc" });

    const first = recordingTelemetry();
    await replaceSource({ sourceId: "doc", chunks, embedder, store, scope, contentHash: "ab".repeat(32), telemetry: first.telemetry });
    assert.deepEqual(
      first.nodes.map((node) => node.name),
      ["rag_index", "embedding.index"],
    );
    assert.equal(first.nodes[0]!.attributes["rag.source_id"], "doc");
    assert.equal(first.nodes[1]!.parent, "rag_index");

    const second = recordingTelemetry();
    const result = await replaceSource({
      sourceId: "doc",
      chunks,
      embedder,
      store,
      scope,
      contentHash: "ab".repeat(32),
      telemetry: second.telemetry,
    });
    assert.equal(result.skipped, true);
    assert.deepEqual(
      second.nodes.map((node) => node.name),
      ["rag_index"],
    );
    assert.ok(second.nodes[0]!.ended);
  });

  it("records rag.scope_count and per-hit tenant/corpus on multi-scope retrieve", async () => {
    const { telemetry, nodes } = recordingTelemetry();
    const embedder = createHashEmbedder({ dimensions: 8 });
    const org = { tenantId: "org_a", resourceId: "kb", corpusId: "org" };
    const user = { tenantId: "org_a", resourceId: "kb", corpusId: "user_self" };
    const session = { tenantId: "org_a", resourceId: "kb", corpusId: "session" };
    const store = createMemoryVectorStore();
    await indexChunks({
      chunks: chunkText("alpha distinctive org", { sourceId: "org-doc" }),
      embedder,
      store,
      scope: org,
    });
    await indexChunks({
      chunks: chunkText("beta distinctive user", { sourceId: "user-doc" }),
      embedder,
      store,
      scope: user,
    });
    await indexChunks({
      chunks: chunkText("gamma distinctive session", { sourceId: "session-doc" }),
      embedder,
      store,
      scope: session,
    });
    const result = await retrieveContext("distinctive", {
      embedder,
      store,
      scopes: [org, user, session],
      lexical: "off",
      telemetry,
    });
    const root = nodes[0]!;
    assert.equal(root.name, "rag_request");
    assert.equal(root.attributes["rag.scope_count"], 3);
    assert.equal(root.attributes["rag.index_generation"], undefined);
    assert.ok(result.hits.length >= 1);
    for (const event of root.events) {
      assert.equal(event.name, "chunk_retrieved");
      assert.equal(event.attributes["rag.chunk.tenant_id"], "org_a");
      assert.ok(["org", "user_self", "session"].includes(String(event.attributes["rag.chunk.corpus_id"])));
    }
    assert.doesNotMatch(JSON.stringify(nodes), /alpha distinctive|beta distinctive|gamma distinctive/);
  });
});
