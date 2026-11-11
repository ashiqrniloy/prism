/**
 * Plan 188.4 Task 5: a scope over its budget merges duplicates first, then episode clusters, then
 * evicts the least valuable unprotected notes — and a scope whose remaining notes are all protected
 * stops and says so.
 */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createMemoryVectorStore } from "@arnilo/prism-memory-system/core";
import { resolveLifecycleConfig } from "../../config.js";
import { createLongTermMemory } from "../../create.js";
import { createMemory } from "../../memory.js";
import { estimateNoteTokens, parseMemoryNoteMetadata } from "../../types.js";

function makeMemory(resourceId = "r") {
  const store = createMemoryVectorStore();
  const memory = createMemory({ tenantId: "t", resourceId, threadId: "s", vectorStore: store });
  return { store, memory };
}

describe("capacity budgets (plan 188.4 Task 5)", () => {
  it("over_budget_merges_duplicates_before_evicting", async () => {
    const { store, memory } = makeMemory();
    const lifecycle = resolveLifecycleConfig({ capacity: { project: { notes: 3, tokens: 10_000 } } });
    const fabric = createLongTermMemory({ memory, vectorStore: store, consolidate: false, lifecycle, clock: () => 0 });
    const first = await fabric.remember({
      kind: "fact",
      content: "Rollback drains the canary pool",
      key: "rollback.order",
      keywords: ["canary"],
    });
    const second = await fabric.remember({
      kind: "fact",
      content: "Rollback drains the canary pool first",
      key: "rollback.order",
      keywords: ["pool"],
      sourceEntryIds: ["e1"],
    });
    await fabric.remember({ kind: "fact", content: "CI runs bun with a timeout", key: "ci.runner" });
    await fabric.remember({ kind: "fact", content: "The release gate reads budgets.json", key: "gate.budget" });

    const report = await fabric.maintain();
    // One duplicate folded, which is enough: the scope is back inside its three-note budget.
    assert.equal(report.merged, 1);
    assert.equal(report.evicted, 0);
    const statuses = await Promise.all([first.id, second.id].map(async (id) => (await memory.getEntry(id))?.metadata?.status));
    const survivorIndex = statuses.indexOf(undefined);
    assert.notEqual(survivorIndex, -1, "one of the duplicates survives");
    const entry = await memory.getEntry([first.id, second.id][survivorIndex === 0 ? 1 : 0]!);
    assert.equal(entry?.metadata?.status, "archived");
    const mergedInto = parseMemoryNoteMetadata(entry?.metadata)?.mergedInto;
    assert.equal(mergedInto, [first.id, second.id][survivorIndex]);
    const survivor = parseMemoryNoteMetadata((await memory.getEntry(mergedInto!))?.metadata);
    assert.deepEqual([...(survivor?.keywords ?? [])].sort(), ["canary", "pool"], "keywords union");
    assert.deepEqual(survivor?.sourceEntryIds, ["e1"], "evidence unions");
  });

  it("eviction_skips_pinned_held_and_high_storage", async () => {
    const { store, memory } = makeMemory();
    const lifecycle = resolveLifecycleConfig({ capacity: { project: { notes: 2, tokens: 10_000 } } });
    const fabric = createLongTermMemory({ memory, vectorStore: store, consolidate: false, lifecycle, clock: () => 0 });
    const pinned = await fabric.remember({ kind: "fact", content: "Pinned ritual", key: "ritual.pinned" });
    await fabric.pin(pinned.id);
    const high = await fabric.remember({
      kind: "fact",
      content: "Explicitly stated rule",
      key: "rule.explicit",
      promotion: { score: 1, signals: { explicit: 1 }, pass: "p1" },
    });
    const held = await fabric.remember({ kind: "fact", content: "Held doctrine", key: "doctrine.held" });
    await fabric.forget({ id: held.id, hold: true });
    const weakA = await fabric.remember({ kind: "fact", content: "Weak note one", key: "weak.one" });
    const weakB = await fabric.remember({ kind: "fact", content: "Weak note two", key: "weak.two" });

    const report = await fabric.maintain();
    assert.equal(report.archived, 0, "the grace window keeps the archive pass out of this");
    assert.equal(report.evicted, 2);
    assert.deepEqual(report.overBudget, [], "pinned plus high storage strength is exactly the budget");
    assert.equal((await memory.getEntry(pinned.id))?.metadata?.status, undefined, "a pinned note is never evicted");
    assert.equal((await memory.getEntry(high.id))?.metadata?.status, undefined, "S ≥ storageBelow is never evicted");
    assert.equal((await memory.getEntry(held.id))?.metadata?.status, undefined, "a held row is invisible to the scan");
    for (const weak of [weakA, weakB]) {
      const entry = await memory.getEntry(weak.id);
      assert.equal(entry?.metadata?.status, "archived");
      assert.equal(entry?.metadata?.auditVerb, "evicted", "eviction names itself in the audit log");
      assert.equal(parseMemoryNoteMetadata(entry?.metadata)?.mergedInto, undefined, "eviction is not a merge");
    }
  });

  it("protected_over_budget_warns_and_stops", async () => {
    const { store, memory } = makeMemory();
    const lifecycle = resolveLifecycleConfig({ capacity: { project: { notes: 1, tokens: 10_000 } } });
    const warnings: string[] = [];
    const fabric = createLongTermMemory({
      memory,
      vectorStore: store,
      consolidate: false,
      lifecycle,
      clock: () => 0,
      notify: (message) => warnings.push(message),
    });
    for (const content of ["First pinned", "Second pinned", "Third pinned"]) {
      const note = await fabric.remember({ kind: "fact", content, key: `pinned.${content.length}` });
      await fabric.pin(note.id);
    }

    const report = await fabric.maintain();
    assert.equal(report.archived, 0);
    assert.equal(report.merged, 0);
    assert.equal(report.evicted, 0);
    assert.equal(report.overBudget.length, 1);
    assert.equal(report.overBudget[0]?.scope, "r");
    assert.equal(report.overBudget[0]?.notes, 3);
    assert.equal(report.overBudget[0]?.limitNotes, 1);
    assert.equal(warnings.length, 1, "one warning per over-budget scope");
    assert.match(warnings[0]!, /^memory-fabric: r stays over its capacity budget \(3\/1 notes,/);
  });

  it("maintain_never_deletes_exchange_text", async () => {
    const { store, memory } = makeMemory();
    const lifecycle = resolveLifecycleConfig({ exchangeCapacity: { hotTokens: 1 } });
    const fabric = createLongTermMemory({ memory, vectorStore: store, consolidate: false, lifecycle, clock: () => 0 });
    const exchange = await fabric.remember({
      kind: "exchange",
      content: "user: remember the launch moved to Monday\n\nassistant: Noted; Monday is the launch date.",
    });
    const fact = await fabric.remember({ kind: "fact", content: "Launch date is Monday", key: "launch.date" });

    const report = await fabric.maintain();
    assert.equal(report.evicted, 1, "the exchange tier demotes the over-budget exchange");
    assert.equal(report.archived, 0, "the archive rule did not need to act at clock 0");
    const entry = await memory.getEntry(exchange.id);
    assert.equal(entry?.metadata?.status, "archived");
    assert.equal(entry?.metadata?.auditVerb, "demoted");
    assert.match(entry?.text ?? "", /launch moved to Monday/);
    assert.equal(parseMemoryNoteMetadata(entry?.metadata)?.archivedFrom, "verified");
    assert.equal((await memory.getEntry(fact.id))?.metadata?.status, undefined, "facts are not in the exchange tier");
  });

  it("demoted_exchange_still_recalled_lexically", async () => {
    const { store, memory } = makeMemory();
    const lifecycle = resolveLifecycleConfig({ exchangeCapacity: { hotTokens: 1 } });
    const fabric = createLongTermMemory({ memory, vectorStore: store, consolidate: false, lifecycle, clock: () => 0 });
    const exchange = await fabric.remember({
      kind: "exchange",
      content: "user: the migration runbook uses the blue-green cutover\n\nassistant: I will use the blue-green cutover.",
    });

    await fabric.maintain();
    assert.equal((await memory.getEntry(exchange.id))?.metadata?.status, "archived");
    const hits = (await fabric.recall("blue-green cutover runbook", { kinds: ["exchange"], includeArchived: true, minSimilarity: 0 })).hits;
    assert.ok(
      hits.some((hit) => hit.id === exchange.id),
      "the demoted exchange remains lexically searchable",
    );
    assert.match(hits.find((hit) => hit.id === exchange.id)?.content ?? "", /blue-green cutover/);
  });

  it("capacity_exchange_tier_bounds_hot_set", async () => {
    const { store, memory } = makeMemory();
    const lifecycle = resolveLifecycleConfig({ exchangeCapacity: { hotTokens: 30 } });
    const fabric = createLongTermMemory({ memory, vectorStore: store, consolidate: false, lifecycle, clock: () => 0 });
    const ids: string[] = [];
    for (let index = 0; index < 5; index++) {
      const note = await fabric.remember({
        kind: "exchange",
        content: `user: session ${index} keeps the release checklist visible\n\nassistant: checklist ${index} recorded`,
      });
      ids.push(note.id);
    }

    const report = await fabric.maintain();
    assert.ok(report.evicted > 0, "the hot tier bounded the exchange set");
    let hotTokens = 0;
    for (const id of ids) {
      const entry = await memory.getEntry(id);
      if (entry?.metadata?.status !== "archived") hotTokens += estimateNoteTokens(entry?.text ?? "");
    }
    assert.ok(hotTokens <= 30, `hot exchange tokens ${hotTokens} stay within the exchange budget`);
  });

  it("merge_never_crosses_scope", async () => {
    const store = createMemoryVectorStore();
    const project = createMemory({ tenantId: "t", resourceId: "projects/a", threadId: "s", vectorStore: store });
    const user = createMemory({ tenantId: "t", resourceId: "user", threadId: "s", vectorStore: store });
    const lifecycle = resolveLifecycleConfig({ capacity: { project: { notes: 2, tokens: 10_000 }, user: { notes: 1, tokens: 10_000 } } });
    const fabric = createLongTermMemory({
      memory: project,
      scopes: [
        { level: "project", memory: project },
        { level: "user", memory: user },
      ],
      vectorStore: store,
      consolidate: false,
      lifecycle,
      clock: () => 0,
    });
    const a = await fabric.remember({ kind: "fact", content: "Alpha drains canary", key: "drain.order" });
    const b = await fabric.remember({ kind: "fact", content: "Alpha drains canary first", key: "drain.order" });
    const c = await fabric.remember({ kind: "fact", content: "Alpha gate budget", key: "gate.budget" });
    const shared = await fabric.remember({ kind: "preference", content: "Drain the canary pool before rollback", key: "drain.order" });

    const report = await fabric.maintain();
    assert.equal(report.merged, 1);
    // The user note shares the key but lives in another resource: it is never an input to the merge.
    const entry = await user.getEntry(shared.id);
    assert.equal(entry?.metadata?.status, undefined);
    assert.equal(parseMemoryNoteMetadata(entry?.metadata)?.mergedInto, undefined);
    const statuses = await Promise.all([a.id, b.id].map(async (id) => (await project.getEntry(id))?.metadata?.status));
    const archivedIndex = statuses.indexOf("archived");
    assert.notEqual(archivedIndex, -1, "the duplicate pair folds");
    assert.equal(statuses.filter((status) => status === undefined).length, 1, "exactly one survivor");
    const survivorOf = parseMemoryNoteMetadata((await project.getEntry([a.id, b.id][archivedIndex]!))?.metadata)?.mergedInto;
    assert.ok(survivorOf === a.id || survivorOf === b.id, "a project note only ever merges into a project note");
    assert.notEqual(survivorOf, shared.id);
    assert.equal((await project.getEntry(c.id))?.metadata?.status, undefined, "the scope is back inside its budget");
  });
});
