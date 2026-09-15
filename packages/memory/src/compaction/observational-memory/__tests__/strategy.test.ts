import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAgent,
  createMemorySessionStore,
  createMockProvider,
  createSessionEntry,
  providerDone,
  providerTextDelta,
  type SessionEntry,
} from "@arnilo/prism";
import {
  createObservationalMemoryCompactionStrategy,
  FOLDED_MEMORY,
  type MemoryObservation,
  type MemoryReflection,
  OBSERVATIONS_RECORDED,
  REFLECTIONS_RECORDED,
  WORK_SCOPE_BOUND,
  WORK_SCOPE_CLOSED,
  WORK_SCOPE_ENTERED,
  WORK_SCOPE_OPENED,
} from "../index.js";

const model = { provider: "mock", model: "demo" };
const now = "2026-06-20T00:00:00.000Z";

function message(id: string, text: string): SessionEntry {
  return createSessionEntry({
    id,
    sessionId: "s1",
    timestamp: now,
    kind: "message",
    message: { role: "user", content: [{ type: "text", text }] },
  });
}

function memoryEntries(): readonly SessionEntry[] {
  const m1 = message("m1", "first");
  const observation: MemoryObservation = {
    id: "aaaaaaaaaaaa",
    content: "Keep secret-token out",
    timestamp: now,
    relevance: "high",
    sourceEntryIds: ["m1"],
    tokenCount: 5,
  };
  const reflection: MemoryReflection = {
    id: "bbbbbbbbbbbb",
    content: "Use package-only strategy",
    supportingObservationIds: [observation.id],
    tokenCount: 4,
  };
  return [
    m1,
    createSessionEntry({
      id: "om1",
      sessionId: "s1",
      parentId: "m1",
      timestamp: now,
      kind: "custom",
      data: { type: OBSERVATIONS_RECORDED, observations: [observation], coversUpToId: "m1" },
    }),
    createSessionEntry({
      id: "om2",
      sessionId: "s1",
      parentId: "om1",
      timestamp: now,
      kind: "custom",
      data: { type: REFLECTIONS_RECORDED, reflections: [reflection], coversUpToId: "om1" },
    }),
    message("m2", "recent one"),
    message("m3", "recent two"),
  ];
}

function scopedMemoryEntries(promoted: boolean): readonly SessionEntry[] {
  const taskObservation: MemoryObservation = {
    id: "aaaaaaaaaaaa",
    content: "Task one keeps the retry budget small",
    timestamp: now,
    relevance: "high",
    sourceEntryIds: ["m1"],
    tokenCount: 8,
  };
  const planObservation: MemoryObservation = {
    id: "cccccccccccc",
    content: "The plan owns the shared canary flag",
    timestamp: now,
    relevance: "medium",
    sourceEntryIds: ["m1"],
    tokenCount: 8,
  };
  const taskReflection: MemoryReflection = {
    id: "bbbbbbbbbbbb",
    content: "Task one prefers the smallest retry budget",
    supportingObservationIds: [taskObservation.id],
    tokenCount: 8,
  };
  const entries: SessionEntry[] = [
    message("m1", "first"),
    createSessionEntry({
      id: "om1",
      sessionId: "s1",
      parentId: "m1",
      timestamp: now,
      kind: "custom",
      data: { type: OBSERVATIONS_RECORDED, observations: [taskObservation, planObservation], coversUpToId: "m1" },
    }),
    createSessionEntry({
      id: "om2",
      sessionId: "s1",
      parentId: "om1",
      timestamp: now,
      kind: "custom",
      data: { type: REFLECTIONS_RECORDED, reflections: [taskReflection], coversUpToId: "om1" },
    }),
    scopeEntry("sc1", { type: WORK_SCOPE_OPENED, id: "plan:memory" }),
    scopeEntry("sc2", { type: WORK_SCOPE_OPENED, id: "task:1", parentId: "plan:memory" }),
    scopeEntry("sc3", { type: WORK_SCOPE_ENTERED, scopeId: "task:1" }),
    scopeEntry("sc4", {
      type: WORK_SCOPE_BOUND,
      scopeId: "task:1",
      refs: [`om:${taskObservation.id}`, `reflection:${taskReflection.id}`],
    }),
    scopeEntry("sc5", { type: WORK_SCOPE_CLOSED, scopeId: "task:1" }),
    scopeEntry("sc6", { type: WORK_SCOPE_OPENED, id: "task:2", parentId: "plan:memory" }),
    scopeEntry("sc7", { type: WORK_SCOPE_BOUND, scopeId: "plan:memory", refs: [`om:${planObservation.id}`] }),
    scopeEntry("sc8", { type: WORK_SCOPE_ENTERED, scopeId: "task:2" }),
    message("m2", "recent one"),
    message("m3", "recent two"),
  ];
  if (promoted) {
    entries.push(
      scopeEntry("sc9", { type: WORK_SCOPE_BOUND, scopeId: "plan:memory", refs: [`om:${taskObservation.id}`] }),
      scopeEntry("sc10", { type: WORK_SCOPE_BOUND, scopeId: "plan:memory", refs: [`reflection:${taskReflection.id}`] }),
    );
  }
  return entries;
}

function scopeEntry(id: string, data: unknown): SessionEntry {
  return createSessionEntry({ id, sessionId: "s1", timestamp: now, kind: "custom", data });
}

describe("observational memory compaction strategy", () => {
  it("observational_memory_strategy_renders_existing_memory_without_provider_call", async () => {
    const strategy = createObservationalMemoryCompactionStrategy({ keepRecentEntries: 1, secrets: ["secret-token"] });
    const result = await strategy.compact({ sessionId: "s1", entries: memoryEntries(), trigger: "manual" });
    assert.match(result.summary, /Observational Memory/);
    assert.match(result.summary, /Use package-only strategy/);
    assert.equal(result.summary.includes("secret-token"), false);
  });

  it("observational_memory_strategy_returns_standard_compaction_data_with_folded_memory", async () => {
    const strategy = createObservationalMemoryCompactionStrategy({ keepRecentEntries: 2 });
    const result = await strategy.compact({ sessionId: "s1", entries: memoryEntries(), trigger: "auto" });
    const entry = result.entries?.[0];
    const data = entry?.data as any;
    assert.equal(entry?.kind, "compaction");
    assert.equal(data.strategy, "observational-memory");
    assert.equal(data.trigger, "auto");
    assert.equal(data.throughEntryId, "om2");
    assert.deepEqual(data.keepEntryIds, ["m2", "m3"]);
    assert.equal(data.memory.type, FOLDED_MEMORY);
    assert.equal(data.memory.fullFold, false);
  });

  it("observational_memory_strategy_preserves_raw_history_and_rebuilds_recent_context", async () => {
    const store = createMemorySessionStore(memoryEntries());
    const seen: string[] = [];
    const agent = createAgent({
      model,
      provider: createMockProvider([providerTextDelta("ok"), providerDone()], {
        onRequest: (request) => seen.push(JSON.stringify(request.messages)),
      }),
      store,
    });
    const session = agent.createSession({ id: "s1" });
    await session.checkout("m3");
    await session.compact({ strategy: createObservationalMemoryCompactionStrategy({ keepRecentEntries: 1 }) });
    assert.equal((await store.list("s1")).length, 6);
    await session.run("after compact");
    assert.match(seen.at(-1) ?? "", /Observational Memory/);
    assert.match(seen.at(-1) ?? "", /recent two/);
    assert.doesNotMatch(seen.at(-1) ?? "", /first/);
  });

  it("observational_memory_strategy_full_fold_trims_observations_to_pool_cap", async () => {
    const strategy = createObservationalMemoryCompactionStrategy({ keepRecentEntries: 1, observationsPoolMaxTokens: 4 });
    const result = await strategy.compact({ sessionId: "s1", entries: memoryEntries() });
    const memory = (result.entries?.[0]?.data as any)!.memory;
    assert.equal(memory.fullFold, true);
    assert.equal(memory.observations.length < 1 || memory.observations.reduce((s: number, o: any) => s + o.tokenCount, 0) <= 4, true);
  });

  it("observational_memory_strategy_handles_repeated_compactions_and_full_fold", async () => {
    const strategy = createObservationalMemoryCompactionStrategy({ keepRecentEntries: 1, observationsPoolMaxTokens: 1 });
    const first = await strategy.compact({ sessionId: "s1", entries: memoryEntries() });
    const secondEntries = [...memoryEntries(), first.entries![0]!];
    const second = await strategy.compact({ sessionId: "s1", entries: secondEntries });
    assert.equal((first.entries?.[0]?.data as any)!.memory.fullFold, true);
    assert.equal((second.entries?.[0]?.data as any)!.memory.fullFold, true);
    assert.equal((second.entries?.[0]?.data as any)!.memory.observations.length, 0);
  });

  it("observational_memory_strategy_packs_the_projected_episodic_layer_when_work_scopes_exist", async () => {
    const strategy = createObservationalMemoryCompactionStrategy({ keepRecentEntries: 2 });
    const result = await strategy.compact({ sessionId: "s1", entries: scopedMemoryEntries(false) });
    assert.match(result.summary, /The plan owns the shared canary flag/);
    assert.doesNotMatch(result.summary, /Task one keeps the retry budget small/);
    assert.doesNotMatch(result.summary, /Task one prefers the smallest retry budget/);
    assert.match(result.summary, /## Scope Outline/);
    const entry = result.entries?.[0];
    assert.ok(entry, "strategy must return one compaction entry");
    const memory = (entry.data as { memory: { observations: readonly { id: string }[] } }).memory;
    assert.deepEqual(
      memory.observations.map((item) => item.id),
      ["aaaaaaaaaaaa", "cccccccccccc"],
    );

    const promoted = await strategy.compact({ sessionId: "s1", entries: scopedMemoryEntries(true) });
    assert.match(promoted.summary, /Task one keeps the retry budget small/);
    assert.match(promoted.summary, /Task one prefers the smallest retry budget/);

    const unscoped = await strategy.compact({ sessionId: "s1", entries: memoryEntries() });
    assert.doesNotMatch(unscoped.summary, /## Scope Outline/);
  });

  it("observational_memory_strategy_redacts_known_secrets_from_summary_and_data", async () => {
    const result = await createObservationalMemoryCompactionStrategy({ keepRecentEntries: 1, secrets: ["secret-token"] }).compact({
      sessionId: "s1",
      entries: memoryEntries(),
    });
    const text = JSON.stringify(result);
    assert.equal(text.includes("secret-token"), false);
    assert.match(text, /\[REDACTED\]/);
  });
});
