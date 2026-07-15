import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAgent, createMockProvider, createProviderTurnMetadata, createToolRegistry, dispatchToolCall, providerDone, providerTextDelta, readProviderHttpStatus } from "../index.js";
import type { AgentEvent, ProviderRequest } from "../index.js";

describe("observability helpers", () => {
  it("createProviderTurnMetadata reads requestId from metadata then sessionId", () => {
    const model = { provider: "mock", model: "demo" };
    const fromMetadata = createProviderTurnMetadata(
      { model, messages: [], metadata: { requestId: "req_meta" } },
      "mock",
      { attempt: 2, latencyMs: 10 },
    );
    assert.equal(fromMetadata.requestId, "req_meta");
    assert.equal(fromMetadata.attempt, 2);
    assert.equal(fromMetadata.latencyMs, 10);

    const fromSession = createProviderTurnMetadata(
      { model, messages: [], options: { sessionId: "sess_1" } } as ProviderRequest,
      "mock",
    );
    assert.equal(fromSession.requestId, "sess_1");
  });

  it("readProviderHttpStatus reads numeric error codes", () => {
    assert.equal(readProviderHttpStatus({ message: "rate limited", code: 429 }), 429);
    assert.equal(readProviderHttpStatus({ message: "bad" }), undefined);
  });
});

describe("provider turn agent events", () => {
  it("emits provider_turn_started and provider_turn_finished with metadata", async () => {
    const session = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerTextDelta("hi"), providerDone({ inputTokens: 1, outputTokens: 2 })]),
    }).createSession();

    const reader = (async () => {
      const events: AgentEvent[] = [];
      for await (const event of session.subscribe()) events.push(event);
      return events;
    })();
    await session.run("hello");
    const events = await reader;

    const started = events.find((event) => event.type === "provider_turn_started");
    const finished = events.find((event) => event.type === "provider_turn_finished");
    assert.ok(started?.type === "provider_turn_started");
    assert.ok(finished?.type === "provider_turn_finished");
    assert.equal(started.metadata.providerId, "mock");
    assert.equal(started.metadata.attempt, 1);
    assert.equal(typeof finished.metadata.latencyMs, "number");
    assert.deepEqual(finished.usage, { inputTokens: 1, outputTokens: 2 });
  });
});

describe("tool execution metadata", () => {
  it("includes durationMs and status on finished error and blocked events", async () => {
    const events: AgentEvent[] = [];
    const registry = createToolRegistry([
      {
        name: "echo",
        execute(_args, ctx) {
          return { toolCallId: ctx.toolCallId, name: "echo" };
        },
      },
      {
        name: "boom",
        execute() {
          throw new Error("fail");
        },
      },
    ]);
    const context = { sessionId: "s1", runId: "r1", toolCallId: "c1" };
    const emit = (event: AgentEvent) => {
      events.push(event);
    };

    await dispatchToolCall({
      call: { type: "tool_call", id: "c1", name: "echo", arguments: {} },
      registry,
      context,
      emit,
    });
    await dispatchToolCall({
      call: { type: "tool_call", id: "c2", name: "boom", arguments: {} },
      registry,
      context,
      emit,
    });
    await dispatchToolCall({
      call: { type: "tool_call", id: "c3", name: "missing", arguments: {} },
      registry,
      context,
      emit,
    });

    const finished = events.find((event) => event.type === "tool_execution_finished");
    const error = events.find((event) => event.type === "tool_execution_error");
    const blocked = events.find((event) => event.type === "tool_execution_blocked");
    assert.equal(finished?.metadata.status, "finished");
    assert.equal(error?.metadata.status, "error");
    assert.equal(blocked?.metadata.status, "blocked");
    assert.equal(typeof finished?.metadata.durationMs, "number");
    assert.equal(typeof error?.metadata.durationMs, "number");
    assert.equal(typeof blocked?.metadata.durationMs, "number");
  });
});
