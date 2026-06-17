import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSessionEntry } from "../session-stores.js";
import { createJsonlSessionStore } from "../node/session-store-jsonl.js";

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

  it("rejects invalid json line", async () => {
    const path = await tempPath();
    await writeFile(path, "{\n", "utf8");

    await assert.rejects(() => createJsonlSessionStore(path).list("s1"), /Invalid JSONL session entry at line 1/);
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
