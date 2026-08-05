import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventSchemas, EventType } from "@ag-ui/core";
import { createAgUiEventMapper } from "../index.js";
import {
  composeAgUiProjections,
  createActivityFromToolProgressProjection,
  createMessagesFromSessionProjection,
  createStateFromStoreProjection,
  jsonDiff,
} from "../projectors.js";

describe("standard AG-UI projectors", () => {
  it("messagesFromSession emits MESSAGES_SNAPSHOT from host getMessages with redaction", () => {
    const projection = createMessagesFromSessionProjection({
      getMessages: () => [
        { id: "u1", role: "user", content: "hello secret" },
        { id: "a1", role: "assistant", content: "hi" },
      ],
      redact: (message) => {
        if (message.role === "user" && typeof message.content === "string" && message.content.includes("secret")) {
          return { id: message.id, role: "user", content: message.content.replace("secret", "[redacted]") };
        }
        return message;
      },
    });
    const mapper = createAgUiEventMapper({ projection });
    const events = mapper.map({ type: "agent_started", sessionId: "s1", runId: "r1" });
    const snap = events.find((event) => event.type === EventType.MESSAGES_SNAPSHOT);
    assert.ok(snap);
    assert.equal(EventSchemas.safeParse(snap).success, true);
    assert.deepEqual(
      (snap as { messages: { content: string }[] }).messages.map((m) => m.content),
      ["hello [redacted]", "hi"],
    );
    // unchanged transcript → no second snapshot
    assert.equal(
      mapper.map({ type: "turn_started", sessionId: "s1", runId: "r1", turn: 1 }).some((e) => e.type === EventType.MESSAGES_SNAPSHOT),
      false,
    );
  });

  it("messagesFromSession accumulates live message_finished when getMessages absent", () => {
    const mapper = createAgUiEventMapper({ projection: createMessagesFromSessionProjection() });
    mapper.map({ type: "agent_started", sessionId: "s1", runId: "r1" });
    const events = mapper.map({
      type: "message_finished",
      sessionId: "s1",
      runId: "r1",
      message: { id: "m1", role: "assistant", content: [{ type: "text", text: "done" }] },
    });
    const snap = events.find((event) => event.type === EventType.MESSAGES_SNAPSHOT);
    assert.ok(snap);
    assert.equal(EventSchemas.safeParse(snap).success, true);
    assert.equal((snap as { messages: { id: string }[] }).messages[0]?.id, "m1");
  });

  it("stateFromStore snapshots on start and emits minimal RFC 6902 deltas", () => {
    let state: Record<string, unknown> = { stage: "init", count: 0 };
    const listeners = new Set<() => void>();
    const store = {
      get: () => state,
      subscribe: (onChange: () => void) => {
        listeners.add(onChange);
        return () => listeners.delete(onChange);
      },
    };
    const mapper = createAgUiEventMapper({
      projection: createStateFromStoreProjection(store),
    });
    const start = mapper.map({ type: "agent_started", sessionId: "s1", runId: "r1" });
    const snapshot = start.find((event) => event.type === EventType.STATE_SNAPSHOT);
    assert.ok(snapshot);
    assert.equal(EventSchemas.safeParse(snapshot).success, true);
    assert.deepEqual((snapshot as { snapshot: unknown }).snapshot, { stage: "init", count: 0 });

    state = { stage: "running", count: 0 };
    for (const listener of listeners) listener();
    const deltaEvents = mapper.map({ type: "turn_started", sessionId: "s1", runId: "r1", turn: 1 });
    const delta = deltaEvents.find((event) => event.type === EventType.STATE_DELTA);
    assert.ok(delta);
    assert.equal(EventSchemas.safeParse(delta).success, true);
    assert.deepEqual((delta as { delta: unknown[] }).delta, [{ op: "replace", path: "/stage", value: "running" }]);
  });

  it("stateFromStore drops closed on throw or oversized state", () => {
    const throwing = createAgUiEventMapper({
      projection: createStateFromStoreProjection({
        get: () => {
          throw new Error("boom");
        },
      }),
    });
    assert.equal(
      throwing.map({ type: "agent_started", sessionId: "s1", runId: "r1" }).some((e) => e.type === EventType.STATE_SNAPSHOT),
      false,
    );

    const oversized = createAgUiEventMapper({
      projection: createStateFromStoreProjection({ get: () => ({ blob: "x".repeat(200) }) }, { maxStateBytes: 32 }),
    });
    assert.equal(
      oversized.map({ type: "agent_started", sessionId: "s1", runId: "r1" }).some((e) => e.type === EventType.STATE_SNAPSHOT),
      false,
    );
  });

  it("activityFromToolProgress emits snapshot then delta; missing progress drops", () => {
    const mapper = createAgUiEventMapper({ projection: createActivityFromToolProgressProjection() });
    mapper.map({ type: "agent_started", sessionId: "s1", runId: "r1" });
    const first = mapper.map({
      type: "tool_execution_progress",
      sessionId: "s1",
      runId: "r1",
      toolCallId: "t1",
      name: "read",
      progress: { pct: 10 },
    });
    const snap = first.find((event) => event.type === EventType.ACTIVITY_SNAPSHOT);
    assert.ok(snap);
    assert.equal(EventSchemas.safeParse(snap).success, true);
    assert.equal((snap as { activityType: string }).activityType, "tool-progress");

    const second = mapper.map({
      type: "tool_execution_progress",
      sessionId: "s1",
      runId: "r1",
      toolCallId: "t1",
      name: "read",
      progress: { pct: 90 },
    });
    const delta = second.find((event) => event.type === EventType.ACTIVITY_DELTA);
    assert.ok(delta);
    assert.equal(EventSchemas.safeParse(delta).success, true);

    const empty = mapper.map({
      type: "tool_execution_progress",
      sessionId: "s1",
      runId: "r1",
      toolCallId: "t2",
      name: "read",
    });
    assert.equal(
      empty.some((e) => e.type === EventType.ACTIVITY_SNAPSHOT || e.type === EventType.ACTIVITY_DELTA),
      false,
    );
  });

  it("composeAgUiProjections: first defined callback wins", () => {
    const composed = composeAgUiProjections(
      createMessagesFromSessionProjection({ getMessages: () => [{ id: "first", role: "user", content: "a" }] }),
      { messages: () => [{ id: "second", role: "user", content: "b" }] },
      undefined,
      { toolResult: () => "host-wins" },
    );
    assert.equal(composed.toolResult?.({ toolCallId: "t", name: "x", value: 1 }), "host-wins");
    const mapper = createAgUiEventMapper({ projection: composed });
    const snap = mapper
      .map({ type: "agent_started", sessionId: "s1", runId: "r1" })
      .find((event) => event.type === EventType.MESSAGES_SNAPSHOT) as { messages: { id: string }[] };
    assert.equal(snap.messages[0]?.id, "first");
  });

  it("jsonDiff emits add/replace/remove only", () => {
    assert.deepEqual(jsonDiff({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 }), [
      { op: "replace", path: "/b", value: 3 },
      { op: "add", path: "/c", value: 4 },
    ]);
    assert.deepEqual(jsonDiff({ a: 1, b: 2 }, { a: 1 }), [{ op: "remove", path: "/b" }]);
  });

  it("default mapper stays inert without opt-in projectors", () => {
    const mapper = createAgUiEventMapper();
    const events = [
      ...mapper.map({ type: "agent_started", sessionId: "s1", runId: "r1" }),
      ...mapper.map({
        type: "tool_execution_progress",
        sessionId: "s1",
        runId: "r1",
        toolCallId: "t1",
        name: "read",
        progress: { pct: 1 },
      }),
    ];
    assert.equal(
      events.some(
        (e) => e.type === EventType.MESSAGES_SNAPSHOT || e.type === EventType.STATE_SNAPSHOT || e.type === EventType.ACTIVITY_SNAPSHOT,
      ),
      false,
    );
  });
});
