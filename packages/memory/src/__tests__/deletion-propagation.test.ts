/**
 * Plan 089 Task 1: deletion propagation through derived artifacts.
 *
 * Covers the orchestration contract (lineage-closed tombstone set, one batched
 * transaction, registered handlers), the query-time tombstone guard on the RAG
 * path, privilege (existing memory ACL), wiki projection retirement, and the
 * bounded 1k-artifact propagation budget.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createDeletionPropagator,
  createHashEmbedder,
  createMemory,
  createMemoryVectorStore,
  type MemoryScope,
  MemoryScopeError,
  MemoryValidationError,
  type MemoryVectorRecord,
} from "../index.js";
import { createRagDeletionHandler, chunkText, replaceSource, retrieveContext } from "../rag/index.js";
import { createWikiDeletionHandler, retireWikiSources } from "../wiki/index.js";
import type { RagScope } from "../rag/types.js";

const scope: Required<MemoryScope> = { tenantId: "t1", resourceId: "r1", threadId: "th1" };
const authority = { tenantId: "t1", principalId: "p1", groupIds: ["eng"] };

function record(id: string, sourceIds: readonly string[] = []): MemoryVectorRecord {
  return {
    id,
    tenantId: scope.tenantId,
    resourceId: scope.resourceId,
    threadId: scope.threadId,
    text: id,
    embedding: [1, 0],
    sequence: 0,
    createdAt: new Date(0).toISOString(),
    metadata: sourceIds.length > 0 ? { _lineage: { v: 1, sourceIds: [...sourceIds] } } : {},
  };
}

describe("deletion propagation", () => {
  it("tombstones the lineage-closed set in one transaction and dispatches registered handlers", async () => {
    const store = createMemoryVectorStore();
    await store.upsert([
      record("doc:erp", []),
      record("summary:erp", ["doc:erp"]),
      record("summary:erp:digest", ["summary:erp"]),
      record("note:other", []),
    ]);
    await store.setSourceAccess(scope, [{ sourceId: "doc:erp", principalIds: ["p1"], groupIds: [], accessVersion: 3 }]);
    let transactions = 0;
    const counted = {
      ...store,
      async transaction<T>(operation: (view: typeof store) => Promise<T>, options?: { readonly signal?: AbortSignal }): Promise<T> {
        transactions += 1;
        return store.transaction(operation as never, options) as Promise<T>;
      },
    };
    const seen: string[][] = [];
    const counts: number[] = [];
    const propagator = createDeletionPropagator({
      scope,
      vectorStore: counted,
      authorization: authority,
      handlers: [
        {
          kind: "observational",
          delete: ({ ids }) => {
            seen.push([...ids]);
            counts.push(ids.length);
            return ids.length;
          },
        },
      ],
    });
    propagator.register({ kind: "wiki", delete: () => 1 });
    assert.deepEqual([...propagator.kinds], ["observational", "wiki"]);
    assert.throws(() => propagator.register({ kind: "wiki", delete: () => 0 }), MemoryValidationError);

    const result = await propagator.propagate("doc:erp");
    assert.deepEqual([...result.ids].sort(), ["doc:erp", "summary:erp", "summary:erp:digest"]);
    assert.equal(result.tombstoned, 3);
    assert.equal(result.batched, true);
    assert.equal(transactions, 1);
    assert.deepEqual(result.layers, { observational: 3, wiki: 1 });
    assert.deepEqual(seen, [["doc:erp", "summary:erp", "summary:erp:digest"]]);

    // Tombstones, not dangling rows: every row survives for explainability.
    assert.equal((await store.getByThread(scope)).length, 4);
    const tombstones = await store.listInvalidated(scope);
    assert.deepEqual(tombstones.map((entry) => entry.id).sort(), ["doc:erp", "summary:erp", "summary:erp:digest"]);
    assert.ok(tombstones.every((entry) => entry.reason === "forgotten" && entry.hold !== true));

    // Retrieval returns zero hits for deleted content.
    const memory = createMemory({ ...scope, embedder: createHashEmbedder({ dimensions: 2 }), vectorStore: store });
    const hits = await memory.recall("summary", { topK: 5 });
    assert.equal(
      hits.hits.some((hit) => hit.id !== "note:other"),
      false,
    );
    assert.ok((await memory.recall("note", { topK: 5 })).hits.some((hit) => hit.id === "note:other"));
  });

  it("fails closed for a principal the source ACL does not grant (and retrieval never propagates)", async () => {
    const store = createMemoryVectorStore();
    await store.upsert([record("doc:payroll", []), record("summary:payroll", ["doc:payroll"])]);
    await store.setSourceAccess(scope, [{ sourceId: "doc:payroll", principalIds: ["p1"], groupIds: [], accessVersion: 1 }]);
    const propagator = createDeletionPropagator({
      scope,
      vectorStore: store,
      authorization: { tenantId: "t1", principalId: "p2", groupIds: [] },
    });
    await assert.rejects(propagator.propagate("doc:payroll"), MemoryScopeError);
    assert.deepEqual(await store.listInvalidated(scope), []);
    assert.equal((await store.getByThread(scope)).length, 2);

    const ungranted = createDeletionPropagator({ scope, vectorStore: store, authorization: authority });
    await assert.rejects(ungranted.propagate("doc:no-grant"), MemoryScopeError);
    assert.deepEqual(await store.listInvalidated(scope), []);

    const misconfigured = createDeletionPropagator({ scope, vectorStore: store, authorization: authority });
    misconfigured.register({ kind: "bad", delete: () => -1 });
    await assert.rejects(misconfigured.propagate("doc:payroll"), MemoryValidationError);
  });

  it("filters in-flight RAG hits through the tombstone guard without a physical purge", async () => {
    const store = createMemoryVectorStore();
    const embedder = createHashEmbedder({ dimensions: 8 });
    const ragScope: RagScope = { tenantId: "t1", resourceId: "r1", corpusId: "corpus" };
    const chunks = chunkText("erp lead policy paragraph", { sourceId: "doc:erp", size: 64, overlap: 0 });
    await replaceSource({ sourceId: "doc:erp", chunks, embedder, store, scope: ragScope });
    const chunksBefore = await store.getBySource(
      { tenantId: ragScope.tenantId, resourceId: ragScope.resourceId, threadId: ragScope.corpusId },
      "doc:erp",
    );
    assert.ok(chunksBefore.length > 0);
    await store.setSourceAccess({ tenantId: ragScope.tenantId, resourceId: ragScope.resourceId, threadId: ragScope.corpusId }, [
      { sourceId: "doc:erp", principalIds: ["p1"], groupIds: [], accessVersion: 1 },
    ]);

    // Delete lands after the query leg read its rows: only the guard can exclude them.
    let fired = false;
    const inflight = {
      ...store,
      async query(query: Parameters<typeof store.query>[0]) {
        const hits = await store.query(query);
        if (!fired) {
          fired = true;
          const propagator = createDeletionPropagator({
            scope: { tenantId: "t1", resourceId: "r1", threadId: "corpus" },
            vectorStore: store,
            authorization: authority,
          });
          await propagator.propagate("doc:erp");
        }
        return hits;
      },
    };
    const result = await retrieveContext("erp lead", { scope: ragScope, store: inflight, embedder, lexical: "off", topK: 5 });
    assert.equal(fired, true);
    assert.equal(result.hits.length, 0);
    assert.equal(result.text, "");
    assert.equal(
      (await store.getBySource({ tenantId: ragScope.tenantId, resourceId: ragScope.resourceId, threadId: ragScope.corpusId }, "doc:erp"))
        .length,
      chunksBefore.length,
      "guard filters hits; the rows are still there for the registered handler to remove",
    );

    // The registered RAG handler is what removes the rows.
    const handler = createRagDeletionHandler({ store, scope: ragScope });
    assert.equal(await handler.delete({ sourceId: "doc:erp", ids: [], scope, signal: undefined }), chunksBefore.length);
    assert.deepEqual(
      await store.getBySource({ tenantId: ragScope.tenantId, resourceId: ragScope.resourceId, threadId: ragScope.corpusId }, "doc:erp"),
      [],
    );
  });

  it("deletes a 1k-artifact document in one batched transaction under 2s", async () => {
    const store = createMemoryVectorStore();
    const derived: MemoryVectorRecord[] = [record("doc:large", [])];
    for (let index = 0; index < 1_000; index += 1) derived.push(record(`summary:large:${index}`, ["doc:large"]));
    await store.upsert(derived);
    await store.setSourceAccess(scope, [{ sourceId: "doc:large", principalIds: ["p1"], groupIds: [], accessVersion: 1 }]);
    let transactions = 0;
    const counted = {
      ...store,
      async transaction<T>(operation: (view: typeof store) => Promise<T>, options?: { readonly signal?: AbortSignal }): Promise<T> {
        transactions += 1;
        return store.transaction(operation as never, options) as Promise<T>;
      },
    };
    const propagator = createDeletionPropagator({ scope, vectorStore: counted, authorization: authority });
    const started = Date.now();
    const result = await propagator.propagate("doc:large");
    const elapsed = Date.now() - started;
    assert.equal(result.tombstoned, 1_001);
    assert.equal(transactions, 1);
    assert.ok(elapsed < 2_000, `propagation took ${elapsed}ms`);
    assert.equal((await store.listInvalidated(scope)).length, 1_001);
  });
});

describe("wiki projection retirement", () => {
  function entity(id: string, rawSources: readonly string[], anchors: readonly string[]) {
    return {
      id,
      title: id,
      category: "module" as const,
      tags: [],
      rawSources,
      anchors: anchors.map((filePath) => ({ filePath, startLine: 1, endLine: 1 })),
      lastCompiledAt: new Date(0).toISOString(),
    };
  }

  async function fixture() {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "prism-wiki-retire-"));
    const wikiRoot = join(workspaceRoot, ".wiki");
    await mkdir(join(wikiRoot, "entities"), { recursive: true });
    await writeFile(
      join(wikiRoot, ".manifest.json"),
      JSON.stringify(
        {
          version: "1.0.0",
          profile: "codebase",
          wikiRoot,
          rawRoots: ["docs"],
          sourceFileHashes: { "docs/a.md": "a", "docs/b.md": "b", "docs/c.md": "c" },
          entities: {
            alpha: entity("alpha", ["docs/a.md", "docs/b.md"], ["docs/a.md", "docs/b.md"]),
            beta: entity("beta", ["docs/b.md"], ["docs/b.md"]),
            gamma: entity("gamma", ["docs/c.md"], ["docs/c.md"]),
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    for (const id of ["alpha", "beta", "gamma"]) await writeFile(join(wikiRoot, "entities", `${id}.md`), `# ${id}\n`, "utf8");
    const manifest = async () => JSON.parse(await readFile(join(wikiRoot, ".manifest.json"), "utf8"));
    return { workspaceRoot, wikiRoot, manifest };
  }

  it("retires fully-derived pages, prunes shared ones, and logs the tombstone", async () => {
    const { workspaceRoot, wikiRoot, manifest } = await fixture();
    const result = await retireWikiSources({ workspaceRoot, sourcePaths: ["./docs/a.md"], at: "2026-05-01T00:00:00.000Z" });
    assert.deepEqual([...result.retired], []);
    assert.deepEqual([...result.pruned], ["alpha"]);
    assert.deepEqual([...result.removedSources], ["docs/a.md"]);
    const next = await manifest();
    assert.deepEqual(next.entities.alpha.rawSources, ["docs/b.md"]);
    assert.deepEqual(
      next.entities.alpha.anchors.map((anchor: { filePath: string }) => anchor.filePath),
      ["docs/b.md"],
    );
    assert.equal(next.sourceFileHashes["docs/a.md"], undefined);
    assert.match(await readFile(join(wikiRoot, "log.md"), "utf8"), /Retired.*deleted sources: docs\/a\.md/);

    const second = await retireWikiSources({ workspaceRoot, sourcePaths: ["docs/b.md"] });
    assert.deepEqual([...second.retired], ["alpha", "beta"]);
    assert.deepEqual([...second.removedSources], ["docs/b.md"]);
    const finalManifest = await manifest();
    assert.deepEqual(Object.keys(finalManifest.entities), ["gamma"]);
    assert.equal(finalManifest.sourceFileHashes["docs/b.md"], undefined);
    await assert.rejects(readFile(join(wikiRoot, "entities", "beta.md"), "utf8"));
    assert.match(await readFile(join(wikiRoot, "index.md"), "utf8"), /gamma/);

    // Handler default: the prism source id is the raw path.
    const handler = createWikiDeletionHandler({ workspaceRoot });
    assert.equal(await handler.delete({ sourceId: "docs/c.md", ids: [], scope, signal: undefined }), 1);
    assert.deepEqual(Object.keys((await manifest()).entities), []);
    await rm(workspaceRoot, { recursive: true, force: true });
  });
});
