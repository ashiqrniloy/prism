/**
 * Plan 218.3 Task 3: a session-memory compaction removes only what STM has recorded. It picks the cut in tokens (the
 * newest tool round plus `keepRecentTokens` mid-loop, only the run's new input between loops), has STM cover every entry
 * before the cut in its own call, and cuts no further than STM's coverage. A coverage failure removes nothing.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { AgentEvent, JsonValue, ModelProvider, SessionEntry } from "@arnilo/prism";
import {
  createAgent,
  createMemorySessionStore,
  createSessionEntry,
  definePackage,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import memorySystem, { type MemorySystemConfig } from "../../index.js";
import { createObservationalCompactor } from "../compactor.js";
import { resolveMemorySystemConfig } from "../config.js";
import { keptTailStart } from "../cut.js";
import { activeObservations } from "../ledger.js";
import { ledgerOf } from "../state.js";
import { OBSERVATIONS_RECORDED } from "../types.js";

const now = "2026-11-18T00:00:00.000Z";

function entry(id: string, role: "user" | "assistant" | "tool", text: string, call?: string): SessionEntry {
  const content =
    role === "tool"
      ? [{ type: "tool_result" as const, toolCallId: call!, name: "noop", result: text }]
      : call
        ? [toolCallContent(call, "noop", {})]
        : [{ type: "text" as const, text }];
  return createSessionEntry({ id, sessionId: "s1", timestamp: now, kind: "message", message: { role, content } as never });
}

/** u1, a1 (calls c1), t1 (its result), a2 (text), u2, a3 (calls c2), t2, then `tail`. */
function branch(tail: readonly SessionEntry[] = []): SessionEntry[] {
  return [
    entry("u1", "user", "first request ".repeat(20)),
    entry("a1", "assistant", "", "c1"),
    entry("t1", "tool", "first output ".repeat(20), "c1"),
    entry("a2", "assistant", "first answer ".repeat(20)),
    entry("u2", "user", "second request ".repeat(20)),
    entry("a3", "assistant", "", "c2"),
    entry("t2", "tool", "second output ".repeat(20), "c2"),
    ...tail,
  ];
}

/** The session-memory compactor over an in-memory ledger, with a scripted cover step. */
function compactorOver(
  cover: (records: JsonValue[], through: string) => void,
  options: { keepRecentTokens?: number; point?: "mid-loop" | "between-loops" } = {},
) {
  const records: JsonValue[] = [];
  const log = { entries: () => records, append: async (_session: unknown, value: JsonValue) => void records.push(value) };
  const covers: string[] = [];
  const compactor = createObservationalCompactor({
    log: log as never,
    config: resolveMemorySystemConfig({
      enabled: true,
      ...(options.keepRecentTokens === undefined ? {} : { context: { keepRecentTokens: options.keepRecentTokens } }),
    }),
    fallback: { name: "fallback", compact: () => assert.fail("memory-on sessions never reach the fallback") },
    isEnabled: () => true,
    cover: async (_session, through) => {
      covers.push(through);
      cover(records, through);
      return { observations: 0, wmItems: 0, processed: 0, dropped: 0, covered: { entries: 3, tokens: 42 } };
    },
    pointFor: () => options.point ?? "mid-loop",
  });
  return { compactor, records, covers };
}

const compactionData = (result: { entries?: readonly SessionEntry[] }) =>
  result.entries?.[0]?.data as { throughEntryId?: string; keepEntryIds: string[]; coverage?: unknown; point?: string };

describe("the cut (plan 218.3 Task 3)", () => {
  it("tool_call_and_result_stay_together", () => {
    const entries = branch([entry("a4", "assistant", "done")]);
    const tokens = (ids: string[]) =>
      entries.filter((item) => ids.includes(item.id)).reduce((sum, item) => sum + JSON.stringify(item.message).length / 4, 0);
    // Mid-loop: the newest tool round (a3, t2, a4) always stays.
    assert.equal(entries[keptTailStart(entries, { point: "mid-loop", keepRecentTokens: 0 })]!.id, "a3");
    // A budget that reaches t1 but not a1 would split c1 from its result: the cut keeps neither.
    const budget = Math.ceil(tokens(["t1", "a2", "u2", "a3", "t2", "a4"])) + 2;
    const start = entries[keptTailStart(entries, { point: "mid-loop", keepRecentTokens: budget })]!.id;
    assert.ok(start === "a2" || start === "a1", `the cut lands on a2 (pair removed) or a1 (pair kept), not ${start}`);
    // A budget large enough for everything keeps everything.
    assert.equal(keptTailStart(entries, { point: "mid-loop", keepRecentTokens: 1_000_000 }), 0);
  });

  it("between_loops_keeps_only_the_new_input", () => {
    const entries = branch([entry("a4", "assistant", "done"), entry("u3", "user", "next task")]);
    assert.equal(entries[keptTailStart(entries, { point: "between-loops", keepRecentTokens: 1_000_000 })]!.id, "u3");
    const ended = branch([entry("a4", "assistant", "done")]);
    assert.equal(keptTailStart(ended, { point: "between-loops", keepRecentTokens: 0 }), ended.length, "no new input: nothing");
  });

  it("compaction_never_removes_an_uncovered_entry", async () => {
    // STM covers only through a1 although the cut asked for everything before a3.
    const { compactor, covers } = compactorOver(
      (records) => records.push({ type: OBSERVATIONS_RECORDED, observations: [], coversUpToId: "a1" }),
      { keepRecentTokens: 1 },
    );
    const entries = branch();
    const result = await compactor.compact({ sessionId: "s1", session: { id: "s1" } as never, entries, trigger: "auto" });
    assert.deepEqual(covers, ["u2"], "coverage was asked through the entry before the newest tool round");
    const data = compactionData(result);
    // Coverage ends at a1, whose result t1 is not covered: the pair stays, so the cut stops at a1's call.
    assert.equal(data.throughEntryId, "u1");
    assert.deepEqual(data.keepEntryIds, ["a1", "t1", "a2", "u2", "a3", "t2"]);
    assert.deepEqual(data.coverage, { entries: 3, tokens: 42 });
    assert.equal(data.point, "mid-loop");
  });

  it("compaction_cuts_at_the_token_rule_once_covered", async () => {
    const { compactor, records } = compactorOver(
      (list, through) => list.push({ type: OBSERVATIONS_RECORDED, observations: [], coversUpToId: through }),
      { keepRecentTokens: 1 },
    );
    const result = await compactor.compact({ sessionId: "s1", session: { id: "s1" } as never, entries: branch(), trigger: "auto" });
    const data = compactionData(result);
    assert.equal(data.throughEntryId, "u2");
    assert.deepEqual(data.keepEntryIds, ["a3", "t2"]);
    const compacted = records.find((record) => (record as { type?: string }).type === "memory.session.compacted") as {
      coversUpToId: string;
      coverage: unknown;
    };
    assert.equal(compacted.coversUpToId, "u2");
    assert.deepEqual(compacted.coverage, { entries: 3, tokens: 42 });
  });

  it("compacted_pool_fits_a_small_window", async () => {
    // Plan 218.3 Task 12 (Session-Bench screen, W = 32K): a pool of 15,000 observation tokens rendered whole after the
    // cut left the request over the 80% trigger, and STM-only overflowed on most tasks after the fourth.
    const observations = Array.from({ length: 30 }, (_, index) => ({
      id: index.toString(16).padStart(12, "a"),
      kind: "statement",
      description: `observation ${index} `.repeat(100),
      timestamp: now,
      relevance: "high",
      sourceEntryIds: ["u1"],
      tokenCount: 500,
    }));
    const poolTokens = async (inputCapTokens?: number) => {
      const { compactor } = compactorOver(
        (list, through) => list.push({ type: OBSERVATIONS_RECORDED, observations, coversUpToId: through } as never),
        { keepRecentTokens: 1 },
      );
      const result = await compactor.compact({
        sessionId: "s1",
        session: { id: "s1" } as never,
        entries: branch(),
        trigger: "auto",
        ...(inputCapTokens === undefined ? {} : { inputCapTokens }),
      });
      const memory = (result.entries?.[0]?.data as { memory: { observations: { tokenCount: number }[] } } | undefined)?.memory;
      assert.ok(memory);
      return memory.observations.reduce((sum, item) => sum + item.tokenCount, 0);
    };
    assert.equal(await poolTokens(), 15_000, "a large window keeps the whole pool");
    const small = await poolTokens(30_720);
    assert.ok(small > 0 && small <= 9_216, `the pool at a 30,720-token input cap is ${small}`);
  });
});

// --- through the agent: a real STM pass over a scripted worker.

const MODEL = { provider: "main", model: "main-model", limits: { contextWindow: 1_000_000, maxOutputTokens: 0 } };

/** Calls `noop` once per run, then answers. */
function mainProvider(): ModelProvider {
  let calls = 0;
  return {
    id: "main",
    async *generate(request) {
      calls += 1;
      if (request.messages.at(-1)?.role === "user") yield providerToolCall(toolCallContent(`c${calls}`, "noop", {}));
      else yield providerTextDelta("done");
      yield providerDone();
    },
  };
}

/** Records one event citing the batch's first entry; `fail` throws. */
function observerProvider(state: { calls: number; fail: boolean }): ModelProvider {
  return {
    id: "observer",
    async *generate(request) {
      state.calls += 1;
      if (state.fail) throw new Error("observer down");
      const prompt = request.messages.find((message) => message.role === "user")?.content[0];
      const text = prompt?.type === "text" ? prompt.text : "";
      const sourceId = /\[[^\]]+\] \[([^\]]+)\] (?:user|assistant|tool|system):/.exec(text)?.[1];
      if (!request.messages.some((message) => message.role === "tool") && sourceId)
        yield providerToolCall(
          toolCallContent("o1", "record_event", {
            kind: "statement",
            description: `Saw ${sourceId}`,
            relevance: "high",
            sourceEntryIds: [sourceId],
          }),
        );
      yield providerDone();
    },
  };
}

const noopTool = definePackage({
  name: "@acme/noop",
  version: "1.0.0",
  requires: { api: 1 },
  setup(prism) {
    prism.tools.register({
      name: "noop",
      description: "Does nothing.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "noop", value: "ok" }),
    });
  },
})();

async function harness(config: MemorySystemConfig, observer: { calls: number; fail: boolean }) {
  const store = createMemorySessionStore();
  const events: AgentEvent[] = [];
  const agent = await createAgent({
    model: MODEL,
    packages: [
      providerPackage("main-provider", [mainProvider()]),
      providerPackage("observer-provider", [observerProvider(observer)]),
      noopTool,
      // The STM trigger is out of reach, so no background pass covers anything: only the compaction's own pass can.
      memorySystem({ enabled: true, stm: { model: "observer/om", triggerTokens: 10_000_000 }, wm: false, ...config }),
    ],
    slots: { store },
    hooks: (hooks: { on: (name: "compaction.completed", handler: (payload: unknown) => void) => void }) =>
      hooks.on("compaction.completed", (payload) => events.push(payload as AgentEvent)),
  });
  const session = await agent.session({ id: "s", create: true });
  return { agent, session, store, events };
}

const ledgerFrom = (entries: readonly SessionEntry[]) =>
  ledgerOf(
    entries
      .filter((item) => item.kind === "package_state" && (item.data as { key?: string }).key === "memory.session.ledger")
      .map((item) => (item.data as { value: JsonValue }).value),
  );

describe("cover first (plan 218.3 Task 3)", () => {
  it("compaction_covers_pending_entries_first", async () => {
    const observer = { calls: 0, fail: false };
    // Between loops at one token: the third run's start compacts.
    const { agent, session, store } = await harness({ context: { compactAfterRun: { maxTokens: 1 } } }, observer);
    await session.run("one");
    assert.equal(observer.calls, 0, "no background pass ran");
    await session.run("two");
    const entries = await store.list("s");
    const compaction = entries.find((item) => item.kind === "compaction");
    assert.ok(compaction, "the second run's start compacted");
    assert.ok(observer.calls > 0, "the compaction ran STM itself");
    const data = compaction.data as { throughEntryId: string; keepEntryIds: string[]; point: string; coverage: { entries: number } };
    assert.equal(data.point, "between-loops");
    assert.ok(data.coverage.entries > 0);
    const messages = entries.filter((item) => item.kind === "message" && item.message);
    const removed = messages.slice(0, messages.findIndex((item) => item.id === data.throughEntryId) + 1);
    assert.ok(removed.length >= 3, "the first run's input, tool round and answer left the window");
    assert.deepEqual(
      data.keepEntryIds,
      messages.filter((item) => item.message?.role === "user" && JSON.stringify(item.message).includes("two")).map((item) => item.id),
      "between loops only the new input stays",
    );
    // Every removed entry is at or before STM's coverage.
    const ids = entries.map((item) => item.id);
    const covered = ids.indexOf(ledgerFrom(entries).latestObservationCoverageId!);
    for (const item of removed) assert.ok(ids.indexOf(item.id) <= covered, `${item.id} was covered before it was removed`);
    await agent.dispose();
  });

  it("coverage_failure_records_the_batch_without_the_model", async () => {
    // Plan 218.3 Task 12: a coverage pass whose model fails used to decline the compaction, so the window stayed full and
    // the next request overflowed. The batch is now recorded without the model, marked, and the compaction cuts.
    const observer = { calls: 0, fail: true };
    const { agent, session, store, events } = await harness({ context: { compactAfterRun: { maxTokens: 1 } } }, observer);
    await session.run("one");
    const result = await session.run("two");
    assert.equal(result.status, "completed");
    const entries = await store.list("s");
    assert.equal(entries.filter((item) => item.kind === "compaction").length, 1, "the compaction cut");
    assert.equal(events.filter((event) => (event as { error?: unknown }).error !== undefined).length, 0);
    const ledger = ledgerFrom(entries);
    assert.ok(ledger.latestObservationCoverageId, "coverage was recorded");
    const fallback = activeObservations(ledger).filter((item) => item.fallback === "worker_error");
    assert.ok(fallback.length > 0, "the batch is on the record");
    // Plan 218.5 Task 1, fix 1: the user's message is kept word for word, not as a truncated fallback line.
    const kept = activeObservations(ledger).filter((item) => item.verbatim);
    assert.ok(kept.some((item) => item.kind === "request" && item.description === "User said: one" && item.fallback === undefined));
    assert.equal(
      fallback.some((item) => item.description.includes("User: one")),
      false,
      "no second copy of the user message",
    );
    await agent.dispose();
  });
});

describe("coverage past the snapshot (plan 218.3 Task 12)", () => {
  it("compaction_reads_coverage_past_its_snapshot", async () => {
    // Session-Bench screen: a background STM pass in flight when a mid-loop compaction started recorded coverage through
    // an entry newer than the compaction's snapshot; the compactor read that as "covered nothing", declined, and the
    // next request overflowed (the overflow compaction then cut). A slow worker reproduces it.
    const sizes = [3_200, 3_200, 3_200, 3_200, 3_200, 16_000, 400];
    let step = 0;
    const main: ModelProvider = {
      id: "main",
      async *generate(request) {
        if (request.messages.at(-1)?.role === "user") step = 0;
        if (step < sizes.length) yield providerToolCall(toolCallContent(`b${step}-${sizes.length}`, "big", { n: sizes[step++] }));
        else yield providerTextDelta("done");
        yield providerDone();
      },
    };
    const slowObserver: ModelProvider = {
      id: "observer",
      async *generate(request) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        const text = JSON.stringify(request.messages);
        const id = /\[(entry_[^\]]+)\] (?:user|assistant|tool)/.exec(text)?.[1];
        if (!request.messages.some((message) => message.role === "tool") && id)
          yield providerToolCall(
            toolCallContent("o1", "record_event", { kind: "statement", description: `Saw ${id}`, relevance: "high", sourceEntryIds: [id] }),
          );
        yield providerDone();
      },
    };
    const big = definePackage({
      name: "@acme/big",
      version: "1.0.0",
      requires: { api: 1 },
      setup(prism) {
        prism.tools.register({
          name: "big",
          description: "Returns n characters.",
          parameters: { type: "object", properties: { n: { type: "integer" } }, additionalProperties: false },
          execute: (args, context) => ({ toolCallId: context.toolCallId, name: "big", value: "y".repeat((args as { n: number }).n) }),
        });
      },
    })();
    const events: { trigger?: string; error?: { code?: string } }[] = [];
    const agent = await createAgent({
      model: { provider: "main", model: "m", limits: { contextWindow: 8_000, maxOutputTokens: 0 } },
      packages: [
        providerPackage("main-provider", [main]),
        providerPackage("observer-provider", [slowObserver]),
        big,
        memorySystem({ enabled: true, stm: { model: "observer/om", triggerTokens: 500 }, wm: false }),
      ],
      slots: { store: createMemorySessionStore() },
      hooks: (hooks: { on: (name: "compaction.completed", handler: (payload: unknown) => void) => void }) =>
        hooks.on("compaction.completed", (payload) => events.push(payload as never)),
    });
    const session = await agent.session({ id: "s", create: true });
    for (const input of ["one", "two", "three"]) assert.equal((await session.run(input)).status, "completed");
    await agent.dispose();
    assert.ok(events.length >= 3, `${events.length} compactions`);
    assert.deepEqual(
      events.filter((event) => event.error?.code === "nothing_to_compact"),
      [],
      "no compaction declines while STM has covered the snapshot",
    );
  });
});
