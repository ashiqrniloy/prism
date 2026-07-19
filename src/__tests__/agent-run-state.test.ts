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
