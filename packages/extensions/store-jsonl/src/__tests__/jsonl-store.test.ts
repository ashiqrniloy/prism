import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "bun:test";
import {
  createAgent,
  createMemorySessionStore,
  createSessionEntry,
  isSessionAppendConflict,
  type OwnershipScope,
  rebuildSessionContext,
  type SessionEntry,
  type SessionListQuery,
  type SessionSearchQuery,
  type SessionStore,
} from "@arnilo/prism";
import { storeConformance } from "@arnilo/prism/testing";
import { mockProvider } from "@arnilo/prism/testing";
import { createJsonlSessionStore, JsonlSessionStoreError, JSONL_BYTES_READ, JSONL_FILE_READS, readJsonlSessionEntries } from "../index.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "prism-jsonl-"));
}

/** The store implements all three optional capabilities; these narrow them once without `!`. */
const listAll = (store: SessionStore, query: SessionListQuery = {}) => {
  const list = store.listSessions;
  assert.ok(list, "the JSONL store implements listSessions");
  return list.call(store, query);
};

const deleteOne = (store: SessionStore, sessionId: string, scope?: OwnershipScope) => {
  const remove = store.deleteSession;
  assert.ok(remove, "the JSONL store implements deleteSession");
  return remove.call(store, sessionId, scope);
};

const searchAll = (store: SessionStore, query: SessionSearchQuery) => {
  const search = store.searchSessions;
  assert.ok(search, "the JSONL store implements searchSessions");
  return search.call(store, query);
};

let stamp = 0;
const entry = (id: string, sessionId: string, extra: Partial<SessionEntry> = {}): SessionEntry => ({
  id,
  sessionId,
  timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, stamp++)).toISOString(),
  kind: "label",
  label: id,
  ...extra,
});

describe("jsonl session store", () => {
  it("round trips entries across instances", async () => {
    const dir = await tempDir();
    const one = entry("e1", "s1");

    await createJsonlSessionStore({ dir }).append(one);

    assert.deepEqual(await createJsonlSessionStore({ dir }).list("s1"), [one]);
    assert.deepEqual(JSON.parse(await readFile(join(dir, "s1.jsonl"), "utf8")), one);
  });

  it("writes one file per session", async () => {
    const dir = await tempDir();
    const store = createJsonlSessionStore({ dir });
    await store.append(entry("e1", "s1"));
    await store.append(entry("e2", "s2"));

    assert.deepEqual(
      (await store.list("s1")).map((row) => row.id),
      ["e1"],
    );
    assert.deepEqual(
      (await store.list("s2")).map((row) => row.id),
      ["e2"],
    );
    assert.deepEqual((await readdirNames(dir)).sort(), ["s1.jsonl", "s2.jsonl"]);
  });

  it("get returns entry by id", async () => {
    const dir = await tempDir();
    const store = createJsonlSessionStore({ dir });
    const one = createSessionEntry({ id: "e1", sessionId: "s1", kind: "summary", summary: "sum" });
    await store.append(one);

    assert.deepEqual(await store.get?.("e1"), one);
    assert.equal(await store.get?.("missing"), undefined);
  });

  it("missing directory is empty", async () => {
    const store = createJsonlSessionStore({ dir: join(await tempDir(), "absent") });

    assert.deepEqual(await store.list("s1"), []);
    assert.equal(await store.get?.("e1"), undefined);
    assert.deepEqual((await store.listSessions?.({}))?.items, []);
  });

  it("searchSessions scans the directory and quarantines invalid lines", async () => {
    const dir = await tempDir();
    const writer = createJsonlSessionStore({ dir });
    await writer.append(
      createSessionEntry({
        id: "e1",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:01.000Z",
        kind: "message",
        label: "auth-flake",
        message: { role: "user", content: [{ type: "text", text: "fix flaky auth" }] },
        metadata: { workspaceRoot: "/repo" },
      }),
    );
    await writer.append(
      createSessionEntry({ id: "e2", sessionId: "s2", timestamp: "2026-01-01T00:00:02.000Z", kind: "label", label: "elsewhere" }),
    );
    await appendFile(join(dir, "s2.jsonl"), "{not json\n", "utf8");

    const hits = await searchAll(createJsonlSessionStore({ dir }), {
      workspaceRoot: "/repo",
      query: "flaky auth",
      limit: 10,
    });
    assert.deepEqual(
      hits.items.map((hit) => [hit.sessionId, hit.entryId, hit.turn]),
      [["s1", "e1", 1]],
    );
    assert.match(hits.items[0]?.snippet ?? "", /flaky auth/);
    // The corrupt line stays quarantined (list/get semantics), it does not fail the whole search.
    assert.equal((await searchAll(createJsonlSessionStore({ dir }), { query: "flaky auth", limit: 10 })).items.length, 1);
    assert.equal((await searchAll(createJsonlSessionStore({ dir }), { query: "missing", limit: 10 })).items.length, 0);
  });

  it("jsonl_search_matches_the_memory_store", async () => {
    const dir = await tempDir();
    const entries = [
      createSessionEntry({
        id: "jsonl-root",
        sessionId: "jsonl-session",
        timestamp: "2026-01-01T00:00:00.000Z",
        kind: "message",
        label: "auth",
        summary: "flaky login",
        message: { role: "user", content: [{ type: "text", text: "fix flaky auth test timeout" }] },
        metadata: { workspaceRoot: "/repo", tenantId: "tenant-a" },
      }),
      createSessionEntry({
        id: "jsonl-other",
        sessionId: "jsonl-other-session",
        timestamp: "2026-01-01T00:00:01.000Z",
        kind: "label",
        label: "unrelated",
      }),
    ];
    const jsonl = createJsonlSessionStore({ dir });
    for (const row of entries) await jsonl.append(row);
    const memory = createMemorySessionStore(entries);

    // One matcher, two stores: every query must produce identical pages, pointer fields included.
    const queries: SessionSearchQuery[] = [
      { query: "flaky auth", limit: 10 },
      { label: "unrelated", limit: 10 },
      { kind: "label", limit: 10 },
      { query: "flaky auth", kind: ["label", "summary"], limit: 10 },
      { workspaceRoot: "/repo", limit: 10 },
      { workspaceRoot: "/elsewhere", limit: 10 },
      { tenantId: "tenant-a", limit: 1, order: "asc" },
    ];
    for (const query of queries) {
      assert.deepEqual(
        await searchAll(jsonl, query),
        await searchAll(memory, query),
        `JSONL and memory search diverged for ${JSON.stringify(query)}`,
      );
    }

    const hits = await searchAll(jsonl, { query: "flaky auth", limit: 10 });
    assert.equal(hits.items[0]?.entryId, "jsonl-root");
    assert.equal(hits.items[0]?.turn, 1);
    assert.match(hits.items[0]?.snippet ?? "", /flaky auth/);

    // Persisted corpus: a fresh instance searches the directory with the same pages.
    const reopened = createJsonlSessionStore({ dir });
    assert.deepEqual(await searchAll(reopened, { query: "flaky auth", limit: 10 }), hits);
  });

  it("quarantines invalid json line and returns usable entries", async () => {
    const dir = await tempDir();
    const valid = entry("e1", "s1");
    await writeFile(join(dir, "s1.jsonl"), [JSON.stringify(valid), "{"].join("\n"), "utf8");

    const store = createJsonlSessionStore({ dir });
    assert.deepEqual(await store.list("s1"), [valid]);

    const result = await readJsonlSessionEntries(join(dir, "s1.jsonl"));
    assert.equal(result.entries.length, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]?.line, 2);
    assert.ok(result.errors[0]?.message.includes("Invalid JSON"));
  });

  it("quarantines invalid message summary parentId and model_change shapes", async () => {
    const dir = await tempDir();
    const valid = entry("e1", "s1");
    const badMessage = JSON.stringify({
      id: "e2",
      sessionId: "s1",
      timestamp: "2024-01-01T00:00:00.000Z",
      kind: "message",
      message: "not-an-object",
    });
    const badSummary = JSON.stringify({ id: "e3", sessionId: "s1", timestamp: "2024-01-01T00:00:00.000Z", kind: "summary", summary: 123 });
    const badParentId = JSON.stringify({
      id: "e4",
      sessionId: "s1",
      timestamp: "2024-01-01T00:00:00.000Z",
      kind: "label",
      label: "x",
      parentId: 1,
    });
    const badModel = JSON.stringify({
      id: "e5",
      sessionId: "s1",
      timestamp: "2024-01-01T00:00:00.000Z",
      kind: "model_change",
      model: "not-an-object",
    });
    await writeFile(join(dir, "s1.jsonl"), [JSON.stringify(valid), badMessage, badSummary, badParentId, badModel].join("\n"), "utf8");

    const store = createJsonlSessionStore({ dir });
    assert.deepEqual(
      (await store.list("s1")).map((row) => row.id),
      ["e1"],
    );

    const result = await readJsonlSessionEntries(join(dir, "s1.jsonl"));
    assert.equal(result.entries.length, 1);
    assert.equal(result.errors.length, 4);
    assert.ok(result.errors.some((error) => error.message.includes("message entry")));
    assert.ok(result.errors.some((error) => error.message.includes("summary entry")));
    assert.ok(result.errors.some((error) => error.message.includes("parentId")));
    assert.ok(result.errors.some((error) => error.message.includes("model_change")));
  });

  it("quarantines invalid custom and compaction data shapes", async () => {
    const dir = await tempDir();
    const badCustom = JSON.stringify({ id: "c1", sessionId: "s1", timestamp: "2024-01-01T00:00:00.000Z", kind: "custom", data: ["array"] });
    const badCompaction = JSON.stringify({
      id: "cp1",
      sessionId: "s1",
      timestamp: "2024-01-01T00:00:00.000Z",
      kind: "compaction",
      summary: 123,
      data: "not-object",
    });
    const compactionNoSummary = JSON.stringify({
      id: "cp2",
      sessionId: "s1",
      timestamp: "2024-01-01T00:00:00.000Z",
      kind: "compaction",
      data: { ok: true },
    });
    await writeFile(join(dir, "s1.jsonl"), [badCustom, badCompaction, compactionNoSummary].join("\n"), "utf8");

    const result = await readJsonlSessionEntries(join(dir, "s1.jsonl"));
    assert.equal(result.entries.length, 0);
    assert.equal(result.errors.length, 3);
    assert.ok(result.errors.some((error) => error.message.includes("custom entry")));
    assert.ok(result.errors.some((error) => error.message.includes("compaction entry")));
  });

  it("blocks append when the file contains invalid json lines", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "s1.jsonl"), [JSON.stringify(entry("e1", "s1")), "{"].join("\n"), "utf8");
    const store = createJsonlSessionStore({ dir });

    await assert.rejects(() => store.append(entry("e2", "s1")), /Invalid JSONL at line 2/);
  });

  it("blocks append when the file contains shape-invalid lines", async () => {
    const dir = await tempDir();
    const badShape = JSON.stringify({
      id: "bad",
      sessionId: "s1",
      timestamp: "2024-01-01T00:00:00.000Z",
      kind: "message",
      message: { role: 123 },
    });
    await writeFile(join(dir, "s1.jsonl"), [JSON.stringify(entry("e1", "s1")), badShape].join("\n"), "utf8");
    const store = createJsonlSessionStore({ dir });

    await assert.rejects(() => store.append(entry("e2", "s1")), /Invalid JSONL at line 2/);
    // Reads still quarantine rather than fail the whole file.
    assert.deepEqual(
      (await store.list("s1")).map((row) => row.id),
      ["e1"],
    );
  });

  it("does not poison a branch when one entry is invalid", async () => {
    const dir = await tempDir();
    const good = createSessionEntry({
      id: "good",
      sessionId: "s1",
      kind: "message",
      message: { role: "user", content: [{ type: "text", text: "hi" }] },
    });
    const bad = JSON.stringify({
      id: "bad",
      sessionId: "s1",
      timestamp: "2024-01-01T00:00:00.000Z",
      kind: "message",
      message: { role: 123 },
    });
    await writeFile(join(dir, "s1.jsonl"), [JSON.stringify(good), bad].join("\n"), "utf8");

    const store = createJsonlSessionStore({ dir });
    assert.deepEqual(
      (await store.list("s1")).map((row) => row.id),
      ["good"],
    );
    assert.deepEqual(await store.get?.("good"), good);
    assert.equal(await store.get?.("bad"), undefined);
  });

  it("serializes appends and writes json lines", async () => {
    const dir = await tempDir();
    const store = createJsonlSessionStore({ dir });

    await Promise.all([store.append(entry("e1", "s1")), store.append(entry("e2", "s1"))]);

    assert.equal((await readFile(join(dir, "s1.jsonl"), "utf8")).trim().split("\n").length, 2);
  });

  it("rejects a duplicate entry id in the same session", async () => {
    const dir = await tempDir();
    const store = createJsonlSessionStore({ dir });
    const one = entry("e1", "s1");

    await store.append(one);
    await assert.rejects(() => store.append(one), /Duplicate session entry id: e1/);
    // Entry ids are session-scoped: the other session owns its own file and its own ids.
    await store.append({ ...one, sessionId: "s2" });
    assert.deepEqual(
      (await store.list("s2")).map((row) => row.id),
      ["e1"],
    );
  });

  it("keeps exact-retry dedup across a reopen", async () => {
    const dir = await tempDir();
    const store = createJsonlSessionStore({ dir });
    await store.append(entry("e1", "s1"), { idempotencyKey: "k1" });

    const reopened = createJsonlSessionStore({ dir });
    await assert.rejects(
      () => reopened.append(entry("e2", "s1"), { idempotencyKey: "k1" }),
      (error: unknown) => isSessionAppendConflict(error) && error.conflict.idempotencyDuplicate === true,
    );
    await reopened.append(entry("e2", "s1"), { idempotencyKey: "k2" });
  });

  it("throws SessionAppendConflictError when expectedParentId does not exist", async () => {
    const dir = await tempDir();
    const store = createJsonlSessionStore({ dir });
    await assert.rejects(
      () => store.append(entry("e1", "s1"), { expectedParentId: "missing" }),
      (error: unknown) => isSessionAppendConflict(error) && error.conflict.expectedParentId === "missing",
    );
    assert.equal((await readJsonlSessionEntries(join(dir, "s1.jsonl"))).entries.length, 0);
  });

  it("recovers later appends after a rejected operation", async () => {
    const dir = await tempDir();
    const store = createJsonlSessionStore({ dir });
    await assert.rejects(
      () => store.append(entry("e1", "s1"), { expectedParentId: "missing" }),
      (error: unknown) => isSessionAppendConflict(error),
    );
    await store.append(entry("e2", "s1"));
    assert.deepEqual(
      (await store.list("s1")).map((row) => row.id),
      ["e2"],
    );
  });

  it("deduplicates an exact retry at the same position by idempotencyKey", async () => {
    const dir = await tempDir();
    const store = createJsonlSessionStore({ dir });
    await store.append(entry("e1", "s1"), { idempotencyKey: "k1" });
    await assert.rejects(
      () => store.append(entry("dup", "s1"), { idempotencyKey: "k1" }),
      (error: unknown) => isSessionAppendConflict(error) && error.conflict.idempotencyDuplicate === true,
    );
    assert.equal((await readJsonlSessionEntries(join(dir, "s1.jsonl"))).entries.length, 1);
  });

  it("unknown_entry_kind_is_kept_as_opaque_entry", async () => {
    const dir = await tempDir();
    const unknown = {
      id: "e2",
      parentId: "e1",
      sessionId: "s1",
      timestamp: "2024-01-01T00:00:00.000Z",
      kind: "future_kind",
      payload: { a: 1 },
    };
    const brokenEnvelope = JSON.stringify({ id: "e3", sessionId: "s1", kind: "future_kind" });
    await writeFile(join(dir, "s1.jsonl"), [JSON.stringify(entry("e1", "s1")), JSON.stringify(unknown), brokenEnvelope].join("\n"), "utf8");

    const store = createJsonlSessionStore({ dir });
    const rows = await store.list("s1");
    assert.deepEqual(
      rows.map((row) => row.id),
      ["e1", "e2"],
    );
    assert.deepEqual(rows[1], unknown, "an unknown kind is returned unchanged");

    const result = await readJsonlSessionEntries(join(dir, "s1.jsonl"));
    assert.equal(result.entries.length, 2);
    assert.equal(result.errors.length, 1, "a line without a valid envelope is still an error");
    assert.equal(result.errors[0]?.line, 3);
  });

  it("accepts omitted schemaVersion as v1", async () => {
    const dir = await tempDir();
    const raw = { id: "e1", sessionId: "s1", timestamp: "2024-01-01T00:00:00.000Z", kind: "label", label: "ok" };
    await writeFile(join(dir, "s1.jsonl"), JSON.stringify(raw), "utf8");

    const result = await readJsonlSessionEntries(join(dir, "s1.jsonl"));
    assert.equal(result.errors.length, 0);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0]?.schemaVersion, undefined);
  });

  it("future_schema_version_is_readable_with_warning", async () => {
    const dir = await tempDir();
    const future = {
      id: "e2",
      parentId: "e1",
      sessionId: "s1",
      timestamp: "2024-01-01T00:00:00.000Z",
      kind: "label",
      schemaVersion: 2,
      newShape: { label: 1 },
    };
    const futureToo = { ...future, id: "e3", parentId: "e2", schemaVersion: 3 };
    const badVersion = JSON.stringify({
      id: "e4",
      sessionId: "s1",
      timestamp: "2024-01-01T00:00:00.000Z",
      kind: "label",
      label: "x",
      schemaVersion: "v1",
    });
    const oldVersion = JSON.stringify({
      id: "e5",
      sessionId: "s1",
      timestamp: "2024-01-01T00:00:00.000Z",
      kind: "label",
      label: "x",
      schemaVersion: 0,
    });
    await writeFile(
      join(dir, "s1.jsonl"),
      [JSON.stringify(entry("e1", "s1")), JSON.stringify(future), JSON.stringify(futureToo), badVersion, oldVersion].join("\n"),
      "utf8",
    );
    await writeFile(join(dir, "s2.jsonl"), JSON.stringify({ ...future, sessionId: "s2", parentId: undefined }), "utf8");

    const warnings: string[] = [];
    const store = createJsonlSessionStore({ dir, logger: { warn: (message) => warnings.push(message) } });
    const rows = await store.list("s1");
    assert.deepEqual(
      rows.map((row) => row.id),
      ["e1", "e2", "e3"],
    );
    assert.deepEqual(rows[1], future, "a newer-schema entry is returned unchanged");
    await store.list("s2");
    assert.equal(warnings.length, 1, "the store warns once, not per line or per file");

    const result = await readJsonlSessionEntries(join(dir, "s1.jsonl"));
    assert.equal(result.errors.length, 2);
    assert.ok(result.errors.some((error) => error.message.includes("Unsupported session entry schema version: v1")));
    assert.ok(result.errors.some((error) => error.message.includes("Unsupported session entry schema version: 0")));
  });

  it("round trips event and metadata entries with valid payloads", async () => {
    const dir = await tempDir();
    const eventEntry = createSessionEntry({
      id: "ev1",
      sessionId: "s1",
      kind: "event",
      event: { type: "run.started", sessionId: "s1", runId: "r1" },
    });
    const metadataEntry = createSessionEntry({ id: "md1", sessionId: "s1", kind: "metadata", data: { source: "test" } });
    const store = createJsonlSessionStore({ dir });
    await store.append(eventEntry);
    await store.append(metadataEntry);

    assert.deepEqual(await store.list("s1"), [eventEntry, metadataEntry]);
  });

  it("quarantines event and metadata entries with invalid payloads", async () => {
    const dir = await tempDir();
    const badEvent = JSON.stringify({
      id: "ev1",
      sessionId: "s1",
      timestamp: "2024-01-01T00:00:00.000Z",
      kind: "event",
      event: "not-an-object",
    });
    const badMetadata = JSON.stringify({
      id: "md1",
      sessionId: "s1",
      timestamp: "2024-01-01T00:00:00.000Z",
      kind: "metadata",
      data: ["array"],
    });
    await writeFile(join(dir, "s1.jsonl"), [badEvent, badMetadata].join("\n"), "utf8");

    const result = await readJsonlSessionEntries(join(dir, "s1.jsonl"));
    assert.equal(result.entries.length, 0);
    assert.equal(result.errors.length, 2);
    assert.ok(result.errors.some((error) => error.message.includes("event entry")));
    assert.ok(result.errors.some((error) => error.message.includes("metadata entry")));
  });

  it("snapshot rebuild stays detached from the file", async () => {
    const dir = await tempDir();
    const store = createJsonlSessionStore({ dir });
    await store.append(
      createSessionEntry({
        id: "e1",
        sessionId: "s1",
        kind: "message",
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
      }),
    );
    const snap = rebuildSessionContext(await store.list("s1"), { leafId: "e1" });
    const block = snap.messages[0]?.content[0] as { type: string; text: string } | undefined;
    if (block?.type === "text") block.text = "mutated";
    const again = rebuildSessionContext(await store.list("s1"), { leafId: "e1" });
    const next = again.messages[0]?.content[0];
    assert.equal(next?.type === "text" ? next.text : undefined, "hi");
  });

  it("snapshot after append does not re-read the file", async () => {
    const dir = await tempDir();
    const store = createJsonlSessionStore({ dir });
    await store.append(
      createSessionEntry({
        id: "e1",
        sessionId: "s1",
        kind: "message",
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
      }),
    );
    const before = fileReads(store);
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [mockProvider()],
      slots: { store },
    });
    const session = await agent.session({ id: "s1", leafId: "e1", snapshotCacheTtlMs: 0, create: true });
    const snap = await (session as unknown as { snapshot(): Promise<{ messages: readonly unknown[] }> }).snapshot();
    assert.equal(snap.messages.length, 1);
    assert.equal(fileReads(store), before);
  });

  it("sees an out-of-band append", async () => {
    const dir = await tempDir();
    const store = createJsonlSessionStore({ dir });
    await store.append(entry("e1", "s1"));
    await store.list("s1");
    await appendFile(join(dir, "s1.jsonl"), `${JSON.stringify(entry("e2", "s1"))}\n`, "utf8");
    assert.deepEqual(
      (await store.list("s1")).map((row) => row.id),
      ["e1", "e2"],
    );
  });

  it("does not share a parse cache across instances on the same directory", async () => {
    const dir = await tempDir();
    const a = createJsonlSessionStore({ dir });
    const b = createJsonlSessionStore({ dir });
    await a.append(entry("e1", "s1"));
    const bBefore = fileReads(b);
    assert.deepEqual(
      (await b.list("s1")).map((row) => row.id),
      ["e1"],
    );
    assert.equal(fileReads(b), bBefore + 1);
    await b.append(entry("e2", "s1"));
    const aBefore = fileReads(a);
    assert.deepEqual(
      (await a.list("s1")).map((row) => row.id),
      ["e1", "e2"],
    );
    assert.equal(fileReads(a), aBefore + 1);
  });

  it("jsonl_session_id_traversal_fails_closed", async () => {
    const dir = await tempDir();
    const store = createJsonlSessionStore({ dir });
    for (const sessionId of ["../escape", "a/b", "..", "", ".hidden"]) {
      await assert.rejects(
        () => store.append(entry("e1", sessionId)),
        (error: unknown) => error instanceof JsonlSessionStoreError && error.code === "invalid_session_id",
        `append must refuse ${JSON.stringify(sessionId)}`,
      );
      await assert.rejects(
        () => store.list(sessionId),
        (error: unknown) => error instanceof JsonlSessionStoreError && error.code === "invalid_session_id",
        `list must refuse ${JSON.stringify(sessionId)}`,
      );
      await assert.rejects(
        () => deleteOne(store, sessionId),
        (error: unknown) => error instanceof JsonlSessionStoreError && error.code === "invalid_session_id",
        `deleteSession must refuse ${JSON.stringify(sessionId)}`,
      );
    }
    // Nothing was written beside the directory, and a traversal first line does not fail a listing.
    await assert.rejects(() => readFile(join(dir, "..", "escape.jsonl"), "utf8"));
    assert.deepEqual((await listAll(store)).items, []);
  });

  it("jsonl_list_sessions_surfaces_entry_metadata_title", async () => {
    const dir = await tempDir();
    const store = createJsonlSessionStore({ dir });
    await store.append(entry("e1", "s1", { metadata: { title: "first prompt title" } }));
    for (let index = 0; index < 5; index += 1) await store.append(entry(`e${index + 2}`, "s1"));
    await store.append(entry("titled", "s2", { metadata: { title: "late title" } }));

    const items = (await listAll(store, { limit: 10 })).items;
    assert.equal(items.find((item) => item.sessionId === "s1")?.title, "first prompt title");
    assert.equal(items.find((item) => item.sessionId === "s2")?.title, "late title");
    // The listing carries display fields only, never a transcript.
    assert.equal(JSON.stringify(items).includes('"content"'), false);
    assert.equal(items.find((item) => item.sessionId === "s1")?.leafId, "e6");
  });

  it("jsonl_list_sessions_reads_no_full_transcript", async () => {
    const dir = await tempDir();
    const store = createJsonlSessionStore({ dir });
    const text = "x".repeat(8_000);
    await store.append(
      createSessionEntry({
        id: "root",
        sessionId: "big",
        kind: "message",
        message: { role: "user", content: [{ type: "text", text }] },
      }),
    );
    for (let index = 0; index < 200; index += 1) {
      await store.append(
        createSessionEntry({
          id: `e${index}`,
          parentId: index === 0 ? "root" : `e${index - 1}`,
          sessionId: "big",
          kind: "message",
          message: { role: "assistant", content: [{ type: "text", text }] },
        }),
      );
    }
    const size = (await stat(join(dir, "big.jsonl"))).size;
    assert.ok(size > 1_000_000, `expected a large fixture, got ${size} bytes`);

    const bytesBefore = bytesRead(store);
    const items = (await listAll(store, { limit: 10 })).items;
    const read = bytesRead(store) - bytesBefore;

    assert.equal(items.length, 1);
    assert.equal(items[0]?.leafId, "e199");
    assert.ok(read <= size / 2, `listSessions read ${read} of ${size} bytes; it must sample the edges`);
  });

  it("list_and_delete_honor_the_ownership_scope", async () => {
    const dir = await tempDir();
    const store = createJsonlSessionStore({ dir });
    const stamp = (sessionId: string, tenantId: string, at: number) =>
      createSessionEntry({
        id: `${sessionId}-e1`,
        sessionId,
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, at)).toISOString(),
        kind: "message",
        message: { role: "user", content: [{ type: "text", text: "scoped" }] },
        metadata: { tenantId },
      });
    await store.append(stamp("mine", "tenant-a", 1));
    await store.append(stamp("newer", "tenant-a", 2));
    await store.append(stamp("theirs", "tenant-b", 3));

    const scoped = await listAll(store, { tenantId: "tenant-a", limit: 10 });
    assert.deepEqual(
      scoped.items.map((item) => item.sessionId),
      ["newer", "mine"],
    );
    assert.equal((await listAll(store, { tenantId: "tenant-b", limit: 10 })).items.length, 1);
    assert.equal((await listAll(store, { tenantId: "tenant-a", limit: 1 })).items.length, 1);
    assert.deepEqual(
      (await listAll(store, { order: "asc", limit: 10 })).items.map((item) => item.sessionId),
      ["mine", "newer", "theirs"],
    );
    const first = await listAll(store, { limit: 1 });
    assert.equal(first.items.length, 1);
    assert.equal(typeof first.nextCursor, "string");
    assert.deepEqual(
      (await listAll(store, { limit: 10, cursor: first.nextCursor })).items.map((item) => item.sessionId),
      ["newer", "mine"],
    );

    assert.equal(await deleteOne(store, "theirs", { tenantId: "tenant-a" }), false);
    assert.equal((await store.list("theirs")).length, 1, "a refused deleteSession must not remove entries");
    assert.equal(await deleteOne(store, "theirs", { tenantId: "tenant-b" }), true);
    assert.deepEqual(await store.list("theirs"), []);
    assert.equal(await deleteOne(store, "theirs", { tenantId: "tenant-b" }), false);
    assert.equal((await store.list("mine")).length, 1);
  });

  it("jsonl_store_passes_store_conformance_with_reopen", async () => {
    const dir = await tempDir();
    let opens = 0;
    await storeConformance(
      () => {
        opens += 1;
        return createJsonlSessionStore({ dir });
      },
      { reopen: () => createJsonlSessionStore({ dir }) },
    );
    assert.ok(opens >= 1);
  });
});

async function readdirNames(dir: string): Promise<string[]> {
  return readdir(dir);
}

function fileReads(store: object): number {
  return counter(store, JSONL_FILE_READS, "fileReads");
}

function bytesRead(store: object): number {
  return counter(store, JSONL_BYTES_READ, "bytesRead");
}

function counter(store: object, symbol: symbol, name: string): number {
  const value = (store as Record<symbol, number>)[symbol];
  if (typeof value !== "number") throw new Error(`missing jsonl ${name} probe`);
  return value;
}
