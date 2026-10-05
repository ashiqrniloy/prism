import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "bun:test";
import { createAgent, createSessionEntry } from "@arnilo/prism";
import { mockProvider, packageConformance } from "@arnilo/prism/testing";
import sqliteStore, { createSqlitePersistence, sqliteStore as sqliteStoreInstance } from "../index.js";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempDb(name = "sessions.db"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-sqlite-package-"));
  dirs.push(dir);
  return join(dir, name);
}

describe("sqlite store package", () => {
  it("sqlite_store_package_passes_package_conformance", async () => {
    const result = await packageConformance(sqliteStore, { config: { path: ":memory:" } });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  });

  it("refuses a config without path", async () => {
    await assert.rejects(async () => {
      await createAgent({
        model: { provider: "mock", model: "m" },
        packages: [sqliteStoreInstance({} as never)],
      });
    }, /path/);
  });

  it("claims the store slot and reports its capabilities", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [sqliteStore({ path: ":memory:" })],
      slots: { store: "@arnilo/prism-store-sqlite" },
    });

    const view = agent.inspect();
    assert.equal(view.slots.store, "@arnilo/prism-store-sqlite");
    assert.deepEqual(view.store, {
      owner: "@arnilo/prism-store-sqlite",
      capabilities: ["listSessions", "deleteSession", "searchSessions"],
    });
  });

  it("resumes a session the package store wrote and serves agent.sessions", async () => {
    const path = await tempDb();
    const session = createSessionEntry({
      id: "e1",
      sessionId: "s1",
      kind: "message",
      message: { role: "user", content: [{ type: "text", text: "durable sqlite" }] },
      metadata: { title: "durable sqlite" },
    });
    await createSqlitePersistence({ filename: path }).append(session);

    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [mockProvider(), sqliteStore({ path })],
    });
    const summary = await agent.sessions.get("s1");
    assert.equal(summary?.sessionId, "s1");
    assert.equal(summary?.leafId, "e1");

    const listed = await agent.sessions.list({ limit: 5 });
    assert.deepEqual(listed.items.map((item) => item.sessionId), ["s1"]);

    await agent.sessions.delete("s1");
    assert.equal(await agent.sessions.get("s1"), undefined);
    assert.deepEqual((await agent.sessions.list({ limit: 5 })).items, []);
  });
});
