import { it } from "bun:test";
import assert from "node:assert/strict";
import type { JsonValue, ModelClient, SessionContext, SessionEntry, SessionLog } from "@arnilo/prism";
import { providerDone, providerToolCall, toolCallContent } from "@arnilo/prism";
import { activeObservations, activeReflections, foldObservationalMemoryLedger, mergeObservationalMemoryLedgers } from "../ledger.js";
import { buildObservationalMemoryProjection } from "../projection.js";
import { observationalMemoryBlock } from "../context.js";
import { createObservationalMemoryCompactor } from "../strategy.js";
import { recallObservationalMemory } from "../recall.js";
import { renderObservationalMemory } from "../render.js";
import { resolveMemoryObservationalConfig } from "../config.js";
import { createObservationalFlush } from "../flush.js";
import { runReflector } from "../workers/reflector.js";
import { runDropper } from "../workers/dropper.js";
import { type MemoryObservation, type MemoryReflection, isReflectionsRecordedData } from "../types.js";

const observation: MemoryObservation = {
  id: "aaaaaaaaaaaa",
  content: "old evidence",
  timestamp: "2026-01-01",
  sourceEntryIds: ["source"],
  relevance: "high",
  tokenCount: 10,
};
const reflection: MemoryReflection = {
  id: "bbbbbbbbbbbb",
  content: "durable knowledge",
  supportingObservationIds: [observation.id],
  tokenCount: 3,
};
const next = { ...reflection, id: "cccccccccccc", content: "rewritten knowledge" };
const records = [
  { type: "om.observations.recorded", observations: [observation] },
  { type: "om.reflections.recorded", reflections: [reflection], consumedObservationIds: [observation.id] },
];
const entries = (data: readonly unknown[]): SessionEntry[] =>
  data.map((value, index) => ({ id: `e${index}`, sessionId: "s", timestamp: "2026-01-01", kind: "custom", data: value }));
const done: ModelClient = {
  model: { provider: "mock", model: "m" },
  async *generate() {
    yield providerDone();
  },
};

it("reflection_consumes_supporting_observations_and_supersedes_prior_reflections", () => {
  const ledger = foldObservationalMemoryLedger([
    ...records,
    { type: "om.reflections.recorded", reflections: [next], supersededReflectionIds: [reflection.id] },
  ]);
  assert.deepEqual(activeObservations(ledger), []);
  assert.deepEqual(activeReflections(ledger), [next]);
  assert.equal(ledger.observations.length, 1);
  assert.equal(ledger.reflections.length, 2);
  assert.match(String(observationalMemoryBlock(ledger)[0]!.content), /rewritten knowledge/);
  assert.doesNotMatch(String(observationalMemoryBlock(ledger)[0]!.content), /durable knowledge|old evidence/);
  const merged = mergeObservationalMemoryLedgers(foldObservationalMemoryLedger(records), ledger);
  assert.deepEqual(activeObservations(merged), []);
  assert.deepEqual(activeReflections(merged), [next]);
  const compacted = createObservationalMemoryCompactor({ ledgerOf: () => ledger }).compact({
    sessionId: "s",
    entries: [],
    keepRecentEntries: 0,
  });
  assert.match((compacted as { summary: string }).summary, /rewritten knowledge/);
  assert.doesNotMatch((compacted as { summary: string }).summary, /durable knowledge|old evidence/);
});

it("dropped_observation_does_not_hide_reflection_but_invalidated_source_does", () => {
  const data = entries([...records, { type: "om.observations.dropped", observationIds: [observation.id] }]);
  assert.deepEqual(buildObservationalMemoryProjection(data).reflections, [reflection]);
  assert.deepEqual(buildObservationalMemoryProjection(data, undefined, { invalidatedIds: ["source"] }).reflections, []);
  assert.match(String(observationalMemoryBlock(foldObservationalMemoryLedger(data))[0]!.content), /durable knowledge/);
  const recalled = recallObservationalMemory(data, reflection.id);
  assert.match(recalled.text, /\(reflected\)/);
  assert.match(recalled.text, /\(dropped\)/);
  assert.match(recallObservationalMemory(data, observation.id).text, /\(reflected\)/);
  assert.equal(recallObservationalMemory(data, reflection.id, [], { invalidatedIds: ["source"] }).reason, "revoked");
});

it("empty_reflection_pass_consumes_nothing_and_optional_fields_are_validated", () => {
  const ledger = foldObservationalMemoryLedger([
    records[0],
    {
      type: "om.reflections.recorded",
      reflections: [],
      consumedObservationIds: [observation.id],
      supersededReflectionIds: [reflection.id],
    },
  ]);
  assert.deepEqual(activeObservations(ledger), [observation]);
  assert.deepEqual(ledger.supersededReflectionIds, []);
  for (const field of ["consumedObservationIds", "supersededReflectionIds"]) {
    assert.equal(isReflectionsRecordedData({ type: "om.reflections.recorded", reflections: [reflection], [field]: ["bad"] }), false);
  }
});

it("reflector_and_dropper_tools_declare_argument_schemas", async () => {
  const seen: string[][] = [];
  const client: ModelClient = {
    ...done,
    async *generate(request) {
      seen.push(request.tools![0]!.parameters!.required as string[]);
      yield providerDone();
    },
  };
  await runReflector({ client, observations: [observation], maxTurns: 1 });
  await runDropper({ client, observations: [observation], targetTokens: 1, maxTurns: 1 });
  assert.deepEqual(seen, [["content", "supportingObservationIds"], ["observationIds"]]);
});

it("render_truncation_drops_oldest_observations_first", () => {
  const newest = { ...observation, id: "dddddddddddd", timestamp: "2026-02-01", content: "new evidence" };
  const budget = Buffer.byteLength(renderObservationalMemory([reflection], [newest]), "utf8");
  const text = renderObservationalMemory([reflection], [newest, observation], { maxBytes: budget });
  assert.match(text, /durable knowledge/);
  assert.match(text, /new evidence/);
  assert.doesNotMatch(text, /old evidence/);
  assert.ok(Buffer.byteLength(text, "utf8") <= budget);
});

it("config_rejects_drop_target_below_reflection_trigger", () => {
  assert.equal(resolveMemoryObservationalConfig().dropper.targetTokens, 20_000);
  assert.throws(
    () => resolveMemoryObservationalConfig({ dropper: { targetTokens: 10 } }),
    /dropper.targetTokens.*reflector.observationTokens/,
  );
});

async function flushHarness(recordReflection: boolean) {
  const data = structuredClone(records) as unknown as JsonValue[];
  const session = { id: "s", entries: async () => [] } as unknown as SessionContext;
  const log = {
    entries: () => data,
    append: async (_session: SessionContext, value: JsonValue) => {
      data.push(value);
    },
  } as unknown as SessionLog<JsonValue>;
  const prompts: string[] = [];
  const client: ModelClient = {
    ...done,
    async *generate(request) {
      prompts.push(JSON.stringify(request.messages));
      if (recordReflection && !request.messages.some((message) => message.role === "tool"))
        yield providerToolCall(
          toolCallContent("r", "record_reflection", { content: next.content, supportingObservationIds: [observation.id, "dddddddddddd"] }),
        );
      yield providerDone();
    },
  };
  data.push({
    type: "om.observations.recorded",
    observations: [{ ...observation, id: "dddddddddddd", content: "new evidence" }],
  } as unknown as JsonValue);
  const flush = createObservationalFlush({
    log,
    config: resolveMemoryObservationalConfig({
      reflector: { observationTokens: 1 },
      dropper: { targetTokens: 1, policy: "lowest-relevance" },
    }),
    readState: () => ({ enabled: true }),
    clientFor: () => client,
    onStatus: () => {},
  });
  const result = await flush.flush(session);
  return { result, data, prompts };
}

it("reflection_pass_rewrites_prior_reflections_with_original_provenance", async () => {
  const { result, data, prompts } = await flushHarness(true);
  assert.equal(result.reflections, 1);
  assert.equal(result.dropped, 0);
  assert.match(prompts[0]!, /durable knowledge/);
  assert.match(prompts[0]!, /new evidence/);
  const ledger = foldObservationalMemoryLedger(data);
  assert.deepEqual(activeObservations(ledger), []);
  assert.deepEqual(
    activeReflections(ledger).map((item) => item.content),
    [next.content],
  );
  assert.deepEqual(activeReflections(ledger)[0]!.supportingObservationIds, [observation.id, "dddddddddddd"]);
});

it("dropper_runs_without_reflection_when_over_target", async () => {
  const { result, data } = await flushHarness(false);
  assert.equal(result.reflections, 0);
  assert.equal(result.dropped, 1);
  assert.deepEqual(activeObservations(foldObservationalMemoryLedger(data)), []);
  assert.deepEqual(activeReflections(foldObservationalMemoryLedger(data)), [reflection]);
});

it("rewriting_an_identical_reflection_keeps_it_active", () => {
  const ledger = foldObservationalMemoryLedger([
    ...records,
    { type: "om.reflections.recorded", reflections: [reflection], supersededReflectionIds: [reflection.id] },
  ]);
  assert.deepEqual(activeReflections(ledger), [reflection]);
});

it("observer_input_bounded_to_recent_pool", async () => {
  const recent = { ...observation, id: "dddddddddddd", content: "recent memory", timestamp: "2026-03-01" };
  const data: JsonValue[] = [{ type: "om.observations.recorded", observations: [observation, recent] } as unknown as JsonValue];
  const log = { entries: () => data, append: async (_s: unknown, value: JsonValue) => { data.push(value); } } as unknown as SessionLog<JsonValue>;
  const session = { id: "s", entries: async () => [{ id: "m", sessionId: "s", timestamp: "2026-04-01", kind: "message", message: { role: "user", content: [{ type: "text", text: "new message" }] } }] } as unknown as SessionContext;
  const prompts: string[] = [];
  const flush = createObservationalFlush({
    log, config: resolveMemoryObservationalConfig({ observer: { messageTokens: 1 }, reflector: { observationTokens: 40 }, dropper: { targetTokens: 40 } }),
    readState: () => ({ enabled: true }), onStatus: () => {},
    clientFor: () => ({ ...done, async *generate(request) { prompts.push(JSON.stringify(request.messages)); yield providerDone(); } }),
  });
  await flush.flush(session);
  assert.match(prompts[0]!, /recent memory|new message/);
  assert.match(prompts[0]!, /recent memory/);
  assert.doesNotMatch(prompts[0]!, /old evidence/);
});
