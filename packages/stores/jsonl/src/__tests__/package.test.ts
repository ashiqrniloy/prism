import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "bun:test";
import { createAgent, createSessionEntry } from "@arnilo/prism";
import { mockProvider, packageConformance } from "@arnilo/prism/testing";
import jsonlStore, { createJsonlSessionStore, jsonlStore as jsonlStoreInstance, readJsonlSessionEntries } from "../index.js";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-jsonl-package-"));
  dirs.push(dir);
  return dir;
}

describe("jsonl store package", () => {
  it("jsonl_store_package_passes_package_conformance", async () => {
    const dir = await tempDir();
    const result = await packageConformance(jsonlStore, { config: { dir } });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  });

  it("refuses a config without dir", async () => {
    await assert.rejects(async () => {
      await createAgent({
        model: { provider: "mock", model: "m" },
        packages: [jsonlStoreInstance({} as never)],
      });
    }, /dir/);
  });

  it("claims the store slot and reports its capabilities", async () => {
    const dir = await tempDir();
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [jsonlStore({ dir })],
      slots: { store: "@arnilo/prism-store-jsonl" },
    });

    const view = agent.inspect();
    assert.equal(view.slots.store, "@arnilo/prism-store-jsonl");
    assert.deepEqual(view.store, {
      owner: "@arnilo/prism-store-jsonl",
      capabilities: ["listSessions", "deleteSession", "searchSessions"],
    });
  });

  it("jsonl_store_package_resumes_a_session_in_a_new_agent", async () => {
    const dir = await tempDir();
    const session = createSessionEntry({
      id: "e1",
      sessionId: "s1",
      kind: "message",
      message: { role: "user", content: [{ type: "text", text: "durable" }] },
    });
    await createJsonlSessionStore({ dir }).append(session);

    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [mockProvider(), jsonlStore({ dir })],
    });
    const summary = await agent.sessions.get("s1");

    assert.equal(summary?.sessionId, "s1");
    assert.equal(summary?.leafId, "e1");
    assert.deepEqual(await createJsonlSessionStore({ dir }).list("s1"), [session]);
    assert.equal((await readJsonlSessionEntries(join(dir, "s1.jsonl"))).entries.length, 1);
  });
});
