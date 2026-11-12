import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { Message, ModelProvider, ProviderEvent, ProviderRequest, SessionEntry, ToolDefinition } from "@arnilo/prism";
import { providerDone, providerTextDelta, providerThinkingDelta, providerToolCall, toolCallContent } from "@arnilo/prism";
import {
  MEMORY_WORKER_UNKNOWN_TOOL,
  MemoryWorkerLimitError as ObservationalMemoryLimitError,
  runMemoryWorkerLoop,
} from "@arnilo/prism-memory-system/core";
import { foldObservationalMemoryLedger, type MemoryObservation, OBSERVATIONS_RECORDED } from "../../index.js";
import { runDropper } from "../workers/dropper.js";
import { runStm } from "../workers/stm.js";
import { runWm } from "../workers/wm.js";
import { clientFor } from "./helpers.js";

const source: SessionEntry = {
  id: "m1",
  sessionId: "s1",
  timestamp: "2026-06-20T00:00:00.000Z",
  kind: "message",
  message: { role: "user", content: [{ type: "text", text: "Keep it package-only." }] },
};

function provider(events: readonly ProviderEvent[]): ModelProvider {
  return {
    id: "mock",
    async *generate() {
      yield* events;
    },
  };
}

describe("observational memory workers", () => {
  it("observer_records_source_backed_observations_with_allowed_source_ids_only", async () => {
    const observations = await runStm({
      entries: [source],
      client: clientFor(
        provider([
          providerToolCall(
            toolCallContent("c1", "record_event", {
              kind: "statement",
              description: "User wants package-only memory.",
              relevance: "high",
              sourceEntryIds: ["m1", "invented"],
            }),
          ),
          providerDone(),
        ]),
      ),
      maxTurns: 1,
    });
    assert.equal(observations.length, 1);
    assert.deepEqual(observations[0]?.sourceEntryIds, ["m1"]);
  });

  it("observer_declares_the_record_event_argument_schema", async () => {
    // Regression (plan 140 Task 6 live run): a bare `{ type: "object" }` gave weaker models no
    // argument shape, so they answered in prose and the observer pass recorded nothing.
    let seen: unknown;
    const observer = await runStm({
      entries: [source],
      client: clientFor({
        id: "mock",
        async *generate(request: any) {
          seen = request.tools?.[0]?.parameters;
          yield providerDone();
        },
      }),
      maxTurns: 1,
    });
    assert.deepEqual(observer, []);
    const parameters = seen as { properties?: Record<string, unknown>; required?: string[] } | undefined;
    assert.deepEqual(Object.keys(parameters?.properties ?? {}).sort(), [
      "chunks",
      "description",
      "kind",
      "referencedAt",
      "relevance",
      "sourceEntryIds",
      "supersedes",
    ]);
    assert.deepEqual(parameters?.required, ["kind", "description", "sourceEntryIds"]);
  });

  it("wm_records_items_only_for_ids_in_the_batch", async () => {
    const observation: MemoryObservation = {
      id: "aaaaaaaaaaaa",
      kind: "statement",
      description: "Package-only",
      timestamp: source.timestamp,
      relevance: "high",
      sourceEntryIds: ["m1"],
      tokenCount: 3,
    };
    const { items, verdicts } = await runWm({
      records: [observation],
      ledger: foldObservationalMemoryLedger([{ type: OBSERVATIONS_RECORDED, observations: [observation] }]),
      client: clientFor(
        provider([
          providerToolCall(
            toolCallContent("c1", "summarize", {
              stmIds: [observation.id, "bbbbbbbbbbbb"],
              text: "Keep it optional.",
              relevance: "medium",
            }),
          ),
          providerToolCall(toolCallContent("c2", "keep", { stmId: observation.id, reason: "later steps need it" })),
          providerDone(),
        ]),
      ),
      maxTurns: 1,
    });
    assert.equal(items.length, 1);
    assert.equal(items[0]?.kind, "event");
    assert.deepEqual(items[0]?.citedIds, [observation.id]);
    assert.equal(verdicts.get(observation.id)?.verdict, "keep");
  });

  it("dropper_records_safe_drops_after_pool_pressure", async () => {
    const observation: MemoryObservation = {
      id: "aaaaaaaaaaaa",
      kind: "statement",
      description: "Drop me",
      timestamp: source.timestamp,
      relevance: "low",
      sourceEntryIds: ["m1"],
      tokenCount: 10,
    };
    const dropped = await runDropper({
      observations: [observation],
      targetTokens: 1,
      client: clientFor(
        provider([
          providerToolCall(toolCallContent("c1", "drop_observations", { observationIds: [observation.id, "bad"] })),
          providerDone(),
        ]),
      ),
      maxTurns: 1,
    });
    assert.deepEqual(dropped, [observation.id]);
  });

  it("treats text-only provider turns as no-op worker output", async () => {
    const observations = await runStm({
      entries: [source],
      client: clientFor(provider([providerTextDelta("No observation."), providerThinkingDelta("No tool."), providerDone()])),
      maxTurns: 1,
    });
    assert.deepEqual(observations, []);
  });

  it("stm_refuses_calls_past_the_limits_and_keeps_the_rest", async () => {
    // Plan 217 Task 6 (gate M-1 smoke): a 33rd call in one turn failed the whole STM pass, discarding its events and
    // re-sending a larger batch. Past the per-turn limit the extra calls are refused; the model repeats them next turn.
    const event = (id: string, description: string) =>
      providerToolCall(toolCallContent(id, "record_event", { kind: "statement", description, sourceEntryIds: ["m1"] }));
    const seen: ProviderRequest[] = [];
    let turn = 0;
    const model: ModelProvider = {
      id: "mock",
      async *generate(request) {
        seen.push(request);
        turn += 1;
        if (turn === 1) yield* [event("c1", "one"), event("c2", "two"), event("c3", "three")];
        else if (turn === 2) yield* [event("c4", "two"), event("c5", "three")];
        yield providerDone();
      },
    };
    const recorded = await runStm({ entries: [source], client: clientFor(model), maxTurns: 4, maxToolCallsPerTurn: 2 });
    assert.deepEqual(
      recorded.map((record) => record.description),
      ["one", "two", "three"],
    );
    const refusals = seen[1]!.messages.flatMap((message) =>
      message.role === "tool" ? message.content.filter((part) => part.type === "tool_result" && part.error) : [],
    );
    assert.equal(refusals.length, 1);
    assert.match(JSON.stringify(refusals[0]), /tool_call_limit.*per-turn limit of 2/);
    // Past the total limit the calls within it keep their effect and the pass ends without another model turn.
    let calls = 0;
    const greedy: ModelProvider = {
      id: "mock",
      async *generate() {
        calls += 1;
        yield* [event(`g${calls}a`, `a${calls}`), event(`g${calls}b`, `b${calls}`), event(`g${calls}c`, `c${calls}`)];
        yield providerDone();
      },
    };
    const capped = await runStm({ entries: [source], client: clientFor(greedy), maxTurns: 4, maxToolCalls: 2 });
    assert.deepEqual(
      capped.map((record) => record.description),
      ["a1", "b1"],
    );
    assert.equal(calls, 1);
  });

  it("stm_pass_ends_after_a_clean_turn_and_continues_after_a_rejection", async () => {
    // Plan 217 Task 6: after a turn whose events were all recorded, the model's next turn was a closing reply with no
    // call; STM now ends the pass instead of asking for it.
    const event = (id: string, description: string, extra: Record<string, unknown> = {}) =>
      providerToolCall(toolCallContent(id, "record_event", { kind: "statement", description, sourceEntryIds: ["m1"], ...extra }));
    let turns = 0;
    const clean: ModelProvider = {
      id: "mock",
      async *generate() {
        turns += 1;
        if (turns === 1) yield* [event("c1", "one"), event("c2", "two")];
        else yield providerTextDelta("Done.");
        yield providerDone();
      },
    };
    assert.equal((await runStm({ entries: [source], client: clientFor(clean), maxTurns: 4 })).length, 2);
    assert.equal(turns, 1, "no closing call after a clean turn");
    // A rejected event (`{ ok: false }`) gets the model another turn to correct it.
    let again = 0;
    const rejected: ModelProvider = {
      id: "mock",
      async *generate() {
        again += 1;
        if (again === 1) yield event("r1", "");
        else if (again === 2) yield event("r2", "fixed");
        yield providerDone();
      },
    };
    const fixed = await runStm({ entries: [source], client: clientFor(rejected), maxTurns: 4 });
    assert.deepEqual(
      fixed.map((record) => record.description),
      ["fixed"],
    );
    assert.equal(again, 2, "the corrected turn was clean, so the pass ended there");
    // A turn cut at the output limit may have more to record: the loop asks again.
    let cut = 0;
    const capped: ModelProvider = {
      id: "mock",
      async *generate() {
        cut += 1;
        if (cut === 1) yield* [event("k1", "first"), providerDone(undefined, "max_output_tokens")];
        else yield* [event("k2", "second"), providerDone()];
      },
    };
    assert.equal((await runStm({ entries: [source], client: clientFor(capped), maxTurns: 4 })).length, 2);
    assert.equal(cut, 2);
  });

  it("memory_worker_thinking_level_reaches_the_request_through_resolve", async () => {
    // Plan 217 Task 6.1: a `provider/model` client carries no description, so `thinkingLevel: "none"` mapped to
    // nothing. The worker now maps it against `client.resolve()`, the provider's description of the model.
    const seen: ProviderRequest[] = [];
    const bare = { provider: "described", model: "thinker" };
    const described = {
      ...bare,
      capabilities: { thinkingLevels: ["none", "low", "high"] },
      compat: { thinkingFamily: "reasoning_effort", thinkingValues: [false, "low", "high"] },
    };
    const provider: ModelProvider = {
      id: "described",
      async *generate(request) {
        seen.push(request);
        yield providerDone();
      },
    };
    const client = {
      model: bare,
      resolve: async () => described,
      generate: (request: never) => provider.generate({ ...(request as object), model: bare } as never),
    };
    await runStm({ entries: [source], client: client as never, maxTurns: 1, thinkingLevel: "none" });
    assert.deepEqual(seen[0]?.options?.compat, { reasoning_effort: "none" });
    // Without `resolve` (a hand-built client), the bare model maps nothing, as before.
    seen.length = 0;
    await runStm({ entries: [source], client: { model: bare, generate: client.generate } as never, maxTurns: 1, thinkingLevel: "none" });
    assert.equal(seen[0]?.options?.compat?.reasoning_effort, undefined);
  });

  it("worker_loop_still_fails_on_the_limits_by_default", async () => {
    // Exact-call workers (the LTM extractor, the wiki curator) keep the fail-closed contract.
    const tool: ToolDefinition = {
      name: "note",
      description: "note",
      parameters: { type: "object" },
      execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "note", value: { ok: true } }),
    };
    const run = (options: { maxToolCallsPerTurn?: number; maxToolCalls?: number }) =>
      runMemoryWorkerLoop({
        client: clientFor(
          provider([
            providerToolCall(toolCallContent("n1", "note", {})),
            providerToolCall(toolCallContent("n2", "note", {})),
            providerDone(),
          ]),
        ),
        system: "s",
        prompt: "p",
        tools: [tool],
        maxTurns: 1,
        ...options,
      });
    await assert.rejects(
      run({ maxToolCallsPerTurn: 1 }),
      (error: unknown) => error instanceof ObservationalMemoryLimitError && /tool calls per turn/.test(error.message),
    );
    await assert.rejects(
      run({ maxToolCalls: 1 }),
      (error: unknown) => error instanceof ObservationalMemoryLimitError && /total tool calls/.test(error.message),
    );
  });

  it("unknown_tool_call_is_refused_and_valid_calls_keep_their_effect", async () => {
    // Plan 218 Task 1.1: a garbled name (gate M-1: `record_rection`) is answered with an error result, not a failed pass.
    const executed: string[] = [];
    const tool: ToolDefinition = {
      name: "note",
      description: "note",
      parameters: { type: "object" },
      execute: (_args, context) => {
        executed.push(context.toolCallId);
        return { toolCallId: context.toolCallId, name: "note", value: { ok: true } };
      },
    };
    const requests: Message[][] = [];
    const secret = "sk-secret-0123456789";
    await runMemoryWorkerLoop({
      client: clientFor({
        id: "mock",
        async *generate(request: ProviderRequest) {
          requests.push([...request.messages]);
          if (requests.length === 1) {
            yield providerToolCall(toolCallContent("n1", "note", {}));
            yield providerToolCall(toolCallContent("u1", `not_${secret}_${"x".repeat(200)}`, {}));
          }
          yield providerDone();
        },
      }),
      system: "s",
      prompt: "p",
      tools: [tool],
      maxTurns: 2,
      maxErrorBytes: 64,
      secrets: [secret],
    });
    assert.deepEqual(executed, ["n1"], "the valid call ran and the unknown one did not");
    assert.equal(requests.length, 2, "the pass continued to a second turn");
    const results = requests[1]!.flatMap((message) => message.content).filter((part) => part.type === "tool_result");
    assert.equal(results.length, 2);
    const refused = results.find((part) => part.type === "tool_result" && part.toolCallId === "u1");
    assert.ok(refused && refused.type === "tool_result");
    assert.equal(refused.error?.code, MEMORY_WORKER_UNKNOWN_TOOL);
    assert.match(refused.error?.message ?? "", /is not a tool here; tools: note$/);
    const replayed = JSON.stringify(requests[1]);
    assert.ok(!replayed.includes(secret), "the unknown name is redacted");
    assert.ok(Buffer.byteLength(refused.name, "utf8") <= 64, "the unknown name is truncated");
  });

  it("unknown_tool_calls_count_toward_the_caps", async () => {
    let requests = 0;
    const client = clientFor({
      id: "mock",
      async *generate() {
        requests += 1;
        yield providerToolCall(toolCallContent(`u${requests}a`, "record_rection", {}));
        yield providerToolCall(toolCallContent(`u${requests}b`, "record_rection", {}));
        yield providerDone();
      },
    });
    const tools: ToolDefinition[] = [
      {
        name: "note",
        description: "note",
        parameters: { type: "object" },
        execute: (_a, c) => ({ toolCallId: c.toolCallId, name: "note" }),
      },
    ];
    await runMemoryWorkerLoop({ client, system: "s", prompt: "p", tools, maxTurns: 16, maxToolCalls: 4, onToolCallLimit: "refuse" });
    assert.equal(requests, 2, "a refusing worker ends at maxToolCalls");
    requests = 0;
    await assert.rejects(
      runMemoryWorkerLoop({ client, system: "s", prompt: "p", tools, maxTurns: 16, maxToolCalls: 4 }),
      (error: unknown) => error instanceof ObservationalMemoryLimitError && /total tool calls/.test(error.message),
    );
    assert.equal(requests, 3, "a fail-closed worker still fails past maxToolCalls");
  });

  it("all_unknown_turn_is_not_clean", async () => {
    let requests = 0;
    const recorded = await runStm({
      entries: [source],
      client: clientFor({
        id: "mock",
        async *generate() {
          requests += 1;
          if (requests === 1) yield providerToolCall(toolCallContent("u1", "record_evnt", {}));
          else
            yield providerToolCall(
              toolCallContent("c1", "record_event", {
                kind: "statement",
                description: "User wants package-only memory.",
                sourceEntryIds: ["m1"],
              }),
            );
          yield providerDone();
        },
      }),
      maxTurns: 4,
    });
    assert.equal(requests, 2, "the pass got another turn after the unknown call, then ended on the clean one");
    assert.equal(recorded.length, 1);
  });

  it("rejects limit failures with typed errors", async () => {
    // The tool-call limits are no longer failures for STM (plan 217 Task 6): see stm_refuses_calls_past_the_limits.
    await assert.rejects(
      runStm({
        entries: [source],
        client: clientFor(
          provider([
            providerToolCall(
              toolCallContent("c1", "record_event", { kind: "statement", description: "x".repeat(100), sourceEntryIds: ["m1"] }),
            ),
          ]),
        ),
        maxTurns: 1,
        maxArgumentBytes: 32,
      }),
      (error: unknown) =>
        error instanceof ObservationalMemoryLimitError && error.code === "limit" && /tool arguments exceeds/.test(error.message),
    );

    const hugeResult: ToolDefinition = {
      name: "store",
      execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "store", value: { text: "x".repeat(100) } }),
    };
    await assert.rejects(
      runMemoryWorkerLoop({
        client: clientFor(provider([providerToolCall(toolCallContent("c1", "store", {}))])),
        system: "s",
        prompt: "p",
        tools: [hugeResult],
        maxTurns: 1,
        maxResultBytes: 32,
      }),
      (error: unknown) =>
        error instanceof ObservationalMemoryLimitError && error.code === "limit" && /tool result exceeds/.test(error.message),
    );
    await assert.rejects(
      runMemoryWorkerLoop({
        client: clientFor(provider([providerDone()])),
        system: "s",
        prompt: "x".repeat(100),
        tools: [],
        maxTurns: 1,
        maxMessageBytes: 32,
      }),
      (error: unknown) => error instanceof ObservationalMemoryLimitError && error.code === "limit" && /worker message/.test(error.message),
    );
  });

  it("redacts bounded provider errors, tool failures, and replayed tool results", async () => {
    const secret = "worker-secret";
    const requests: ProviderRequest[] = [];
    let turn = 0;
    const memoryProvider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        if (turn++ === 0) yield providerToolCall(toolCallContent("c1", "store", {}));
        else yield providerDone();
      },
    };
    const tool: ToolDefinition = {
      name: "store",
      execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "store", value: { text: secret }, error: { message: secret } }),
    };
    await runMemoryWorkerLoop({
      client: clientFor(memoryProvider),
      system: "s",
      prompt: "p",
      tools: [tool],
      maxTurns: 2,
      secrets: [secret],
    });
    assert.equal(JSON.stringify(requests[1]?.messages).includes(secret), false);

    const throwing: ToolDefinition = {
      name: "throw",
      execute: () => {
        throw new Error(`${secret}-${"x".repeat(100)}`);
      },
    };
    await assert.rejects(
      runMemoryWorkerLoop({
        client: clientFor(provider([providerToolCall(toolCallContent("c1", "throw", {}))])),
        system: "s",
        prompt: "p",
        tools: [throwing],
        maxTurns: 1,
        maxErrorBytes: 16,
        secrets: [secret],
      }),
      (error: unknown) => error instanceof Error && !error.message.includes(secret) && Buffer.byteLength(error.message, "utf8") <= 16,
    );
    await assert.rejects(
      runMemoryWorkerLoop({
        client: clientFor({
          id: "bad",
          async *generate() {
            throw new Error(secret);
          },
        }),
        system: "s",
        prompt: "p",
        tools: [],
        maxTurns: 1,
        secrets: [secret],
      }),
      (error: unknown) => error instanceof Error && !error.message.includes(secret),
    );
  });

  it("observes abort before retaining provider output", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await assert.rejects(
      runStm({ entries: [source], client: clientFor(provider([providerDone()])), maxTurns: 1, signal: controller.signal }),
      /stop/,
    );
  });

  it("worker_transcript_replays_assistant_tool_call_before_tool_result", async () => {
    const requests: ProviderRequest[] = [];
    let turn = 0;
    const memoryProvider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        if (turn++ === 0) {
          yield providerTextDelta("Ignored worker text.");
          yield providerThinkingDelta("Ignored worker thinking.");
          yield providerToolCall(
            toolCallContent("c1", "record_event", {
              kind: "statement",
              description: "Package-only memory.",
              relevance: "high",
              sourceEntryIds: ["m1"],
            }),
          );
        }
        yield providerDone();
      },
    };

    // `endAfterCleanTurn: false` so the second request (the replayed transcript) is sent at all.
    const observations = await runStm({ entries: [source], client: clientFor(memoryProvider), maxTurns: 2, endAfterCleanTurn: false });

    assert.equal(observations.length, 1);
    const replay = requests[1]?.messages.slice(-2) as Message[] | undefined;
    assert.equal(replay?.[0]?.role, "assistant");
    assert.equal(replay?.[0]?.content[0]?.type, "tool_call");
    assert.equal(replay?.[1]?.role, "tool");
    assert.equal(replay?.[1]?.content[0]?.type, "tool_result");
    assert.equal((replay?.[1]?.content[0] as any)!.toolCallId, "c1");
    assert.equal(JSON.stringify(replay).includes("Ignored worker"), false);
  });

  it("stamps sessionId and cacheKey on worker generate", async () => {
    let request!: ProviderRequest;
    await runStm({
      entries: [source],
      client: clientFor({
        id: "mock",
        async *generate(input) {
          request = input;
          yield providerDone();
        },
      }),
      maxTurns: 1,
      sessionId: "om:s1",
    });
    assert.equal(request.options?.sessionId, "om:s1");
    assert.equal(request.options?.cacheKey, "om:s1");
  });

  it("host providerOptions.sessionId wins over worker sessionId", async () => {
    let request!: ProviderRequest;
    await runStm({
      entries: [source],
      client: clientFor({
        id: "mock",
        async *generate(input) {
          request = input;
          yield providerDone();
        },
      }),
      maxTurns: 1,
      sessionId: "om:s1",
      providerOptions: { sessionId: "custom" },
    });
    assert.equal(request.options?.sessionId, "custom");
    assert.equal(request.options?.cacheKey, "custom");
  });
});
