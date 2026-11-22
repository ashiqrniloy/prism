import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { EventType } from "@ag-ui/core";
import { EventSchemas } from "@ag-ui/core/schemas";
import { type AgentEvent, createSecretRedactor } from "@arnilo/prism";
import { createAgUiEventMapper, packageName, resolveAgUiLimits } from "../index.js";

describe("@arnilo/prism-hosts/ag-ui", () => {
  it("maps a redacted message, safe tool lifecycle, usage, and finish through official schemas", async () => {
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
      ...(await mapper.map({ type: "run.started", sessionId: "thread-1", runId: "run-1" })),
      ...(await mapper.map({
        type: "message.delta",
        sessionId: "thread-1",
        runId: "run-1",
        content: { type: "text", text: "hello secret" },
      })),
      ...(await mapper.map({
        type: "message.completed",
        sessionId: "thread-1",
        runId: "run-1",
        message: { id: "message-1", role: "assistant", content: [] },
      })),
      ...(await mapper.map({
        type: "tool.started",
        sessionId: "thread-1",
        runId: "run-1",
        call: { type: "tool_call", id: "tool-1", name: "read", arguments: { path: "/host/workspace/secret" } },
      })),
      ...(await mapper.map({
        type: "tool.progress",
        sessionId: "thread-1",
        runId: "run-1",
        toolCallId: "tool-1",
        name: "read",
        progress: { path: "/host/workspace" },
      })),
      ...(await mapper.map({
        type: "tool.completed",
        status: "finished",
        sessionId: "thread-1",
        runId: "run-1",
        result: { toolCallId: "tool-1", name: "read", value: "secret" },
        metadata: { durationMs: 1, status: "finished" },
      })),
      ...(await mapper.map({
        type: "turn.completed",
        sessionId: "thread-1",
        runId: "run-1",
        turn: 1,
        metadata: { providerId: "fake", model: { provider: "fake", model: "fake" } },
        usage: { inputTokens: 3, outputTokens: 5 },
      })),
      ...(await mapper.map({ type: "run.completed", sessionId: "thread-1", runId: "run-1", status: "completed" })),
    ];

    for (const event of events) assert.equal(EventSchemas.safeParse(event).success, true);
    assert.deepEqual(
      events.map((event) => event.type),
      [
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
      ],
    );
    const output = JSON.stringify(events);
    assert.ok(!output.includes("secret"));
    assert.ok(!output.includes("/host/workspace"));
    assert.equal(events.at(-1)?.type, EventType.RUN_FINISHED);
  });

  it("closes active sequences before suspension/error and never maps unknown events", async () => {
    const mapper = createAgUiEventMapper();
    await mapper.map({ type: "run.started", sessionId: "session-1", runId: "run-1" });
    await mapper.map({ type: "message.delta", sessionId: "session-1", runId: "run-1", content: { type: "text", text: "hi" } });
    const suspended = await mapper.map({
      type: "run.suspended",
      sessionId: "session-1",
      runId: "run-1",
      version: 3,
      interruption: { kind: "tool_approval", reason: "approval required", toolCallId: "tool-1", toolName: "shell" },
    });
    assert.deepEqual(
      suspended.map((event) => event.type),
      [EventType.TEXT_MESSAGE_END, EventType.STATE_SNAPSHOT],
    );
    assert.deepEqual((suspended.at(-1) as { snapshot: unknown }).snapshot, { prism: { run: { status: "suspended", version: 3 } } });

    const failed = createAgUiEventMapper();
    await failed.map({ type: "message.delta", sessionId: "session-1", runId: "run-1", content: { type: "text", text: "hi" } });
    const error = await failed.map({
      type: "run.failed",
      sessionId: "session-1",
      runId: "run-1",
      error: { message: "secret failure", code: "E_FAIL" },
    });
    assert.deepEqual(
      error.map((event) => event.type),
      [EventType.TEXT_MESSAGE_END, EventType.RUN_ERROR],
    );
    assert.deepEqual(await failed.map({ type: "future" } as unknown as AgentEvent), []);
  });

  it("ag_ui_mapper_discards_failed_attempt_text", async () => {
    // Plan 227 Task 4: a failed attempt ends its message and is not the run's end; the retry names
    // the message to drop, and the retried attempt's text opens a new one.
    const mapper = createAgUiEventMapper({ includeCustomEvents: true });
    const metadata = { providerId: "mock", model: { provider: "mock", model: "demo" } };
    const base = { sessionId: "s1", runId: "r1" } as const;
    const events = [
      ...(await mapper.map({ type: "run.started", ...base })),
      ...(await mapper.map({ type: "turn.started", ...base, turn: 1, metadata: { ...metadata, attempt: 1 } })),
      ...(await mapper.map({ type: "message.delta", ...base, content: { type: "text", text: "partial" } })),
      ...(await mapper.map({
        type: "turn.completed",
        ...base,
        turn: 1,
        metadata,
        error: { message: "socket reset", code: "ECONNRESET", failureClass: "transient" },
      })),
      ...(await mapper.map({
        type: "turn.started",
        ...base,
        turn: 1,
        attempt: 2,
        metadata: { ...metadata, attempt: 2 },
        retry: { delayMs: 0, error: { message: "socket reset", code: "ECONNRESET", failureClass: "transient" } },
      })),
      ...(await mapper.map({ type: "message.delta", ...base, content: { type: "text", text: "ok" } })),
      ...(await mapper.map({ type: "message.completed", ...base, message: { id: "m1", role: "assistant", content: [] } })),
      ...(await mapper.map({ type: "turn.completed", ...base, turn: 1, metadata })),
      ...(await mapper.map({ type: "run.completed", ...base, status: "completed" })),
    ];
    for (const mapped of events) assert.equal(EventSchemas.safeParse(mapped).success, true);
    assert.equal(
      events.some((event) => event.type === EventType.RUN_ERROR),
      false,
      "a retried attempt is not a run error",
    );
    assert.equal(events.at(-1)?.type, EventType.RUN_FINISHED);
    const starts = events.filter((event) => event.type === EventType.TEXT_MESSAGE_START) as { messageId: string }[];
    assert.equal(starts.length, 2);
    const ends = events.filter((event) => event.type === EventType.TEXT_MESSAGE_END) as { messageId: string }[];
    assert.deepEqual(
      ends.map((event) => event.messageId),
      starts.map((event) => event.messageId),
    );
    const retry = events.find((event) => event.type === EventType.CUSTOM && (event as { name: string }).name === "prism.retry") as
      | { value: { attempt: number; discardMessageIds: string[] } }
      | undefined;
    assert.ok(retry);
    assert.equal(retry.value.attempt, 2);
    assert.deepEqual(retry.value.discardMessageIds, [starts[0]?.messageId]);
    const content = events.filter((event) => event.type === EventType.TEXT_MESSAGE_CONTENT) as { messageId: string; delta: string }[];
    assert.deepEqual(
      content.map((event) => [event.messageId === starts[1]?.messageId, event.delta]),
      [
        [false, "partial"],
        [true, "ok"],
      ],
    );

    // A final failure still ends the run with one RUN_ERROR, from `run.failed`.
    const failed = createAgUiEventMapper();
    await failed.map({ type: "run.started", ...base });
    const settled = [
      ...(await failed.map({ type: "turn.completed", ...base, turn: 1, metadata, error: { message: "bad", code: 400 } })),
      ...(await failed.map({ type: "run.failed", ...base, error: { message: "bad", code: 400 } })),
    ];
    assert.deepEqual(settled.filter((event) => event.type === EventType.RUN_ERROR).length, 1);
  });

  it("maps every current standard event family through explicit host projections", async () => {
    const mapper = createAgUiEventMapper({
      projection: {
        stateSnapshot: () => ({ stage: "snapshot" }),
        stateDelta: () => [{ op: "add", path: "/stage", value: "delta" }],
        messages: () => [{ id: "snapshot-user", role: "user", content: "safe" }],
        activity: (event) =>
          event.type === "turn.started"
            ? { type: "snapshot", messageId: "activity-1", activityType: "turn", content: { status: "started" } }
            : event.type === "turn.completed"
              ? {
                  type: "delta",
                  messageId: "activity-1",
                  activityType: "turn",
                  patch: [{ op: "replace", path: "/status", value: "finished" }],
                }
              : undefined,
        reasoning: ({ text }) => ({ text: `summary:${text}`, encryptedValue: "host-encrypted" }),
        raw: (event) => ({ event: { type: event.type }, source: "prism" }),
        custom: (event) => ({ name: "host.event", value: { type: event.type } }),
      },
    });
    const events = [
      ...(await mapper.map({ type: "run.started", sessionId: "s1", runId: "r1" })),
      ...(await mapper.map({
        type: "turn.started",
        sessionId: "s1",
        runId: "r1",
        turn: 1,
        metadata: { providerId: "mock", model: { provider: "mock", model: "demo" } },
      })),
      ...(await mapper.map({ type: "message.delta", sessionId: "s1", runId: "r1", content: { type: "thinking", text: "safe" } })),
      ...(await mapper.map({ type: "message.delta", sessionId: "s1", runId: "r1", content: { type: "text", text: "answer" } })),
      ...(await mapper.map({
        type: "message.completed",
        sessionId: "s1",
        runId: "r1",
        message: { id: "m1", role: "assistant", content: [] },
      })),
      ...(await mapper.map({
        type: "turn.completed",
        sessionId: "s1",
        runId: "r1",
        turn: 1,
        metadata: { providerId: "mock", model: { provider: "mock", model: "demo" } },
      })),
      ...(await mapper.map({ type: "run.completed", sessionId: "s1", runId: "r1", status: "completed" })),
    ];
    for (const mapped of events) assert.equal(EventSchemas.safeParse(mapped).success, true);
    for (const type of [
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
      EventType.STEP_STARTED,
      EventType.STEP_FINISHED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.STATE_SNAPSHOT,
      EventType.STATE_DELTA,
      EventType.MESSAGES_SNAPSHOT,
      EventType.ACTIVITY_SNAPSHOT,
      EventType.ACTIVITY_DELTA,
      EventType.REASONING_START,
      EventType.REASONING_MESSAGE_START,
      EventType.REASONING_MESSAGE_CONTENT,
      EventType.REASONING_MESSAGE_END,
      EventType.REASONING_END,
      EventType.REASONING_ENCRYPTED_VALUE,
      EventType.RAW,
      EventType.CUSTOM,
    ]) {
      assert.ok(
        events.some((event) => event.type === type),
        `missing ${type}`,
      );
    }
  });

  it("projects delegated steps to bounded activity/custom metadata without transcript or raw details", async () => {
    const mapper = createAgUiEventMapper({ includeCustomEvents: true });
    const event = {
      type: "package.event" as const,
      sessionId: "session-1",
      runId: "run-1",
      package: "kernel",
      name: "agent.step",
      data: {
        adapterId: "delegated-cli",
        externalConversationId: "conversation-1",
        stepIndex: 4,
        state: "done",
        kind: "tool",
        toolName: "prism:edit",
        durationMs: 70,
        usage: { inputTokens: 100, outputTokens: 20, thinkingTokens: 4, totalTokens: 124 },
        detail: { referenceId: "opaque-1", label: "safe" },
      },
    };
    const mapped = await mapper.map(event);
    assert.deepEqual(
      mapped.map((item) => item.type),
      [EventType.ACTIVITY_SNAPSHOT, EventType.CUSTOM],
    );
    const activity = mapped[0] as { content: Record<string, unknown> };
    assert.equal(activity.content.kind, "tool");
    assert.deepEqual(activity.content.usage, { inputTokens: 100, outputTokens: 20, thinkingTokens: 4, totalTokens: 124 });
    assert.equal(JSON.stringify(mapped).includes("arguments"), false);
    assert.equal(JSON.stringify(mapped).includes("result"), false);
    assert.equal(EventSchemas.safeParse(mapped[0]).success, true);
    assert.equal(EventSchemas.safeParse(mapped[1]).success, true);
  });

  it("enforces finite limits and truncates oversized text before schema output", async () => {
    assert.equal(packageName, "@arnilo/prism-hosts/ag-ui");
    assert.throws(() => resolveAgUiLimits({ maxEventBytes: 1_000 }), /maxEventBytes/);
    assert.equal(resolveAgUiLimits({ maxErrorBytes: 65_537 }).maxErrorBytes, 65_537);
    const mapper = createAgUiEventMapper();
    const events = await mapper.map({
      type: "message.delta",
      sessionId: "session-1",
      runId: "run-1",
      content: { type: "text", text: "x".repeat(100_000) },
    });
    assert.equal(events[1]?.type, EventType.TEXT_MESSAGE_CONTENT);
    assert.ok(Buffer.byteLength(JSON.stringify(events[1]), "utf8") <= 64 * 1024);
  });
});
