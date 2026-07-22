import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventSchemas, EventType } from "@ag-ui/core";
import { createSecretRedactor, type AgentEvent } from "@arnilo/prism";
import { createAgUiEventMapper, resolveAgUiLimits, packageName } from "../index.js";

describe("@arnilo/prism-ag-ui", () => {
  it("maps a redacted message, safe tool lifecycle, usage, and finish through official schemas", () => {
    const mapper = createAgUiEventMapper({
      redactor: createSecretRedactor(["secret", "/host/workspace"]),
      includeCustomEvents: true,
      projection: {
        toolArguments: () => "safe args",
        toolResult: () => "safe result",
        state: () => ({ safe: true }),
      },
    });
    const events = [
      ...mapper.map({ type: "agent_started", sessionId: "thread-1", runId: "run-1" }),
      ...mapper.map({ type: "message_started", sessionId: "thread-1", runId: "run-1", message: { id: "message-1", role: "assistant", content: [] } }),
      ...mapper.map({ type: "message_delta", sessionId: "thread-1", runId: "run-1", content: { type: "text", text: "hello secret" } }),
      ...mapper.map({ type: "message_finished", sessionId: "thread-1", runId: "run-1", message: { id: "message-1", role: "assistant", content: [] } }),
      ...mapper.map({ type: "tool_execution_started", sessionId: "thread-1", runId: "run-1", call: { type: "tool_call", id: "tool-1", name: "read", arguments: { path: "/host/workspace/secret" } } }),
      ...mapper.map({ type: "tool_execution_progress", sessionId: "thread-1", runId: "run-1", toolCallId: "tool-1", name: "read", progress: { path: "/host/workspace" } }),
      ...mapper.map({ type: "tool_execution_finished", sessionId: "thread-1", runId: "run-1", result: { toolCallId: "tool-1", name: "read", value: "secret" }, metadata: { durationMs: 1, status: "finished" } }),
      ...mapper.map({ type: "provider_turn_finished", sessionId: "thread-1", runId: "run-1", turn: 1, metadata: { providerId: "fake", model: { provider: "fake", model: "fake" } }, usage: { inputTokens: 3, outputTokens: 5 } }),
      ...mapper.map({ type: "agent_finished", sessionId: "thread-1", runId: "run-1" }),
    ];

    for (const event of events) assert.equal(EventSchemas.safeParse(event).success, true);
    assert.deepEqual(events.map((event) => event.type), [
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.CUSTOM,
      EventType.TOOL_CALL_RESULT,
      EventType.TOOL_CALL_END,
      EventType.CUSTOM,
      EventType.RUN_FINISHED,
    ]);
    const output = JSON.stringify(events);
    assert.ok(!output.includes("secret"));
    assert.ok(!output.includes("/host/workspace"));
    assert.equal(events.at(-1)?.type, EventType.RUN_FINISHED);
  });

  it("closes active sequences before suspension/error and never maps unknown events", () => {
    const mapper = createAgUiEventMapper();
    mapper.map({ type: "agent_started", sessionId: "session-1", runId: "run-1" });
    mapper.map({ type: "message_started", sessionId: "session-1", runId: "run-1", message: { role: "assistant", content: [] } });
    const suspended = mapper.map({
      type: "agent_suspended",
      sessionId: "session-1",
      runId: "run-1",
      version: 3,
      interruption: { kind: "tool_approval", reason: "approval required", toolCallId: "tool-1", toolName: "shell" },
    });
    assert.deepEqual(suspended.map((event) => event.type), [EventType.TEXT_MESSAGE_END, EventType.STATE_SNAPSHOT]);
    assert.deepEqual((suspended.at(-1) as { snapshot: unknown }).snapshot, { prism: { run: { status: "suspended", version: 3 } } });

    const failed = createAgUiEventMapper();
    failed.map({ type: "message_started", sessionId: "session-1", runId: "run-1", message: { role: "assistant", content: [] } });
    const error = failed.map({ type: "error", sessionId: "session-1", runId: "run-1", error: { message: "secret failure", code: "E_FAIL" } });
    assert.deepEqual(error.map((event) => event.type), [EventType.TEXT_MESSAGE_END, EventType.RUN_ERROR]);
    assert.deepEqual(failed.map({ type: "future" } as unknown as AgentEvent), []);
  });

  it("enforces finite limits and truncates oversized text before schema output", () => {
    assert.equal(packageName, "@arnilo/prism-ag-ui");
    assert.throws(() => resolveAgUiLimits({ maxEventBytes: 1_000 }), /maxEventBytes/);
    assert.throws(() => resolveAgUiLimits({ maxErrorBytes: 65_537 }), /maxErrorBytes/);
    const mapper = createAgUiEventMapper();
    const events = mapper.map({ type: "message_delta", sessionId: "session-1", runId: "run-1", content: { type: "text", text: "x".repeat(100_000) } });
    assert.equal(events[1]?.type, EventType.TEXT_MESSAGE_CONTENT);
    assert.ok(Buffer.byteLength(JSON.stringify(events[1]), "utf8") <= 64 * 1024);
  });
});
