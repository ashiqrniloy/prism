import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AgentRunStateError,
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  createMockProvider,
  createSecretRedactor,
  loadAgentRunState,
  providerDone,
  providerTextDelta,
  resumeAgentRun,
  resumeAgentRunStream,
  toolCallContent,
} from "../index.js";

describe("durable agent runs", () => {
  it("suspends before a tool, recreates process objects, and executes it once on approval", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const store = createMemorySessionStore();
    let calls = 0;
    const agent = createAgent({
      id: "durable-demo",
      model: { provider: "mock", model: "demo" },
      store,
      provider: (() => {
        let turn = 0;
        return {
          id: "mock",
          async *generate() {
            turn += 1;
            if (turn === 1) {
              yield { type: "tool_call" as const, call: toolCallContent("call-1", "write", { value: "ok" }) };
              yield providerDone();
              return;
            }
            yield providerTextDelta("finished");
            yield providerDone();
          },
        };
      })(),
      tools: [{ name: "write", parameters: {}, execute: () => { calls += 1; return { toolCallId: "call-1", name: "write", value: "done" }; } }],
    });
    const first = await agent.createSession({ id: "durable-session" }).run("go", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });

    assert.equal(first.status, "suspended");
    assert.equal(calls, 0);
    assert.equal(first.interruption?.toolCallId, "call-1");

    const result = await resumeAgentRun(agent, { runId: first.runId, sessionId: first.sessionId }, {
      decision: "approve",
      expectedVersion: first.runState!.version!,
    }, { checkpoints, definitionRevision: "1" });

    assert.equal(result.status, "succeeded");
    assert.equal(result.text, "finished");
    assert.equal(calls, 1);
    await assert.rejects(() => resumeAgentRun(agent, { runId: first.runId }, {
      decision: "approve",
      expectedVersion: first.runState!.version!,
    }, { checkpoints, definitionRevision: "1" }), AgentRunStateError);
  });

  it("never retries an ambiguous dispatched tool", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const agent = createAgent({
      id: "ambiguous-durable-demo",
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([{ type: "tool_call", call: toolCallContent("call-3", "write", {}) }, providerDone()]),
      tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-3", name: "write" }) }],
    });
    const suspended = await agent.createSession().run("go", { runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true } });
    const loaded = await loadAgentRunState(checkpoints, { runId: suspended.runId });
    await checkpoints.saveCheckpoint({
      namespace: "prism.agent-run", key: suspended.runId, version: loaded.record.version + 1, expectedVersion: loaded.record.version,
      value: { ...loaded.state, pending: { ...loaded.state.pending!, status: "dispatched" } }, category: "agent-run",
    });
    await assert.rejects(() => resumeAgentRun(agent, { runId: suspended.runId }, {
      decision: "approve", expectedVersion: loaded.record.version + 1,
    }, { checkpoints, definitionRevision: "1" }), /Ambiguous dispatched tool/);
  });

  it("streams approved durable resume events once", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const store = createMemorySessionStore();
    let calls = 0;
    const agent = createAgent({
      id: "stream-durable-demo",
      store,
      model: { provider: "mock", model: "demo" },
      provider: (() => {
        let turn = 0;
        return {
          id: "mock",
          async *generate() {
            turn += 1;
            if (turn === 1) {
              yield { type: "tool_call" as const, call: toolCallContent("call-stream", "write", {}) };
              yield providerDone();
              return;
            }
            yield providerTextDelta("finished");
            yield providerDone();
          },
        };
      })(),
      tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-stream", name: "write", value: ++calls }) }],
    });
    const suspended = await agent.createSession({ id: "stream-durable-session" }).run("go", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    const events = [];
    for await (const event of resumeAgentRunStream(agent, { runId: suspended.runId, sessionId: suspended.sessionId }, {
      decision: "approve",
      expectedVersion: suspended.runState!.version!,
    }, { checkpoints, definitionRevision: "1", maxQueuedEvents: 64, overflow: "close" })) events.push(event);

    assert.equal(calls, 1);
    assert.deepEqual(events.map((event) => event.type).slice(0, 2), ["agent_started", "agent_resumed"]);
    assert.equal(events.some((event) => event.type === "tool_execution_started"), true);
    assert.equal(events.some((event) => event.type === "message_delta"), true);
    assert.equal(events.at(-1)?.type, "agent_finished");
    assert.equal(events.every((event) => !("runId" in event) || event.runId === suspended.runId), true);
  });

  it("streams denial without provider or tool execution", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let calls = 0;
    const agent = createAgent({
      id: "stream-deny-demo",
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([{ type: "tool_call", call: toolCallContent("call-deny", "write", {}) }, providerDone()]),
      tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-deny", name: "write", value: ++calls }) }],
    });
    const suspended = await agent.createSession().run("go", { runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true } });
    const events = [];
    for await (const event of resumeAgentRunStream(agent, { runId: suspended.runId }, {
      decision: "deny",
      expectedVersion: suspended.runState!.version!,
    }, { checkpoints, definitionRevision: "1" })) events.push(event);

    assert.equal(calls, 0);
    assert.deepEqual(events.map((event) => event.type), ["agent_denied"]);
  });

  it("aborts before claiming and closes an overflowing resume subscriber", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const store = createMemorySessionStore();
    let calls = 0;
    const agent = createAgent({
      id: "stream-bounds-demo",
      store,
      model: { provider: "mock", model: "demo" },
      provider: (() => {
        let turn = 0;
        return {
          id: "mock",
          async *generate() {
            turn += 1;
            if (turn === 1) {
              yield { type: "tool_call" as const, call: toolCallContent("call-bounds", "write", {}) };
              yield providerDone();
              return;
            }
            yield providerTextDelta("one");
            yield providerTextDelta("two");
            yield providerDone();
          },
        };
      })(),
      tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-bounds", name: "write", value: ++calls }) }],
    });
    const suspended = await agent.createSession().run("go", { runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true } });
    const aborted = new AbortController();
    aborted.abort(new Error("disconnect"));
    const rejected = resumeAgentRunStream(agent, { runId: suspended.runId }, {
      decision: "approve",
      expectedVersion: suspended.runState!.version!,
    }, { checkpoints, definitionRevision: "1", signal: aborted.signal })[Symbol.asyncIterator]();
    await assert.rejects(() => rejected.next(), /disconnect/);
    assert.equal((await loadAgentRunState(checkpoints, { runId: suspended.runId })).state.status, "suspended");

    const stream = resumeAgentRunStream(agent, { runId: suspended.runId }, {
      decision: "approve",
      expectedVersion: suspended.runState!.version!,
    }, { checkpoints, definitionRevision: "1", maxQueuedEvents: 1, overflow: "close" })[Symbol.asyncIterator]();
    assert.equal((await stream.next()).value?.type, "event_subscriber_overflow");
    assert.equal((await stream.next()).done, true);
    assert.equal(calls, 1);
  });

  it("redacts checkpointed pending tool arguments and denial never executes", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let calls = 0;
    const agent = createAgent({
      id: "redacted-durable-demo",
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([{ type: "tool_call", call: toolCallContent("call-2", "write", { token: "secret" }) }, providerDone()]),
      tools: [{ name: "write", parameters: {}, execute: () => { calls += 1; return { toolCallId: "call-2", name: "write" }; } }],
    });
    const result = await agent.createSession({ id: "redacted-session" }).run("secret", {
      redactor: createSecretRedactor(["secret"]),
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    const loaded = await loadAgentRunState(checkpoints, { runId: result.runId });
    assert.equal(JSON.stringify(loaded.state).includes("secret"), false);

    const denied = await resumeAgentRun(agent, { runId: result.runId }, {
      decision: "deny",
      expectedVersion: result.runState!.version!,
    }, { checkpoints, definitionRevision: "1" });
    assert.equal(denied.status, "denied");
    assert.equal(calls, 0);
  });
});
