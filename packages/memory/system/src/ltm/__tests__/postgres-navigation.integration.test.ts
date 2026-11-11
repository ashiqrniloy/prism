/**
 * Plan 202 Task 5.6: Task 5 (session addressing, `memory.read` around/session navigation, lexical
 * recall) against a real PostgreSQL. The PostgreSQL vector store has no `listBySession`, so
 * navigation uses the fabric's status-emitting `scanMetadata` fallback; these cases prove that path
 * (and that it is the path taken), compare it with the SQLite indexed path, and cross the scan's
 * 200-row cursor boundary.
 *
 * Skipped with a named reason when `PRISM_TEST_POSTGRES_URL` is unset. Never prints the URL. Each
 * case uses a unique schema dropped in `finally`.
 */

import { afterAll as after, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSecretRedactor, type ToolExecutionContext } from "@arnilo/prism";
import type { MemoryVectorRecord, VectorStore } from "@arnilo/prism-memory-system/core";
import { createPostgresMemoryStores } from "@arnilo/prism-memory-system/core/postgres";
import { createSqliteMemoryStores } from "@arnilo/prism-memory-system/core/sqlite";
import { Pool } from "pg";
import { createExchangeArchive } from "../exchanges.js";
import { createMemory, createLongTermMemory, parseMemoryNoteMetadata } from "../../index.js";

const postgresUrl = process.env.PRISM_TEST_POSTGRES_URL;
const describeIntegration = postgresUrl ? describe : describe.skip;
if (!postgresUrl) console.log("skip: PRISM_TEST_POSTGRES_URL is unset; Task 5.6 PostgreSQL navigation cases did not run");

const context: ToolExecutionContext = { sessionId: "caller", runId: "run", toolCallId: "call" };
const DIMENSIONS = 8;
const scope = { tenantId: "t", resourceId: "r", threadId: "archive" } as const;
const hex = (i: number): string => i.toString(16).padStart(12, "0");
const day = (i: number): string => `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`;

type ReadResult = { notes: { id: string; session: string; content: string }[]; reason?: string };

function uniqueSchema(): string {
  return `prism_nav_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Counts `scanMetadata` pages and the rows they return: the declared cost of the fallback. */
function countingStore(store: VectorStore): { store: VectorStore; stats: { pages: number; rows: number } } {
  const stats = { pages: 0, rows: 0 };
  const scan = store.scanMetadata?.bind(store);
  assert.ok(scan, "the durable store must expose scanMetadata for the fallback");
  const wrapped: VectorStore = {
    ...store,
    async scanMetadata(query) {
      const page = await scan(query);
      stats.pages += 1;
      stats.rows += page.rows.length;
      return page;
    },
  };
  return { store: wrapped, stats };
}

describeIntegration("Task 5 navigation on PostgreSQL", () => {
  const pools: Pool[] = [];
  after(async () => {
    while (pools.length > 0)
      await pools
        .pop()!
        .end()
        .catch(() => undefined);
  });
  const createPool = (): Pool => {
    const pool = new Pool({ connectionString: postgresUrl, max: 5 });
    pools.push(pool);
    return pool;
  };

  async function withStores<T>(
    run: (env: { pool: Pool; schema: string; stores: Awaited<ReturnType<typeof createPostgresMemoryStores>> }) => Promise<T>,
  ): Promise<T> {
    const schema = uniqueSchema();
    const pool = createPool();
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    const stores = await createPostgresMemoryStores({ pool, schema, dimensions: DIMENSIONS });
    try {
      return await run({ pool, schema, stores });
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  }

  function readerFor(fabric: ReturnType<typeof createLongTermMemory>) {
    const tool = fabric.tools().find((definition) => definition.name === "memory.read")!;
    return async (args: Record<string, string | number>, ctx: ToolExecutionContext = context): Promise<ReadResult> =>
      (await tool.execute(args, ctx)).value as ReadResult;
  }

  async function seedSession(fabric: ReturnType<typeof createLongTermMemory>, session: string, count: number, offset = 0): Promise<void> {
    // Written newest-first so storage order never equals reference-time order.
    for (let i = count - 1; i >= 0; i--) {
      await fabric.remember({ kind: "exchange", id: hex(offset + i), session, content: `round ${offset + i}`, tRef: day(i) });
    }
  }

  it("postgres_exchange_session_survives_reopen_without_retired_keywords", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    let pool2: Pool | undefined;
    try {
      const stores = await createPostgresMemoryStores({ pool, schema, dimensions: DIMENSIONS });
      const memory = createMemory({ ...scope, vectorStore: stores.vectorStore });
      const fabric = createLongTermMemory({ memory, consolidate: false });
      const archive = createExchangeArchive({ remember: fabric.remember, maxTextChars: 16384, scope: "project" });
      const entry = (id: string, role: "user" | "assistant", text: string) => ({
        id,
        sessionId: "persisted-session",
        timestamp: "2026-01-01T00:00:00Z",
        kind: "message" as const,
        message: { role, content: [{ type: "text" as const, text }] },
      });
      const report = await archive.pair({
        user: entry("u1", "user", "My flight to Paris was delayed by two hours."),
        assistant: entry("a1", "assistant", "Noted, I recorded the delay."),
      });
      assert.equal(report.archived, 1);

      // Close the first connection pool entirely, then reopen against the same schema.
      await pool.end();
      pools.splice(pools.indexOf(pool), 1);
      pool2 = createPool();
      const reopened = await createPostgresMemoryStores({ pool: pool2, schema, dimensions: DIMENSIONS, skipMigrations: true });
      const memory2 = createMemory({ ...scope, vectorStore: reopened.vectorStore });
      const page = await reopened.vectorStore.scanMetadata!({ scope: { tenantId: "t", resourceId: "r" }, limit: 50 });
      assert.equal(page.rows.length, 1);
      const metadata = parseMemoryNoteMetadata(page.rows[0]!.metadata);
      assert.equal(metadata?.kind, "exchange");
      assert.equal(metadata?.session, "persisted-session");
      assert.equal(metadata?.keywords, undefined, "the archive no longer derives category keywords (plan 210 Task 7)");
      const [record] = await memory2.get([page.rows[0]!.id]);
      assert.equal(parseMemoryNoteMetadata(record?.metadata)?.session, "persisted-session");
    } finally {
      const cleaner = pool2 ?? createPool();
      await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });

  it("postgres_lexical_recall_and_unmatched_terms", async () => {
    await withStores(async ({ stores }) => {
      const memory = createMemory({ ...scope, vectorStore: stores.vectorStore });
      assert.equal(memory.retrieval, "lexical", "no embedder: the preset lexical path on PostgreSQL");
      const fabric = createLongTermMemory({ memory, consolidate: false });
      const archive = createExchangeArchive({ remember: fabric.remember, maxTextChars: 16384, scope: "project" });
      const entry = (id: string, role: "user" | "assistant", text: string) => ({
        id,
        sessionId: "s-enrich",
        timestamp: "2026-01-01T00:00:00Z",
        kind: "message" as const,
        message: { role, content: [{ type: "text" as const, text }] },
      });
      await archive.pair({
        user: entry("u", "user", "My flight landed at Heathrow."),
        assistant: entry("a", "assistant", "Welcome to London."),
      });

      // The archive no longer derives category keywords (plan 210 Task 7).
      const tags = await stores.vectorStore.topTags!(scope);
      assert.equal(
        tags.some((t) => t.tag === "travel"),
        false,
        "retired category enrichment does not appear in topTags",
      );

      // Memory recall tool unmatched-term feedback
      const recallTool = fabric.tools().find((definition) => definition.name === "memory.recall")!;

      // 1) Content matches, but the retired category keyword remains unmatched.
      const hitRes = (await recallTool.execute({ query: "Heathrow travel" }, context)).value as {
        hits: unknown[];
        unmatchedTerms: string[];
      };
      assert.equal(hitRes.hits.length, 1);
      assert.deepEqual(hitRes.unmatchedTerms, ["travel"]);

      // 2) Partial match: matching content + unmatched term -> unmatched reported
      const partialRes = (await recallTool.execute({ query: "Heathrow kubernetes" }, context)).value as {
        hits: unknown[];
        unmatchedTerms: string[];
      };
      assert.equal(partialRes.hits.length, 1);
      assert.deepEqual(partialRes.unmatchedTerms, ["kubernete"]);

      // 3) Complete miss: reports all unmatched terms
      const miss = (await recallTool.execute({ query: "kubernetes helm" }, context)).value as { hits: unknown[]; unmatchedTerms: string[] };
      assert.equal(miss.hits.length, 0);
      assert.deepEqual(miss.unmatchedTerms, ["kubernete", "helm"]);
    });
  });

  it("postgres_read_around_and_session_pages_match_sqlite", async () => {
    await withStores(async ({ stores }) => {
      const sqlite = await createSqliteMemoryStores({ path: ":memory:" });
      try {
        const results: ReadResult[][] = [];
        for (const store of [stores.vectorStore, sqlite.vectorStore]) {
          const memory = createMemory({ ...scope, vectorStore: store });
          const fabric = createLongTermMemory({ memory, vectorStore: store, consolidate: false });
          await seedSession(fabric, "past", 12);
          const read = readerFor(fabric);
          results.push([
            await read({ session: "past" }),
            await read({ session: "past", page: 1 }),
            await read({ session: "past", page: 2 }),
            await read({ around: hex(5) }),
            await read({ around: hex(0) }),
            await read({ around: hex(11) }),
          ]);
          await assert.rejects(read({ session: "past", page: -1 }));
          await assert.rejects(read({ session: "past", id: hex(0) }));
        }
        const ids = (result: ReadResult) => result.notes?.map((note) => note.id);
        const [pg, lite] = results as [ReadResult[], ReadResult[]];
        assert.deepEqual(pg.map(ids), lite.map(ids), "PostgreSQL and SQLite navigation return identical pages");
        assert.deepEqual(
          ids(pg[0]!),
          Array.from({ length: 8 }, (_, i) => hex(i)),
          "zero-based page 0 in reference-time order",
        );
        assert.deepEqual(ids(pg[1]!), [8, 9, 10, 11].map(hex));
        assert.equal(pg[2]!.reason, "not_found");
        assert.deepEqual(ids(pg[3]!), [3, 4, 5, 6, 7].map(hex));
        assert.deepEqual(ids(pg[4]!), [0, 1, 2].map(hex));
        assert.deepEqual(ids(pg[5]!), [9, 10, 11].map(hex));
        assert.equal(pg[0]!.notes[0]!.session, "past");
      } finally {
        sqlite.close();
      }
    });
  });

  it("postgres_navigation_scan_emits_status_and_honours_abort", async () => {
    await withStores(async ({ stores }) => {
      const { store, stats } = countingStore(stores.vectorStore);
      const warnings: string[] = [];
      const memory = createMemory({ ...scope, vectorStore: store });
      const fabric = createLongTermMemory({ memory, vectorStore: store, consolidate: false, notify: (message) => warnings.push(message) });
      // Cross the 200-row cursor boundary: the session straddles it, with other-session rows between.
      await seedSession(fabric, "past", 12);
      const fillers = 450;
      const batch: MemoryVectorRecord[] = [];
      for (let i = 0; i < fillers; i++) {
        batch.push({
          tenantId: "t",
          resourceId: "r",
          threadId: "archive",
          id: `5${String(i).padStart(11, "0")}`,
          text: `filler ${i}`,
          sequence: i,
          metadata: { fabric: { v: 1, kind: "fact", content: `filler ${i}` } },
          embedding: new Array(DIMENSIONS).fill(0.1),
          consent: { source: "user", scope: "thread", visible: true },
          createdAt: new Date(0).toISOString(),
        });
      }
      for (let start = 0; start < batch.length; start += 100) await stores.vectorStore.upsert(batch.slice(start, start + 100));
      for (let i = 12; i < 16; i++)
        await fabric.remember({ kind: "exchange", id: hex(i), session: "past", content: `late round ${i}`, tRef: day(i) });
      const read = readerFor(fabric);

      stats.pages = 0;
      stats.rows = 0;
      const started = performance.now();
      const result = await read({ session: "past", page: 1 });
      const elapsedMs = performance.now() - started;
      assert.deepEqual(
        result.notes.map((note) => note.id),
        [8, 9, 10, 11, 12, 13, 14, 15].map(hex),
      );
      assert.ok(stats.pages >= 3, `the 200-row cursor must be crossed (saw ${stats.pages} page(s))`);
      assert.ok(
        warnings.some((message) => message.includes("metadata scan")),
        "the fallback is announced",
      );
      console.log(
        `T56_METRICS ${JSON.stringify({ fixtureRows: 12 + fillers + 4, scanPages: stats.pages, scanRows: stats.rows, sessionPageMs: Math.round(elapsedMs) })}`,
      );

      const aborted = new AbortController();
      aborted.abort();
      await assert.rejects(read({ session: "past" }, { ...context, signal: aborted.signal }));
    });
  });

  it("postgres_navigation_enforces_scope_consent_holds_deletion_and_redaction", async () => {
    await withStores(async ({ stores }) => {
      const canary = "sk-task56-canary-secret-value";
      const redactor = createSecretRedactor([canary]);
      const memory = createMemory({ ...scope, vectorStore: stores.vectorStore, redactor });
      const fabric = createLongTermMemory({ memory, vectorStore: stores.vectorStore, consolidate: false, redactor });
      await seedSession(fabric, "past", 12);
      const read = readerFor(fabric);

      // Deletion, hold-tombstone and revoked consent drop out of both around and session reads.
      await memory.forget({ ids: [hex(4)] });
      await memory.forget({ ids: [hex(3)], hold: true });
      await memory.setConsent(hex(6), { visible: false });
      const aroundNotes = (await read({ around: hex(5) })).notes.map((note) => note.id);
      assert.deepEqual(aroundNotes, [1, 2, 5, 7, 8].map(hex));
      for (const dropped of [hex(3), hex(4), hex(6)]) {
        assert.ok(!aroundNotes.includes(dropped), `${dropped} must not appear in around notes`);
      }
      const listed = (await read({ session: "past" })).notes.map((note) => note.id);
      for (const dropped of [hex(3), hex(4), hex(6)]) assert.ok(!listed.includes(dropped), `${dropped} must not be readable`);
      assert.equal((await readerFor(fabric)({ around: hex(4) })).reason, "not_found");

      // A different session never leaks into the neighbours.
      await fabric.remember({ kind: "exchange", id: "eeeeeeeeeeee", session: "another", content: "other session" });
      assert.ok(!(await read({ around: hex(5) })).notes.some((note) => note.id === "eeeeeeeeeeee"));

      // Foreign tenant and foreign resource: same session id, never visible, not addressable.
      let foreignCounter = 1;
      for (const foreignScope of [
        { tenantId: "foreign", resourceId: "r", threadId: "archive" },
        { tenantId: "t", resourceId: "other-resource", threadId: "archive" },
      ]) {
        const foreignId = `fa000000000${foreignCounter++}`;
        const other = createLongTermMemory({
          memory: createMemory({ ...foreignScope, vectorStore: stores.vectorStore }),
          consolidate: false,
        });
        await other.remember({ kind: "exchange", id: foreignId, session: "past", content: "foreign data", tRef: day(5) });
        assert.equal((await read({ around: foreignId })).reason, "not_found");
        assert.ok(!(await read({ session: "past" })).notes.some((note) => note.id === foreignId));
      }

      // Foreign thread, same tenant/resource, same session id: the scan returns it, the active-thread bind drops it.
      const sibling = createLongTermMemory({
        memory: createMemory({ ...scope, threadId: "sibling", vectorStore: stores.vectorStore }),
        consolidate: false,
      });
      await sibling.remember({ kind: "exchange", id: "dddddddddddd", session: "past", content: "sibling thread", tRef: day(5) });
      assert.equal((await read({ around: "dddddddddddd" })).reason, "not_found");
      assert.ok(!(await read({ session: "past" })).notes.some((note) => note.id === "dddddddddddd"));

      // Configured redaction applies to notes returned through navigation.
      await fabric.remember({
        kind: "exchange",
        id: "aaaaaaaaaaaa",
        session: "secret-session",
        content: `the key is ${canary}`,
        tRef: day(0),
      });
      const redacted = await read({ session: "secret-session" });
      assert.equal(redacted.notes.length, 1);
      assert.ok(!JSON.stringify(redacted).includes(canary), "the canary secret never leaves through navigation");
    });
  });
});
