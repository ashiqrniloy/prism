/**
 * Plan 188.4 Further Action 4: `memory:lifecycle` explains one note from inside a session — the
 * operator-facing surface of the archive and widening rules.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "bun:test";
import { createAgent, createMemorySessionStore, type JsonObject, providerDone, providerTextDelta } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { createSqliteMemoryStores } from "@arnilo/prism-memory-core/sqlite";
import memoryFabric, {
  createMemory,
  createMemoryWorkingStore,
  encodeMemoryNoteMetadata,
  projectResourceId,
  resolveProjectIdentity,
} from "../index.js";

/** One seeded note: a verified procedure, used once, in a project twenty sessions old. */
async function seed(index: string, project: string): Promise<void> {
  const stores = await createSqliteMemoryStores({ path: index });
  try {
    const memory = createMemory({
      tenantId: "prism",
      resourceId: project,
      threadId: "default",
      vectorStore: stores.vectorStore,
      workingStore: createMemoryWorkingStore(),
    });
    for (let session = 0; session < 20; session += 1) {
      await stores.vectorStore.scopeCounter.increment({ tenantId: "prism", resourceId: project, name: "sessions" });
    }
    await memory.remember(
      {
        entries: [
          {
            id: "a1000000000a",
            text: "Drain the canary pool before every rollback",
            createdAt: "2026-01-01T00:00:00.000Z",
            metadata: {
              fabric: encodeMemoryNoteMetadata({
                kind: "procedure",
                key: "canary.drain",
                created: 0,
                uses: [{ s: 0, at: "2026-01-01T00:00:00.000Z" }],
                useSessions: 1,
              }),
            },
          },
        ],
      },
      { wait: true },
    );
    await memory.remember(
      {
        entries: [
          {
            id: "b1000000000b",
            text: "Tag every release twice",
            createdAt: "2026-01-01T00:00:00.000Z",
            metadata: {
              status: "archived",
              fabric: encodeMemoryNoteMetadata({
                kind: "fact",
                key: "release.tag",
                created: 0,
                archivedAt: "2026-01-02T00:00:00.000Z",
                archivedFrom: "verified",
              }),
            },
          },
        ],
      },
      { wait: true },
    );
  } finally {
    await stores.close();
  }
}

describe("memory:lifecycle (plan 188.4 Further Action 4)", () => {
  it("explains_a_note_and_filters_by_id_and_archive", async () => {
    const root = await mkdtemp(join(tmpdir(), "prism-lifecycle-"));
    const index = join(root, "index.sqlite");
    try {
      const agent = await createAgent({
        model: { provider: "mock", model: "main" },
        packages: [
          mockProvider([[providerTextDelta("ok"), providerDone()]]),
          memoryFabric({
            tools: { root },
            store: { sqlite: { path: index } },
            scopes: { user: false, agent: false, project: { root } },
            consolidate: false,
          }),
        ],
        slots: { store: createMemorySessionStore() },
      });
      try {
        await seed(index, projectResourceId(resolveProjectIdentity(root)));
        const session = await agent.session({ id: "inspect-1", create: true });
        const listed = (await agent.commands.run("memory:lifecycle", {}, { session })) as JsonObject;
        assert.equal(listed.ok, true);
        assert.equal(listed.total, 1);
        const view = (listed.notes as JsonObject[])[0]!;
        assert.equal(view.id, "a1000000000a");
        assert.equal(view.key, "canary.drain");
        assert.equal(view.noteScope, undefined, "a project note carries no explicit scope");
        assert.equal(view.useSessions, 1);
        assert.equal(view.retrieval, Math.round(Math.log(21 ** -0.4) * 10_000) / 10_000, "R is read from the scope clock");
        assert.deepEqual((view.uses as JsonObject[]).length, 1);
        assert.deepEqual(view.archive, { eligible: false, reasons: ["retrieval"] }, "a used procedure is not archivable yet");
        assert.deepEqual(view.widen, { eligible: true, reasons: [] }, "note-level gates pass; replication decides");
        assert.match(String(listed.text), /^1 of 1 note\(s\), most retrievable first:\na1000000000a procedure key=canary\.drain/);

        const byId = (await agent.commands.run("memory:lifecycle", { id: "a1000000000a" }, { session })) as JsonObject;
        assert.equal(byId.total, 1);
        const missing = (await agent.commands.run("memory:lifecycle", { id: "ffffffffffff" }, { session })) as JsonObject;
        assert.equal(missing.total, 0);
        assert.equal(missing.text, "No note matches.");
        const byKey = (await agent.commands.run("memory:lifecycle", { key: "canary.drain" }, { session })) as JsonObject;
        assert.equal(byKey.total, 1);
        const otherKey = (await agent.commands.run("memory:lifecycle", { key: "release.gate" }, { session })) as JsonObject;
        assert.equal(otherKey.total, 0);
        const limited = (await agent.commands.run("memory:lifecycle", { limit: 1 }, { session })) as JsonObject;
        assert.equal(limited.total, 1);

        // An archived note is hidden from the default view; `includeArchived` explains it too.
        const withArchived = (await agent.commands.run(
          "memory:lifecycle",
          { includeArchived: true },
          { session },
        )) as JsonObject;
        assert.equal(withArchived.total, 2);
        const archived = (withArchived.notes as JsonObject[]).find((note) => note.id === "b1000000000b")!;
        assert.equal(archived.status, "archived");
        assert.equal(archived.archivedAt, "2026-01-02T00:00:00.000Z");
        assert.equal(archived.archivedFrom, "verified");
        const archivedOnly = (await agent.commands.run(
          "memory:lifecycle",
          { id: "b1000000000b" },
          { session },
        )) as JsonObject;
        assert.equal(archivedOnly.total, 0, "the default view hides archived notes");
        const capped = (await agent.commands.run(
          "memory:lifecycle",
          { includeArchived: true, limit: 1 },
          { session },
        )) as JsonObject;
        assert.equal(capped.total, 2);
        assert.equal((capped.notes as JsonObject[]).length, 1, "limit caps the printed rows, not the count");
        await session.close();
      } finally {
        await agent.dispose();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
