import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { providerDone, providerToolCall, toolCallContent, type SessionEntry, type ProviderRequest, type JsonObject } from "@arnilo/prism";
import { clientFor } from "./helpers.js";
import {
  runObserver,
  runReflector,
  serializeSourceEntries,
  foldObservationalMemoryLedger,
  renderObservationalMemory,
  observationalMemoryBlock,
  type MemoryObservation,
} from "../index.js";

const first: SessionEntry = {
  id: "m1",
  sessionId: "s",
  kind: "message",
  timestamp: "2026-10-15T09:12:00.000Z",
  message: { role: "user", content: [{ type: "text", text: "Deploy tomorrow" }] },
};
const last = { ...first, id: "m2", timestamp: "2026-10-17T09:12:00.000Z" };
const old: MemoryObservation = {
  id: "aaaaaaaaaaaa",
  content: "Old date",
  timestamp: first.timestamp,
  sourceEntryIds: ["m1"],
  relevance: "high",
  tokenCount: 2,
};

async function observe(calls: { name: string; args: JsonObject }[], extra = {}) {
  const records: any[] = [];
  const requests: ProviderRequest[] = [];
  let turn = 0;
  const observations = await runObserver({
    entries: [last, first],
    observations: [old],
    maxTurns: 2,
    ...extra,
    onRecord: (record: unknown) => {
      records.push(record);
    },
    client: clientFor({
      id: "mock",
      async *generate(request) {
        requests.push(request);
        if (turn++ === 0) for (const [i, call] of calls.entries()) yield providerToolCall(toolCallContent(`c${i}`, call.name, call.args));
        yield providerDone();
      },
    }),
  });
  return { records, observations, requests };
}

describe("OM temporal grounding and task state", () => {
  it("observation_observed_at_is_latest_source_timestamp", async () => {
    const { observations } = await observe([
      { name: "record_observation", args: { content: "Deploy moved", sourceEntryIds: ["m2", "m1"], referencedAt: "2026-10-18" } },
    ]);
    assert.equal(observations[0]?.observedAt, last.timestamp);
    assert.equal(observations[0]?.referencedAt, "2026-10-18");
  });
  it("invalid_referenced_at_is_dropped", async () => {
    for (const referencedAt of ["tomorrow", "2026-02-30", "2026-13-01"]) {
      const { observations } = await observe([
        { name: "record_observation", args: { content: "Deploy", sourceEntryIds: ["m1"], referencedAt } },
      ]);
      assert.equal(observations[0]?.referencedAt, undefined);
    }
  });
  it("observer_input_has_dates_and_gap_markers", () => {
    const text = serializeSourceEntries([first, last]);
    assert.ok(text.includes(first.timestamp));
    assert.ok(text.includes("[gap: 2d]"));
    assert.ok(!serializeSourceEntries([first, { ...last, timestamp: "2026-10-15T09:21:00.000Z" }]).includes("[gap:"));
    assert.throws(() => serializeSourceEntries([first, last], [], 20));
  });
  it("observer_supersedes_marks_old_observation_dropped", async () => {
    const { records, observations } = await observe([
      { name: "record_observation", args: { content: "New date", sourceEntryIds: ["m2"], supersedes: old.id } },
    ]);
    assert.deepEqual(records[0], {
      type: "om.observations.dropped",
      observationIds: [old.id],
      reason: "superseded",
      supersededBy: observations[0]?.id,
    });
  });
  it("unknown_supersedes_id_is_ignored_and_reported", async () => {
    const { records, observations, requests } = await observe([
      { name: "record_observation", args: { content: "New date", sourceEntryIds: ["m2"], supersedes: "bbbbbbbbbbbb" } },
    ]);
    assert.equal(records.length, 0);
    assert.equal(observations.length, 1);
    assert.match(JSON.stringify(requests[1]), /Unknown supersedes id ignored/);
  });
  it("task_state_latest_record_wins_and_renders_last_with_metadata", async () => {
    const { records } = await observe([
      { name: "record_task_state", args: { goal: "Old goal" } },
      {
        name: "record_task_state",
        args: { goal: "Deploy", openQuestions: ["Date unconfirmed"], decisions: ["Use staging"], nextSteps: ["Confirm date"] },
      },
    ]);
    const ledger = foldObservationalMemoryLedger([{ type: "om.observations.recorded", observations: [old] }, ...records]);
    assert.equal(ledger.taskState?.goal, "Deploy");
    assert.deepEqual(ledger.taskState?.sourceEntryIds, ["m2", "m1"]);
    const block = observationalMemoryBlock(ledger)[0]!;
    const content = String(block.content);
    assert.equal(content.match(/## Current task/g)?.length, 1);
    assert.ok(content.indexOf("## Current task") > content.indexOf("## Observations"));
    assert.match(content, /cite the ids you rely on as \[id\]/);
    assert.deepEqual(block.metadata, { source: "om", itemIds: [old.id, ledger.taskState?.id] });
  });
  it("task_state_tool_declares_schema_and_caps_bytes", async () => {
    const { records, requests } = await observe(
      [{ name: "record_task_state", args: { goal: "界".repeat(1000), nextSteps: ["x".repeat(1000)] } }],
      { maxTaskStateBytes: 64 },
    );
    const state = records[0].taskState;
    assert.ok(Buffer.byteLength([state.goal, ...(state.nextSteps ?? [])].join("")) <= 64);
    const tool = requests[0]?.tools?.find((t) => t.name === "record_task_state");
    assert.ok(tool?.parameters);
    assert.match(JSON.stringify(tool?.parameters), /maxLength/);
  });
  it("render_groups_by_observed_date_and_legacy_timestamp", () => {
    const newer = { ...old, id: "bbbbbbbbbbbb", observedAt: last.timestamp, referencedAt: "2026-10-18" };
    const text = renderObservationalMemory([], [newer, old]);
    assert.ok(text.indexOf("### 2026-10-15") < text.indexOf("### 2026-10-17"));
    assert.match(text, /\[aaaaaaaaaaaa\] 09:12 \(high\)/);
    assert.match(text, /\(refers to 2026-10-18\)/);
  });
  it("reflection_range_comes_from_evidence", async () => {
    const reflections = await runReflector({
      observations: [old, { ...old, id: "bbbbbbbbbbbb", observedAt: last.timestamp }],
      maxTurns: 1,
      client: clientFor({
        id: "mock",
        async *generate() {
          yield providerToolCall(
            toolCallContent("c", "record_reflection", { content: "Deploy history", supportingObservationIds: [old.id, "bbbbbbbbbbbb"] }),
          );
          yield providerDone();
        },
      }),
    });
    assert.equal(reflections[0]?.observedFrom, first.timestamp);
    assert.equal(reflections[0]?.observedTo, last.timestamp);
    assert.match(renderObservationalMemory(reflections, []), /2026-10-15.*2026-10-17/);
  });
});

it("task_state_recall_withholds_revoked_sources_and_render_preserves_tail", async () => {
  const { recallObservationalMemory } = await import("../recall.js");
  const { records } = await observe([{ name: "record_task_state", args: { goal: "Deploy", openQuestions: ["Confirm window"] } }]);
  const taskState = records[0].taskState;
  const entries: SessionEntry[] = [first, last, { ...last, id: "record", kind: "custom", message: undefined, data: records[0] }];
  assert.equal(recallObservationalMemory(entries, taskState.id).kind, "task_state");
  assert.match(recallObservationalMemory(entries, taskState.id).text, /Deploy/);
  assert.equal(recallObservationalMemory(entries, taskState.id, [], { invalidatedIds: ["m1"] }).reason, "revoked");
  const text = renderObservationalMemory(
    [{ id: "bbbbbbbbbbbb", content: "x".repeat(1000), supportingObservationIds: [old.id], tokenCount: 250 }],
    [old],
    { taskState, maxBytes: 512 },
  );
  assert.match(text, /## Current task/);
  assert.ok(text.endsWith("- Confirm window"));
  assert.ok(Buffer.byteLength(text) <= 512);
});

it("flush_persists_supersession_and_latest_task_state_without_extra_model_call", async () => {
  const { createObservationalFlush, resolveMemoryObservationalConfig, activeObservations } = await import("../index.js");
  const data: import("@arnilo/prism").JsonValue[] = [JSON.parse(JSON.stringify({ type: "om.observations.recorded", observations: [old] }))];
  let calls = 0;
  const session = { id: "s", entries: async () => [first, last] } as unknown as import("@arnilo/prism").SessionContext;
  const flush = createObservationalFlush({
    log: {
      entries: () => data,
      append: async (_session: unknown, value: import("@arnilo/prism").JsonValue) => {
        data.push(value);
      },
    } as unknown as import("@arnilo/prism").SessionLog<import("@arnilo/prism").JsonValue>,
    config: resolveMemoryObservationalConfig({ observer: { messageTokens: 1 }, worker: { maxTurns: 1 } }),
    readState: () => ({ enabled: true }),
    onStatus: () => {},
    clientFor: () =>
      clientFor({
        id: "mock",
        async *generate() {
          calls++;
          yield providerToolCall(
            toolCallContent("a", "record_observation", { content: "Moved deployment", sourceEntryIds: ["m2"], supersedes: old.id }),
          );
          yield providerToolCall(toolCallContent("b", "record_task_state", { goal: "Deploy" }));
          yield providerDone();
        },
      }),
  });
  await flush.flush(session);
  const ledger = foldObservationalMemoryLedger(data);
  assert.equal(calls, 1);
  assert.equal(ledger.taskState?.goal, "Deploy");
  assert.deepEqual(
    activeObservations(ledger).map((item) => item.content),
    ["Moved deployment"],
  );
});
