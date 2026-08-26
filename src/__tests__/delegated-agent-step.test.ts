import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgentEventRecord,
  createDelegatedAgentStep,
  createMemoryAgentEventSource,
  createSecretRedactor,
  DelegatedAgentStepError,
  MAX_DELEGATED_AGENT_EVENT_BYTES,
  redactAgentEvent,
} from "../index.js";

describe("delegated agent step", () => {
  it("normalizes unknown kinds and drops raw untrusted fields", () => {
    const event = createDelegatedAgentStep({
      sessionId: "session-1",
      runId: "run-1",
      adapterId: "antigravity-cli",
      externalConversationId: "conversation-1",
      stepIndex: 4,
      state: "done",
      kind: "new-google-private-step",
      toolName: "prism:edit",
      detail: { referenceId: "opaque-1", label: "edit" },
      usage: { inputTokens: 100, outputTokens: 20, thinkingTokens: 4, totalTokens: 124 },
      ...({ arguments: { path: "/secret" }, result: "raw" } as Record<string, unknown>),
    } as never);

    assert.equal(event.type, "delegated_agent_step");
    assert.equal(event.kind, "unknown");
    assert.equal("arguments" in event, false);
    assert.equal("result" in event, false);
    assert.deepEqual(event.usage, { inputTokens: 100, outputTokens: 20, thinkingTokens: 4, totalTokens: 124 });
  });

  it("bounds identifiers, counters, and serialized event size", () => {
    assert.throws(
      () =>
        createDelegatedAgentStep({
          sessionId: "s",
          runId: "r",
          adapterId: "a",
          externalConversationId: "x".repeat(MAX_DELEGATED_AGENT_EVENT_BYTES),
          stepIndex: 0,
          state: "active",
          kind: "tool",
        }),
      DelegatedAgentStepError,
    );
    assert.throws(
      () =>
        createDelegatedAgentStep({
          sessionId: "s",
          runId: "r",
          adapterId: "a",
          externalConversationId: "c",
          stepIndex: 1_000_001,
          state: "active",
          kind: "tool",
        }),
      DelegatedAgentStepError,
    );
    assert.throws(
      () =>
        createDelegatedAgentStep({
          sessionId: "s",
          runId: "r",
          adapterId: "a",
          externalConversationId: "c",
          stepIndex: 0,
          state: "active",
          kind: "tool",
          detail: { referenceId: "/tmp/private-log" },
        }),
      DelegatedAgentStepError,
    );
  });

  it("redacts and persists through the existing event source", async () => {
    const source = createMemoryAgentEventSource();
    const raw = createDelegatedAgentStep({
      sessionId: "session-1",
      runId: "run-1",
      adapterId: "antigravity-cli",
      externalConversationId: "conversation-1",
      stepIndex: 0,
      state: "done",
      kind: "assistant",
      toolName: "secret-tool",
    });
    const event = redactAgentEvent(raw, createSecretRedactor(["secret"]));
    const record: AgentEventRecord = {
      id: "event-1",
      tenantId: "tenant-1",
      sessionId: "session-1",
      runId: "run-1",
      type: event.type,
      timestamp: "2026-08-20T00:00:00.000Z",
      event,
      redacted: true,
    };
    await source.append(record);
    const page = await source.page({ ownership: { tenantId: "tenant-1" }, sessionId: "session-1", runId: "run-1", limit: 10 });
    assert.equal(page.items.length, 1);
    const stored = page.items[0]?.record.event;
    assert.equal(stored?.type, "delegated_agent_step");
    if (stored?.type === "delegated_agent_step") assert.equal(stored.toolName, "[REDACTED]-tool");
  });
});
