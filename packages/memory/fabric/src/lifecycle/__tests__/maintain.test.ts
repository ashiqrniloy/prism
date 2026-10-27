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

describe("scope widening and narrowing (plan 188.4 Task 6)", () => {
  it("verified_lesson_in_two_projects_widens_to_agent_candidate", async () => {
    const { fabric, projects, agent } = stack();
    const left = await note(projects[0]!, {
      id: "a1".padEnd(12, "0"),
      text: "Drain the canary pool before every rollback",
      key: "canary.drain",
    });
    const right = await note(projects[1]!, {
      id: "b1".padEnd(12, "0"),
      text: "Drain the canary pool before every rollback",
      key: "canary.drain",
    });

    assert.deepEqual(await fabric.maintain(), {
      archived: 0,
      merged: 0,
      episodesMerged: 0,
      evicted: 0,
      widened: 1,
      superseded: 0,
      overBudget: [],
    });

    const hits = (await agent.recall("drain the canary pool before a rollback", { topK: 5 })).hits;
    assert.equal(hits.length, 1, "exactly one agent note");
    const wider = await agent.getEntry(hits[0]!.id);
    const metadata = parseMemoryNoteMetadata(wider?.metadata);
    assert.equal(wider?.metadata?.status, "candidate", "an agent note must still earn verification through use");
    assert.equal(metadata?.kind, "fact");
    assert.equal(metadata?.key, "canary.drain", "the subject is kept so narrower notes can shadow it");
    assert.equal(metadata?.generated?.by, "promotion");
    assert.deepEqual([...(metadata?.sourceEntryIds ?? [])].sort(), [left, right].sort(), "the project notes are the evidence");

    for (const [index, id] of [left, right].entries()) {
      const entry = await projects[index]!.getEntry(id);
      const copy = parseMemoryNoteMetadata(entry?.metadata);
      assert.equal(entry?.metadata?.status, "archived");
      assert.equal(copy?.widenedTo, wider?.id);
      assert.equal(copy?.validTo, undefined, "widening archives; only supersession sets validTo");
    }

    // The agent scope now holds the subject: the next pass has nothing left to widen.
    assert.equal((await fabric.maintain()).widened, 0);
  });

  it("failed_wider_write_preserves_local_notes_and_retry_is_idempotent", async () => {
    const { fabric, projects, agent } = stack();
    const left = await note(projects[0]!, {
      id: "c1".padEnd(12, "0"),
      text: "Drain the canary pool before every rollback",
      key: "canary.drain",
    });
    const right = await note(projects[1]!, {
      id: "d1".padEnd(12, "0"),
      text: "Drain the canary pool before every rollback",
      key: "canary.drain",
    });
    const original = agent.remember;
    Object.defineProperty(agent, "remember", {
      configurable: true,
      value: async () => {
        throw new Error("agent store unavailable");
      },
    });
    await assert.rejects(fabric.maintain(), /agent store unavailable/);
    assert.equal((await projects[0]!.getEntry(left))?.metadata?.status, undefined, "local note survives a failed wider write");
    assert.equal((await projects[1]!.getEntry(right))?.metadata?.status, undefined);
    assert.equal((await agent.recall("drain the canary pool", { topK: 5 })).hits.length, 0);

    Object.defineProperty(agent, "remember", { configurable: true, value: original });
    assert.equal((await fabric.maintain()).widened, 1);
    assert.equal((await projects[0]!.getEntry(left))?.metadata?.status, "archived");
    assert.equal((await projects[1]!.getEntry(right))?.metadata?.status, "archived");
    assert.equal((await fabric.maintain()).widened, 0, "retry reconciles without rewriting or deleting");
    assert.equal((await agent.recall("drain the canary pool", { topK: 5 })).hits.length, 1);
  });

  it("wider_candidate_does_not_erase_needed_private_exception", async () => {
    const { fabric, projects, agent } = stack();
    const a = await note(projects[0]!, { id: "e1".padEnd(12, "0"), text: "Deploy region is eu-west", key: "deploy.region" });
    await note(projects[1]!, { id: "e2".padEnd(12, "0"), text: "Deploy region is eu-west", key: "deploy.region" });
    // A private exception with the same subject blocks widening; it must stay readable afterwards.
    const exception = await note(projects[0]!, {
      id: "e3".padEnd(12, "0"),
      text: "Deploy region is us-east for this project",
      key: "deploy.region",
    });
    assert.equal((await fabric.maintain()).widened, 0, "a contested subject never widens");
    assert.equal((await projects[0]!.getEntry(a))?.metadata?.status, undefined);
    assert.equal((await projects[0]!.getEntry(exception))?.metadata?.status, undefined);
    assert.equal((await agent.recall("deploy region", { topK: 5 })).hits.length, 0);
  });

  it("a_host_opener_hydrates_a_project_it_did_not_bind", async () => {
    const seed = async () => {
      // The fabric binds project A only; B lives in the same store and is written by its own session.
      const base = stack({ projects: [PROJECT_A] });
      const unbound = base.memoryFor(PROJECT_B);
      const left = await note(base.projects[0]!, {
        id: "a6".padEnd(12, "0"),
        text: "Drain the canary pool before every rollback",
        key: "canary.drain",
      });
      const right = await note(unbound, {
        id: "b6".padEnd(12, "0"),
        text: "Drain the canary pool before every rollback",
        key: "canary.drain",
      });
      return { base, unbound, left, right };
    };

    // Without a resolver B is metadata-only. Presence is not agreement, so nothing widens and no
    // project copy is archived: an unreadable witness fails closed.
    const plain = await seed();
    assert.equal((await plain.base.fabric.maintain()).widened, 0);
    const untouched = await plain.unbound.getEntry(plain.right);
    assert.equal(untouched?.metadata?.status, undefined);
    assert.equal(parseMemoryNoteMetadata(untouched?.metadata)?.widenedTo, undefined);

    const { base, unbound, left, right } = await seed();
    const asked: { level: string; tenantId: string; resourceId: string }[] = [];
    const boundFabric = createMemoryFabric({
      memory: base.projects[0]!,
      scopes: [
        { level: "project", memory: base.projects[0]! },
        { level: "agent", memory: base.agent },
      ],
      vectorStore: base.store,
      openScope: (input) => {
        asked.push(input);
        return input.resourceId === PROJECT_B ? base.memoryFor(PROJECT_B) : undefined;
      },
      consolidate: false,
      lifecycle: resolveLifecycleConfig({}),
      clock: () => 0,
    });
    assert.equal((await boundFabric.maintain()).widened, 1);
    assert.deepEqual(asked, [{ level: "project", tenantId: TENANT, resourceId: PROJECT_B }]);
    const widened = parseMemoryNoteMetadata((await unbound.getEntry(right))?.metadata)?.widenedTo;
    assert.match(widened ?? "", /^[0-9a-f]{12}$/, "the unbound project's copy is archived and points at the wider note");
    assert.equal((await unbound.getEntry(right))?.metadata?.status, "archived");
    assert.equal((await base.projects[0]!.getEntry(left))?.metadata?.status, "archived");
    // A second pass has nothing to do: both copies are archived and the agent scope holds the key.
    assert.equal((await boundFabric.maintain()).widened, 0);
  });

  it("a_nightly_pass_without_project_bindings_widens_through_the_opener", async () => {
    // A host that binds no project at all: every project is discovered through listResources.
    const vectorStore = createMemoryVectorStore();
    const workingStore = createMemoryWorkingStore();
    const memoryFor = (resourceId: string) =>
      createMemory({ tenantId: TENANT, resourceId, threadId: "default", vectorStore, workingStore });
    const [a, b, agent, user] = [memoryFor(PROJECT_A), memoryFor(PROJECT_B), memoryFor("agent"), memoryFor("user")];
    const left = await note(a!, { id: "a7".padEnd(12, "0"), text: "Drain the canary pool before every rollback", key: "canary.drain" });
    const right = await note(b!, { id: "b7".padEnd(12, "0"), text: "Drain the canary pool before every rollback", key: "canary.drain" });
    const nightly = (openScope?: (input: { resourceId: string }) => Memory | undefined) =>
      createMemoryFabric({
        memory: user!,
        scopes: [
          { level: "agent", memory: agent! },
          { level: "user", memory: user! },
        ],
        vectorStore,
        ...(openScope === undefined ? {} : { openScope }),
        consolidate: false,
        lifecycle: resolveLifecycleConfig({}),
        clock: () => 0,
      });

    // Metadata-only evidence cannot supply the text of the wider note, so nothing widens and no
    // project copy is archived.
    assert.equal((await nightly().maintain()).widened, 0);
    assert.equal((await a!.getEntry(left))?.metadata?.status, undefined);
    assert.equal((await agent!.recall("drain the canary pool", { topK: 5 })).hits.length, 0);

    assert.equal((await nightly((input) => memoryFor(input.resourceId)).maintain()).widened, 1);
    assert.equal((await a!.getEntry(left))?.metadata?.status, "archived");
    assert.equal((await b!.getEntry(right))?.metadata?.status, "archived");
    assert.equal((await agent!.recall("drain the canary pool", { topK: 5 })).hits.length, 1);
  });

  it("a_resolver_that_throws_or_answers_for_another_resource_opened_nothing", async () => {
    const base = stack({ projects: [PROJECT_A] });
    const unbound = base.memoryFor(PROJECT_B);
    await note(base.projects[0]!, { id: "a8".padEnd(12, "0"), text: "Drain the canary pool before every rollback", key: "canary.drain" });
    const right = await note(unbound, {
      id: "b8".padEnd(12, "0"),
      text: "Drain the canary pool before every rollback",
      key: "canary.drain",
    });
    let calls = 0;
    const fabric = createMemoryFabric({
      memory: base.projects[0]!,
      scopes: [
        { level: "project", memory: base.projects[0]! },
        { level: "agent", memory: base.agent },
      ],
      vectorStore: base.store,
      openScope: () => {
        calls += 1;
        // Host bug: the same memory back for every resource.
        return base.projects[0]!;
      },
      consolidate: false,
      lifecycle: resolveLifecycleConfig({}),
      clock: () => 0,
    });
    assert.equal((await fabric.maintain()).widened, 0, "a bad resolver leaves B unreadable, so nothing widens");
    assert.equal(calls, 1);
    assert.equal((await unbound.getEntry(right))?.metadata?.status, undefined, "the foreign memory was never used");

    let thrown = 0;
    const failing = createMemoryFabric({
      memory: base.projects[0]!,
      scopes: [
        { level: "project", memory: base.projects[0]! },
        { level: "agent", memory: base.agent },
      ],
      vectorStore: base.store,
      openScope: () => {
        thrown += 1;
        throw new Error("no capacity to open");
      },
      consolidate: false,
      lifecycle: resolveLifecycleConfig({}),
      clock: () => 0,
    });
    assert.equal((await failing.maintain()).widened, 0);
    assert.equal(thrown, 1);
  });

  it("single_project_never_widens", async () => {
    const { fabric, projects } = stack({ projects: [PROJECT_A] });
    const id = await note(projects[0]!, { id: "a2".padEnd(12, "0"), text: "Run the gate before tagging", key: "release.gate" });

    assert.equal((await fabric.maintain()).widened, 0, "one project is not replication");
    const entry = await projects[0]!.getEntry(id);
    assert.equal(entry?.metadata?.status, undefined, "the note stays verified in its project");
    assert.equal(parseMemoryNoteMetadata(entry?.metadata)?.widenedTo, undefined);
  });

  it("harmful_or_contradicted_note_never_widens", async () => {
    const { fabric, projects, agent } = stack();
    await note(projects[0]!, { id: "a3".padEnd(12, "0"), text: "Skip the canary drain on hotfixes", key: "canary.skip", harmful: 1 });
    await note(projects[1]!, { id: "b3".padEnd(12, "0"), text: "Skip the canary drain on hotfixes", key: "canary.skip" });
    await note(projects[0]!, {
      id: "a4".padEnd(12, "0"),
      text: "Tag every release twice",
      key: "release.tag",
      contradictedIn: ["alpha--11111111"],
    });
    await note(projects[1]!, { id: "b4".padEnd(12, "0"), text: "Tag every release twice", key: "release.tag" });

    const report = await fabric.maintain();
    assert.equal(report.widened, 0, "harmful or contradicted evidence never widens");
    assert.deepEqual((await agent.recall("canary skip", { topK: 5 })).hits, []);
  });

  it("path_note_in_two_sibling_subtrees_widens_to_project", async () => {
    const { fabric, projects } = stack({ projects: [PROJECT_A] });
    const api = await note(projects[0]!, {
      id: "a5".padEnd(12, "0"),
      text: "Run the integration suite before merging",
      key: "tests.run",
      scope: "path",
      appliesTo: ["src/api/**"],
    });
    const web = await note(projects[0]!, {
      id: "b5".padEnd(12, "0"),
      text: "Run the integration suite before merging",
      key: "tests.run",
      scope: "path",
      appliesTo: ["src/web/**"],
    });
    // A second path note without a sibling stays narrow.
    const solo = await note(projects[0]!, {
      id: "c5".padEnd(12, "0"),
      text: "Regenerate the API client after a schema change",
      key: "api.client",
      scope: "path",
      appliesTo: ["src/api/**"],
    });

    assert.equal((await fabric.maintain()).widened, 1);
    // The archived path notes still answer through archive search; the wider note is the active hit.
    const active = (await projects[0]!.recall("integration suite before merging", { topK: 5 })).hits.filter(
      (hit) => hit.metadata?.status !== "archived",
    );
    assert.equal(active.length, 1);
    const wider = await projects[0]!.getEntry(active[0]!.id);
    const metadata = parseMemoryNoteMetadata(wider?.metadata);
    assert.equal(wider?.metadata?.status, "candidate");
    assert.equal(metadata?.scope, "project", "the wider note is a plain project note");
    assert.equal(metadata?.key, "tests.run");
    assert.equal(metadata?.appliesTo, undefined, "the globs were the reason it stayed narrow");
    for (const id of [api, web]) {
      const copy = await projects[0]!.getEntry(id);
      assert.equal(copy?.metadata?.status, "archived");
      assert.equal(parseMemoryNoteMetadata(copy?.metadata)?.widenedTo, wider?.id);
    }
    const alone = await projects[0]!.getEntry(solo);
    assert.equal(alone?.metadata?.status, undefined, "no sibling subtree, no widening");
  });

  it("user_preference_contradicted_in_two_projects_is_superseded", async () => {
    const { fabric, user } = stack();
    const contested = await note(user, {
      id: "a6".padEnd(12, "0"),
      text: "Always squash merge",
      contradictedIn: ["alpha--11111111", "beta--22222222"],
    });
    const once = await note(user, { id: "b6".padEnd(12, "0"), text: "Always sign the release tag", contradictedIn: ["alpha--11111111"] });

    const report = await fabric.maintain();
    assert.equal(report.superseded, 1);
    const retired = await user.getEntry(contested);
    assert.equal(retired?.metadata?.status, "retired");
    const metadata = parseMemoryNoteMetadata(retired?.metadata);
    assert.equal(typeof metadata?.validTo, "string", "supersession is what sets validTo");
    assert.equal(retired?.metadata?.auditVerb, "superseded-by-contradiction");
    assert.equal((await user.getEntry(once))?.metadata?.status, undefined, "one contradicting project is not enough");
  });

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
      widened: 1,
      superseded: 0,
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

  it("a_scoped_pass_skips_widening_and_rejects_an_unknown_scope", async () => {
    const { fabric, projects } = stack();
    const left = await note(projects[0]!, { id: "a8".padEnd(12, "0"), text: "Drain the canary pool", key: "canary.drain" });
    await note(projects[1]!, { id: "b8".padEnd(12, "0"), text: "Drain the canary pool", key: "canary.drain" });

    assert.equal((await fabric.maintain({ scope: PROJECT_A })).widened, 0, "a single-scope pass cannot compare projects");
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

  it("widening_skips_a_subject_the_agent_scope_already_holds", async () => {
    const { fabric, projects, agent } = stack();
    await note(projects[0]!, { id: "a9".padEnd(12, "0"), text: "Drain the canary pool first", key: "canary.drain" });
    await note(projects[1]!, { id: "b9".padEnd(12, "0"), text: "Drain the canary pool first", key: "canary.drain" });
    await agent.remember(
      {
        entries: [
          {
            id: "c9".padEnd(12, "0"),
            text: "Drain the canary pool first",
            createdAt: "2026-01-01T00:00:00.000Z",
            metadata: { fabric: encodeMemoryNoteMetadata({ kind: "fact", key: "canary.drain" }) },
          },
        ],
      },
      { wait: true },
    );

    assert.equal((await fabric.maintain()).widened, 0, "the agent scope already knows this subject");
    assert.equal((await agent.recall("drain the canary pool", { topK: 5 })).hits.length, 1);
  });
});
