/**
 * Plan 089 Task 3: grant-change re-pointing and the OM staleness bridge.
 *
 * Covers the store-side move (chunk keys, `_rag.sourceId`, citation ids, and lineage
 * edges rewritten in one transaction with embeddings reused verbatim), the ACL
 * fail-closed posture, the wiki projection following the move, the propagation
 * interaction (edges now point at the new source, the old one no longer owns the
 * derived rows), and `listInvalidatedIds` feeding observational-memory
 * `invalidatedIds` so already-emitted blocks go stale on the next build.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { SessionEntry } from "@arnilo/prism";
import {
  createDeletionPropagator,
  createHashEmbedder,
  createMemoryVectorStore,
  HARD_REPOINT_RECORDS,
  listInvalidatedIds,
  type MemoryScope,
  MemoryLimitError,
  MemoryScopeError,
  MemoryValidationError,
  type MemoryVectorRecord,
  repointSource,
  type VectorStore,
} from "../index.js";
import { buildObservationalMemoryProjection, OBSERVATIONS_RECORDED } from "../compaction/observational-memory/index.js";
import { chunkText, indexChunks, type RagScope, retrieveContext } from "../rag/index.js";
import { createWikiRepointHandler, repointWikiSources } from "../wiki/index.js";

const thread: Required<MemoryScope> = { tenantId: "t1", resourceId: "r1", threadId: "th1" };
const ragScope: RagScope = { tenantId: thread.tenantId, resourceId: thread.resourceId, corpusId: thread.threadId };
const alice = { principalId: "alice", tenantId: thread.tenantId };

function derived(id: string, sourceIds: readonly string[]): MemoryVectorRecord {
  return {
    id,
    ...thread,
    text: id,
    embedding: [0.5, 0.5],
    sequence: 99,
    embedderId: "hash",
    createdAt: new Date(0).toISOString(),
    metadata: { _lineage: { v: 1, sourceIds: [...sourceIds] } },
  };
}

async function seeded() {
  const embedder = createHashEmbedder({ dimensions: 8 });
  const store = createMemoryVectorStore();
  await indexChunks({
    chunks: [
      ...chunkText("payroll approval policy for the finance team", { sourceId: "doc:a" }),
      ...chunkText("noise", { sourceId: "doc:c" }),
    ],
    embedder,
    store,
    scope: ragScope,
  });
  await store.upsert([derived("summary:a", ["doc:a"])]);
  await store.setSourceAccess(thread, [
    { sourceId: "doc:a", principalIds: ["alice"], accessVersion: 1 },
    { sourceId: "doc:b", principalIds: ["alice"], accessVersion: 1 },
  ]);
  return { embedder, store };
}

describe("grant-change re-pointing", () => {
  it("re-keys chunk rows and rewrites lineage edges in one transaction without re-embedding", async () => {
    const { embedder, store } = await seeded();
    const before = await store.getByThread(thread);
    const chunkBefore = before.filter((record) => (record.metadata as { _rag?: { sourceId?: string } })?._rag?.sourceId === "doc:a");
    assert.ok(chunkBefore.length >= 1);

    let transactions = 0;
    const counted = {
      ...store,
      async transaction<T>(operation: (view: VectorStore) => Promise<T>, options?: { readonly signal?: AbortSignal }): Promise<T> {
        transactions += 1;
        return store.transaction(operation as never, options) as Promise<T>;
      },
    };
    const result = await repointSource({
      scope: thread,
      vectorStore: counted,
      from: "doc:a",
      to: "doc:b",
      authorization: alice,
      handlers: [{ kind: "wiki", repoint: () => 2 }],
    });
    assert.equal(result.movedChunks, chunkBefore.length);
    assert.equal(result.rewrittenEdges, 1);
    assert.deepEqual(result.layers, { wiki: 2 });
    assert.equal(result.batched, true);
    assert.equal(transactions, 1);

    const after = await store.getByThread(thread);
    assert.equal(
      after.some((record) => (record.metadata as { _rag?: { sourceId?: string } })?._rag?.sourceId === "doc:a"),
      false,
    );
    const movedChunks = after.filter(
      (record) => (record.metadata as { _rag?: { sourceId?: string } })?._rag?.sourceId === "doc:b" && record.id.startsWith("doc:b#"),
    );
    assert.equal(movedChunks.length, chunkBefore.length);
    for (const moved of movedChunks) {
      const original = chunkBefore.find((record) => record.id === `doc:a#${moved.id.slice("doc:b#".length)}`)!;
      // Content identity, not a re-embed: same text, same vector, same offsets.
      assert.equal(moved.text, original.text);
      assert.deepEqual(moved.embedding, original.embedding);
      assert.equal((moved.metadata as { _rag?: { citationId?: string } })._rag?.citationId, moved.id);
    }
    const summary = after.find((record) => record.id === "summary:a")!;
    assert.deepEqual((summary.metadata as { _lineage: { sourceIds: string[] } })._lineage.sourceIds, ["doc:b"]);

    // The re-pointed rows still retrieve and still carry consistent citation identity.
    const found = await retrieveContext("payroll approval policy", {
      embedder,
      store,
      scope: ragScope,
      lexical: "off",
      authorization: alice,
    });
    assert.ok(found.hits.some((hit) => hit.sourceId === "doc:b" && hit.text.includes("payroll")));
  });

  it("keeps deletion propagation correct on both sides of the move", async () => {
    const { store } = await seeded();
    await repointSource({ scope: thread, vectorStore: store, from: "doc:a", to: "doc:b", authorization: alice });

    const propagator = createDeletionPropagator({ scope: thread, vectorStore: store, authorization: alice });
    const old = await propagator.propagate("doc:a");
    assert.equal(old.ids.includes("summary:a"), false);
    const moved = await store.getByThread(thread);
    const summary = moved.find((record) => record.id === "summary:a")!;
    assert.deepEqual((summary.metadata as { _lineage: { sourceIds: string[] } })._lineage.sourceIds, ["doc:b"]);

    const next = await propagator.propagate("doc:b");
    assert.ok(next.ids.includes("summary:a"));
    const invalidated = await store.listInvalidated(thread);
    assert.ok(invalidated.some((entry) => entry.id === "summary:a"));
  });

  it("fails closed on ACL stores: no authorization, no destination grant, no partial move", async () => {
    const { store } = await seeded();
    await assert.rejects(() => repointSource({ scope: thread, vectorStore: store, from: "doc:a", to: "doc:b" }), MemoryScopeError);
    // Revoke the destination grant: the move must refuse before any write.
    await store.setSourceAccess(thread, [
      { sourceId: "doc:a", principalIds: ["alice"], accessVersion: 1 },
      { sourceId: "doc:b", principalIds: [], accessVersion: 1 },
    ]);
    await assert.rejects(
      () => repointSource({ scope: thread, vectorStore: store, from: "doc:a", to: "doc:b", authorization: alice }),
      /no live grant for to source/,
    );
    const records = await store.getByThread(thread);
    assert.ok(records.some((record) => (record.metadata as { _rag?: { sourceId?: string } })?._rag?.sourceId === "doc:a"));
  });

  it("validates input and bounds the scope before writing anything", async () => {
    const { embedder, store } = await seeded();
    await assert.rejects(
      () => repointSource({ scope: thread, vectorStore: store, from: "doc:a", to: "doc:a", authorization: alice }),
      MemoryValidationError,
    );
    await assert.rejects(
      () => repointSource({ scope: thread, vectorStore: store, from: "doc:a", to: "doc:b", authorization: alice, maxRecords: 1 }),
      MemoryLimitError,
    );
    await assert.rejects(
      () =>
        repointSource({
          scope: thread,
          vectorStore: { ...store, getByThread: undefined } as unknown as typeof store,
          from: "doc:a",
          to: "doc:b",
          authorization: alice,
        }),
      /getByThread/,
    );
    assert.equal(HARD_REPOINT_RECORDS, 4_096);
    // The failed moves left the source in place.
    const records = await store.getByThread(thread);
    assert.ok(records.some((record) => record.id.startsWith("doc:a#")));

    // Destination collision fails closed instead of overwriting an unrelated row.
    await indexChunks({ chunks: chunkText("already at the destination", { sourceId: "doc:b" }), embedder, store, scope: ragScope });
    await assert.rejects(
      () => repointSource({ scope: thread, vectorStore: store, from: "doc:a", to: "doc:b", authorization: alice }),
      /destination already holds record/,
    );
  });
});

describe("wiki re-pointing", () => {
  async function wikiFixture(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "prism-wiki-repoint-"));
    await mkdir(join(root, ".wiki", "entities"), { recursive: true });
    await writeFile(
      join(root, ".wiki", ".manifest.json"),
      `${JSON.stringify(
        {
          version: "1.0.0",
          profile: "codebase",
          wikiRoot: join(root, ".wiki"),
          rawRoots: ["."],
          sourceFileHashes: { "docs/old.md": "abc123" },
          entities: {
            auth: {
              id: "auth",
              title: "Auth",
              category: "entity",
              tags: ["security"],
              rawSources: ["docs/old.md"],
              anchors: [{ filePath: "docs/old.md", startLine: 1, endLine: 9, symbol: "login", sourceHash: "abc123" }],
              lastCompiledAt: "2026-01-01T00:00:00.000Z",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      join(root, ".wiki", "entities", "auth.md"),
      "---\ntitle: Auth\nsources:\n  - resource: docs/old.md#L1-L9\n    title: docs/old.md\n---\n\n# Auth\n\n## Raw Sources\n- `docs/old.md`\n",
      "utf8",
    );
    return root;
  }

  it("moves manifest references, hashes, page text, and the log", async () => {
    const root = await wikiFixture();
    try {
      const result = await repointWikiSources({ workspaceRoot: root, from: ["docs/old.md"], to: ["./docs/new.md"] });
      assert.deepEqual(result.repointed, ["auth"]);
      assert.deepEqual(result.movedSources, [{ from: "docs/old.md", to: "docs/new.md" }]);
      const manifest = JSON.parse(await readFile(join(root, ".wiki", ".manifest.json"), "utf8"));
      assert.deepEqual(manifest.entities.auth.rawSources, ["docs/new.md"]);
      assert.equal(manifest.entities.auth.anchors[0].filePath, "docs/new.md");
      assert.deepEqual(manifest.sourceFileHashes, { "docs/new.md": "abc123" });
      const page = await readFile(join(root, ".wiki", "entities", "auth.md"), "utf8");
      assert.equal(page.includes("docs/old.md"), false);
      assert.ok(page.includes("docs/new.md#L1-L9"));
      assert.ok(page.includes("- `docs/new.md`"));
      const log = await readFile(join(root, ".wiki", "log.md"), "utf8");
      assert.ok(log.includes("Repointed"));
      // Index pages were rewritten alongside the manifest.
      assert.ok((await readFile(join(root, ".wiki", "index.md"), "utf8")).includes("Auth"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs as a re-point handler layer over a store move", async () => {
    const root = await wikiFixture();
    try {
      const { store } = await seeded();
      await store.setSourceAccess(thread, [
        { sourceId: "docs/old.md", principalIds: ["alice"], accessVersion: 1 },
        { sourceId: "docs/new.md", principalIds: ["alice"], accessVersion: 1 },
      ]);
      const result = await repointSource({
        scope: thread,
        vectorStore: store,
        from: "docs/old.md",
        to: "docs/new.md",
        authorization: alice,
        handlers: [createWikiRepointHandler({ workspaceRoot: root })],
      });
      assert.equal(result.layers.wiki, 2);
      const manifest = JSON.parse(await readFile(join(root, ".wiki", ".manifest.json"), "utf8"));
      assert.deepEqual(manifest.entities.auth.rawSources, ["docs/new.md"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("observational-memory staleness bridge", () => {
  it("turns scope invalidations into invalidatedIds so already-emitted blocks go stale", async () => {
    const store = createMemoryVectorStore();
    const at = new Date(0).toISOString();
    await store.invalidate(thread, [
      { id: "doc:b", reason: "forgotten", at },
      { id: "doc:fixed", reason: "corrected", at },
    ]);
    const ids = await listInvalidatedIds(store, thread);
    assert.deepEqual(ids, ["doc:b"]);

    const entries: SessionEntry[] = [
      {
        id: "m1",
        sessionId: "s1",
        timestamp: at,
        kind: "message",
        message: { role: "user", content: [{ type: "text", text: "payroll policy" }] },
      },
      {
        id: "c1",
        sessionId: "s1",
        timestamp: at,
        kind: "custom",
        data: {
          type: OBSERVATIONS_RECORDED,
          coversUpToId: "m1",
          observations: [
            {
              id: "aaaaaaaaaaaa",
              content: "Payroll approvals need finance sign-off.",
              timestamp: at,
              relevance: "high",
              sourceEntryIds: ["doc:b"],
              tokenCount: 8,
            },
          ],
        },
      },
    ];
    const stale = buildObservationalMemoryProjection(entries, undefined, { invalidatedIds: ids });
    assert.deepEqual(stale.droppedObservationIds, ["aaaaaaaaaaaa"]);
    assert.deepEqual(stale.observations, []);
    const fresh = buildObservationalMemoryProjection(entries);
    assert.equal(fresh.observations.length, 1);
    assert.equal(
      await listInvalidatedIds({ ...store, lineage: undefined } as unknown as VectorStore, thread).then((value) => value.length),
      0,
    );
  });
});
