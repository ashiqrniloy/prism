import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMemoryConformance } from "../../../fabric/src/conformance.js";
import { createHashEmbedder, MemoryValidationError } from "../index.js";
import { createSqliteMemoryStores } from "../sqlite/index.js";

const dirs: string[] = [];
const opened: { close(): void }[] = [];
function path() {
  const dir = mkdtempSync(join(tmpdir(), "prism-memory-"));
  dirs.push(dir);
  return join(dir, "memory.sqlite");
}
async function open(file = path(), dimensions?: number) {
  const stores = await createSqliteMemoryStores({ path: file, dimensions });
  opened.push(stores);
  return stores;
}
afterEach(() => {
  for (const store of opened.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const scope = { tenantId: "t", resourceId: "r", threadId: "a" };
const record = (id: string, text = "coffee", embedding = [1, 0]) => ({
  ...scope,
  id,
  text,
  embedding,
  sequence: 1,
  createdAt: "2026-10-19T00:00:00Z",
});

test("sqlite_store_passes_memory_conformance", async () => {
  const stores = await open();
  await runMemoryConformance(() => ({ ...stores, embedder: createHashEmbedder({ dimensions: 64 }) }));
});
test("sqlite_store_survives_reopen", async () => {
  const file = path();
  const first = await open(file, 2);
  await first.vectorStore.upsert([{ ...record("one"), generation: 1n, metadata: { generation: { bigint: "12" } } }]);
  await first.workingStore.update(scope, { name: "Ada" }, { expectedVersion: 0 });
  await first.vectorStore.invalidate(scope, [{ id: "blocked", reason: "legal_hold", at: "2026-10-19T00:00:00Z" }]);
  await first.vectorStore.setSourceAccess(scope, [{ sourceId: "source", principalIds: ["p"], accessVersion: 1 }]);
  await first.vectorStore.setShareGrant(scope, { tenantId: "t", parentThreadId: "a", childThreadId: "b", sourceIds: ["one"] });
  await first.vectorStore.setCurrentGeneration(scope, 9007199254740993n);
  first.close();
  const second = await open(file, 2);
  expect((await second.vectorStore.getByThread(scope))[0]?.text).toBe("coffee");
  expect((await second.vectorStore.getByThread(scope))[0]?.generation).toBe(1n);
  expect((await second.vectorStore.getByThread(scope))[0]?.metadata).toEqual({ generation: { bigint: "12" } });
  expect((await second.workingStore.get(scope))?.value).toEqual({ name: "Ada" });
  expect((await second.vectorStore.listInvalidated(scope))[0]?.hold).toBe(true);
  expect(await second.vectorStore.checkSourceAccess(scope, "source", { tenantId: "t", principalId: "p" })).toBe(true);
  expect((await second.vectorStore.getShareGrant(scope, "b"))?.sourceIds).toEqual(["one"]);
  expect(await second.vectorStore.getCurrentGeneration(scope)).toBe(9007199254740993n);
});
test("sqlite_lexical_query_ranks_bm25_and_updates_index", async () => {
  const { vectorStore: v } = await open();
  await v.upsert([record("short", "coffee"), record("long", "coffee tea water milk juice bread fruit")]);
  expect((await v.lexicalQuery({ ...scope, text: "coffee", topK: 2 })).map((x) => x.id)).toEqual(["short", "long"]);
  await v.upsert([record("short", "almonds")]);
  expect((await v.lexicalQuery({ ...scope, text: 'coffee " OR *', topK: 2 })).map((x) => x.id)).toEqual(["long"]);
  await v.delete({ ...scope, ids: ["long"] });
  expect(await v.lexicalQuery({ ...scope, text: "coffee", topK: 2 })).toEqual([]);
});
test("sqlite_isolates_scope_and_filters_before_ranking", async () => {
  const { vectorStore: v } = await open();
  await v.upsert([
    record("hidden"),
    { ...record("derived"), metadata: { _lineage: { v: 1, sourceIds: ["hidden"] } } },
    { ...record("allowed"), metadata: { _rag: { sourceId: "s" } } },
    { ...record("foreign"), resourceId: "other" },
  ]);
  await v.invalidate(scope, [{ id: "hidden", reason: "revoked", at: "2026-10-19T00:00:00Z" }]);
  await v.setSourceAccess(scope, [{ sourceId: "s", principalIds: ["p"], accessVersion: 1 }]);
  const authorization = { tenantId: "t", principalId: "p", accessVersion: 1 };
  expect((await v.query({ ...scope, embedding: [1, 0], topK: 1, authorization })).map((x) => x.id)).toEqual(["allowed"]);
  expect((await v.lexicalQuery({ ...scope, text: "coffee", topK: 1, authorization })).map((x) => x.id)).toEqual(["allowed"]);
  expect(await v.query({ ...scope, embedding: [1, 0], topK: 5, ids: [] })).toEqual([]);
});
test("sqlite_batches_rollback_and_working_cas_is_atomic", async () => {
  const file = path();
  const a = await open(file, 2);
  const b = await open(file, 2);
  await expect(a.vectorStore.upsert([record("valid"), record("invalid", "x", [1])])).rejects.toBeInstanceOf(MemoryValidationError);
  expect(await a.vectorStore.countByThread(scope)).toBe(0);
  const results = await Promise.allSettled([
    a.workingStore.update(scope, { a: 1 }, { expectedVersion: 0 }),
    b.workingStore.update(scope, { b: 1 }, { expectedVersion: 0 }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});
test("sqlite_store_rejects_corrupt_and_unknown_file", async () => {
  const corrupt = path();
  writeFileSync(corrupt, "not sqlite");
  await expect(open(corrupt)).rejects.toBeInstanceOf(MemoryValidationError);
  const unknown = path();
  const db = new Database(unknown);
  db.exec("CREATE TABLE unrelated (id TEXT)");
  db.close();
  await expect(open(unknown)).rejects.toBeInstanceOf(MemoryValidationError);
});
test("sqlite_file_mode_is_0600", async () => {
  const file = path();
  await open(file);
  expect(statSync(file).mode & 0o777).toBe(0o600);
});
test("memory_core_root_does_not_load_bun_sqlite", () => {
  const probe = spawnSync(
    "bun",
    [
      "-e",
      `const { mock } = await import('bun:test'); mock.module('bun:sqlite', () => { throw new Error('sqlite loaded'); }); await import('@arnilo/prism-memory-core');`,
    ],
    { timeout: 10000 },
  );
  expect(probe.status).toBe(0);
});

test("sqlite_pagination_generations_holds_and_aborts", async () => {
  const { vectorStore: v, workingStore: w } = await open();
  await v.upsert([record("legacy"), { ...record("old"), generation: 1n }, { ...record("new"), generation: 2n }]);
  expect((await v.query({ ...scope, embedding: [1, 0], topK: 5 })).map((x) => x.id).sort()).toEqual(["legacy", "new"]);
  await v.setCurrentGeneration(scope, 1n);
  expect((await v.lexicalQuery({ ...scope, text: "coffee", topK: 5 })).map((x) => x.id).sort()).toEqual(["legacy", "old"]);
  const first = await v.listByThread({ ...scope, limit: 1 });
  const second = await v.listByThread({ ...scope, limit: 1, cursor: first.nextCursor });
  expect(first.records[0]?.id).not.toBe(second.records[0]?.id);
  await v.invalidate(scope, [{ id: "legacy", reason: "legal_hold", at: "2026-10-19T00:00:00Z" }]);
  await v.invalidate(scope, [{ id: "legacy", reason: "corrected", at: "2026-10-19T00:00:00Z" }]);
  await v.clearInvalidation(scope, ["legacy"]);
  expect((await v.listInvalidated(scope))[0]?.hold).toBe(true);
  await v.setShareGrant(scope, { tenantId: "t", parentThreadId: "a", childThreadId: "child", sourceIds: ["legacy"] });
  expect((await v.getShareGrant(scope, "child"))?.sourceIds).toEqual(["legacy"]);
  expect(await v.getShareGrant({ ...scope, resourceId: "other" }, "child")).toBeUndefined();
  const controller = new AbortController();
  controller.abort();
  await expect(v.upsert([record("aborted")], { signal: controller.signal })).rejects.toThrow(/aborted/i);
  await expect(w.update(scope, {}, { signal: controller.signal })).rejects.toThrow(/aborted/i);
  expect(await v.countByThread(scope)).toBe(3);
});
test("sqlite_dimensions_and_identifiers_fail_closed", async () => {
  const { buildSqliteMemoryDdl } = await import("../sqlite/ddl.js");
  expect(() => buildSqliteMemoryDdl("notes; DROP TABLE notes")).toThrow(MemoryValidationError);
  const file = path();
  const first = await open(file, 2);
  first.close();
  await expect(open(file, 3)).rejects.toBeInstanceOf(MemoryValidationError);
  await expect(open(path(), 0)).rejects.toBeInstanceOf(MemoryValidationError);
});

test("sqlite_reports_acl_denials_and_isolates_resource_working_memory", async () => {
  const { vectorStore: v, workingStore: w } = await open();
  await v.upsert([{ ...record("note"), metadata: { _rag: { sourceId: "source" } } }]);
  await v.setSourceAccess(scope, [{ sourceId: "source", principalIds: ["p"], accessVersion: 1 }]);
  const denials: unknown[] = [];
  expect(
    await v.lexicalQuery({
      ...scope,
      text: "coffee",
      topK: 1,
      authorization: { tenantId: "t", principalId: "p", accessVersion: 2 },
      onDeniedSources: (items) => denials.push(items),
    }),
  ).toEqual([]);
  expect(denials).toEqual([[{ sourceId: "source", reason: "version_mismatch" }]]);
  await v.setSourceAccess(scope, [{ sourceId: "source", accessVersion: 2 }]);
  expect(await v.checkSourceAccess(scope, "source", { tenantId: "t", principalId: "p" })).toBe(false);
  const resource = { tenantId: "t", resourceId: "r" };
  await w.update(resource, { name: "resource" });
  expect(await w.get(scope)).toBeUndefined();
  expect((await w.get(resource))?.version).toBe(1);
  expect(await w.delete(resource)).toBe(true);
  expect(await w.delete(resource)).toBe(false);
});

test("sqlite_bm25_weights_keys_above_body", async () => {
  const { vectorStore } = await open();
  await vectorStore.upsert([
    { ...record("body", "rollout notes mention kubernetes once", []), sequence: 1 },
    { ...record("keys", "rollout notes", []), sequence: 2, metadata: { fabric: { v: 1, kind: "fact", keywords: ["kubernetes"] } } },
  ]);
  const hits = await vectorStore.lexicalQuery({ ...scope, text: "kubernetes", topK: 5 });
  expect(hits.map((hit) => hit.id)).toEqual(["keys", "body"]);
  expect(hits.every((hit) => hit.coverage === 1)).toBe(true);
});

test("sqlite_lexical_matches_stemmed_variants", async () => {
  const { vectorStore } = await open();
  await vectorStore.upsert([record("n", "We deployed the servers", [])]);
  const hits = await vectorStore.lexicalQuery({ ...scope, text: "deploying a server", topK: 5 });
  expect(hits.map((hit) => [hit.id, hit.coverage])).toEqual([["n", 1]]);
  expect(await vectorStore.query({ ...scope, embedding: [], topK: 5 })).toEqual([]);
});

test("sqlite_lexical_treats_fts_operators_as_text", async () => {
  const { vectorStore } = await open();
  await vectorStore.upsert([record("n", "near column match", [])]);
  for (const text of ['"near" NEAR(a b) AND OR NOT *', "lex_keys: near", "^near -column"]) {
    const hits = await vectorStore.lexicalQuery({ ...scope, text, topK: 5 });
    expect(hits.map((hit) => hit.id)).toEqual(["n"]);
  }
});

test("sqlite_v3_migrates_v2_index_and_refuses_unknown", async () => {
  const file = path();
  const first = await open(file);
  await first.vectorStore.upsert([
    {
      ...record("migrated"),
      metadata: { status: "candidate", fabric: { v: 1, kind: "fact", uses: [{ s: 7, at: "2026-10-19T00:00:00Z" }] } },
      consent: { source: "user", scope: "thread", visible: true },
      importance: 0.25,
    },
  ]);
  first.vectorStore.scopeCounter;
  first.close();
  opened.splice(opened.indexOf(first), 1);

  // Downgrade to the v2 index, keeping the row so the backfill has something to fill.
  const old = new Database(file);
  old.exec(`DROP TABLE memory_scope_counter;
    ALTER TABLE semantic_memory DROP COLUMN status;
    ALTER TABLE semantic_memory DROP COLUMN storage;
    ALTER TABLE semantic_memory DROP COLUMN last_use_ordinal;
    PRAGMA user_version = 2;`);
  old.close();

  const migrated = await open(file);
  const columns = new Database(file).query("SELECT status, storage, last_use_ordinal FROM semantic_memory").get() as Record<
    string,
    unknown
  >;
  expect(columns).toEqual({ status: "candidate", storage: 0.25, last_use_ordinal: 7 });
  expect((await migrated.vectorStore.scanMetadata({ scope, limit: 5 })).rows.map((row) => row.id)).toEqual(["migrated"]);
  expect(
    await migrated.vectorStore.scopeCounter.increment({ tenantId: "t", resourceId: "r", name: "sessions" }),
  ).toBe(1);
  const version = new Database(file).query("PRAGMA user_version").get() as { user_version: number };
  expect(version.user_version).toBe(3);

  migrated.close();
  opened.splice(opened.indexOf(migrated), 1);
  const unknown = new Database(file);
  unknown.exec("PRAGMA user_version = 9");
  unknown.close();
  await expect(open(file)).rejects.toBeInstanceOf(MemoryValidationError);
});

test("sqlite_refuses_v1_schema", async () => {
  const file = path();
  const first = await open(file);
  first.close();
  opened.splice(opened.indexOf(first), 1);
  const db = new Database(file);
  db.exec("PRAGMA user_version = 1");
  db.close();
  await expect(open(file)).rejects.toBeInstanceOf(MemoryValidationError);
});
