import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "bun:test";
import type { ContextDraft, HookContext, SessionEntry } from "@arnilo/prism";
import { createMemoryVectorStore, type Memory, type VectorStore, type WorkingMemoryStore } from "@arnilo/prism-memory-core";
import { createFabricContext } from "../context.js";
import { createFabricDirectory, renderFabricDirectory } from "../directory.js";
import { createMemory, createMemoryFabric, createMemoryWorkingStore, type MemoryFabricScopeBinding } from "../index.js";
import { createFabricLifecycle } from "../lifecycle/index.js";
import { createTouchedPathTracker } from "../scope/touched-paths.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function shared() {
  return { vectorStore: createMemoryVectorStore(), workingStore: createMemoryWorkingStore() };
}

function memoryFor(resourceId: string, stores: { vectorStore: VectorStore; workingStore: WorkingMemoryStore }): Memory {
  return createMemory({ tenantId: "prism", resourceId, threadId: "default", ...stores });
}

function fabricOver(levels: readonly ("project" | "agent" | "user")[]) {
  const stores = shared();
  const bindings: MemoryFabricScopeBinding[] = levels.map((level) => ({
    level,
    memory: memoryFor(level === "project" ? "projects/demo--01234567" : level, stores),
  }));
  return { bindings, fabric: createMemoryFabric({ memory: bindings[0]!.memory, scopes: bindings, consolidate: false }) };
}

function userEntry(text: string): SessionEntry {
  return {
    id: "e1",
    sessionId: "s1",
    timestamp: "2026-01-01T00:00:00.000Z",
    kind: "message",
    message: { role: "user", content: [{ type: "text", text }] },
  };
}

function hookContext(entries: readonly SessionEntry[]): HookContext {
  return {
    sessionId: "s1",
    runId: "r1",
    emit: () => {},
    reject: (reason: string) => ({ __prismHookRejection: reason }),
    session: { id: "s1", entries: async () => entries, background: () => {} },
  } as HookContext;
}

describe("fabric union recall (plan 188.2 Task 4)", () => {
  it("recall_unions_user_agent_and_project_scopes", async () => {
    const { fabric } = fabricOver(["project", "agent", "user"]);
    await fabric.remember({ kind: "fact", content: "Canary rollout protects deploys", scope: "project" });
    await fabric.remember({ kind: "fact", content: "Canary rollout deploys are gradual", scope: "agent" });
    await fabric.remember({ kind: "preference", content: "Prefer canary rollout over big bang deploys", scope: "user" });

    const result = await fabric.recall("canary rollout deploys", { topK: 6 });
    assert.equal(result.hits.length, 3);
    assert.deepEqual(new Set(result.hits.map((hit) => hit.level)), new Set(["project", "agent", "user"]));
  });

  it("narrower_scope_shadows_same_key", async () => {
    const { fabric } = fabricOver(["project", "agent", "user"]);
    const project = await fabric.remember({ kind: "fact", content: "Deploy gate runs in CI", scope: "project", key: "deploy.gate" });
    const user = await fabric.remember({ kind: "preference", content: "Deploy gate should run locally too", scope: "user", key: "deploy.gate" });

    const result = await fabric.recall("deploy gate", { topK: 5 });
    assert.deepEqual(result.hits.map((hit) => hit.id), [project.id]);
    assert.equal(result.explain.find((entry) => entry.id === user.id)?.shadowedBy, project.id);
    assert.equal((await fabric.recall("deploy gate", { topK: 5 })).explain.length, 2);
  });

  it("path_prior_applies_only_when_applies_to_matches_touched_path", async () => {
    const { fabric } = fabricOver(["project", "agent", "user"]);
    const project = await fabric.remember({ kind: "procedure", content: "Deploy checklist", scope: "project" });
    const path = await fabric.remember({
      kind: "procedure",
      content: "Deploy checklist",
      scope: "path",
      appliesTo: ["packages/memory/**"],
    });
    const far = await fabric.remember({
      kind: "procedure",
      content: "Deploy checklist",
      scope: "path",
      appliesTo: ["apps/other/**"],
    });

    const cool = await fabric.recall("deploy checklist", { topK: 5, kinds: ["procedure"] });
    assert.equal(cool.hits.length, 3);
    const coolPath = cool.hits.find((hit) => hit.id === path.id)?.score ?? 0;
    const coolProject = cool.hits.find((hit) => hit.id === project.id)?.score ?? 0;
    assert.ok(coolPath < coolProject, "unmatched path note ranks as a project note");

    const touched = await fabric.recall("deploy checklist", {
      topK: 5,
      kinds: ["procedure"],
      touchedPaths: ["packages/memory/fabric/src/index.ts"],
    });
    const pathScore = touched.hits.find((hit) => hit.id === path.id)?.score ?? 0;
    const projectScore = touched.hits.find((hit) => hit.id === project.id)?.score ?? 0;
    assert.ok(pathScore > projectScore, `${pathScore} > ${projectScore}`);
    assert.ok((touched.hits.find((hit) => hit.id === far.id)?.score ?? 0) < projectScore);
    assert.equal(touched.hits[0]?.id, path.id);
  });

  it("priors_are_bounded_and_cannot_outrank_a_much_more_relevant_hit", async () => {
    const stores = shared();
    const project = memoryFor("projects/demo--01234567", stores);
    const user = memoryFor("user", stores);
    const bindings: MemoryFabricScopeBinding[] = [
      { level: "project", memory: project },
      { level: "user", memory: user },
    ];
    // The clock makes retrieval strength measurable; without it the pre-188.4 ranking stands.
    const fabric = createMemoryFabric({ memory: project, scopes: bindings, consolidate: false, clock: () => 20 });
    // "aaaa" sorts first on a tie, so only the strength prior can lift "bbbb" above it.
    await fabric.remember({ kind: "fact", id: "aaaaaaaaaaaa", content: "Deploy gate runs in CI", scope: "project" });
    await fabric.remember({ kind: "fact", id: "bbbbbbbbbbbb", content: "Deploy gate runs in CI", scope: "project" });
    const lifecycle = createFabricLifecycle(project);
    for (let session = 1; session <= 6; session += 1) await lifecycle.recordUses(`s${session}`, ["bbbbbbbbbbbb"], { clock: session });
    await lifecycle.recordEvidence({ helpful: ["bbbbbbbbbbbb"] });

    const ranked = await fabric.recall("deploy gate", { topK: 2 });
    assert.deepEqual(ranked.hits.map((hit) => hit.id), ["bbbbbbbbbbbb", "aaaaaaaaaaaa"]);

    // The prior is bounded: the rank flip costs a fraction of the fused score, and the scope prior
    // (0.1 project) plus both strengths (0.1) still sit far below a 0.15 relevance gap.
    const [first, second] = ranked.hits;
    assert.ok(first !== undefined && second !== undefined);
    const lift = first.score - second.score;
    assert.ok(lift > 0 && lift < 0.2, `${lift} is bounded`);

    const plain = createMemoryFabric({ memory: project, scopes: bindings, consolidate: false });
    const unprioritised = await plain.recall("deploy gate", { topK: 2 });
    assert.deepEqual(unprioritised.hits.map((hit) => hit.id), ["aaaaaaaaaaaa", "bbbbbbbbbbbb"], "equal relevance ties break on id");
  });

  it("per_scope_budget_reserves_a_slot_per_scope_with_hits", async () => {
    const { fabric } = fabricOver(["project", "agent", "user"]);
    await fabric.remember({ kind: "fact", content: "Alpha rollout protects deploys", scope: "project" });
    await fabric.remember({ kind: "fact", content: "Alpha rollout is gradual here", scope: "project" });
    await fabric.remember({ kind: "fact", content: "Alpha rollout needs flags set", scope: "agent" });
    await fabric.remember({ kind: "preference", content: "Alpha rollout should be weekly", scope: "user" });

    const unbudgeted = await fabric.recall("alpha rollout", { topK: 5 });
    assert.equal(unbudgeted.hits.length, 4);
    const tokenCount = Math.max(...unbudgeted.hits.map((hit) => hit.tokenCount));
    const budgeted = await fabric.recall("alpha rollout", { topK: 5, budget: tokenCount * 3 });
    assert.equal(budgeted.hits.length, 3);
    assert.deepEqual(new Set(budgeted.hits.map((hit) => hit.level)), new Set(["project", "agent", "user"]));
  });

  it("inject_uses_union_recall_and_floor_before_priors", async () => {
    const { fabric, bindings } = fabricOver(["project", "agent", "user"]);
    await fabric.remember({ kind: "preference", content: "Deploys happen on fridays", scope: "user" });
    await fabric.remember({ kind: "fact", content: "Deploys happen fridays from main", scope: "project" });

    const projection = createFabricContext(bindings[0]!.memory, fabric.recall, { topK: 3, budgetTokens: 200 }, {});
    const entries = [userEntry("how do deploys happen fridays")];
    const built = await projection.build({ messages: [{ role: "user", content: [{ type: "text", text: "how do deploys happen fridays" }] }] } as ContextDraft, hookContext(entries));
    const injected = JSON.stringify(built.messages);
    assert.match(injected, /fabric-semantic/);
    assert.match(injected, /user preference/);
    assert.match(injected, /project fact/);

    // The floor is applied per scope before the prior, so a large prior cannot rescue a weak hit.
    const strictFabric = createMemoryFabric({
      memory: bindings[0]!.memory,
      scopes: bindings,
      consolidate: false,
      scopePriors: { user: 0.5, project: 0.5 },
    });
    const strictProjection = createFabricContext(bindings[0]!.memory, strictFabric.recall, {
      topK: 3,
      minSimilarity: 0.9,
      budgetTokens: 200,
    });
    const weak = "deploys happen fridays weekly cadence";
    const empty = await strictProjection.build(
      { messages: [{ role: "user", content: [{ type: "text", text: weak }] }] } as ContextDraft,
      hookContext([userEntry(weak)]),
    );
    assert.doesNotMatch(JSON.stringify(empty.messages), /fabric-semantic/);
  });

  it("directory_renders_per_scope_counts_within_budget", async () => {
    const stores = shared();
    const project = memoryFor("projects/demo--01234567", stores);
    const user = memoryFor("user", stores);
    const bindings: MemoryFabricScopeBinding[] = [
      { level: "project", memory: project },
      { level: "user", memory: user },
    ];
    const fabric = createMemoryFabric({ memory: project, scopes: bindings, consolidate: false });
    await fabric.remember({ kind: "fact", content: "Deploys go through CI", scope: "project", keywords: ["deploy"] });
    await fabric.remember({ kind: "preference", content: "Prefer weekly deploys", scope: "user", keywords: ["cadence"] });

    const directory = createFabricDirectory({ memory: project, memories: bindings });
    const rendered = renderFabricDirectory(await directory.snapshot(), { maxTopics: 8, maxFiles: 10, maxTokens: 200 });
    assert.ok(rendered);
    assert.match(rendered.content, /^project: 1 fact; topics: deploy \(1\)/m);
    assert.match(rendered.content, /^user: 1 preference; topics: cadence \(1\)/m);
    assert.ok(rendered.tokens <= 200);
  });

  it("touched_paths_are_normalised_capped_and_persisted_on_change", async () => {
    const root = mkdtempSync(join(tmpdir(), "fabric-touched-"));
    dirs.push(root);
    const saved: { readonly paths: readonly string[] }[] = [];
    const tracker = createTouchedPathTracker({
      root,
      store: { get: () => ({ paths: ["old.ts"] }), set: async (value) => void saved.push(value) },
    });

    assert.deepEqual(tracker.paths(), ["old.ts"]);
    assert.equal(tracker.record({ name: "read", arguments: { path: "./src/a.ts" } }), true);
    assert.equal(tracker.record({ name: "read", arguments: { path: "src/a.ts" } }), false, "same path is not dirty");
    assert.equal(tracker.record({ name: "write", arguments: { path: join(root, "src/b.ts") } }), true, "absolute inside the root");
    assert.equal(tracker.record({ name: "read", arguments: { path: "../outside.ts" } }), false);
    assert.equal(tracker.record({ name: "grep", arguments: { path: "src" } }), false);
    assert.deepEqual(tracker.paths(), ["src/b.ts", "src/a.ts", "old.ts"]);

    for (let index = 0; index < 300; index += 1) tracker.record({ name: "read", arguments: { path: `src/f${index}.ts` } });
    assert.equal(tracker.paths().length, 256);
    assert.equal(tracker.paths()[0], "src/f299.ts");
    assert.equal(tracker.paths().at(-1), "src/f44.ts");

    await tracker.flush();
    assert.equal(saved.length, 1);
    assert.equal(saved[0]!.paths.length, 256);
    await tracker.flush();
    assert.equal(saved.length, 1, "flush once per turn, only when changed");
  });
});
