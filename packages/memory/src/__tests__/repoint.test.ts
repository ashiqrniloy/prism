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
import { buildObservationalMemoryProjection, OBSERVATIONS_RECORDED } from "../compaction/observational-memory/index.js";
import {
  applySourceRenames,
  createDeletionPropagator,
  createHashEmbedder,
  createMemoryVectorStore,
  HARD_REPOINT_RECORDS,
  listInvalidatedIds,
  MemoryAbortError,
  MemoryLimitError,
  type MemoryScope,
  MemoryScopeError,
  MemoryValidationError,
  type MemoryVectorRecord,
  repointSource,
  type SourceRename,
  type SourceRenameEvent,
  type VectorStore,
} from "../index.js";
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

describe("paged re-pointing", () => {
  /** Synthetic source-owned rows in id order, so pages are predictable: `doc:a#0000`, `doc:a#0001`, … */
  async function pagedFixture(rows: number, extra: readonly MemoryVectorRecord[] = []) {
    const store = createMemoryVectorStore();
    const records: MemoryVectorRecord[] = [];
    for (let index = 0; index < rows; index += 1) {
      const id = `doc:a#${String(index).padStart(4, "0")}`;
      records.push({
        id,
        ...thread,
        text: `row ${index}`,
        embedding: [0.5, 0.5],
        sequence: index,
        embedderId: "hash",
        createdAt: new Date(0).toISOString(),
        metadata: { _rag: { v: 1, sourceId: "doc:a", citationId: id } },
      });
    }
    await store.upsert([...records, ...extra]);
    await store.setSourceAccess(thread, [
      { sourceId: "doc:a", principalIds: ["alice"], accessVersion: 1 },
      { sourceId: "doc:b", principalIds: ["alice"], accessVersion: 1 },
    ]);
    return store;
  }

  function counted(store: ReturnType<typeof createMemoryVectorStore>) {
    let transactions = 0;
    let writes = 0;
    return {
      store: {
        ...store,
        async transaction<T>(operation: (view: VectorStore) => Promise<T>, options?: { readonly signal?: AbortSignal }): Promise<T> {
          transactions += 1;
          // The store hands a staged view to the operation, so count writes on that view, not on the spy.
          const counted = (view: VectorStore): VectorStore =>
            ({
              ...view,
              async upsert(...args: Parameters<typeof view.upsert>) {
                writes += 1;
                return view.upsert(...args);
              },
              async delete(...args: Parameters<typeof view.delete>) {
                writes += 1;
                return view.delete(...args);
              },
            }) as VectorStore;
          return store.transaction((view) => operation(counted(view)), options) as Promise<T>;
        },
        async upsert(...args: Parameters<typeof store.upsert>) {
          writes += 1;
          return store.upsert(...args);
        },
        async delete(...args: Parameters<typeof store.delete>) {
          writes += 1;
          return store.delete(...args);
        },
      },
      transactions: () => transactions,
      writes: () => writes,
    };
  }

  it("moves above the single-pass bound across pages, one transaction each, with no old ids or duplicates", async () => {
    const store = await pagedFixture(4_097);
    const { store: spy, transactions } = counted(store);

    const first = await repointSource({ scope: thread, vectorStore: spy, from: "doc:a", to: "doc:b", authorization: alice });
    assert.equal(first.movedChunks, HARD_REPOINT_RECORDS, "the page size is the bound, not the scope");
    assert.equal(first.batched, true);
    assert.equal(transactions(), 1);
    assert.ok(first.cursor);

    const second = await repointSource({
      scope: thread,
      vectorStore: spy,
      from: "doc:a",
      to: "doc:b",
      authorization: alice,
      cursor: first.cursor,
    });
    assert.equal(second.movedChunks, 1);
    assert.equal(second.cursor, undefined, "no cursor means the scope is fully moved");
    assert.equal(transactions(), 2);

    const after = await store.getByThread(thread);
    assert.equal(after.length, 4_097);
    assert.equal(after.filter((record) => record.id.startsWith("doc:a#")).length, 0);
    assert.equal(after.filter((record) => record.id.startsWith("doc:b#")).length, 4_097);
    assert.equal(new Set(after.map((record) => record.id)).size, 4_097);
  });

  it("treats a stale page as a no-op instead of re-moving or double-writing", async () => {
    const store = await pagedFixture(3);
    const { store: spy, transactions, writes } = counted(store);

    // Page 1 only: its cursor is issued while the row past it is still pending.
    const first = await repointSource({ scope: thread, vectorStore: spy, from: "doc:a", to: "doc:b", authorization: alice, pageSize: 2 });
    assert.ok(first.cursor);
    assert.equal(transactions(), 1);
    assert.equal(writes(), 2, "one upsert + one delete for the page");

    // Someone else finishes the move before the host resumes, so the cursor is stale by then.
    await repointSource({ scope: thread, vectorStore: spy, from: "doc:a", to: "doc:b", authorization: alice, pageSize: 10 });
    const transactionsBefore = transactions();
    const writesBefore = writes();

    const replay = await repointSource({
      scope: thread,
      vectorStore: spy,
      from: "doc:a",
      to: "doc:b",
      authorization: alice,
      pageSize: 2,
      cursor: first.cursor,
    });

    assert.equal(replay.movedChunks, 0);
    assert.equal(replay.rewrittenEdges, 0);
    assert.equal(replay.cursor, undefined, "no workable record past the cursor, so the move reports done");
    assert.deepEqual(replay.layers, {}, "nothing moved, so no handler pass is fabricated");
    assert.equal(transactions(), transactionsBefore, "the replay opens no transaction at all");
    assert.equal(writes(), writesBefore);

    // Every row moved exactly once, under its new id.
    const ids = (await store.getByThread(thread)).map((record) => record.id).sort();
    assert.deepEqual(ids, ["doc:b#0000", "doc:b#0001", "doc:b#0002"]);
  });

  it("rejects a stale, foreign, or malformed cursor before any write", async () => {
    const store = await pagedFixture(3);
    const { store: spy, writes } = counted(store);
    const first = await repointSource({ scope: thread, vectorStore: spy, from: "doc:a", to: "doc:b", authorization: alice, pageSize: 2 });
    assert.ok(first.cursor);
    const writesAfterFirstPage = writes();

    await assert.rejects(
      () => repointSource({ scope: thread, vectorStore: spy, from: "doc:a", to: "doc:c", authorization: alice, cursor: first.cursor }),
      /cursor belongs to another scope or source pair/,
    );
    await assert.rejects(
      () =>
        repointSource({
          scope: { ...thread, threadId: "th2" },
          vectorStore: spy,
          from: "doc:a",
          to: "doc:b",
          authorization: alice,
          cursor: first.cursor,
        }),
      /cursor belongs to another scope or source pair/,
    );
    await assert.rejects(
      () => repointSource({ scope: thread, vectorStore: spy, from: "doc:a", to: "doc:b", authorization: alice, cursor: "not-a-cursor" }),
      /cursor is not a re-point resume token/,
    );
    await assert.rejects(
      () => repointSource({ scope: thread, vectorStore: spy, from: "doc:a", to: "doc:b", authorization: alice, pageSize: 0 }),
      /pageSize must be a positive integer/,
    );
    assert.equal(writes(), writesAfterFirstPage, "every rejection happened before the store was touched");
  });

  it("runs handlers once per page with that page's moved ids", async () => {
    const store = await pagedFixture(5);
    const pages: string[][] = [];
    let cursor: string | undefined;
    do {
      const page = await repointSource({
        scope: thread,
        vectorStore: store,
        from: "doc:a",
        to: "doc:b",
        authorization: alice,
        pageSize: 2,
        handlers: [
          {
            kind: "audit",
            repoint: (context) => {
              pages.push([...context.ids]);
              return context.movedChunks;
            },
          },
        ],
        ...(cursor === undefined ? {} : { cursor }),
      });
      cursor = page.cursor;
    } while (cursor !== undefined);

    assert.deepEqual(pages, [["doc:b#0000", "doc:b#0001"], ["doc:b#0002", "doc:b#0003"], ["doc:b#0004"]]);
  });

  it("keeps the destination collision fail-closed on a later page", async () => {
    const occupied = derived("doc:b#0002", []);
    const store = await pagedFixture(3, [{ ...occupied, text: "already at the destination" }]);

    const first = await repointSource({ scope: thread, vectorStore: store, from: "doc:a", to: "doc:b", authorization: alice, pageSize: 2 });
    assert.equal(first.movedChunks, 2);
    assert.ok(first.cursor);

    await assert.rejects(
      () =>
        repointSource({
          scope: thread,
          vectorStore: store,
          from: "doc:a",
          to: "doc:b",
          authorization: alice,
          pageSize: 2,
          cursor: first.cursor,
        }),
      /destination already holds record/,
    );
    const occupant = (await store.getByThread(thread)).find((record) => record.id === "doc:b#0002");
    assert.equal(occupant?.text, "already at the destination", "the colliding row is never overwritten");
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

describe("host rename batch", () => {
  /** `seeded()` has chunk rows for `doc:a`/`doc:c`, a derived row for `doc:a`, and grants for `doc:a`/`doc:b`. */
  async function renameFixture(extraGrants: readonly string[] = []) {
    const { store } = await seeded();
    if (extraGrants.length > 0) {
      await store.setSourceAccess(
        thread,
        extraGrants.map((sourceId) => ({ sourceId, principalIds: ["alice"], accessVersion: 1 })),
      );
    }
    return { store };
  }

  function sourceIdsOf(records: readonly MemoryVectorRecord[]): string[] {
    return records.flatMap((record) => {
      const rag = record.metadata?._rag;
      if (rag === null || typeof rag !== "object" || Array.isArray(rag)) return [];
      const sourceId = (rag as { sourceId?: unknown }).sourceId;
      return typeof sourceId === "string" ? [sourceId] : [];
    });
  }

  it("applies every pair, runs handlers per rename, and audits one event per rename", async () => {
    const { store } = await renameFixture(["doc:c", "doc:d"]);
    const before = sourceIdsOf(await store.getByThread(thread));
    let scopeReads = 0;
    const counted = {
      ...store,
      async getByThread(scope: Required<MemoryScope>) {
        scopeReads += 1;
        return store.getByThread(scope);
      },
    };
    const events: SourceRenameEvent[] = [];
    const handlerCalls: string[] = [];
    const result = await applySourceRenames({
      scope: thread,
      vectorStore: counted,
      authorization: alice,
      renames: [
        { from: "doc:a", to: "doc:b" },
        { from: "doc:c", to: "doc:d" },
      ],
      handlers: [
        {
          kind: "wiki",
          repoint: (context) => {
            handlerCalls.push(context.from);
            return 1;
          },
        },
      ],
      onRenamed: (event) => events.push(event),
    });
    assert.deepEqual(
      result.results.map((entry) => `${entry.from}->${entry.to}`),
      ["doc:a->doc:b", "doc:c->doc:d"],
    );
    assert.deepEqual(result.failures, []);
    assert.deepEqual(handlerCalls, ["doc:a", "doc:c"], "handlers run once per rename");
    assert.equal(scopeReads, 2, "one scope read per rename: the helper adds no store round trip of its own");

    const moved = events.filter((event): event is Extract<SourceRenameEvent, { readonly outcome: "moved" }> => event.outcome === "moved");
    assert.deepEqual(
      events.map((event) => `${event.outcome}:${event.from}->${event.to}`),
      ["moved:doc:a->doc:b", "moved:doc:c->doc:d"],
    );
    assert.deepEqual(
      moved.map((event) => event.movedChunks),
      [before.filter((id) => id === "doc:a").length, before.filter((id) => id === "doc:c").length],
    );
    assert.deepEqual(
      moved.map((event) => event.layers),
      [{ wiki: 1 }, { wiki: 1 }],
    );

    const after = sourceIdsOf(await store.getByThread(thread));
    assert.deepEqual([...new Set(after)].sort(), ["doc:b", "doc:d"]);
    assert.equal(
      (await store.getByThread(thread)).some((record) => record.id.startsWith("doc:d#")),
      true,
    );
  });

  it("validates the whole batch before the first store read, so a malformed list writes nothing", async () => {
    const { store } = await renameFixture(["doc:c", "doc:d", "doc:e"]);
    let storeCalls = 0;
    const counted = {
      ...store,
      async getByThread(scope: Required<MemoryScope>) {
        storeCalls += 1;
        return store.getByThread(scope);
      },
      async upsert(records: Parameters<typeof store.upsert>[0], options?: { readonly signal?: AbortSignal }) {
        storeCalls += 1;
        return store.upsert(records, options);
      },
      async delete(filter: Parameters<typeof store.delete>[0], options?: { readonly signal?: AbortSignal }) {
        storeCalls += 1;
        return store.delete(filter, options);
      },
    };
    const base = { scope: thread, vectorStore: counted, authorization: alice };
    const malformed: readonly (readonly SourceRename[])[] = [
      [
        { from: "doc:a", to: "doc:b" },
        { from: "doc:a", to: "doc:b" },
      ],
      [
        { from: "doc:a", to: "doc:b" },
        { from: "doc:a", to: "doc:c" },
      ],
      [
        { from: "doc:a", to: "doc:b" },
        { from: "doc:b", to: "doc:c" },
      ],
      [
        { from: "doc:a", to: "doc:b" },
        { from: "doc:c", to: "doc:a" },
      ],
      [{ from: "doc:a", to: "doc:a" }],
      [{ from: "", to: "doc:b" }],
    ];
    for (const renames of malformed) {
      await assert.rejects(() => applySourceRenames({ ...base, renames }), MemoryValidationError);
    }
    await assert.rejects(() => applySourceRenames({ ...base, renames: undefined as unknown as readonly SourceRename[] }), /renames array/);
    await assert.rejects(() => applySourceRenames({ ...base, renames: [null as unknown as SourceRename] }), /pair/);
    assert.equal(storeCalls, 0, "no store read or write happened before validation");
    assert.ok(sourceIdsOf(await store.getByThread(thread)).includes("doc:a"));

    // An empty batch is a no-op, not an error.
    const empty = await applySourceRenames({ ...base, renames: [] });
    assert.deepEqual(empty, { results: [], failures: [] });
    assert.equal(storeCalls, 0);
  });

  it("fails fast: the failed pair writes nothing and later pairs never start", async () => {
    const { store } = await renameFixture(["doc:c"]);
    const events: SourceRenameEvent[] = [];
    await assert.rejects(
      () =>
        applySourceRenames({
          scope: thread,
          vectorStore: store,
          authorization: alice,
          renames: [
            { from: "doc:c", to: "doc:e" },
            { from: "doc:a", to: "doc:b" },
          ],
          onRenamed: (event) => events.push(event),
        }),
      /no live grant for to source/,
    );
    assert.deepEqual(
      events.map((event) => `${event.outcome}:${event.from}->${event.to}`),
      ["failed:doc:c->doc:e"],
      "the un-attempted pair is not audited",
    );
    const ids = sourceIdsOf(await store.getByThread(thread));
    assert.ok(ids.includes("doc:a") && ids.includes("doc:c"), "neither pair moved");
    assert.equal(ids.includes("doc:b"), false);
  });

  it("continueOnError keeps moved pairs, reports the failed one, and never caches an ACL decision", async () => {
    const { store } = await renameFixture(["doc:c", "doc:f", "doc:g"]);
    let checks = 0;
    const counted = {
      ...store,
      async checkSourceAccess(
        scope: Required<MemoryScope>,
        sourceId: string,
        authorization: Parameters<typeof store.checkSourceAccess>[2],
        options?: { readonly signal?: AbortSignal },
      ) {
        checks += 1;
        return store.checkSourceAccess(scope, sourceId, authorization, options);
      },
    };
    const events: SourceRenameEvent[] = [];
    const result = await applySourceRenames({
      scope: thread,
      vectorStore: counted,
      authorization: alice,
      continueOnError: true,
      renames: [
        { from: "doc:a", to: "doc:b" },
        { from: "doc:c", to: "doc:e" },
        { from: "doc:f", to: "doc:g" },
      ],
      onRenamed: (event) => events.push(event),
      redact: (message) => message.replace("no live grant", "«redacted»"),
    });
    assert.deepEqual(
      result.results.map((entry) => entry.to),
      ["doc:b", "doc:g"],
    );
    assert.equal(result.failures.length, 1);
    const [failure] = result.failures;
    assert.equal(failure.from, "doc:c");
    assert.equal(failure.to, "doc:e");
    assert.match(failure.error, /«redacted» for to source/);
    assert.equal(failure.error.includes("no live grant"), false, "the sink redacts the error before it is recorded");
    assert.equal(checks, 6, "both ids of every pair are checked: no decision carries across renames");
    assert.deepEqual(
      events.map((event) => `${event.outcome}:${event.from}->${event.to}`),
      ["moved:doc:a->doc:b", "failed:doc:c->doc:e", "moved:doc:f->doc:g"],
      "the pair after the failure still runs",
    );
    const after = sourceIdsOf(await store.getByThread(thread));
    assert.ok(after.includes("doc:b"), "the pair moved before the failure stays moved");
    assert.ok(after.includes("doc:c"), "the failed pair wrote nothing");
    assert.equal(after.includes("doc:e"), false);
  });

  it("treats an abort as an abort: it stops the batch and is never recorded as a rename failure", async () => {
    const { store } = await renameFixture(["doc:c", "doc:d"]);
    const events: SourceRenameEvent[] = [];
    const controller = new AbortController();
    await assert.rejects(
      () =>
        applySourceRenames({
          scope: thread,
          vectorStore: store,
          authorization: alice,
          continueOnError: true,
          renames: [
            { from: "doc:a", to: "doc:b" },
            { from: "doc:c", to: "doc:d" },
          ],
          signal: controller.signal,
          handlers: [
            {
              kind: "wiki",
              repoint: () => {
                controller.abort();
                return 0;
              },
            },
          ],
          onRenamed: (event) => events.push(event),
        }),
      MemoryAbortError,
    );
    assert.deepEqual(
      events.map((event) => `${event.outcome}:${event.from}->${event.to}`),
      ["moved:doc:a->doc:b"],
      "the committed rename is audited, the aborted one is not a failure",
    );
    const ids = sourceIdsOf(await store.getByThread(thread));
    assert.ok(ids.includes("doc:b"));
    assert.ok(ids.includes("doc:c"));
  });
});
