import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { AgentEvent, ErrorInfo, ModelProvider, ProviderEvent, ToolDefinition } from "../index.js";
import { createAgent } from "../index.js";
import { providerDone, providerTextDelta, providerToolCallDelta, providerUsage } from "../models/events.js";
import { createRoutedProvider, providerPackage } from "../provider-kit/index.js";
import { assertDroppedStreamRecovery } from "../testing/index.js";
import { failedRun } from "./run-result-helpers.js";

const RESET: ErrorInfo = { name: "TypeError", message: "socket reset", code: "ECONNRESET", failureClass: "transient" };

/** Attempt 1 streams `partial` then fails with `error`; later attempts answer "ok". */
function droppingProvider(partial: readonly ProviderEvent[], error: ErrorInfo = RESET) {
  const state = { calls: 0 };
  const provider: ModelProvider = {
    id: "mock",
    async *generate() {
      state.calls += 1;
      if (state.calls === 1) {
        yield* partial;
        yield { type: "error", error };
        return;
      }
      yield providerTextDelta("ok");
      yield providerDone({ inputTokens: 10, outputTokens: 1 });
    },
  };
  return { provider, state };
}

async function sessionWith(provider: ModelProvider, extra: Record<string, unknown> = {}) {
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [providerPackage("test-provider", [provider])],
    retry: { baseDelayMs: 0 },
    ...extra,
  });
  return agent.session();
}

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

/** The turn and message events, as a compact trace. */
function trace(events: readonly AgentEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.type === "turn.started") return [`turn.started#${event.attempt ?? 1}${event.retry ? "+retry" : ""}`];
    if (event.type === "turn.completed") return [event.error ? "turn.completed!error" : "turn.completed"];
    if (event.type === "message.delta") return [`delta:${event.content.type === "text" ? event.content.text : event.content.type}`];
    if (event.type === "message.completed") return ["message.completed"];
    return [];
  });
}

describe("mid-stream recovery (plan 227 Task 4)", () => {
  it("transient_drop_after_output_is_retried", async () => {
    for (const limits of [undefined, { maxOutputTokens: 10_000, bufferOutput: true }]) {
      const { provider, state } = droppingProvider([providerTextDelta("par"), providerTextDelta("tial")]);
      const session = await sessionWith(provider);
      const reader = collect(session.subscribe());
      const result = await session.run("Hi", limits ? { limits } : undefined);
      const events = await reader;
      assert.equal(result.status, "completed", JSON.stringify(result.error));
      assert.equal(result.text, "ok");
      assert.equal(state.calls, 2);
      // Live runs stream the failed attempt's deltas; `bufferOutput: true` holds and drops them (plan 228 Task 2).
      const failedDeltas = limits ? [] : ["delta:par", "delta:tial"];
      assert.deepEqual(trace(events), [
        "turn.started#1",
        ...failedDeltas,
        "turn.completed!error",
        "turn.started#2+retry",
        "delta:ok",
        "turn.completed",
        "message.completed",
      ]);
      const reopened = events.find((event) => event.type === "turn.started" && event.retry);
      assert.ok(reopened?.type === "turn.started");
      assert.equal(reopened.metadata.attempt, 2);
      assert.equal(reopened.retry?.error.code, "ECONNRESET");
      const turns = events
        .filter((event) => event.type === "turn.started" || event.type === "turn.completed")
        .map((event) => (event as { turn: number }).turn);
      assert.equal(new Set(turns).size, 1, "both attempts are the same turn");
    }
  });

  it("idle_timeout_after_output_is_retried", async () => {
    const encoder = new TextEncoder();
    const chunk = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
    const stop = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      const first = calls === 1;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(chunk(first ? "stalled" : "hello")));
          if (!first) {
            controller.enqueue(encoder.encode(stop));
            controller.close();
          }
        },
        pull: () => (first ? new Promise<void>(() => {}) : undefined),
      });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const provider = createRoutedProvider({
      id: "mock",
      baseUrl: "https://provider.test/v1",
      apiKey: async () => "sk-mid-stream-canary",
      fetch: fetchImpl,
      routes: { chat: { format: "openai-chat", path: "/chat/completions" } },
    });
    const session = await sessionWith(provider, { providerOptions: { timeouts: { idleMs: 30 } } });
    const result = await session.run("Hi");
    assert.equal(result.status, "completed", JSON.stringify(result.error));
    assert.equal(result.text, "hello");
    assert.equal(calls, 2);
  });

  it("failed_attempt_appends_nothing", async () => {
    const { provider } = droppingProvider([providerTextDelta("partial")]);
    const session = await sessionWith(provider);
    const result = await session.run("Hi");
    assert.equal(result.status, "completed");
    const assistant = result.messages.filter((message) => message.role === "assistant");
    assert.equal(assistant.length, 1);
    assert.doesNotMatch(JSON.stringify(result.messages), /partial/);
  });

  it("after_output_false_keeps_failure_final", async () => {
    const { provider, state } = droppingProvider([providerTextDelta("partial")]);
    const session = await sessionWith(provider, { retry: { baseDelayMs: 0, afterOutput: false } });
    const result = await failedRun(session.run("Hi"), /socket reset/);
    assert.equal(result.error?.failureClass, "transient");
    assert.equal(state.calls, 1);
  });

  it("permanent_failure_after_output_is_final", async () => {
    for (const error of [
      { message: "bad request", code: 400, failureClass: "permanent" },
      { message: "who are you", code: 401, failureClass: "auth" },
      { message: "odd", failureClass: "unknown" },
    ] satisfies ErrorInfo[]) {
      const { provider, state } = droppingProvider([providerTextDelta("partial")], error);
      const session = await sessionWith(provider);
      await failedRun(session.run("Hi"), new RegExp(error.message));
      assert.equal(state.calls, 1, error.message);
    }
  });

  it("partial_tool_call_from_failed_attempt_is_not_dispatched", async () => {
    let executed = 0;
    const danger: ToolDefinition = {
      name: "danger",
      execute: (_args, context) => {
        executed += 1;
        return { toolCallId: context.toolCallId, name: "danger", value: "ran" };
      },
    };
    const { provider, state } = droppingProvider([
      { type: "tool_call", call: { type: "tool_call", id: "call_1", name: "danger", arguments: { all: true } } },
      providerToolCallDelta({ index: 1, id: "call_2", name: "danger", argumentsText: '{"pa' }),
    ]);
    const session = await sessionWith(provider, { tools: { add: [danger] } });
    const reader = collect(session.subscribe());
    const result = await session.run("Hi");
    const events = await reader;
    assert.equal(result.status, "completed", JSON.stringify(result.error));
    assert.equal(state.calls, 2);
    assert.equal(executed, 0);
    assert.equal(
      events.some((event) => event.type === "tool.started"),
      false,
    );
  });

  it("retry_emits_one_turn_started_per_attempt", async () => {
    const { provider } = droppingProvider([]);
    const session = await sessionWith(provider);
    const reader = collect(session.subscribe());
    await session.run("Hi");
    const events = await reader;
    const started = events.filter((event) => event.type === "turn.started");
    const completed = events.filter((event) => event.type === "turn.completed");
    assert.equal(started.length, 2);
    assert.equal(started.length, completed.length);
    assert.deepEqual(
      started.map((event) => event.type === "turn.started" && [event.attempt, event.metadata.attempt, event.retry?.delayMs]),
      [
        [undefined, 1, undefined],
        [2, 2, 0],
      ],
    );
  });

  it("failed_attempt_with_retry_projects_no_usage_estimate", async () => {
    // No reported usage on the failed attempt: the retried attempt is not estimated, so the run's usage
    // is exactly the successful attempt's reported tokens.
    const { provider } = droppingProvider([providerTextDelta("partial")]);
    const session = await sessionWith(provider);
    const reader = collect(session.subscribe());
    const result = await session.run("Hi");
    const events = await reader;
    assert.equal(result.usage?.inputTokens, 10);
    assert.notEqual(result.usage?.estimated, true);
    const failed = events.find((event) => event.type === "turn.completed" && event.error);
    assert.ok(failed?.type === "turn.completed");
    assert.equal(failed.usage, undefined);

    // Usage the provider did report for the failed attempt is recorded once.
    const reported = droppingProvider([providerTextDelta("partial"), providerUsage({ inputTokens: 7, outputTokens: 2 })]);
    const second = await (await sessionWith(reported.provider)).run("Hi");
    assert.equal(second.usage?.inputTokens, 17);

    // A final failure keeps today's accounting: the estimate is projected.
    const final = droppingProvider([providerTextDelta("partial")]);
    const finalSession = await sessionWith(final.provider, { retry: { baseDelayMs: 0, afterOutput: false } });
    const finalReader = collect(finalSession.subscribe());
    await failedRun(finalSession.run("Hi"));
    const finalEvents = await finalReader;
    const finalFailed = finalEvents.find((event) => event.type === "turn.completed" && event.error);
    assert.ok(finalFailed?.type === "turn.completed");
    assert.equal(finalFailed.usage?.estimated, true);
  });

  it("loop_conformance_dropped_stream", async () => {
    await assertDroppedStreamRecovery({
      name: "default-like",
      async run(run) {
        for (;;) {
          const turn = await run.turn();
          if (turn.toolCalls.length === 0) return;
          await run.executeTools(turn.toolCalls);
        }
      },
    });
  });
});
