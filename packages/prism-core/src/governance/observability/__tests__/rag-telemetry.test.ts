import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory";
import { chunkText, indexChunks, retrieveContext } from "@arnilo/prism-memory/rag";
import { createInMemoryTelemetry } from "../instrumentation.js";
import { createRagTelemetry } from "../rag-telemetry.js";

const scope = { tenantId: "tenant-a", resourceId: "docs", corpusId: "handbook" };

describe("createRagTelemetry", () => {
  it("maps a real hybrid retrieve onto the tracer with parent linkage and latency samples", async () => {
    const memory = createInMemoryTelemetry();
    const telemetry = createRagTelemetry({ tracer: memory.tracer, meter: memory.meter });
    const embedder = createHashEmbedder({ dimensions: 16 });
    const store = createMemoryVectorStore();
    await indexChunks({
      chunks: chunkText("approval policy requires current authorization", { sourceId: "policy" }),
      embedder,
      store,
      scope,
    });

    await retrieveContext("approval policy requires current authorization", { embedder, store, scope, telemetry });

    const names = memory.spans.map((span) => span.name);
    assert.deepEqual(names, [
      "rag_request",
      "embedding.query",
      "retrieval.vector_search",
      "retrieval.lexical",
      "retrieval.fusion",
      "prompt.assembly",
    ]);
    const root = memory.spans[0]!;
    assert.ok(root.ended);
    assert.equal(root.status?.code, "ok");
    for (const child of memory.spans.slice(1)) {
      assert.equal(child.traceId, root.traceId);
      assert.equal(child.parentSpanId, root.spanId);
    }
    // Latency samples land in the meter histogram with the span name attached.
    const samples = memory.metrics.filter((metric) => metric.name === "rag.operation.duration");
    assert.equal(samples.length, names.length);
    for (const sample of samples) assert.ok(sample.value >= 0);
    assert.doesNotMatch(JSON.stringify(memory.spans), /current authorization|"text"/i);
  });

  it("enforces the span/event/key allow-list and drops unknown spans entirely", () => {
    const memory = createInMemoryTelemetry();
    const telemetry = createRagTelemetry({ tracer: memory.tracer });
    const span = telemetry.startSpan("exfiltrate_everything", { "raw.text": "secret" });
    span.setAttribute("user.password", "hunter2");
    span.addEvent("raw_dump", { body: "chunk text" });
    span.end();

    const allowed = telemetry.startSpan("rag_request", { "rag.scope.tenant_id": "t1", "not.allowed": 1 });
    allowed.setAttribute("rag.top_k", 5);
    allowed.setAttribute("rogue_key", "x");
    allowed.addEvent("chunk_retrieved", { "rag.chunk.id": "policy#0001", body: "text" });
    allowed.end();
    telemetry.startSpan("embedding.query").end();

    assert.deepEqual(
      memory.spans.map((s) => s.name),
      ["rag_request", "embedding.query"],
    );
    const recorded = memory.spans[0]!;
    assert.deepEqual(recorded.attributes, { "rag.scope.tenant_id": "t1", "rag.top_k": 5 });
    assert.deepEqual(
      recorded.events.map((event) => event.name),
      ["chunk_retrieved"],
    );
    assert.deepEqual(recorded.events[0]?.attributes, { "rag.chunk.id": "policy#0001" });
  });

  it("routes values through attributeFilter and drops undefined results", async () => {
    const memory = createInMemoryTelemetry();
    const telemetry = createRagTelemetry({
      tracer: memory.tracer,
      attributeFilter: (name, value) => (name === "rag.scope.tenant_id" ? "[REDACTED]" : name === "rag.drop_me" ? undefined : value),
    });
    const span = telemetry.startSpan("rag_request", { "rag.scope.tenant_id": "tenant-a", "rag.embedder_id": "m" });
    span.setAttribute("rag.drop_me", 1);
    span.end();

    assert.deepEqual(memory.spans[0]?.attributes, { "rag.scope.tenant_id": "[REDACTED]", "rag.embedder_id": "m" });
  });

  it("marks error status via recordError without carrying any message", async () => {
    const memory = createInMemoryTelemetry();
    const telemetry = createRagTelemetry({ tracer: memory.tracer });
    const embedder = createHashEmbedder({ dimensions: 8 });
    const store = createMemoryVectorStore();
    await indexChunks({
      chunks: chunkText("legacy content", { sourceId: "old" }),
      embedder: createHashEmbedder({ dimensions: 8, id: "legacy-model" }),
      store,
      scope,
    });
    await assert.rejects(retrieveContext("query", { embedder, store, scope, telemetry }));
    const root = memory.spans[0]!;
    assert.equal(root.name, "rag_request");
    assert.equal(root.status?.code, "error");
    assert.doesNotMatch(JSON.stringify(memory.spans), /legacy-model/);
  });
});
