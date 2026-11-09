/**
 * Plan 217 Task 3: habituation (repeated identical events collapse into one record with a count) and event
 * boundaries (outcome, task-state change, user turn after an idle gap).
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type JsonValue,
  type ModelProvider,
  providerDone,
  providerToolCall,
  type SessionContext,
  type SessionEntry,
  type SessionLog,
  toolCallContent,
} from "@arnilo/prism";
import { activeObservations, foldObservationalMemoryLedger, resolveMemorySystemConfig } from "../../index.js";
import { createObservationalFlush } from "../flush.js";
import type { ObservationalMemoryRecord } from "../ledger.js";
import { renderObservationalMemory } from "../render.js";
import { type MemoryObservation, OBSERVATIONS_RECORDED, OBSERVATIONS_REPEATED } from "../types.js";
import { runStm, stmRecentIndex } from "../workers/stm.js";
import { clientFor } from "./helpers.js";

type Call = { name: string; args: Record<string, unknown> };

function message(id: string, minute: number, role: "user" | "assistant" | "tool", text: string): SessionEntry {
  const timestamp = new Date(Date.UTC(2026, 10, 9, 10, minute)).toISOString();
  const content = [{ type: "text", text }];
  return {
    id,
    sessionId: "s",
    kind: "message",
    timestamp,
    message: role === "tool" ? { role, toolCallId: `t-${id}`, name: "bash", content } : { role, content },
  } as SessionEntry;
}

/** Answers each request with the next scripted batch of tool calls (one turn per request). */
function scripted(batches: readonly (readonly Call[])[], counter: { calls: number } = { calls: 0 }): ModelProvider {
  return {
    id: "mock",
    async *generate(request) {
      if (!request.messages.some((item) => item.role === "tool")) {
        const calls = batches[counter.calls] ?? [];
        counter.calls++;
        for (const [index, call] of calls.entries()) yield providerToolCall(toolCallContent(`c${index}`, call.name, call.args as never));
      }
      yield providerDone();
    },
  };
}

const poll = (id: string): Call => ({
  name: "record_event",
  args: { kind: "result", description: "CI status poll: build 812 still pending", sourceEntryIds: [id] },
});

function harness(entries: () => readonly SessionEntry[], stm: Record<string, unknown>, provider: ModelProvider) {
  const data: JsonValue[] = [];
  const log = {
    entries: () => data,
    append: async (_session: unknown, value: JsonValue) => {
      data.push(value);
    },
  } as unknown as SessionLog<JsonValue>;
  const session = { id: "s", entries: async () => entries() } as unknown as SessionContext;
  const flush = createObservationalFlush({
    log,
    config: resolveMemorySystemConfig({ stm: { triggerTokens: 1, ...stm }, worker: { maxTurns: 1 } }, { wm: false, rehearsal: false }),
    readState: () => ({ enabled: true }),
    onStatus: () => {},
    clientFor: () => clientFor(provider),
  });
  return { data, flush: () => flush.flush(session) };
}

describe("habituation and event boundaries (plan 217 Task 3)", () => {
  it("repeated_identical_event_increments_count", async () => {
    let entries: readonly SessionEntry[] = [message("p1", 0, "tool", "build 812: pending")];
    const { data, flush } = harness(
      () => entries,
      {},
      scripted([
        // Pass 1: the first poll, then an identical repeat inside the same batch.
        [poll("p1"), poll("p1")],
        // Pass 2: the same poll again (new entry), whitespace aside, against the ledger record.
        [
          {
            name: "record_event",
            args: { kind: "result", description: "  CI status poll:  build 812 still pending ", sourceEntryIds: ["p2"] },
          },
        ],
      ]),
    );
    await flush();
    let ledger = foldObservationalMemoryLedger(data);
    assert.equal(activeObservations(ledger).length, 1);
    assert.equal(activeObservations(ledger)[0]!.count, 2, "a repeat inside one batch raises the new record's count");

    entries = [...entries, message("p2", 5, "tool", "build 812: pending")];
    await flush();
    ledger = foldObservationalMemoryLedger(data);
    const [record] = activeObservations(ledger);
    assert.equal(activeObservations(ledger).length, 1, "no record added");
    assert.equal(record!.count, 3);
    assert.equal(record!.lastAt, entries[1]!.timestamp);
    const repeat = data.find((item) => (item as { type?: string }).type === OBSERVATIONS_REPEATED) as { count: number };
    assert.equal(repeat.count, 3, "the repeat record carries the absolute count");
    // Folding the repeat twice cannot over-count.
    assert.equal(activeObservations(foldObservationalMemoryLedger([...data, repeat as unknown as JsonValue]))[0]!.count, 3);

    assert.match(renderObservationalMemory([], activeObservations(ledger)), /result ×3: CI status poll/);
    assert.match(stmRecentIndex(activeObservations(ledger))[0]!, /result ×3:/);
  });

  it("changed_result_is_a_new_event", async () => {
    const entries = [
      message("r1", 0, "tool", "Ran 35 tests. 0 fail"),
      message("r2", 1, "tool", "Ran 35 tests. 2 fail"),
      message("r3", 2, "tool", "Ran 35 tests. 0 fail"),
      message("r4", 3, "tool", "Ran 35 tests"),
    ];
    const run = (id: string, text?: string): Call => ({
      name: "record_event",
      args: {
        kind: "result",
        description: "Ran the campaign test suite",
        sourceEntryIds: [id],
        ...(text ? { chunks: [{ sourceEntryId: id, text }] } : {}),
      },
    });
    const records: ObservationalMemoryRecord[] = [];
    const provider = scripted([
      [run("r1", "Ran 35 tests. 0 fail"), run("r2", "Ran 35 tests. 2 fail"), run("r3", "Ran 35 tests. 0 fail"), run("r4")],
    ]);
    const events = await runStm({
      entries,
      client: clientFor(provider),
      maxTurns: 1,
      onRecord: (record) => records.push(record),
    });
    assert.equal(events.length, 2, "different chunk bytes make a new event");
    assert.notEqual(events[0]!.chunkRefs?.[0]?.sha256, events[1]!.chunkRefs?.[0]?.sha256);
    assert.equal(events[0]!.count, 2, "byte-equal chunks habituate to the first record");
    assert.equal(events[1]!.count, 2, "absent chunks habituate to the newest identical record");
    assert.equal(records.length, 0, "batch-local repeats need no repeat record");
  });

  it("outcome_or_task_state_change_runs_a_boundary_pass", async () => {
    const entries = [message("u1", 0, "user", "Fix the retry counter"), message("a1", 1, "assistant", "Done; 35 tests pass")];
    const outcome: Call = {
      name: "record_event",
      args: {
        kind: "outcome",
        description: "Retry counter fixed in campaign.mjs (retryUncounted); verified by 35 passing tests",
        sourceEntryIds: ["u1", "a1"],
      },
    };
    const task: Call = { name: "record_task_state", args: { goal: "Fix the retry counter" } };
    const counter = { calls: 0 };
    let current = entries;
    const { data, flush } = harness(() => current, {}, scripted([[outcome, task], [task]], counter));
    const first = await flush();
    let ledger = foldObservationalMemoryLedger(data);
    assert.deepEqual(
      ledger.boundaries?.map((item) => [item.reason, item.entryId]),
      [
        ["outcome", "a1"],
        ["task_state", "a1"],
      ],
    );
    assert.equal(first.boundaries, 2);
    assert.equal(counter.calls, 1, "outcome and task-state boundaries come from the pass itself: no extra STM call");
    const outcomeId = activeObservations(ledger).find((item) => item.kind === "outcome")!.id;
    assert.equal(ledger.boundaries?.[0]?.recordId, outcomeId);

    // An unchanged task state is not a boundary.
    current = [...entries, message("a2", 2, "assistant", "Still on it")];
    const second = await flush();
    ledger = foldObservationalMemoryLedger(data);
    assert.equal(ledger.boundaries?.length, 2);
    assert.equal(second.boundaries, undefined);
  });

  it("idle_gap_user_turn_runs_a_boundary_pass_below_trigger", async () => {
    const before = [message("u1", 0, "user", "hi"), message("a1", 1, "assistant", "hello")];
    const after = [...before, message("u2", 30, "user", "Back: rerun the campaign"), message("a2", 31, "assistant", "ok")];
    const note: Call = {
      name: "record_event",
      args: { kind: "request", description: "User asked to rerun the campaign", sourceEntryIds: ["u2"] },
    };

    // Boundaries off (the default): the marker is recorded, but no STM call runs below the trigger.
    for (const boundaries of [false, true]) {
      const counter = { calls: 0 };
      let current: readonly SessionEntry[] = before;
      const { data, flush } = harness(() => current, { triggerTokens: 100_000, boundaries }, scripted([[note]], counter));
      await flush();
      assert.equal(counter.calls, 0, "no gap, below trigger: no pass");
      current = after;
      await flush();
      await flush();
      const ledger = foldObservationalMemoryLedger(data);
      assert.deepEqual(
        ledger.boundaries?.map((item) => [item.reason, item.entryId, item.gapMinutes]),
        [["idle_gap", "u2", 29]],
        "one marker per boundary across passes",
      );
      assert.equal(counter.calls, boundaries ? 1 : 0, "at most one STM call per boundary, only with stm.boundaries");
      assert.equal(activeObservations(ledger).length, boundaries ? 1 : 0);
    }
  });

  it("habituation_off_records_every_event", async () => {
    const entries = [message("p1", 0, "tool", "pending"), message("p2", 1, "tool", "pending")];
    const { data, flush } = harness(() => entries, { habituation: false }, scripted([[poll("p1"), poll("p2")]]));
    await flush();
    const active = activeObservations(foldObservationalMemoryLedger(data));
    assert.equal(active.length, 2);
    assert.ok(active.every((item: MemoryObservation) => (item.count ?? 1) === 1));
    assert.equal(
      data.some((item) => (item as { type?: string }).type === OBSERVATIONS_REPEATED),
      false,
    );
    assert.ok(data.some((item) => (item as { type?: string }).type === OBSERVATIONS_RECORDED));
  });

  it("habituation_window_and_config_defaults", async () => {
    const config = resolveMemorySystemConfig();
    assert.deepEqual(config.stm.habituation, { windowEvents: 50 });
    assert.equal(config.stm.boundaries, false);
    assert.equal(config.stm.boundaryGapMinutes, 10);
    assert.equal(resolveMemorySystemConfig({ stm: { habituation: false } }).stm.habituation, false);

    // A match outside the window is a new event.
    const at = (minute: number) => new Date(Date.UTC(2026, 10, 9, 9, minute)).toISOString();
    const old: MemoryObservation = {
      id: "aaaaaaaaaaaa",
      kind: "result",
      description: "CI status poll: build 812 still pending",
      timestamp: at(0),
      observedAt: at(0),
      relevance: "medium",
      sourceEntryIds: ["p0"],
      tokenCount: 8,
    };
    const newer: MemoryObservation = { ...old, id: "bbbbbbbbbbbb", description: "Something else", observedAt: at(1), timestamp: at(1) };
    const run = (windowEvents: number) =>
      runStm({
        entries: [message("p1", 0, "tool", "pending")],
        recent: [old, newer],
        habituation: { windowEvents },
        client: clientFor(scripted([[poll("p1")]])),
        maxTurns: 1,
      });
    assert.equal((await run(1)).length, 1, "outside a window of 1");
    assert.equal((await run(2)).length, 0, "inside a window of 2: habituated");
  });
});
