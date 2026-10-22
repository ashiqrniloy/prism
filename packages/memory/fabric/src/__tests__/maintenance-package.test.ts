/**
 * Plan 188.4 Further Action 2: a nightly `memory:maintain` widens across projects the process does not
 * bind. The package opens each project resource it discovers over its own stores, so the host does not
 * have to pre-bind a project to get it widened or archived.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "bun:test";
import { createAgent, createMemorySessionStore, providerDone, providerTextDelta } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { createSqliteMemoryStores } from "@arnilo/prism-memory-core/sqlite";
import memoryFabric, {
  createMemory,
  createMemoryWorkingStore,
  encodeMemoryNoteMetadata,
  projectResourceId,
  resolveProjectIdentity,
} from "../index.js";

const OTHER_PROJECT = "projects/beta--22222222";
const LESSON = "Drain the canary pool before every rollback";

/** Write one verified project note through the SQLite index the package itself will read. */
async function seed(index: string, resourceId: string, id: string): Promise<void> {
  const stores = await createSqliteMemoryStores({ path: index });
  try {
    const memory = createMemory({
      tenantId: "prism",
      resourceId,
      threadId: "default",
      vectorStore: stores.vectorStore,
      workingStore: createMemoryWorkingStore(),
    });
    await memory.remember(
      {
        entries: [
          {
            id,
            text: LESSON,
            createdAt: "2026-01-01T00:00:00.000Z",
            metadata: { fabric: encodeMemoryNoteMetadata({ kind: "fact", key: "canary.drain", created: 0 }) },
          },
        ],
      },
      { wait: true },
    );
  } finally {
    await stores.close();
  }
}

/** The stored row, read the way the pass reads it: metadata out of the store's own scan. */
async function statusOf(index: string, resourceId: string, id: string): Promise<{ status?: unknown; widenedTo?: unknown }> {
  const stores = await createSqliteMemoryStores({ path: index });
  try {
    const page = await stores.vectorStore.scanMetadata({ scope: { tenantId: "prism", resourceId }, limit: 100 });
    const row = page.rows.find((item) => item.id === id);
    return {
      status: row?.metadata?.status,
      widenedTo: (row?.metadata?.fabric as { widenedTo?: unknown } | undefined)?.widenedTo,
    };
  } finally {
    await stores.close();
  }
}

describe("Maintenance over unbound projects (plan 188.4 Further Action 2)", () => {
  it("memory_maintain_widens_a_project_the_process_does_not_bind", async () => {
    const root = await mkdtemp(join(tmpdir(), "prism-maintain-open-"));
    const index = join(root, "index.sqlite");
    try {
      const boundId = projectResourceId(resolveProjectIdentity(root));
      const agent = await createAgent({
        model: { provider: "mock", model: "main" },
        packages: [
          mockProvider([[providerTextDelta("ok"), providerDone()]]),
          // Only the project at `root` is bound; the second project is known to the store alone.
          memoryFabric({
            tools: { root },
            store: { sqlite: { path: index } },
            scopes: { user: false, agent: true, project: { root } },
            consolidate: false,
          }),
        ],
        slots: { store: createMemorySessionStore() },
      });
      try {
        // Both notes exist in the store; only one of the two projects is bound in the package config.
        await seed(index, boundId, "a1000000000a");
        await seed(index, OTHER_PROJECT, "b1000000000b");

        const maintenance = await agent.session({ id: "maintain-nightly", create: true });
        const report = (await agent.commands.run("memory:maintain", {}, { session: maintenance })) as {
          ok: boolean;
          widened: number;
        };
        await maintenance.close();
        assert.equal(report.ok, true);
        assert.equal(report.widened, 1, "a lesson verified in the bound and the unbound project widens");

        for (const [resource, id] of [
          [boundId, "a1000000000a"],
          [OTHER_PROJECT, "b1000000000b"],
        ] as const) {
          const copy = await statusOf(index, resource, id);
          assert.equal(copy.status, "archived", `${resource} copy is archived`);
          assert.match(String(copy.widenedTo ?? ""), /^[0-9a-f]{12}$/);
        }
      } finally {
        await agent.dispose();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
