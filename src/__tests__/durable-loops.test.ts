import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AgentLoopStateError,
  agentFingerprint,
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  providerDone,
  providerTextDelta,
  resumeAgentRun,
  toolCallContent,
  type AgentLoopStrategy,
  type JsonValue,
} from "../index.js";
import { loadAgentRunState } from "../agent-run-state.js";

/** Minimal custom loop: one provider turn, dispatch any calls, one more provider turn. */
function customLoop(hooks: boolean, state: { turns: number; restored?: JsonValue }): AgentLoopStrategy {
  return {
    name: "custom-loop",
    revision: "1",
    ...(hooks
      ? {
          snapshot: () => ({ turns: state.turns }) as JsonValue,
          restore: (snapshot: JsonValue) => {
            state.restored = snapshot;
            state.turns = (snapshot as { turns: number }).turns;
          },
        }
      : {}),
    async run(ctx) {
      state.turns += 1;
      const { calls } = await ctx.generate(await ctx.assemble([]));
      for (const call of calls) await ctx.dispatchToolCall(call);
      return undefined;
    },
  };
}

function twoTurnProvider() {
  let turn = 0;
  return () => {
    turn = 0;
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
  };
}

describe("durable custom loops", () => {
  it("rejects a hook-less custom strategy on a durable run before any provider call", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let providerCalls = 0;
    const state = { turns: 0 };
    const agent = createAgent({
      id: "not-durable-loop",
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate() {
          providerCalls += 1;
          yield providerTextDelta("unreachable");
          yield providerDone();
        },
      },
      loop: customLoop(false, state),
    });
    await assert.rejects(
      () => agent.createSession().run("go", { runState: { checkpoints, definitionRevision: "1" } }),
      (error: unknown) => error instanceof AgentLoopStateError && error.code === "ERR_PRISM_LOOP_NOT_DURABLE",
    );
    assert.equal(providerCalls, 0);
  });

  it("captures and restores loop-local state across a tool-approval suspension", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const provider = twoTurnProvider();
    const state: { turns: number; restored?: JsonValue } = { turns: 0 };
    let calls = 0;
    const agent = createAgent({
      id: "durable-custom-loop",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      provider: provider(),
      loop: customLoop(true, state),
      tools: [
        {
          name: "write",
          parameters: {},
          execute: () => {
            calls += 1;
            return { toolCallId: "call-1", name: "write", value: "done" };
          },
        },
      ],
    });
    const first = await agent
      .createSession({ id: "durable-loop-session" })
      .run("go", { runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true } });
    assert.equal(first.status, "suspended");
    assert.equal(calls, 0);

    const { state: stored } = await loadAgentRunState(checkpoints, { runId: first.runId });
    assert.deepEqual(stored.loopState, { name: "custom-loop", revision: "1", snapshot: { turns: 1 } });

    const result = await resumeAgentRun(
      agent,
      { runId: first.runId, sessionId: first.sessionId },
      { decision: "approve", expectedVersion: first.runState!.version! },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(result.status, "succeeded");
    assert.equal(calls, 1);
    assert.deepEqual(state.restored, { turns: 1 });
    assert.equal(state.turns, 2);
  });

  it("fails closed when a snapshot is not JSON-compatible", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const loop: AgentLoopStrategy = {
      name: "bad-snapshot-loop",
      revision: "1",
      snapshot: () => ({ callback: () => undefined }) as unknown as JsonValue,
      restore: () => undefined,
      async run(ctx) {
        const { calls } = await ctx.generate(await ctx.assemble([]));
        for (const call of calls) await ctx.dispatchToolCall(call);
        return undefined;
      },
    };
    const agent = createAgent({
      id: "bad-snapshot",
      model: { provider: "mock", model: "demo" },
      provider: twoTurnProvider()(),
      loop,
      tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-1", name: "write" }) }],
    });
    await assert.rejects(
      () => agent.createSession().run("go", { runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true } }),
      (error: unknown) => error instanceof Error && (error.cause as { code?: string } | undefined)?.code === "ERR_PRISM_LOOP_SNAPSHOT",
    );
  });

  it("keeps generate-validate-revise attempt state across a durable suspension", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let turn = 0;
    const seen: string[] = [];
    const agent = createAgent({
      id: "durable-gvr",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      provider: {
        id: "mock",
        async *generate() {
          turn += 1;
          if (turn === 1) {
            yield { type: "tool_call" as const, call: toolCallContent("call-1", "draft", {}) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("artifact-v1");
          yield providerDone();
        },
      },
      loop: {
        strategy: "generate-validate-revise",
        toolCalls: "bounded",
        maxRevisions: 2,
        validator: (value: unknown) => {
          seen.push(String(value));
          return { ok: true as const, value };
        },
      },
      tools: [{ name: "draft", parameters: {}, execute: () => ({ toolCallId: "call-1", name: "draft", value: "drafted" }) }],
    });
    const first = await agent
      .createSession({ id: "gvr-session" })
      .run("go", { runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true } });
    assert.equal(first.status, "suspended");

    const { state: stored } = await loadAgentRunState(checkpoints, { runId: first.runId });
    assert.equal(stored.loopState?.name, "generate-validate-revise");
    assert.equal(stored.loopState?.revision, "1");
    const snap = stored.loopState?.snapshot as { attempts: number } | undefined;
    assert.equal(snap?.attempts, 0);

    const result = await resumeAgentRun(
      agent,
      { runId: first.runId, sessionId: first.sessionId },
      { decision: "approve", expectedVersion: first.runState!.version! },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(result.status, "succeeded");
    assert.deepEqual(seen, ["artifact-v1"]);
  });

  it("changes the fingerprint when a custom loop revision changes", () => {
    const base = {
      id: "fp-loop",
      model: { provider: "mock", model: "demo" },
      loop: { name: "custom-loop", revision: "1", run: async () => undefined } as AgentLoopStrategy,
    };
    const a = agentFingerprint(createAgent(base), "1");
    const b = agentFingerprint(createAgent({ ...base, loop: { ...base.loop, revision: "2" } }), "1");
    const c = agentFingerprint(createAgent({ ...base, loop: undefined }), "1");
    assert.notEqual(a, b);
    assert.notEqual(a, c);
  });
});
