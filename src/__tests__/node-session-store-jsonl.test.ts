import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSessionEntry } from "../session-stores.js";
import { createJsonlSessionStore, readJsonlSessionEntries } from "../node/session-store-jsonl.js";

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

  it("package subpath is declared", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { exports: Record<string, unknown> };

    assert.deepEqual(packageJson.exports["./node/session-store-jsonl"], {
      types: "./dist/node/session-store-jsonl.d.ts",
      default: "./dist/node/session-store-jsonl.js",
    });
  });
});
