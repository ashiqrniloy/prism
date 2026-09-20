import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHashEmbedder, createMemoryVectorStore, type MemoryVectorHit, type VectorStore } from "../index.js";
import {
  chunkText,
  indexChunks,
  RagLimitError,
  RagScopeError,
  type RagTelemetry,
  type RagTelemetrySpan,
  RagValidationError,
  retrieveContext,
} from "../rag/index.js";

const scope = { tenantId: "tenant-a", resourceId: "docs", corpusId: "handbook" };
const thread = { tenantId: scope.tenantId, resourceId: scope.resourceId, threadId: scope.corpusId };
const alice = { principalId: "alice", tenantId: scope.tenantId };

function stubStore(hits: MemoryVectorHit[] = []): VectorStore {
  return {
    async upsert() {},
    async query() {
      return hits;
    },
    async delete() {
      return 0;
    },
  };
}

describe("RAG document authorization", () => {
  it("hides unauthorized sources on both legs and after revocation", async () => {
    const embedder = createHashEmbedder({ dimensions: 8 });
    const store = createMemoryVectorStore();
    await indexChunks({
      chunks: [
        ...chunkText("alice owns the approval policy handbook", { sourceId: "alice-doc" }),
        ...chunkText("secret merger terms stay hidden", { sourceId: "secret-doc" }),
      ],
      embedder,
      store,
      scope,
    });
    await store.setSourceAccess(thread, [
      { sourceId: "alice-doc", principalIds: ["alice"], accessVersion: 1 },
      { sourceId: "secret-doc", principalIds: ["mallory"], accessVersion: 1 },
    ]);
    const found = await retrieveContext("approval policy handbook", {
      embedder,
      store,
      scope,
      lexical: "fts",
      authorization: alice,
    });
    assert.ok(found.hits.every((hit) => hit.sourceId === "alice-doc"));
    assert.equal(
      found.hits.some((hit) => hit.sourceId === "secret-doc"),
      false,
    );
    const [embedding] = await embedder.embed(["approval policy handbook"]);
    const vector = await store.query({ ...thread, embedding: embedding!, topK: 10, authorization: alice });
    const lexical = await store.lexicalQuery!({ ...thread, text: "approval policy handbook", topK: 10, authorization: alice });
    assert.ok([...vector, ...lexical].every((hit) => (hit.metadata as { _rag?: { sourceId?: string } })?._rag?.sourceId !== "secret-doc"));

    await store.setSourceAccess(thread, [{ sourceId: "alice-doc", principalIds: [], accessVersion: 2 }]);
    const revoked = await retrieveContext("approval policy handbook", {
      embedder,
      store,
      scope,
      lexical: "off",
      authorization: alice,
    });
    assert.equal(revoked.hits.length, 0);
    assert.equal(revoked.text, "");
  });

  it("reports which sources its own predicate withheld, per source and only when asked", async () => {
    const embedder = createHashEmbedder({ dimensions: 8 });
    const store = createMemoryVectorStore();
    // 20 revoked rows of one source, one version-stale source, one unattributable row, one allowed source.
    await indexChunks({
      chunks: [
        ...chunkText(Array.from({ length: 20 }, (_, index) => `revoked row ${index + 1} about the approval policy`).join(" "), {
          sourceId: "revoked-doc",
        }),
        ...chunkText("stale grant row about the approval policy", { sourceId: "stale-doc" }),
        ...chunkText("allowed row about the approval policy", { sourceId: "alice-doc" }),
      ],
      embedder,
      store,
      scope,
    });
    await store.setSourceAccess(thread, [
      { sourceId: "stale-doc", principalIds: ["alice"], accessVersion: 1 },
      { sourceId: "alice-doc", principalIds: ["alice"], accessVersion: 3 },
    ]);
    const [embedding] = await embedder.embed(["approval policy"]);
    assert.ok(embedding);
    const lexicalQuery = store.lexicalQuery;
    assert.ok(lexicalQuery);
    const reports: (readonly { sourceId: string; reason: string }[])[] = [];
    const onDeniedSources = (denials: readonly { sourceId: string; reason: string }[]) => reports.push(denials);

    // 20 withheld rows of one source are one report entry, and the version-stale grant is named as such.
    const vector = await store.query({
      ...thread,
      embedding,
      topK: 50,
      authorization: { ...alice, accessVersion: 3 },
      onDeniedSources,
    });
    assert.deepEqual(
      vector.map((hit) => (hit.metadata as { _rag?: { sourceId?: string } })?._rag?.sourceId),
      ["alice-doc"],
    );
    assert.equal(reports.length, 1, "the callback fires once per query");
    const [vectorReport] = reports;
    assert.ok(vectorReport);
    assert.deepEqual(
      [...vectorReport].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
      [
        { sourceId: "revoked-doc", reason: "no_grant" },
        { sourceId: "stale-doc", reason: "version_mismatch" },
      ],
    );

    // Same contract on the lexical leg, and nothing is reported once the report is not asked for.
    const lexical = await lexicalQuery({
      ...thread,
      text: "approval policy",
      topK: 50,
      authorization: { ...alice, accessVersion: 3 },
      onDeniedSources,
    });
    assert.deepEqual(
      lexical.map((hit) => (hit.metadata as { _rag?: { sourceId?: string } })?._rag?.sourceId),
      ["alice-doc"],
    );
    assert.equal(reports.length, 2);
    const lexicalReport = reports[1];
    assert.ok(lexicalReport);
    assert.deepEqual(lexicalReport.map((denial) => denial.sourceId).sort(), ["revoked-doc", "stale-doc"]);
    const silent = await store.query({ ...thread, embedding, topK: 50, authorization: { ...alice, accessVersion: 3 } });
    assert.deepEqual(silent, vector, "the report never widens or narrows the hits");
    assert.equal(reports.length, 2, "no callback, no report");

    // The lexical leg short-circuits before it reads a row (`topK < 1`), so it reports nothing; the vector
    // leg still scans its rows, so it reports what its predicate withheld even for a query that returns none.
    reports.length = 0;
    await lexicalQuery({
      ...thread,
      text: "approval policy",
      topK: 0,
      authorization: { ...alice, accessVersion: 3 },
      onDeniedSources,
    });
    assert.equal(reports.length, 0);
    await store.query({ ...thread, embedding, topK: 0, authorization: { ...alice, accessVersion: 3 }, onDeniedSources });
    assert.equal(reports.length, 1);
    const emptyish = reports[0];
    assert.ok(emptyish);
    assert.deepEqual(emptyish.map((denial) => denial.sourceId).sort(), ["revoked-doc", "stale-doc"]);
  });

  it("group grant then group revocation", async () => {
    const embedder = createHashEmbedder({ dimensions: 8 });
    const store = createMemoryVectorStore();
    await indexChunks({
      chunks: chunkText("engineering runbook for oncall", { sourceId: "runbook" }),
      embedder,
      store,
      scope,
    });
    await store.setSourceAccess(thread, [{ sourceId: "runbook", groupIds: ["eng"], accessVersion: 1 }]);
    const allowed = await retrieveContext("engineering runbook", {
      embedder,
      store,
      scope,
      lexical: "off",
      authorization: { ...alice, groupIds: ["eng"] },
    });
    assert.ok(allowed.hits.length >= 1);
    await store.setSourceAccess(thread, [{ sourceId: "runbook", groupIds: ["ops"], accessVersion: 2 }]);
    const denied = await retrieveContext("engineering runbook", {
      embedder,
      store,
      scope,
      lexical: "off",
      authorization: { ...alice, groupIds: ["eng"] },
    });
    assert.equal(denied.hits.length, 0);
  });

  it("does not starve allowed hits behind unauthorized high-score candidates", async () => {
    const embedder = createHashEmbedder({ dimensions: 8 });
    const store = createMemoryVectorStore();
    const [queryVec] = await embedder.embed(["needle query"]);
    const secret = [...queryVec!];
    const allowed = queryVec!.map((value, index) => (index === 0 ? value * 0.4 : value));
    const records = [
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `secret#${String(index + 1).padStart(4, "0")}`,
        ...thread,
        text: `secret ${index}`,
        embedding: secret,
        sequence: index,
        embedderId: embedder.id,
        metadata: {
          _rag: { sourceId: "secret", citationId: `secret#${String(index + 1).padStart(4, "0")}`, chunkIndex: index, start: 0, end: 4 },
        },
        createdAt: new Date(0).toISOString(),
      })),
      {
        id: "public#0001",
        ...thread,
        text: "public handbook",
        embedding: allowed,
        sequence: 99,
        embedderId: embedder.id,
        metadata: { _rag: { sourceId: "public", citationId: "public#0001", chunkIndex: 0, start: 0, end: 4 } },
        createdAt: new Date(0).toISOString(),
      },
    ];
    await store.upsert(records);
    await store.setSourceAccess(thread, [{ sourceId: "public", principalIds: ["alice"], accessVersion: 1 }]);
    const leaked = await store.query({ ...thread, embedding: queryVec!, topK: 5 });
    assert.equal(leaked.length, 5);
    assert.ok(leaked.every((hit) => hit.id.startsWith("secret#")));
    const trimmed = await retrieveContext("needle query", {
      embedder,
      store,
      scope,
      lexical: "off",
      topK: 3,
      queryCandidates: 5,
      authorization: alice,
    });
    assert.deepEqual(
      trimmed.hits.map((hit) => hit.sourceId),
      ["public"],
    );
  });

  it("filter is not authorization; unresolved version denies; metadata-matching unauthorized stays hidden", async () => {
    const embedder = createHashEmbedder({ dimensions: 8 });
    const store = createMemoryVectorStore();
    await indexChunks({
      chunks: [
        ...chunkText("public classification still secret", { sourceId: "hidden", metadata: { classification: "public" } }),
        ...chunkText("public classification allowed", { sourceId: "shown", metadata: { classification: "public" } }),
      ],
      embedder,
      store,
      scope,
    });
    await store.setSourceAccess(thread, [
      { sourceId: "shown", principalIds: ["alice"], accessVersion: 1 },
      { sourceId: "hidden", principalIds: ["mallory"], accessVersion: 1 },
    ]);
    const found = await retrieveContext("public classification", {
      embedder,
      store,
      scope,
      lexical: "off",
      filter: { classification: "public" },
      authorization: alice,
    });
    assert.ok(found.hits.length >= 1);
    assert.ok(found.hits.every((hit) => hit.sourceId === "shown"));
    const pinned = await retrieveContext("public classification", {
      embedder,
      store,
      scope,
      lexical: "off",
      authorization: { ...alice, accessVersion: 9 },
    });
    assert.equal(pinned.hits.length, 0);
  });

  it("revokes between query and rerank so reranker never sees unauthorized text", async () => {
    const embedder = createHashEmbedder({ dimensions: 8 });
    const inner = createMemoryVectorStore();
    await indexChunks({
      chunks: chunkText("confidential salary bands", { sourceId: "payroll" }),
      embedder,
      store: inner,
      scope,
    });
    await inner.setSourceAccess(thread, [{ sourceId: "payroll", principalIds: ["alice"], accessVersion: 1 }]);
    const store: VectorStore = {
      ...inner,
      async query(query) {
        const hits = await inner.query(query);
        await inner.setSourceAccess(thread, [{ sourceId: "payroll", principalIds: [], accessVersion: 2 }]);
        return hits;
      },
    };
    const seen: string[] = [];
    const result = await retrieveContext("confidential salary", {
      embedder,
      store,
      scope,
      lexical: "off",
      authorization: alice,
      reranker: {
        async rerank({ hits }) {
          seen.push(...hits.map((hit) => hit.text));
          return hits;
        },
      },
    });
    assert.deepEqual(seen, []);
    assert.equal(result.hits.length, 0);
    assert.equal(result.text, "");
  });

  it("rejects unsupported stores, cross-tenant constraints, and oversized group lists", async () => {
    const embedder = createHashEmbedder({ dimensions: 8 });
    await assert.rejects(
      retrieveContext("q", { embedder, store: stubStore(), scope, authorization: alice }),
      (error: RagValidationError) => error instanceof RagValidationError && /does not declare ACL support/.test(error.message),
    );
    const store = createMemoryVectorStore();
    await assert.rejects(
      retrieveContext("q", { embedder, store, scope, authorization: { principalId: "alice", tenantId: "other-tenant" } }),
      RagScopeError,
    );
    await assert.rejects(
      retrieveContext("q", {
        embedder,
        store,
        scope,
        authorization: { ...alice, groupIds: Array.from({ length: 33 }, (_, index) => `g${index}`) },
      }),
      RagLimitError,
    );
  });

  it("does not emit unauthorized source ids in telemetry", async () => {
    const embedder = createHashEmbedder({ dimensions: 8 });
    const store = createMemoryVectorStore();
    await indexChunks({
      chunks: [...chunkText("visible policy text", { sourceId: "visible" }), ...chunkText("hidden policy text", { sourceId: "hidden" })],
      embedder,
      store,
      scope,
    });
    await store.setSourceAccess(thread, [{ sourceId: "visible", principalIds: ["alice"], accessVersion: 1 }]);
    const events: Array<{ name: string; attrs: Record<string, string | number | boolean> }> = [];
    const span = (_name: string): RagTelemetrySpan => ({
      setAttribute() {},
      addEvent(eventName, attributes) {
        events.push({ name: eventName, attrs: { ...(attributes ?? {}) } });
      },
      recordError() {},
      end() {},
    });
    const telemetry: RagTelemetry = {
      startSpan(name) {
        return span(name);
      },
    };
    await retrieveContext("policy text", { embedder, store, scope, lexical: "off", authorization: alice, telemetry });
    const sourceIds = events.flatMap((event) =>
      typeof event.attrs["rag.chunk.source_id"] === "string" ? [event.attrs["rag.chunk.source_id"]] : [],
    );
    assert.ok(sourceIds.includes("visible"));
    assert.equal(sourceIds.includes("hidden"), false);
  });

  it("transaction rollback drops staged grants", async () => {
    const store = createMemoryVectorStore();
    await assert.rejects(
      store.transaction(async (tx) => {
        await tx.setSourceAccess(thread, [{ sourceId: "doc", principalIds: ["alice"], accessVersion: 1 }]);
        throw new Error("boom");
      }),
    );
    assert.equal(await store.checkSourceAccess(thread, "doc", alice), false);
  });
});
