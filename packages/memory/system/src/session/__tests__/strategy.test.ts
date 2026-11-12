import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  createAgent,
  createMemorySessionStore,
  createSessionEntry,
  type JsonValue,
  providerDone,
  providerTextDelta,
  type SessionEntry,
} from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { assertCompactorConforms } from "@arnilo/prism/testing/compaction-conformance";
import { type MemoryObservation, type MemoryWmItem, OBSERVATIONS_RECORDED, WM_RECORDED } from "../../index.js";
import { createObservationalMemoryCommands } from "../commands.js";
import { createObservationalCompactor } from "../compactor.js";
import { resolveMemorySystemConfig } from "../config.js";
import { createObservationalMemoryCompactor } from "../strategy.js";
import { FOLDED_MEMORY, OBSERVATIONS_TOMBSTONED, TASK_STATE_RECORDED } from "../types.js";

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
    kind: "statement",
    description: "Keep secret-token out",
    timestamp: now,
    relevance: "high",
    sourceEntryIds: ["m1"],
    tokenCount: 5,
  };
  const reflection: MemoryWmItem = {
    id: "bbbbbbbbbbbb",
    kind: "summary",
    text: "Use package-only strategy",
    relevance: "medium",
    citedIds: [observation.id],
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
      data: { type: WM_RECORDED, items: [reflection], coversUpToId: "om1" },
    }),
    message("m2", "recent one"),
    message("m3", "recent two"),
  ];
}

describe("observational memory compaction strategy", () => {
  it("observational_memory_strategy_renders_existing_memory_without_provider_call", async () => {
    const strategy = createObservationalMemoryCompactor({ keepRecentEntries: 1, secrets: ["secret-token"] });
    const result = await strategy.compact({ sessionId: "s1", entries: memoryEntries(), trigger: "manual" });
    assert.match(result.summary, /Session Memory/);
    assert.match(result.summary, /Use package-only strategy/);
    assert.equal(result.summary.includes("secret-token"), false);
  });

  it("observational_memory_strategy_returns_standard_compaction_data_with_folded_memory", async () => {
    const strategy = createObservationalMemoryCompactor({ keepRecentEntries: 2 });
    const result = await strategy.compact({ sessionId: "s1", entries: memoryEntries(), trigger: "auto" });
    const entry = result.entries?.[0];
    const data = entry?.data as any;
    assert.equal(entry?.kind, "compaction");
    assert.equal(data.strategy, "session-memory");
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
      packages: [
        mockProvider([[providerTextDelta("ok"), providerDone()]], {
          onRequest: (request) => seen.push(JSON.stringify(request.messages)),
        }),
      ],
      // Roadmap §2.5: the compactor is the `compaction` slot.
      slots: { store, compaction: createObservationalMemoryCompactor({ keepRecentEntries: 2 }) },
    });
    const session = await agent.session({ id: "s1", create: true });
    await session.checkout("m3");
    await session.compact();
    assert.equal((await store.list("s1")).length, 6);
    await session.run("after compact");
    assert.match(seen.at(-1) ?? "", /Session Memory/);
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
  const entries = [
    ...memoryEntries(),
    createSessionEntry({
      sessionId: "s1",
      kind: "custom",
      data: {
        type: "memory.session.task_state.recorded",
        taskState: { id: "cccccccccccc", goal: "Finish secret-token", nextSteps: ["Ship it"], sourceEntryIds: ["m1"] },
      },
    }),
  ];
  const result = await createObservationalMemoryCompactor({ secrets: ["secret-token"] }).compact({ sessionId: "s1", entries });
  assert.match(result.summary, /## Current task[\s\S]*Ship it$/);
  assert.doesNotMatch(result.summary, /secret-token/);
});

it("compaction_renders_wm_then_stm_then_task_state_without_model_call", async () => {
  const observation = (id: string, description: string): MemoryObservation => ({
    id,
    kind: "result",
    description,
    timestamp: now,
    relevance: "medium",
    sourceEntryIds: ["m1"],
    tokenCount: 5,
    chunkRefs: [{ id: `${id}chunkchunkch`, sourceEntryId: "m1", sha256: "0".repeat(64), bytes: 30 }],
  });
  const wmItem = (id: string, kind: MemoryWmItem["kind"], text: string): MemoryWmItem => ({
    id,
    kind,
    text,
    relevance: "medium",
    citedIds: ["aaaaaaaaaaaa"],
    tokenCount: 4,
  });
  // Recorded in the worst order: event, summary, fact.
  const records = [
    {
      type: OBSERVATIONS_RECORDED,
      observations: [observation("aaaaaaaaaaaa", "Tombstoned record"), observation("bbbbbbbbbbbb", "Unprocessed record")],
      coversUpToId: "m2",
    },
    {
      type: WM_RECORDED,
      items: [
        wmItem("cccccccccccc", "event", "An event item"),
        wmItem("dddddddddddd", "summary", "A summary item"),
        wmItem("eeeeeeeeeeee", "fact", "A fact item"),
      ],
      processedIds: ["aaaaaaaaaaaa"],
    },
    { type: OBSERVATIONS_TOMBSTONED, observationIds: ["aaaaaaaaaaaa"], reason: "wm keep cccccccccccc", at: now },
    {
      type: TASK_STATE_RECORDED,
      taskState: { id: "ffffffffffff", goal: "Ship the probe", nextSteps: ["Run it"], sourceEntryIds: ["m1"] },
    },
  ] as unknown as JsonValue[];
  const log = { entries: () => records, append: async (_session: unknown, value: JsonValue) => void records.push(value) };
  const config = resolveMemorySystemConfig({ enabled: true, context: { recentMessages: 2 } });
  let fallbackCalls = 0;
  const compactor = createObservationalCompactor({
    log: log as never,
    config,
    // No model client reaches the compactor; the kernel default is the only other path and must stay unused.
    fallback: {
      name: "fallback",
      compact: () => {
        fallbackCalls += 1;
        return { summary: "", entries: [] };
      },
    },
    isEnabled: () => true,
  });
  const entries = [message("m1", "first"), message("m2", "second"), message("m3", "recent one"), message("m4", "recent two")];
  const session = { id: "s1", entries: async () => entries } as never;
  const result = await compactor.compact({ sessionId: "s1", session, entries, trigger: "manual" });
  assert.equal(fallbackCalls, 0);
  const order = ["A fact item", "A summary item", "An event item", "## Observations", "Unprocessed record", "## Current task", "Run it"];
  const at = order.map((text) => result.summary.indexOf(text));
  assert.equal(at.includes(-1), false, `every part renders: ${JSON.stringify(at)}`);
  assert.deepEqual(
    [...at].sort((a, b) => a - b),
    at,
    "WM (fact, summary, event), then unprocessed STM, then the task state",
  );
  assert.doesNotMatch(result.summary, /Tombstoned record/, "a processed record is off the STM surface");
  assert.doesNotMatch(result.summary, /chunkchunk/, "the summary never carries chunk ids or text, only the marker");
  const data = result.entries?.[0]?.data as { keepEntryIds: string[] };
  assert.deepEqual(data.keepEntryIds, ["m3", "m4"], "context.recentMessages stay verbatim");
  // The same rendering function serves memory:session:view.
  const view = createObservationalMemoryCommands({ log, config } as never).find((command) => command.name === "memory:session:view")!;
  const viewed = (await view.run({}, { session } as never)) as { text: string };
  const body = (text: string) => text.slice(text.indexOf("## Working memory"));
  assert.equal(body(viewed.text), body(result.summary));
});
