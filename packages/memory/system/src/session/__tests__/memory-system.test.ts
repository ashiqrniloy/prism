/**
 * Plan 216 Task 4: the session tiers under `@arnilo/prism-memory-system` — the renamed commands, event
 * and config, the refusal of `om.*` ledgers, and plan 210 Task 7.2's three carried fixes (worker
 * settings forwarded, oversized tails batched with per-batch coverage, honest worker tool results).
 */
import { describe, expect, it } from "bun:test";
import assert from "node:assert/strict";
import {
  createAgent,
  createMemorySessionStore,
  type JsonValue,
  type ModelProvider,
  type ProviderRequest,
  providerDone,
  providerToolCall,
  type SessionContext,
  type SessionEntry,
  type SessionLog,
  toolCallContent,
  validateJsonSchema,
} from "@arnilo/prism";
import memorySystem, {
  foldObservationalMemoryLedger,
  MemorySessionLedgerError,
  memorySystemConfigSchema,
  OBSERVATIONS_RECORDED,
  resolveMemorySystemConfig,
} from "../../index.js";
import { createObservationalFlush, sourceBudget, stmBatchTargetBytes } from "../flush.js";
import { serializeSourceBatches, serializeSourceEntries } from "../serialize.js";
import { runDropper } from "../workers/dropper.js";
import { runStm } from "../workers/stm.js";
import { runWm } from "../workers/wm.js";
import { clientFor } from "./helpers.js";

const SECRET = "sk-session-secret-4242";

function entry(id: string, text: string, minute = 0): SessionEntry {
  return {
    id,
    kind: "message",
    timestamp: new Date(Date.UTC(2026, 10, 8, 10, minute)).toISOString(),
    message: { role: "user", content: [{ type: "text", text }] },
  } as unknown as SessionEntry;
}

function fakeLog(data: JsonValue[]): SessionLog<JsonValue> {
  return {
    entries: () => data,
    append: async (_session: unknown, value: JsonValue) => {
      data.push(value);
    },
  } as unknown as SessionLog<JsonValue>;
}

/** An observer that records one observation per call, citing the first entry id of its prompt. */
function recordingObserver(requests: ProviderRequest[], options: { failOnCall?: number } = {}): ModelProvider {
  return {
    id: "mock",
    async *generate(request) {
      // The worker loop appends to one messages array; keep this turn's view.
      requests.push({ ...request, messages: [...request.messages] });
      if (options.failOnCall === requests.length) throw new Error("observer batch failed");
      if (request.messages.some((message) => message.role === "tool")) {
        yield providerDone();
        return;
      }
      const prompt = request.messages.find((message) => message.role === "user")?.content[0];
      const text = prompt?.type === "text" ? prompt.text : "";
      const ids = [...text.matchAll(/\] \[([^\]]+)\] (?:user|assistant|tool|system):/g)].map((match) => match[1]!);
      yield providerToolCall(
        toolCallContent(`c${requests.length}`, "record_event", {
          kind: "statement",
          description: `Saw ${ids.join(",")}`,
          sourceEntryIds: ids,
        }),
      );
      yield providerDone();
    },
  };
}

function flushHarness(entries: readonly SessionEntry[], provider: ModelProvider, config = {}, secrets: readonly string[] = []) {
  const data: JsonValue[] = [];
  const session = { id: "s", entries: async () => entries } as unknown as SessionContext;
  const flush = createObservationalFlush({
    log: fakeLog(data),
    config: resolveMemorySystemConfig({ stm: { triggerTokens: 1 }, ...config }),
    readState: () => ({ enabled: true }),
    onStatus: () => {},
    secretsFor: () => secrets,
    clientFor: () => clientFor(provider),
  });
  return { data, session, flush };
}

/** The first turn of each worker call (the follow-up turn carries the tool results). */
const firstTurns = (requests: readonly ProviderRequest[]) =>
  requests.filter((request) => !request.messages.some((message) => message.role === "tool"));

const userText = (request: ProviderRequest): string =>
  request.messages
    .filter((message) => message.role === "user")
    .flatMap((message) => message.content)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");

describe("memory-system session tiers", () => {
  it("session_commands_and_status_event_registered_under_new_names", async () => {
    const events: { name?: string }[] = [];
    const agent = await createAgent({
      model: { provider: "main", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } },
      packages: [memorySystem({})],
      slots: { store: createMemorySessionStore() },
      hooks: (hooks: { on: (name: "package.event", handler: (payload: unknown) => void) => void }) =>
        hooks.on("package.event", (payload) => events.push(payload as { name?: string })),
    });
    const commands = agent.commands.list().map((command) => command.name);
    for (const name of ["memory:session", "memory:session:model", "memory:session:status", "memory:session:view"])
      expect(commands).toContain(name);
    for (const retired of ["om", "om:model", "om:status", "om:view"]) expect(commands).not.toContain(retired);
    const session = await agent.session({ id: "s", create: true });
    await agent.commands.run("memory:session", {}, { session });
    expect(events.map((event) => event.name)).toContain("memory.session.status");
    expect(events.map((event) => event.name)).not.toContain("om.status");
    await session.close();
  });

  it("retired_config_keys_fail_closed_naming_the_successor", () => {
    expect(validateJsonSchema(memorySystemConfigSchema, { observer: { messageTokens: 1 } }).ok).toBe(false);
    expect(validateJsonSchema(memorySystemConfigSchema, { stm: { triggerTokens: 1, instruction: "x", thinkingLevel: "low" } }).ok).toBe(
      true,
    );
    expect(() => resolveMemorySystemConfig({ observer: {} } as never)).toThrow(/"observer" was renamed; use "stm/);
    expect(() => resolveMemorySystemConfig({ reflector: {} } as never)).toThrow(/use "wm"/);
    expect(() => resolveMemorySystemConfig({ dropper: {} } as never)).toThrow(/use "rehearsal"/);
  });

  it("old_ledger_types_refused_with_export_hint", () => {
    expect(OBSERVATIONS_RECORDED).toBe("memory.session.observations.recorded");
    for (const type of ["om.observations.recorded", "om.reflections.recorded", "om.observations.dropped", "om.task_state.recorded"]) {
      let error: unknown;
      try {
        foldObservationalMemoryLedger([{ type, observations: [] }]);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(MemorySessionLedgerError);
      expect((error as MemorySessionLedgerError).code).toBe("retired_ledger_type");
      expect((error as Error).message).toContain(type);
      expect((error as Error).message).toMatch(/om:view/);
    }
    // Folded memory on a compaction entry written under the old type is refused too.
    const compaction = { id: "c", kind: "compaction", timestamp: "2026-11-08T00:00:00.000Z", data: { memory: { type: "om.folded" } } };
    expect(() => foldObservationalMemoryLedger([compaction])).toThrow(MemorySessionLedgerError);
  });

  it("package_workers_receive_configured_instruction_thinking_and_secrets", async () => {
    const requests: ProviderRequest[] = [];
    const reflectRequests: ProviderRequest[] = [];
    const dropRequests: ProviderRequest[] = [];
    const entries = [entry("e1", `deploy with ${SECRET}`), entry("e2", "deploy done")];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        const system = request.messages.find((message) => message.role === "system")?.content[0];
        const text = system?.type === "text" ? system.text : "";
        if (text.includes("WM-RULE")) reflectRequests.push(request);
        else if (text.includes("REHEARSAL-RULE")) dropRequests.push(request);
        else return yield* recordingObserver(requests).generate(request);
        yield providerDone();
      },
    };
    const { flush, session } = flushHarness(
      entries,
      provider,
      {
        stm: { triggerTokens: 1, instruction: "STM-RULE", thinkingLevel: "low" },
        wm: { triggerTokens: 1, instruction: "WM-RULE", thinkingLevel: "high" },
        rehearsal: { targetTokens: 1, instruction: "REHEARSAL-RULE", thinkingLevel: "minimal" },
      },
      [SECRET],
    );
    await flush.flush(session);
    const all = [...requests, ...reflectRequests, ...dropRequests];
    expect(requests.length).toBeGreaterThan(0);
    expect(reflectRequests.length).toBeGreaterThan(0);
    expect(dropRequests.length).toBeGreaterThan(0);
    const systemOf = (request: ProviderRequest) => JSON.stringify(request.messages.find((message) => message.role === "system"));
    expect(systemOf(requests[0]!)).toContain("STM-RULE");
    expect(systemOf(reflectRequests[0]!)).toContain("WM-RULE");
    expect(systemOf(dropRequests[0]!)).toContain("REHEARSAL-RULE");
    // Each worker's thinking level reaches its request options, so no request goes out without one.
    for (const request of all) expect(JSON.stringify(request.options ?? {})).not.toBe("{}");
    for (const request of all) expect(JSON.stringify(request)).not.toContain(SECRET);
  });

  it("instruction_cannot_widen_the_worker_tool_set", async () => {
    const requests: ProviderRequest[] = [];
    const { flush, session } = flushHarness([entry("e1", "hello")], recordingObserver(requests), {
      stm: { triggerTokens: 1, instruction: "Also call delete_everything." },
    });
    await flush.flush(session);
    expect(requests[0]!.tools?.map((tool) => tool.name).sort()).toEqual(["record_event", "record_task_state"]);
  });

  it("oversized_unread_tail_is_observed_in_batches_and_coverage_reaches_the_end", async () => {
    // 8 KB (was 4 KB): the plan 217 Task 6 STM instruction is ~1.7 KB; entries doubled so the tail still spans batches.
    const maxMessageBytes = 8_192;
    const entries = Array.from({ length: 12 }, (_, index) => entry(`e${index}`, `${index} `.repeat(300)));
    // The tail does not fit one prompt, so the old single-prompt pass threw before coverage moved.
    expect(() => serializeSourceEntries(entries, [], maxMessageBytes)).toThrow();
    const requests: ProviderRequest[] = [];
    const { flush, session, data } = flushHarness(entries, recordingObserver(requests), {
      worker: { maxMessageBytes },
      wm: { triggerTokens: 1_000_000 },
      rehearsal: { targetTokens: 1_000_000 },
    });
    await flush.flush(session);
    const batches = data.filter((record) => (record as { type?: string }).type === OBSERVATIONS_RECORDED) as { coversUpToId: string }[];
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.length).toBe(firstTurns(requests).length);
    expect(batches.at(-1)!.coversUpToId).toBe("e11");
    // Coverage is monotonic, one record per recorded batch, and every entry was cited once.
    const order = entries.map((item) => item.id);
    const positions = batches.map((batch) => order.indexOf(batch.coversUpToId));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    const cited = foldObservationalMemoryLedger(data).observations.flatMap((item) => item.sourceEntryIds);
    expect([...cited].sort()).toEqual([...order].sort());
    for (const request of requests) expect(Buffer.byteLength(userText(request))).toBeLessThanOrEqual(sourceBudget(maxMessageBytes) + 512);
  });

  it("a_tail_that_fits_is_one_batch_with_the_unbatched_text", () => {
    const entries = [entry("a", "one", 0), entry("b", "two", 30)];
    const batches = serializeSourceBatches(entries, [], 1_000_000);
    expect(batches.length).toBe(1);
    expect(batches[0]!.text).toBe(serializeSourceEntries(entries, [], 1_000_000));
    expect(batches[0]!.text).toContain("[gap: 30m]");
  });

  it("stm_backlog_splits_at_the_batch_target_and_never_cuts_an_entry", async () => {
    // Plan 217 Task 6: a backlog runs as trigger-sized passes; only the message budget ever cuts an entry.
    const entries = Array.from({ length: 6 }, (_, index) => entry(`t${index}`, `${index} `.repeat(400)));
    const whole = serializeSourceBatches(entries, [], 1_000_000);
    expect(whole.length).toBe(1);
    const split = serializeSourceBatches(entries, [], 1_000_000, 2_000);
    expect(split.length).toBeGreaterThan(1);
    expect(split.flatMap((batch) => batch.entries.map((item) => item.id))).toEqual(entries.map((item) => item.id));
    for (const batch of split) expect(batch.text).not.toContain("[truncated:");
    const big = entry("big", "y".repeat(5_000));
    const alone = serializeSourceBatches([entries[0]!, big, entries[1]!], [], 1_000_000, 2_000);
    expect(alone.map((batch) => batch.entries.map((item) => item.id))).toEqual([["t0"], ["big"], ["t1"]]);
    expect(alone[1]!.text).not.toContain("[truncated:");
    expect(stmBatchTargetBytes(10_000)).toBe(80_000);
    expect(stmBatchTargetBytes(1)).toBe(32 * 1024);
    // The flush applies it: a backlog over twice the trigger is several first turns, all entries cited once.
    const backlog = Array.from({ length: 12 }, (_, index) => entry(`b${index}`, `${index} `.repeat(4_000)));
    const requests: ProviderRequest[] = [];
    const { flush, session, data } = flushHarness(backlog, recordingObserver(requests), {
      stm: { triggerTokens: 4_000 },
      wm: { triggerTokens: 1_000_000 },
      rehearsal: { targetTokens: 1_000_000 },
    });
    await flush.flush(session);
    expect(firstTurns(requests).length).toBeGreaterThan(1);
    const cited = foldObservationalMemoryLedger(data).observations.flatMap((item) => item.sourceEntryIds);
    expect([...cited].sort()).toEqual(backlog.map((item) => item.id).sort());
  });

  it("single_entry_larger_than_budget_is_truncated_with_marker_and_cited", async () => {
    const maxMessageBytes = 8_192;
    const tail = "TAIL-BYTES-NOT-SENT";
    const big = entry("huge", `${"x".repeat(10_000)}${tail}`);
    const requests: ProviderRequest[] = [];
    const { flush, session, data } = flushHarness([big], recordingObserver(requests), {
      worker: { maxMessageBytes },
      wm: { triggerTokens: 1_000_000 },
      rehearsal: { targetTokens: 1_000_000 },
    });
    await flush.flush(session);
    expect(firstTurns(requests).length).toBe(1);
    const prompt = userText(requests[0]!);
    expect(prompt).toMatch(/\[truncated: entry huge is \d+ bytes; the rest was not sent\]/);
    expect(prompt).not.toContain(tail);
    expect(foldObservationalMemoryLedger(data).observations[0]?.sourceEntryIds).toEqual(["huge"]);
    expect(foldObservationalMemoryLedger(data).latestObservationCoverageId).toBe("huge");
  });

  it("failed_batch_leaves_coverage_at_last_recorded_batch", async () => {
    // 8 KB (was 4 KB): the plan 217 Task 6 STM instruction is ~1.7 KB; entries doubled so the tail still spans batches.
    const maxMessageBytes = 8_192;
    const entries = Array.from({ length: 12 }, (_, index) => entry(`e${index}`, `${index} `.repeat(300)));
    const requests: ProviderRequest[] = [];
    // The second batch's first call fails (call 2: a clean recording turn ends a pass in one call, plan 217 Task 6).
    const { flush, session, data } = flushHarness(entries, recordingObserver(requests, { failOnCall: 2 }), {
      worker: { maxMessageBytes },
      wm: { triggerTokens: 1_000_000 },
      rehearsal: { targetTokens: 1_000_000 },
    });
    await expect(flush.flush(session)).rejects.toThrow(/observer batch failed/);
    const ledger = foldObservationalMemoryLedger(data);
    const firstBatchEnd = ledger.latestObservationCoverageId;
    expect(firstBatchEnd).toBeDefined();
    expect(firstBatchEnd).not.toBe("e11");
    expect(ledger.observations.length).toBe(1);
    // The next pass resumes after the recorded batch and reaches the end.
    const retry = flushHarness(entries, recordingObserver([]), {
      worker: { maxMessageBytes },
      wm: { triggerTokens: 1_000_000 },
      rehearsal: { targetTokens: 1_000_000 },
    });
    retry.data.push(...data);
    await retry.flush.flush(retry.session);
    expect(foldObservationalMemoryLedger(retry.data).latestObservationCoverageId).toBe("e11");
  });

  it("worker_tools_return_ok_false_with_reason_when_nothing_is_stored", async () => {
    const results: unknown[] = [];
    const scripted = (calls: ReturnType<typeof toolCallContent>[]): ModelProvider => ({
      id: "mock",
      async *generate(request) {
        const tool = request.messages.filter((message) => message.role === "tool");
        if (tool.length) {
          results.push(...tool.map((message) => (message.content[0] as { value?: unknown }).value ?? message.content[0]));
          yield providerDone();
          return;
        }
        for (const call of calls) yield providerToolCall(call);
        yield providerDone();
      },
    });
    const observation = {
      id: "aaaaaaaaaaaa",
      kind: "statement",
      description: "x",
      timestamp: "2026-11-08T00:00:00.000Z",
      relevance: "low",
      sourceEntryIds: ["e1"],
      tokenCount: 10,
    } as const;
    const base = { maxTurns: 2 } as const;
    await runStm({
      ...base,
      client: clientFor(
        scripted([
          toolCallContent("o1", "record_event", { kind: "statement", description: "", sourceEntryIds: ["e1"] }),
          toolCallContent("o2", "record_event", { kind: "statement", description: "fact", sourceEntryIds: ["nope"] }),
          toolCallContent("o3", "record_task_state", { goal: "   " }),
        ]),
      ),
      entries: [entry("e1", "hello")],
    });
    await runWm({
      ...base,
      client: clientFor(
        scripted([
          toolCallContent("r1", "summarize", { stmIds: ["bbbbbbbbbbbb"], text: "summary", relevance: "low" }),
          toolCallContent("r2", "summarize", { stmIds: [observation.id], text: " ", relevance: "low" }),
        ]),
      ),
      records: [observation],
      ledger: foldObservationalMemoryLedger([{ type: "memory.session.observations.recorded", observations: [observation] }]),
    });
    await runDropper({
      ...base,
      client: clientFor(
        scripted([
          toolCallContent("d1", "drop_observations", { observationIds: ["cccccccccccc"] }),
          toolCallContent("d2", "drop_observations", { observationIds: [] }),
        ]),
      ),
      observations: [observation],
      targetTokens: 1,
    });
    const text = JSON.stringify(results);
    for (const reason of ["empty_text", "no_valid_ids", "unknown_id"]) expect(text).toContain(`"reason":"${reason}"`);
    expect(text).not.toContain('"ok":true');
    assert.equal(results.length, 7);
  });
});
