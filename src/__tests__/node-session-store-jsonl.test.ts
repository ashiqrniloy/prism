import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSessionEntry } from "../session-stores.js";
import { createJsonlSessionStore, readJsonlSessionEntries } from "../node/session-store-jsonl.js";
import { isSessionAppendConflict, isSessionEntryKind, SESSION_ENTRY_KINDS, SESSION_ENTRY_SCHEMA_VERSION } from "../index.js";

async function tempPath(name = "sessions.jsonl"): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "prism-jsonl-")), name);
}

describe("node jsonl session store", () => {
  it("round trips entries across instances", async () => {
    const path = await tempPath("nested/sessions.jsonl");
    const entry = createSessionEntry({ id: "e1", sessionId: "s1", kind: "message", message: { role: "user", content: [{ type: "text", text: "hi" }] } });

    await createJsonlSessionStore(path).append(entry);

    assert.deepEqual(await createJsonlSessionStore(path).list("s1"), [entry]);
  });

  it("lists only requested session id", async () => {
    const path = await tempPath();
    const store = createJsonlSessionStore(path);
    await store.append(createSessionEntry({ id: "e1", sessionId: "s1", kind: "label", label: "one" }));
    await store.append(createSessionEntry({ id: "e2", sessionId: "s2", kind: "label", label: "two" }));

    assert.deepEqual((await store.list("s1")).map((entry) => entry.id), ["e1"]);
  });

  it("get returns entry by id", async () => {
    const path = await tempPath();
    const store = createJsonlSessionStore(path);
    const entry = createSessionEntry({ id: "e1", sessionId: "s1", kind: "summary", summary: "sum" });
    await store.append(entry);

    assert.deepEqual(await store.get?.("e1"), entry);
    assert.equal(await store.get?.("missing"), undefined);
  });

  it("missing file is empty", async () => {
    const store = createJsonlSessionStore(await tempPath());

    assert.deepEqual(await store.list("s1"), []);
    assert.equal(await store.get?.("e1"), undefined);
  });

  it("quarantines invalid json line and returns usable entries", async () => {
    const path = await tempPath();
    const valid = createSessionEntry({ id: "e1", sessionId: "s1", kind: "label", label: "ok" });
    await writeFile(path, [JSON.stringify(valid), "{"].join("\n"), "utf8");

    const store = createJsonlSessionStore(path);
    assert.deepEqual(await store.list("s1"), [valid]);

    const result = await readJsonlSessionEntries(path);
    assert.equal(result.entries.length, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]!.line, 2);
    assert.ok(result.errors[0]!.message.includes("Invalid JSON"));
  });

  it("quarantines invalid message summary parentId and model_change shapes", async () => {
    const path = await tempPath();
    const valid = createSessionEntry({ id: "e1", sessionId: "s1", kind: "label", label: "ok" });
    const badMessage = JSON.stringify({ id: "e2", sessionId: "s1", timestamp: "2024-01-01T00:00:00.000Z", kind: "message", message: "not-an-object" });
    const badSummary = JSON.stringify({ id: "e3", sessionId: "s1", timestamp: "2024-01-01T00:00:00.000Z", kind: "summary", summary: 123 });
    const badParentId = JSON.stringify({ id: "e4", sessionId: "s1", timestamp: "2024-01-01T00:00:00.000Z", kind: "label", label: "x", parentId: 1 });
    const badModel = JSON.stringify({ id: "e5", sessionId: "s1", timestamp: "2024-01-01T00:00:00.000Z", kind: "model_change", model: "not-an-object" });
    await writeFile(path, [JSON.stringify(valid), badMessage, badSummary, badParentId, badModel].join("\n"), "utf8");

    const store = createJsonlSessionStore(path);
    assert.deepEqual((await store.list("s1")).map((entry) => entry.id), ["e1"]);

    const result = await readJsonlSessionEntries(path);
    assert.equal(result.entries.length, 1);
    assert.equal(result.errors.length, 4);
    assert.ok(result.errors.some((error) => error.message.includes("message entry")));
    assert.ok(result.errors.some((error) => error.message.includes("summary entry")));
    assert.ok(result.errors.some((error) => error.message.includes("parentId")));
    assert.ok(result.errors.some((error) => error.message.includes("model_change")));
  });

  it("quarantines invalid custom and compaction data shapes", async () => {
    const path = await tempPath();
    const badCustom = JSON.stringify({ id: "c1", sessionId: "s1", timestamp: "2024-01-01T00:00:00.000Z", kind: "custom", data: ["array"] });
    const badCompaction = JSON.stringify({ id: "cp1", sessionId: "s1", timestamp: "2024-01-01T00:00:00.000Z", kind: "compaction", summary: 123, data: "not-object" });
    const compactionNoSummary = JSON.stringify({ id: "cp2", sessionId: "s1", timestamp: "2024-01-01T00:00:00.000Z", kind: "compaction", data: { ok: true } });
    await writeFile(path, [badCustom, badCompaction, compactionNoSummary].join("\n"), "utf8");

    const result = await readJsonlSessionEntries(path);
    assert.equal(result.entries.length, 0);
    assert.equal(result.errors.length, 3);
    assert.ok(result.errors.some((error) => error.message.includes("custom entry")));
    assert.ok(result.errors.some((error) => error.message.includes("compaction entry")));
  });

  it("blocks append when the file contains invalid json lines", async () => {
    const path = await tempPath();
    const valid = createSessionEntry({ id: "e1", sessionId: "s1", kind: "label", label: "ok" });
    await writeFile(path, [JSON.stringify(valid), "{"].join("\n"), "utf8");
    const store = createJsonlSessionStore(path);

    await assert.rejects(
      () => store.append(createSessionEntry({ id: "e2", sessionId: "s1", kind: "label", label: "new" })),
      /Invalid JSONL at line 2/,
    );
  });

  it("blocks append when the file contains shape-invalid lines", async () => {
    const path = await tempPath();
    const valid = createSessionEntry({ id: "e1", sessionId: "s1", kind: "label", label: "ok" });
    const badShape = JSON.stringify({
      id: "bad",
      sessionId: "s1",
      timestamp: "2024-01-01T00:00:00.000Z",
      kind: "message",
      message: { role: 123 },
    });
    await writeFile(path, [JSON.stringify(valid), badShape].join("\n"), "utf8");
    const store = createJsonlSessionStore(path);

    await assert.rejects(
      () => store.append(createSessionEntry({ id: "e2", sessionId: "s1", kind: "label", label: "new" })),
      /Invalid JSONL at line 2/,
    );
    // Reads still quarantine rather than fail the whole file.
    assert.deepEqual((await store.list("s1")).map((entry) => entry.id), ["e1"]);
  });

  it("does not poison a branch when one entry is invalid", async () => {
    const path = await tempPath();
    const good = createSessionEntry({ id: "good", sessionId: "s1", kind: "message", message: { role: "user", content: [{ type: "text", text: "hi" }] } });
    const bad = JSON.stringify({ id: "bad", sessionId: "s1", timestamp: "2024-01-01T00:00:00.000Z", kind: "message", message: { role: 123 } });
    await writeFile(path, [JSON.stringify(good), bad].join("\n"), "utf8");

    const store = createJsonlSessionStore(path);
    assert.deepEqual((await store.list("s1")).map((entry) => entry.id), ["good"]);
    assert.deepEqual(await store.get?.("good"), good);
    assert.equal(await store.get?.("bad"), undefined);
  });

  it("serializes appends and writes json lines", async () => {
    const path = await tempPath();
    const store = createJsonlSessionStore(path);

    await Promise.all([
      store.append(createSessionEntry({ id: "e1", sessionId: "s1", kind: "label", label: "one" })),
      store.append(createSessionEntry({ id: "e2", sessionId: "s1", kind: "label", label: "two" })),
    ]);

    assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 2);
  });

  it("rejects duplicate entry ids", async () => {
    const path = await tempPath();
    const store = createJsonlSessionStore(path);
    const entry = createSessionEntry({ id: "e1", sessionId: "s1", kind: "label", label: "one" });

    await store.append(entry);
    await assert.rejects(() => store.append({ ...entry, sessionId: "s2" }), /Duplicate session entry id: e1/);
  });

  it("throws SessionAppendConflictError when expectedParentId does not exist", async () => {
    const path = await tempPath();
    const store = createJsonlSessionStore(path);
    const orphan = createSessionEntry({ id: "e1", sessionId: "s1", kind: "label", label: "orphan" });
    await assert.rejects(
      () => store.append(orphan, { expectedParentId: "missing" }),
      (error: unknown) => isSessionAppendConflict(error) && error.conflict.expectedParentId === "missing",
    );
    assert.equal((await readJsonlSessionEntries(path)).entries.length, 0);
  });

  it("deduplicates an exact retry at the same position by idempotencyKey", async () => {
    const path = await tempPath();
    const store = createJsonlSessionStore(path);
    await store.append(createSessionEntry({ id: "e1", sessionId: "s1", kind: "label", label: "root" }), { idempotencyKey: "k1" });
    await assert.rejects(
      () => store.append(createSessionEntry({ id: "dup", sessionId: "s1", kind: "label", label: "dup" }), { idempotencyKey: "k1" }),
      (error: unknown) => isSessionAppendConflict(error) && error.conflict.idempotencyDuplicate === true,
    );
    assert.equal((await readJsonlSessionEntries(path)).entries.length, 1);
  });

  it("package subpath is declared", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { exports: Record<string, unknown> };

    assert.deepEqual(packageJson.exports["./node/session-store-jsonl"], {
      types: "./dist/node/session-store-jsonl.d.ts",
      default: "./dist/node/session-store-jsonl.js",
    });
  });

  it("exports session entry kind constants and validator", () => {
    assert.equal(SESSION_ENTRY_SCHEMA_VERSION, 1);
    assert.deepEqual(SESSION_ENTRY_KINDS, ["message", "event", "summary", "metadata", "model_change", "label", "custom", "compaction"]);
    for (const kind of SESSION_ENTRY_KINDS) assert.equal(isSessionEntryKind(kind), true);
    assert.equal(isSessionEntryKind("future_kind"), false);
    assert.equal(isSessionEntryKind(123), false);
  });

  it("quarantines unknown entry kinds", async () => {
    const path = await tempPath();
    const valid = createSessionEntry({ id: "e1", sessionId: "s1", kind: "label", label: "ok" });
    const unknownKind = JSON.stringify({ id: "e2", sessionId: "s1", timestamp: "2024-01-01T00:00:00.000Z", kind: "future_kind", label: "x" });
    await writeFile(path, [JSON.stringify(valid), unknownKind].join("\n"), "utf8");

    const store = createJsonlSessionStore(path);
    assert.deepEqual((await store.list("s1")).map((entry) => entry.id), ["e1"]);

    const result = await readJsonlSessionEntries(path);
    assert.equal(result.entries.length, 1);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0]!.message.includes("Unknown session entry kind"));
    assert.ok(result.errors[0]!.message.includes("future_kind"));
  });

  it("accepts omitted schemaVersion as v1", async () => {
    const path = await tempPath();
    const entry = { id: "e1", sessionId: "s1", timestamp: "2024-01-01T00:00:00.000Z", kind: "label", label: "ok" };
    await writeFile(path, JSON.stringify(entry), "utf8");

    const result = await readJsonlSessionEntries(path);
    assert.equal(result.errors.length, 0);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0]!.schemaVersion, undefined);
  });

  it("rejects unsupported schemaVersion", async () => {
    const path = await tempPath();
    const valid = createSessionEntry({ id: "e1", sessionId: "s1", kind: "label", label: "ok" });
    const futureVersion = JSON.stringify({ id: "e2", sessionId: "s1", timestamp: "2024-01-01T00:00:00.000Z", kind: "label", label: "x", schemaVersion: 2 });
    const badVersion = JSON.stringify({ id: "e3", sessionId: "s1", timestamp: "2024-01-01T00:00:00.000Z", kind: "label", label: "x", schemaVersion: "v1" });
    await writeFile(path, [JSON.stringify(valid), futureVersion, badVersion].join("\n"), "utf8");

    const result = await readJsonlSessionEntries(path);
    assert.equal(result.entries.length, 1);
    assert.equal(result.errors.length, 2);
    assert.ok(result.errors.some((error) => error.message.includes("Unsupported session entry schema version: 2")));
    assert.ok(result.errors.some((error) => error.message.includes("Unsupported session entry schema version: v1")));
  });

  it("round trips event and metadata entries with valid payloads", async () => {
    const path = await tempPath();
    const eventEntry = createSessionEntry({ id: "ev1", sessionId: "s1", kind: "event", event: { type: "agent_started", sessionId: "s1", runId: "r1" } });
    const metadataEntry = createSessionEntry({ id: "md1", sessionId: "s1", kind: "metadata", data: { source: "test" } });
    const store = createJsonlSessionStore(path);
    await store.append(eventEntry);
    await store.append(metadataEntry);

    assert.deepEqual(await store.list("s1"), [eventEntry, metadataEntry]);
  });

  it("quarantines event and metadata entries with invalid payloads", async () => {
    const path = await tempPath();
    const badEvent = JSON.stringify({ id: "ev1", sessionId: "s1", timestamp: "2024-01-01T00:00:00.000Z", kind: "event", event: "not-an-object" });
    const badMetadata = JSON.stringify({ id: "md1", sessionId: "s1", timestamp: "2024-01-01T00:00:00.000Z", kind: "metadata", data: ["array"] });
    await writeFile(path, [badEvent, badMetadata].join("\n"), "utf8");

    const result = await readJsonlSessionEntries(path);
    assert.equal(result.entries.length, 0);
    assert.equal(result.errors.length, 2);
    assert.ok(result.errors.some((error) => error.message.includes("event entry")));
    assert.ok(result.errors.some((error) => error.message.includes("metadata entry")));
  });
});
