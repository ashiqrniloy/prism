import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventType } from "@ag-ui/core";
import { createSecretRedactor, toolCallContent } from "@arnilo/prism";
import { createAcpEventMapper } from "../acp/index.js";
import { createAgUiEventMapper } from "../index.js";
import { composeAgUiProjections, createMessagesFromSessionProjection } from "../projectors.js";

/** entries()-shaped async transcript source (AgentSession.entries() is async). */
const asyncEntries = (messages: { id: string; role: "user" | "assistant"; text: string }[]) => async () =>
  messages.map((message) => ({ id: message.id, role: message.role, content: message.text }));

const agentStarted = { type: "agent_started" as const, sessionId: "s1", runId: "r1" };

const snapshotOf = (events: readonly unknown[]) =>
  events.find((event) => (event as { type?: string }).type === EventType.MESSAGES_SNAPSHOT) as { messages: { id: string }[] } | undefined;

describe("async AgUiProjection hooks (Task 15)", () => {
  it("emits MESSAGES_SNAPSHOT from an async getMessages at agent_started and message_finished", async () => {
    const entries: { id: string; role: "user" | "assistant"; text: string }[] = [{ id: "u1", role: "user", text: "hi" }];
    const projection = createMessagesFromSessionProjection({
      getMessages: async () => entries.map((e) => ({ id: e.id, role: e.role, content: e.text })),
    });
    const mapper = createAgUiEventMapper({ projection });
    const started = snapshotOf(await mapper.map(agentStarted));
    assert.deepEqual(
      started?.messages.map((m) => m.id),
      ["u1"],
    );
    entries.push({ id: "a1", role: "assistant", text: "done" });
    const refreshed = snapshotOf(
      await mapper.map({
        type: "message_finished",
        sessionId: "s1",
        runId: "r1",
        message: { id: "a1", role: "assistant", content: [{ type: "text", text: "done" }] },
      }),
    );
    assert.deepEqual(
      refreshed?.messages.map((m) => m.id),
      ["u1", "a1"],
    );
  });

  it("async getMessages rejection drops the snapshot closed and the stream continues", async () => {
    const projection = createMessagesFromSessionProjection({
      getMessages: async () => {
        throw new Error("entries unavailable");
      },
    });
    const mapper = createAgUiEventMapper({ projection });
    const started = await mapper.map(agentStarted);
    assert.equal(snapshotOf(started), undefined);
    const later = await mapper.map({
      type: "message_delta",
      sessionId: "s1",
      runId: "r1",
      content: { type: "text", text: "still streaming" },
    });
    assert.ok(later.some((event) => event.type === EventType.TEXT_MESSAGE_CONTENT));
  });

  it("mixed sync/async composed hooks resolve in order with first-wins semantics", async () => {
    const sync = { toolArguments: () => "sync-args" };
    const asyncProjection = {
      toolArguments: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return "async-args";
      },
    };
    const composed = composeAgUiProjections(sync, asyncProjection);
    const mapper = createAgUiEventMapper({ projection: composed });
    const call = toolCallContent("t1", "read", { path: "/x" });
    const events = await mapper.map({
      type: "tool_execution_started",
      sessionId: "s1",
      runId: "r1",
      call,
    });
    const args = events.find((event) => event.type === EventType.TOOL_CALL_ARGS);
    assert.equal((args as { delta: string } | undefined)?.delta, "sync-args", "first defined callback wins");

    const composedAsyncFirst = composeAgUiProjections(asyncProjection, sync);
    const mapper2 = createAgUiEventMapper({ projection: composedAsyncFirst });
    const events2 = await mapper2.map({
      type: "tool_execution_started",
      sessionId: "s1",
      runId: "r1",
      call,
    });
    const args2 = events2.find((event) => event.type === EventType.TOOL_CALL_ARGS);
    assert.equal((args2 as { delta: string } | undefined)?.delta, "async-args");
  });

  it("hooks are awaited in event order, never Promise.all: a slow hook does not reorder later events", async () => {
    const order: string[] = [];
    const slow = {
      toolArguments: async () => {
        order.push("tool-arguments-started");
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push("tool-arguments-done");
        return "slow-args";
      },
    };
    const mapper = createAgUiEventMapper({ projection: slow });
    const call = toolCallContent("t1", "read", { path: "/x" });
    await mapper.map({ type: "tool_execution_started", sessionId: "s1", runId: "r1", call });
    const next = await mapper.map({
      type: "message_delta",
      sessionId: "s1",
      runId: "r1",
      content: { type: "text", text: "after" },
    });
    assert.ok(next.some((event) => event.type === EventType.TEXT_MESSAGE_CONTENT));
    // The text delta was mapped only after the slow hook resolved (in-order awaits).
    assert.deepEqual(order, ["tool-arguments-started", "tool-arguments-done"]);
  });

  it("async hook rejection is fail-closed per event: later events still map", async () => {
    const flaky = {
      stateSnapshot: async () => {
        throw new Error("boom");
      },
      messages: async () => [{ id: "a1", role: "assistant" as const, content: "ok" }],
    };
    const mapper = createAgUiEventMapper({ projection: flaky });
    const started = await mapper.map(agentStarted);
    assert.equal(
      started.some((event) => event.type === EventType.STATE_SNAPSHOT),
      false,
      "throwing async hook dropped",
    );
    assert.ok(
      started.some((event) => event.type === EventType.MESSAGES_SNAPSHOT),
      "sibling hook still projected",
    );
  });

  it("caps still apply to awaited values (oversized async messages drop closed)", async () => {
    const projection = createMessagesFromSessionProjection({
      getMessages: asyncEntries([{ id: "big", role: "user", text: "x".repeat(128 * 1024) }]),
    });
    const mapper = createAgUiEventMapper({ projection });
    const started = snapshotOf(await mapper.map(agentStarted));
    assert.equal(started, undefined);
  });

  it("ACP mapper awaits async tool hooks with redaction parity", async () => {
    const mapper = createAcpEventMapper({
      redactor: createSecretRedactor(["SECRET"]),
      projection: {
        toolArguments: async (call) => `safe ${call.name}`,
        toolResult: async () => {
          await new Promise((resolve) => setTimeout(resolve, 2));
          return "safe result";
        },
      },
    });
    const call = toolCallContent("t1", "write_file", { path: "/private/SECRET.txt", contents: "SECRET" });
    const started = await mapper.map({
      type: "tool_execution_started",
      sessionId: "s1",
      runId: "r1",
      call,
    });
    assert.equal(started[0]?.sessionUpdate, "tool_call");
    const contents = started[0]?.content as { content: { text: string } }[] | undefined;
    assert.equal(contents?.[0]?.content.text, "safe write_file");
    const finished = await mapper.map({
      type: "tool_execution_finished",
      sessionId: "s1",
      runId: "r1",
      result: { toolCallId: "t1", name: "write_file", value: "SECRET" },
      metadata: { durationMs: 1, status: "finished" },
    });
    assert.equal((finished[0] as { content?: { content: { text: string } }[] }).content?.[0]?.content.text, "safe result");
  });

  it("sync-only hooks keep exact behavior through the async pipeline", async () => {
    const mapper = createAgUiEventMapper({
      projection: {
        toolArguments: (call) => `args:${call.id}`,
        reasoning: (content) => ({ text: `summary:${content.type}` }),
      },
    });
    const call = toolCallContent("t1", "read", { path: "/x" });
    const events = await mapper.map({
      type: "message_delta",
      sessionId: "s1",
      runId: "r1",
      content: { type: "thinking", text: "SECRET reasoning" },
    });
    assert.ok(events.some((event) => event.type === EventType.REASONING_MESSAGE_CONTENT));
    const tool = await mapper.map({ type: "tool_execution_started", sessionId: "s1", runId: "r1", call });
    assert.equal((tool.find((event) => event.type === EventType.TOOL_CALL_ARGS) as { delta: string }).delta, "args:t1");
  });
});
