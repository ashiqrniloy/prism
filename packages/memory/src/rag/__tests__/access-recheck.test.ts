/**
 * Plan 089 Task 3: mid-turn source-grant recheck at the retrieval boundary.
 *
 * Retrieval must never use a grant snapshot. These tests pin the observable contract:
 * a revoke that lands between turns (or while a query is in flight, even during
 * rerank) excludes the source from the result the caller receives; one store lookup
 * per distinct source per query; absent grants and thrown store errors fail closed
 * with an audit event instead of aborting the query; and abort stays an abort.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHashEmbedder, createMemoryVectorStore, type MemoryScope, type RagAccessConstraint, type VectorStore } from "../../index.js";
import { type AccessDenial, chunkText, createAccessRecheck, indexChunks, type RagHit, type Reranker, retrieveContext } from "../index.js";

const scope = { tenantId: "tenant-a", resourceId: "docs", corpusId: "handbook" };
const thread: Required<MemoryScope> = { tenantId: scope.tenantId, resourceId: scope.resourceId, threadId: scope.corpusId };
const alice: RagAccessConstraint = { principalId: "alice", tenantId: scope.tenantId };

async function seeded() {
  const embedder = createHashEmbedder({ dimensions: 8 });
  const store = createMemoryVectorStore();
  await indexChunks({
    chunks: [
      ...chunkText("approval policy handbook for engineers", { sourceId: "doc:a" }),
      ...chunkText("secret merger terms stay hidden", { sourceId: "doc:b" }),
    ],
    embedder,
    store,
    scope,
  });
  await store.setSourceAccess(thread, [
    { sourceId: "doc:a", principalIds: ["alice"], accessVersion: 1 },
    { sourceId: "doc:b", principalIds: ["alice"], accessVersion: 1 },
  ]);
  return { embedder, store };
}

/** Counts `checkSourceAccess` calls while delegating to the real store. */
function counting(store: VectorStore, onCheck?: () => void): VectorStore & { checks: string[] } {
  const checks: string[] = [];
  return {
    ...store,
    checks,
    async checkSourceAccess(scopeInput, sourceId, authorization, options) {
      checks.push(sourceId);
      onCheck?.();
      return store.checkSourceAccess!(scopeInput, sourceId, authorization, options);
    },
  } as VectorStore & { checks: string[] };
}

describe("mid-turn source-grant recheck", () => {
  it("revokes between turns, and withholds what the store leg failed to filter", async () => {
    const { embedder, store } = await seeded();
    const spied = counting(store);
    const first = await retrieveContext("approval policy handbook secret merger", {
      embedder,
      store: spied,
      scope,
      lexical: "fts",
      authorization: alice,
    });
    assert.ok(first.hits.some((hit) => hit.sourceId === "doc:a"));
    assert.ok(first.hits.some((hit) => hit.sourceId === "doc:b"));
    // One lookup per distinct source, not per candidate hit.
    assert.deepEqual([...new Set(spied.checks)].sort(), ["doc:a", "doc:b"]);
    assert.equal(spied.checks.length, new Set(spied.checks).size);

    // Mid-turn revoke: the grant is re-stamped empty (the memory store upserts per source).
    await store.setSourceAccess(thread, [
      { sourceId: "doc:a", principalIds: ["alice"], accessVersion: 2 },
      { sourceId: "doc:b", principalIds: [], accessVersion: 2 },
    ]);
    const second = await retrieveContext("approval policy handbook secret merger", {
      embedder,
      store: spied,
      scope,
      lexical: "fts",
      authorization: alice,
    });
    assert.equal(
      second.hits.some((hit) => hit.sourceId === "doc:b"),
      false,
    );
    assert.ok(second.hits.length > 0);

    // A store whose query leg ignores grants still cannot leak: the boundary withholds
    // and reports. This is the audit path for in-flight revokes and non-filtering stores.
    const denials: AccessDenial[] = [];
    const blind: VectorStore = {
      ...store,
      async query(input) {
        return store.query({ ...input, authorization: undefined });
      },
      async lexicalQuery(input) {
        return store.lexicalQuery!({ ...input, authorization: undefined });
      },
    };
    const third = await retrieveContext("approval policy handbook secret merger", {
      embedder,
      store: blind,
      scope,
      lexical: "fts",
      authorization: alice,
      onAccessDenied: (denial) => denials.push(denial),
    });
    assert.equal(
      third.hits.some((hit) => hit.sourceId === "doc:b"),
      false,
    );
    assert.ok(third.hits.some((hit) => hit.sourceId === "doc:a"));
    assert.equal(denials.length, 1);
    assert.equal(denials[0]!.sourceId, "doc:b");
    assert.equal(denials[0]!.reason, "no_grant");
    assert.ok(denials[0]!.hits >= 1);
    assert.equal(denials[0]!.scope.threadId, scope.corpusId);
  });

  it("raises the boundary's own denial event for a source the store's predicate withheld", async () => {
    const embedder = createHashEmbedder({ dimensions: 8 });
    const store = createMemoryVectorStore();
    await indexChunks({
      chunks: [
        ...chunkText(Array.from({ length: 20 }, (_, index) => `revoked row ${index + 1} about the approval policy`).join(" "), {
          sourceId: "doc:b",
        }),
        ...chunkText("approval policy handbook for engineers", { sourceId: "doc:a" }),
      ],
      embedder,
      store,
      scope,
    });
    await store.setSourceAccess(thread, [{ sourceId: "doc:a", principalIds: ["alice"], accessVersion: 1 }]);

    // Store-filtered: both legs withhold doc:b inside their own predicate, so the boundary never sees a
    // hit for it. 20 withheld rows of one source are one event, not one per row or one per leg.
    const events: AccessDenial[] = [];
    const found = await retrieveContext("approval policy handbook", {
      embedder,
      store,
      scope,
      lexical: "fts",
      authorization: alice,
      onAccessDenied: (denial) => events.push(denial),
    });
    assert.ok(found.hits.some((hit) => hit.sourceId === "doc:a"));
    assert.equal(
      found.hits.some((hit) => hit.sourceId === "doc:b"),
      false,
    );
    assert.equal(events.length, 1);
    const [event] = events;
    assert.ok(event);
    assert.equal(event.sourceId, "doc:b");
    assert.equal(event.reason, "no_grant");
    assert.equal(event.hits, 0, "no hit existed for the boundary to withhold");
    assert.equal(event.scope.threadId, scope.corpusId);
    assert.equal("error" in event, false);

    // Parity: a store that filters nothing raises the same event for the same source at the boundary.
    const lexicalQuery = store.lexicalQuery;
    assert.ok(lexicalQuery);
    const blind: VectorStore = {
      ...store,
      async query(input) {
        return store.query({ ...input, authorization: undefined });
      },
      async lexicalQuery(input) {
        return lexicalQuery({ ...input, authorization: undefined });
      },
    };
    const boundary: AccessDenial[] = [];
    await retrieveContext("approval policy handbook", {
      embedder,
      store: blind,
      scope,
      lexical: "fts",
      authorization: alice,
      onAccessDenied: (denial) => boundary.push(denial),
    });
    assert.equal(boundary.length, 1);
    const [boundaryEvent] = boundary;
    assert.ok(boundaryEvent);
    assert.ok(boundaryEvent.hits > 0);
    assert.deepEqual({ ...boundaryEvent, hits: 0 }, event, "only the withheld-hit count can differ");

    // Opt-in: without an audit sink the store is never asked for a report, so it pays nothing for one.
    const asked: unknown[] = [];
    const watched: VectorStore = {
      ...store,
      async query(input) {
        asked.push(input.onDeniedSources);
        return store.query(input);
      },
    };
    await retrieveContext("approval policy handbook", { embedder, store: watched, scope, lexical: "off", authorization: alice });
    assert.deepEqual(asked, [undefined]);
  });

  it("rechecks again after rerank, so a revoke during rerank cannot leak the hit", async () => {
    const { embedder, store } = await seeded();
    let revoked = false;
    const reranker: Reranker = {
      async rerank({ hits }) {
        // A grant change landing while the query is in flight.
        await store.setSourceAccess(thread, [
          { sourceId: "doc:a", principalIds: ["alice"], accessVersion: 2 },
          { sourceId: "doc:b", principalIds: [], accessVersion: 2 },
        ]);
        revoked = true;
        return hits.map((hit, index) => ({ ...hit, score: 1 - index / 10 }));
      },
    };
    const denials: AccessDenial[] = [];
    const result = await retrieveContext("secret merger terms", {
      embedder,
      store,
      scope,
      lexical: "off",
      authorization: alice,
      reranker,
      onAccessDenied: (denial) => denials.push(denial),
    });
    assert.equal(revoked, true);
    assert.equal(
      result.hits.some((hit) => hit.sourceId === "doc:b"),
      false,
    );
    assert.equal(denials.length, 1);
    assert.equal(denials[0]!.sourceId, "doc:b");
    assert.equal(denials[0]!.reason, "no_grant");
    assert.ok(denials[0]!.hits >= 1);
  });

  it("fails closed with a redacted audit event when the grant lookup throws", async () => {
    const { embedder, store } = await seeded();
    const failing: VectorStore = {
      ...store,
      async checkSourceAccess() {
        throw new Error("acl store unreachable: token boom-secret");
      },
    };
    const denials: AccessDenial[] = [];
    const result = await retrieveContext("approval policy handbook", {
      embedder,
      store: failing,
      scope,
      lexical: "off",
      authorization: alice,
      secrets: ["boom-secret"],
      onAccessDenied: (denial) => denials.push(denial),
    });
    assert.equal(result.hits.length, 0);
    assert.equal(result.text, "");
    assert.ok(denials.length >= 1);
    assert.equal(
      denials.every((denial) => denial.reason === "check_failed"),
      true,
    );
    assert.equal(
      denials.every((denial) => !denial.error?.includes("boom-secret")),
      true,
    );
    assert.ok(denials[0]!.error?.includes("[REDACTED]") || denials[0]!.error?.includes("acl store unreachable"));
  });

  it("keeps rechecking when no audit sink is supplied and never turns abort into a denial", async () => {
    const { embedder, store } = await seeded();
    await store.setSourceAccess(thread, [
      { sourceId: "doc:a", principalIds: [], accessVersion: 2 },
      { sourceId: "doc:b", principalIds: [], accessVersion: 2 },
    ]);
    const revoked = await retrieveContext("secret merger terms", {
      embedder,
      store,
      scope,
      lexical: "off",
      authorization: alice,
    });
    assert.equal(revoked.hits.length, 0);

    const controller = new AbortController();
    const aborting: VectorStore = {
      ...(await seeded()).store,
      async checkSourceAccess(_scope, _sourceId, _authorization, options) {
        // The recheck forwards the caller's signal so a host can cancel the lookup.
        assert.equal(options?.signal, controller.signal);
        controller.abort();
        throw new Error("store saw the abort");
      },
    };
    await assert.rejects(
      () =>
        retrieveContext("secret merger terms", {
          embedder,
          store: aborting,
          scope,
          lexical: "off",
          authorization: alice,
          signal: controller.signal,
        }),
      /abort/i,
    );
  });
  it("checks each distinct source once per query, inside the 5ms budget for 50 sources", async () => {
    // 200 candidate hits over 50 distinct sources: the store must see 50 lookups, not 200.
    const hits: RagHit[] = [];
    for (let source = 0; source < 50; source += 1) {
      for (let chunk = 0; chunk < 4; chunk += 1) {
        const id = `doc:${source}#${String(chunk + 1).padStart(4, "0")}`;
        hits.push({
          id,
          citationId: id,
          sourceId: `doc:${source}`,
          index: chunk,
          start: 0,
          end: 4,
          text: "text",
          score: 1,
          retrievalRank: chunk,
          provenance: {
            sourceId: `doc:${source}`,
            chunkId: id,
            citationId: id,
            provider: "host",
            tenantId: scope.tenantId,
            resourceId: scope.resourceId,
            corpusId: scope.corpusId,
            retrieval: "vector",
            retrievedAt: "0",
          },
          trust: { untrusted: true, inert: true, injectionCapable: true },
        });
      }
    }
    let lookups = 0;
    const store = {
      authorization: "acl",
      async checkSourceAccess() {
        lookups += 1;
        return true;
      },
    } as unknown as VectorStore;
    const durations: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const recheck = createAccessRecheck({ store, authorization: alice });
      const started = performance.now();
      for (const hit of hits) assert.equal(await recheck.allows(hit), true);
      durations.push(performance.now() - started);
      assert.equal(recheck.report().length, 0);
    }
    assert.equal(lookups, 50 * durations.length);
    durations.sort((left, right) => left - right);
    // Median of 5 runs over an in-memory store: the hook's own cost, well inside the budget.
    assert.ok(durations[2]! < 5, `recheck median ${durations[2]}ms exceeds 5ms`);
  });
});
