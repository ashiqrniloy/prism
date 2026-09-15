import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { type CheckpointStore, createMemoryCheckpointStore } from "@arnilo/prism";
import { createHashEmbedder, createMemoryVectorStore } from "../../index.js";
import { RagSyncCursorError, RagSyncThrottleError, RagValidationError } from "../errors.js";
import { createMemoryIngestionStatusStore } from "../ingestion-status.js";
import { retrieveContext } from "../retrieve.js";
import { type KnowledgeChange, type KnowledgeChangePage, type KnowledgeConnector, syncKnowledge } from "../sync.js";

const scope = { tenantId: "tenant-a", resourceId: "docs", corpusId: "drive" };
const checkpoint = { namespace: "prism.rag.sync", key: "drive-demo", tenantId: scope.tenantId };

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function upsert(sourceId: string, text: string, principalIds: readonly string[], groupIds: readonly string[] = []): KnowledgeChange {
  return {
    kind: "upsert",
    sourceId,
    text,
    contentHash: sha(text),
    grants: { sourceId, principalIds, groupIds, accessVersion: 1 },
  };
}

function pages(map: Record<string, KnowledgeChangePage>, missing?: (cursor?: string) => Promise<KnowledgeChangePage>): KnowledgeConnector {
  return {
    async listChanges(input) {
      const key = input.cursor ?? "";
      if (map[key]) return map[key]!;
      if (missing) return missing(input.cursor);
      throw new RagSyncCursorError(`unknown cursor ${key}`);
    },
  };
}

function countingEmbedder() {
  const inner = createHashEmbedder({ dimensions: 8 });
  let calls = 0;
  return {
    embedder: {
      id: inner.id,
      dimensions: inner.dimensions,
      async embed(texts: readonly string[], options?: { readonly signal?: AbortSignal }) {
        calls += 1;
        return inner.embed(texts, options);
      },
    },
    calls: () => calls,
  };
}

async function run(connector: KnowledgeConnector, extra: Partial<Parameters<typeof syncKnowledge>[0]> = {}) {
  const counted = countingEmbedder();
  const store = extra.store ?? createMemoryVectorStore();
  const statusStore = extra.statusStore ?? createMemoryIngestionStatusStore();
  const checkpoints = extra.checkpoints ?? createMemoryCheckpointStore();
  const result = await syncKnowledge({
    connector,
    checkpoints,
    checkpoint,
    store,
    scope,
    statusStore,
    pageSize: 10,
    maxPages: 8,
    sleep: async () => undefined,
    ...extra,
    embedder: extra.embedder ?? counted.embedder,
  });
  return { result, store, statusStore, checkpoints, embedCalls: counted.calls };
}

describe("knowledge sync", () => {
  it("indexes authorized sources, hides others, and reuses embeddings on replay", async () => {
    const docs = [upsert("doc-a", "alpha policy text", ["alice"]), upsert("doc-b", "secret policy text", ["bob"])];
    const connector = pages({
      "": { changes: docs, resumeCursor: "c1", done: true },
      c1: { changes: docs, resumeCursor: "c1", done: true },
    });
    const first = await run(connector);
    assert.equal(first.result.upserted, 2);
    assert.equal(first.result.exhausted, true);
    const alice = await retrieveContext("policy", {
      embedder: createHashEmbedder({ dimensions: 8 }),
      store: first.store,
      scope,
      authorization: { principalId: "alice", tenantId: scope.tenantId },
      lexical: "off",
    });
    assert.equal(alice.hits.length, 1);
    assert.equal(alice.hits[0]?.sourceId, "doc-a");
    assert.equal(alice.text.includes("secret"), false);
    assert.ok(first.embedCalls() > 0);
    const counted = countingEmbedder();
    const replay = await syncKnowledge({
      connector,
      checkpoints: first.checkpoints,
      checkpoint,
      store: first.store,
      embedder: counted.embedder,
      scope,
      statusStore: first.statusStore,
      sleep: async () => undefined,
    });
    assert.equal(replay.skipped, 2);
    assert.equal(counted.calls(), 0);
  });

  it("does not advance the cursor when checkpoint CAS crashes, then replays without embedding", async () => {
    const inner = createMemoryCheckpointStore();
    let boom = true;
    const checkpoints: CheckpointStore = {
      saveCheckpoint: async (input) => {
        if (boom) {
          boom = false;
          throw new Error("crash");
        }
        return inner.saveCheckpoint(input);
      },
      loadCheckpoint: (input) => inner.loadCheckpoint(input),
      listCheckpoints: (query) => inner.listCheckpoints(query),
      deleteCheckpoint: (input) => inner.deleteCheckpoint(input),
    };
    const counted = countingEmbedder();
    const store = createMemoryVectorStore();
    const connector = pages({
      "": { changes: [upsert("doc-a", "alpha policy text", ["alice"])], resumeCursor: "c1", done: true },
    });
    await assert.rejects(
      () =>
        syncKnowledge({
          connector,
          checkpoints,
          checkpoint,
          store,
          embedder: counted.embedder,
          scope,
          sleep: async () => undefined,
        }),
      /crash/,
    );
    assert.equal(counted.calls(), 1);
    assert.equal((await inner.loadCheckpoint(checkpoint))?.value, undefined);
    await syncKnowledge({
      connector,
      checkpoints,
      checkpoint,
      store,
      embedder: counted.embedder,
      scope,
      sleep: async () => undefined,
    });
    assert.equal(counted.calls(), 1);
    const saved = await inner.loadCheckpoint(checkpoint);
    assert.equal(saved && typeof saved.value === "object" && saved.value && "cursor" in saved.value ? saved.value.cursor : undefined, "c1");
  });

  it("deletes, revokes groups, and withholds stale/unavailable sources", async () => {
    const store = createMemoryVectorStore();
    const statusStore = createMemoryIngestionStatusStore();
    const checkpoints = createMemoryCheckpointStore();
    const counted = countingEmbedder();
    const opts = {
      checkpoints,
      checkpoint,
      store,
      embedder: counted.embedder,
      scope,
      statusStore,
      sleep: async () => {},
    };
    await syncKnowledge({
      ...opts,
      connector: pages({
        "": {
          changes: [upsert("doc-a", "visible policy", ["alice"], ["eng"]), upsert("doc-b", "other policy", ["bob"])],
          resumeCursor: "c1",
          done: true,
        },
      }),
    });
    await syncKnowledge({
      ...opts,
      connector: pages({
        c1: {
          changes: [
            { kind: "delete", sourceId: "doc-b" },
            { kind: "acl", sourceId: "doc-a", grants: { sourceId: "doc-a", principalIds: ["alice"], groupIds: [], accessVersion: 1 } },
            { kind: "withhold", sourceId: "doc-c", freshness: "stale" },
          ],
          resumeCursor: "c2",
          done: true,
        },
      }),
    });
    const group = await retrieveContext("policy", {
      embedder: counted.embedder,
      store,
      scope,
      authorization: { principalId: "other", tenantId: scope.tenantId, groupIds: ["eng"] },
      lexical: "off",
    });
    assert.equal(group.hits.length, 0);
    const alice = await retrieveContext("policy", {
      embedder: counted.embedder,
      store,
      scope,
      authorization: { principalId: "alice", tenantId: scope.tenantId },
      lexical: "off",
    });
    assert.equal(alice.hits.length, 1);
    const listed = await statusStore.list(scope, { limit: 20 });
    assert.equal(listed.entries.find((entry) => entry.sourceId === "doc-c")?.freshness, "stale");
    assert.equal(listed.entries.find((entry) => entry.sourceId === "doc-a")?.freshness, "current");
  });

  it("resyncs an invalid cursor, retries throttle, and fails closed without ACL", async () => {
    let throttled = false;
    const connector: KnowledgeConnector = {
      async listChanges(input) {
        if (input.cursor === "bad") throw new RagSyncCursorError();
        if (!throttled) {
          throttled = true;
          throw new RagSyncThrottleError(1);
        }
        return { changes: [upsert("doc-a", "alpha policy text", ["alice"])], resumeCursor: "ok", done: true };
      },
    };
    const checkpoints = createMemoryCheckpointStore();
    await checkpoints.saveCheckpoint({
      ...checkpoint,
      version: 1,
      expectedVersion: 0,
      value: { v: 1, cursor: "bad" },
    });
    const sleeps: number[] = [];
    const result = await syncKnowledge({
      connector,
      checkpoints,
      checkpoint,
      store: createMemoryVectorStore(),
      embedder: createHashEmbedder({ dimensions: 8 }),
      scope,
      onInvalidCursor: "resync",
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    assert.equal(result.upserted, 1);
    assert.deepEqual(sleeps, [1]);
    await assert.rejects(
      () =>
        syncKnowledge({
          connector: pages({ "": { changes: [upsert("doc-a", "x", ["alice"])], resumeCursor: "c1", done: true } }),
          checkpoints: createMemoryCheckpointStore(),
          checkpoint,
          store: { upsert: async () => undefined, query: async () => [], delete: async () => 0 } as never,
          embedder: createHashEmbedder({ dimensions: 8 }),
          scope,
          sleep: async () => undefined,
        }),
      RagValidationError,
    );
  });

  it("observes abort and treats missing grants as unavailable", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () =>
        syncKnowledge({
          connector: pages({ "": { changes: [], resumeCursor: "c1", done: true } }),
          checkpoints: createMemoryCheckpointStore(),
          checkpoint,
          store: createMemoryVectorStore(),
          embedder: createHashEmbedder({ dimensions: 8 }),
          scope,
          signal: controller.signal,
        }),
      /aborted/i,
    );
    const statusStore = createMemoryIngestionStatusStore();
    await syncKnowledge({
      connector: pages({
        "": {
          changes: [{ kind: "upsert", sourceId: "open", text: "no grants", contentHash: sha("no grants") }],
          resumeCursor: "c1",
          done: true,
        },
      }),
      checkpoints: createMemoryCheckpointStore(),
      checkpoint,
      store: createMemoryVectorStore(),
      embedder: createHashEmbedder({ dimensions: 8 }),
      scope,
      statusStore,
      sleep: async () => undefined,
    });
    const listed = await statusStore.list(scope, { limit: 10 });
    assert.equal(listed.entries[0]?.freshness, "unavailable");
  });
});
