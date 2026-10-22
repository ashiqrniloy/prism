/**
 * Plan 188.4 Task 2: the scope clock ticks once per session per active scope, in the store, and the
 * session's own state keeps a restore from counting it twice.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "bun:test";
import { createAgent, createMemorySessionStore, providerDone, providerTextDelta } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import memoryFabric, { projectResourceId, resolveProjectIdentity } from "../index.js";

describe("Scope clock (plan 188.4 Task 2)", () => {
  it("scope_clock_counts_once_per_session_and_survives_restore", async () => {
    const root = await mkdtemp(join(tmpdir(), "prism-scope-clock-"));
    const notes = join(root, "notes");
    // One active scope keeps the assertion exact: the project's resource id.
    const resourceId = projectResourceId(resolveProjectIdentity(root));
    const provider = mockProvider([[providerTextDelta("ok"), providerDone()]]);
    const agent = await createAgent({
      model: { provider: "mock", model: "main" },
      packages: [
        provider,
        memoryFabric({
          tools: { root },
          store: { markdown: { dir: notes } },
          scopes: { user: false, agent: false, project: { root } },
          consolidate: false,
        }),
      ],
      slots: { store: createMemorySessionStore() },
    });
    const { createMarkdownMemoryStores } = await import("@arnilo/prism-memory-core/fabric");
    const counter = async (): Promise<number> => {
      const stores = await createMarkdownMemoryStores({ root: notes });
      try {
        return await stores.vectorStore.scopeCounter.get({ tenantId: "prism", resourceId, name: "sessions" });
      } finally {
        await stores.close();
      }
    };
    try {
      const session = await agent.session({ id: "clock-1", create: true });
      await session.run("first turn");
      assert.equal(await counter(), 1, "the first context.build ticks the project scope");
      await session.run("second turn");
      assert.equal(await counter(), 1, "later turns of the same session never re-tick");
      await session.close();

      // A restore re-reads the session's branch, which already records the tick.
      const restored = await agent.session({ id: "clock-1", create: true });
      await restored.run("after restore");
      assert.equal(await counter(), 1, "a restored session does not count itself twice");
      await restored.close();

      const other = await agent.session({ id: "clock-2", create: true });
      await other.run("new session");
      assert.equal(await counter(), 2, "a new session advances the clock");
      await other.close();
    } finally {
      await agent.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});