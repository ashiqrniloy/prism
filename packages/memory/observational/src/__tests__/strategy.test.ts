import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgent, createMemorySessionStore, createSessionEntry, providerDone, providerTextDelta, type SessionEntry } from "@arnilo/prism";
import { assertCompactorConforms } from "@arnilo/prism/testing/compaction-conformance";
import {
  createObservationalMemoryCompactor,
  FOLDED_MEMORY,
  type MemoryObservation,
  type MemoryReflection,
  OBSERVATIONS_RECORDED,
  REFLECTIONS_RECORDED,
} from "../index.js";
import { mockProvider } from "@arnilo/prism/testing";

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

describe("observational memory compaction strategy", () => {
  it("observational_memory_strategy_renders_existing_memory_without_provider_call", async () => {
    const strategy = createObservationalMemoryCompactor({ keepRecentEntries: 1, secrets: ["secret-token"] });
    const result = await strategy.compact({ sessionId: "s1", entries: memoryEntries(), trigger: "manual" });
    assert.match(result.summary, /Observational Memory/);
    assert.match(result.summary, /Use package-only strategy/);
    assert.equal(result.summary.includes("secret-token"), false);
  });

  it("observational_memory_strategy_returns_standard_compaction_data_with_folded_memory", async () => {
    const strategy = createObservationalMemoryCompactor({ keepRecentEntries: 2 });
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
    const agent = await createAgent({
      model,
      packages: [mockProvider([[providerTextDelta("ok"), providerDone()]], {
        onRequest: (request) => seen.push(JSON.stringify(request.messages)),
      })],
      // Roadmap §2.5: the compactor is the `compaction` slot.
      slots: { store, compaction: createObservationalMemoryCompactor({ keepRecentEntries: 2 }) },
    });
    const session = await agent.session({ id: "s1", create: true });
    await session.checkout("m3");
    await session.compact();
    assert.equal((await store.list("s1")).length, 6);
    await session.run("after compact");
    assert.match(seen.at(-1) ?? "", /Observational Memory/);
    assert.match(seen.at(-1) ?? "", /recent two/);
    assert.doesNotMatch(seen.at(-1) ?? "", /first/);
  });

  it("observational_memory_strategy_full_fold_trims_observations_to_pool_cap", async () => {
    const strategy = createObservationalMemoryCompactor({ keepRecentEntries: 1, observationsPoolMaxTokens: 4 });
    const result = await strategy.compact({ sessionId: "s1", entries: memoryEntries() });
    const memory = (result.entries?.[0]?.data as any)!.memory;
    assert.equal(memory.fullFold, true);
    assert.equal(memory.observations.length < 1 || memory.observations.reduce((s: number, o: any) => s + o.tokenCount, 0) <= 4, true);
  });

  it("observational_memory_strategy_handles_repeated_compactions_and_full_fold", async () => {
    const strategy = createObservationalMemoryCompactor({ keepRecentEntries: 1, observationsPoolMaxTokens: 1 });
    const first = await strategy.compact({ sessionId: "s1", entries: memoryEntries() });
    const secondEntries = [...memoryEntries(), first.entries![0]!];
    const second = await strategy.compact({ sessionId: "s1", entries: secondEntries });
    assert.equal((first.entries?.[0]?.data as any)!.memory.fullFold, true);
    assert.equal((second.entries?.[0]?.data as any)!.memory.fullFold, true);
    assert.equal((second.entries?.[0]?.data as any)!.memory.observations.length, 0);
  });

  it("observational_memory_strategy_redacts_known_secrets_from_summary_and_data", async () => {
    const result = await createObservationalMemoryCompactor({ keepRecentEntries: 1, secrets: ["secret-token"] }).compact({
      sessionId: "s1",
      entries: memoryEntries(),
    });
    const text = JSON.stringify(result);
    assert.equal(text.includes("secret-token"), false);
    assert.match(text, /\[REDACTED\]/);
  });
});

describe("family compactors conform to the compaction slot contract", () => {
  it("family_compactors_pass_compaction_conformance", async () => {
    // Both first-party compactors are `Compactor` slot implementations (roadmap §2.5), so they
    // satisfy the same adapter contract the kernel's default does.
    const { summary: omSummary } = await assertCompactorConforms(createObservationalMemoryCompactor(), {
      secrets: ["secret-value"],
      exerciseAbort: true,
    });
    assert.ok(omSummary.length > 0);
  });
});

it("om_compaction_summary_ends_with_current_task", async () => {
  const entries = [...memoryEntries(), createSessionEntry({ sessionId: "s1", kind: "custom", data: {
    type: "om.task_state.recorded", taskState: { id: "cccccccccccc", goal: "Finish secret-token", nextSteps: ["Ship it"], sourceEntryIds: ["m1"] },
  } })];
  const result = await createObservationalMemoryCompactor({ secrets: ["secret-token"] }).compact({ sessionId: "s1", entries });
  assert.match(result.summary, /## Current task[\s\S]*Ship it$/);
  assert.doesNotMatch(result.summary, /secret-token/);
});
