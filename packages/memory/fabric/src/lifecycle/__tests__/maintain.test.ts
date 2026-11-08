/**
 * Plan 188.4 Task 6: scope widening is replication-gated, narrowing is contradiction-gated, and one
 * maintenance pass runs archive → capacity → widening → narrowing for every active scope.
 */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createSessionEntry, type ModelClient, providerDone, providerToolCall, toolCallContent } from "@arnilo/prism";
import { createMemoryVectorStore, type Memory, type VectorStore } from "@arnilo/prism-memory-core";
import { resolveLifecycleConfig } from "../../config.js";
import { createMemoryFabric } from "../../create.js";
import { createMemory, createMemoryWorkingStore, type MemoryFabricScopeBinding } from "../../index.js";
import { resolvePromoteConfig } from "../../promote.js";
import { encodeMemoryNoteMetadata, type MemoryNoteMetadata, parseMemoryNoteMetadata } from "../../types.js";

const PROJECT_A = "projects/alpha--11111111";
const PROJECT_B = "projects/beta--22222222";
const TENANT = "prism";

interface NoteInput {
  readonly id: string;
  readonly text: string;
  readonly key?: string;
  readonly scope?: "project" | "path";
  readonly appliesTo?: readonly string[];
  readonly status?: "candidate" | "verified";
  readonly harmful?: number;
  readonly contradictedIn?: readonly string[];
  /** Scope ordinal the note was written in; 0 is old enough to archive once the clock moves. */
  readonly created?: number;
}

/** Write one note the way a project's own fabric would: core memory, fabric metadata. */
async function note(memory: Memory, input: NoteInput, createdAt = "2026-01-01T00:00:00.000Z"): Promise<string> {
  const fields: Omit<MemoryNoteMetadata, "v"> = {
    kind: "fact",
    ...(input.key === undefined ? {} : { key: input.key }),
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    ...(input.appliesTo === undefined ? {} : { appliesTo: input.appliesTo }),
    ...(input.harmful === undefined ? {} : { harmful: input.harmful }),
    ...(input.contradictedIn === undefined ? {} : { contradictedIn: input.contradictedIn }),
    created: input.created ?? 0,
  };
  await memory.remember(
    {
      entries: [
        {
          id: input.id,
          text: input.text,
          createdAt,
          metadata: { fabric: encodeMemoryNoteMetadata(fields), ...(input.status === undefined ? {} : { status: input.status }) },
        },
      ],
    },
    { wait: true },
  );
  return input.id;
}

/** A fabric over several project resources plus the agent and user scopes they widen and narrow into. */
function stack(
  options: {
    readonly projects?: readonly string[];
    readonly capacityNotes?: number;
    readonly promote?: boolean;
    readonly client?: ModelClient;
  } = {},
) {
  // One store per stack, so every scope shares a tenant and the maintenance scan can list projects.
  const vectorStore = createMemoryVectorStore();
  const workingStore = createMemoryWorkingStore();
  const projects = options.projects ?? [PROJECT_A, PROJECT_B];
  const memoryFor = (resourceId: string) => createMemory({ tenantId: TENANT, resourceId, threadId: "default", vectorStore, workingStore });
  const projectMemories = projects.map(memoryFor);
  const agent = memoryFor("agent");
  const user = memoryFor("user");
  const bindings: MemoryFabricScopeBinding[] = [
    ...projectMemories.map((memory) => ({ level: "project" as const, memory })),
    { level: "agent" as const, memory: agent },
    { level: "user" as const, memory: user },
  ];
  const lifecycle = resolveLifecycleConfig({
    ...(options.capacityNotes === undefined ? {} : { capacity: { project: { notes: options.capacityNotes } } }),
  });
  const fabric = createMemoryFabric({
    memory: projectMemories[0]!,
    scopes: bindings,
    vectorStore,
    ...(options.promote === true
      ? {
          promote: resolvePromoteConfig({ minTurnsBetween: 1 }),
          promoteRoot: "/nonexistent-prism-promote-root",
          resolveModelClient: () => options.client!,
        }
      : { consolidate: false }),
    lifecycle,
    clock: () => 0,
  });
  return { store: vectorStore, fabric, projects: projectMemories, agent, user, memoryFor };
}

async function advance(store: VectorStore, resourceId: string, sessions: number): Promise<void> {
  for (let index = 0; index < sessions; index += 1) await store.scopeCounter!.increment({ tenantId: TENANT, resourceId, name: "sessions" });
}

describe("lifecycle maintenance (plan 188.4 Tasks 4-5)", () => {










  it("maintain_runs_steps_in_order_and_reports_counts", async () => {
    const { fabric, projects, store } = stack({ capacityNotes: 3 });
    const [alpha, beta] = projects as [Memory, Memory];
    // The archive rule sees this candidate before capacity does: it archives by the rule, not by a merge,
    // so it never gains `mergedInto` from the verified note that shares its key.
    const recent = { created: 190 };
    const stale = await note(alpha, { id: "a7".padEnd(12, "0"), text: "Old gate rule", key: "stale.gate", status: "candidate" });
    const survivor = await note(alpha, { id: "b7".padEnd(12, "0"), text: "Gate rule", key: "stale.gate", ...recent });
    await note(alpha, { id: "c7".padEnd(12, "0"), text: "Gate budget is forty minutes", key: "gate.budget", ...recent });
    await note(alpha, { id: "d7".padEnd(12, "0"), text: "Gate budget is forty minutes", key: "gate.budget", ...recent });
    await note(alpha, { id: "e7".padEnd(12, "0"), text: "Drain the canary pool before every rollback", key: "canary.drain", ...recent });
    await note(beta, { id: "f7".padEnd(12, "0"), text: "Drain the canary pool before every rollback", key: "canary.drain", ...recent });
    await advance(store, PROJECT_A, 200);

    const report = await fabric.maintain();
    assert.deepEqual(report, {
      archived: 1,
      merged: 1,
      episodesMerged: 0,
      evicted: 0,
      overBudget: [],
    });
    const staleEntry = await alpha.getEntry(stale);
    assert.equal(staleEntry?.metadata?.status, "archived");
    assert.equal(parseMemoryNoteMetadata(staleEntry?.metadata)?.mergedInto, undefined, "archived by the rule, before any merge");
    assert.equal((await alpha.getEntry(survivor))?.metadata?.status, undefined);
    // Capacity ran after archive and merged the duplicate pair, leaving the budget intact.
    const budgetHits = (await alpha.recall("gate budget is forty minutes", { topK: 5 })).hits.filter(
      (hit) => parseMemoryNoteMetadata(hit.metadata)?.key === "gate.budget" && hit.metadata?.status !== "archived",
    );
    assert.equal(budgetHits.length, 1);
  });

  it("a_scoped_pass_rejects_an_unknown_scope", async () => {
    const { fabric, projects } = stack();
    const left = await note(projects[0]!, { id: "a8".padEnd(12, "0"), text: "Drain the canary pool", key: "canary.drain" });

    await fabric.maintain({ scope: PROJECT_A });
    assert.equal((await projects[0]!.getEntry(left))?.metadata?.status, undefined);
    await assert.rejects(fabric.maintain({ scope: "projects/nope--00000000" }), /unknown maintenance scope/);
  });

  it("a_consolidation_pass_maintains_its_project_scope", async () => {
    // The extractor answers with nothing, so the pass itself writes no note: only the tail has work.
    const client: ModelClient = {
      model: { provider: "scripted", model: "test" },
      async *generate() {
        yield providerToolCall(toolCallContent("x1", "record_notes", { notes: [] }));
        yield providerDone();
      },
    };
    const { fabric, projects, store } = stack({ projects: [PROJECT_A], promote: true, client });
    const alpha = projects[0]!;
    const stale = await note(alpha, { id: "a0".padEnd(12, "0"), text: "Old gate rule", key: "stale.gate", status: "candidate" });
    await advance(store, PROJECT_A, 200);
    assert.equal((await alpha.getEntry(stale))?.metadata?.status, "candidate");

    await fabric.consolidate({
      id: "s1",
      entries: async () => [
        createSessionEntry({
          id: "u1",
          sessionId: "s1",
          timestamp: "2026-01-01T00:00:00.000Z",
          kind: "message",
          message: { role: "user", content: [{ type: "text", text: "Please keep the retry budget small." }] },
        }),
      ],
    });

    assert.equal((await alpha.getEntry(stale))?.metadata?.status, "archived", "the pass maintained its project scope");
  });

});
