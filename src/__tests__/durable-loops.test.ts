import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { loadAgentRunState } from "../agent-run-state.js";
import {
  AgentLoopStateError,
  agentFingerprint,
  createAgent,
  askEveryTool,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  type JsonValue,
  type LoopStrategy,
  providerDone,
  providerTextDelta,
  resumeAgentRun,
  toolCallContent,
} from "../index.js";

/** Minimal custom loop: one provider turn, dispatch any calls. */
function customLoop(hooks: boolean, state: { turns: number; restored?: JsonValue }): LoopStrategy {
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
    async run(run) {
      state.turns += 1;
      const turn = await run.turn();
      if (turn.toolCalls.length > 0) await run.executeTools(turn.toolCalls);
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
    const agent = await createAgent({
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
      slots: { loop: customLoop(false, state) },
    });
    await assert.rejects(
      async () => (await agent.session()).run("go", { runState: { checkpoints, definitionRevision: "1" } }),
      (error: unknown) => error instanceof AgentLoopStateError && error.code === "ERR_PRISM_LOOP_NOT_DURABLE",
    );
    assert.equal(providerCalls, 0);
  });

  it("captures and restores loop-local state across a tool-approval suspension", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const provider = twoTurnProvider();
    const state: { turns: number; restored?: JsonValue } = { turns: 0 };
    let calls = 0;
    const agent = await createAgent({
      hooks: askEveryTool(),
      id: "durable-custom-loop",
      model: { provider: "mock", model: "demo" },
      provider: provider(),
      slots: { store: createMemorySessionStore(), loop: customLoop(true, state) },
      tools: {
        add: [
          {
            name: "write",
            parameters: {},
            execute: () => {
              calls += 1;
              return { toolCallId: "call-1", name: "write", value: "done" };
            },
          },
        ],
      },
    });
    const first = await (await agent.session({ id: "durable-loop-session", create: true })).run("go", {
      runState: { checkpoints, definitionRevision: "1" },
    });
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
    assert.equal(result.status, "completed");
    assert.equal(calls, 1);
    assert.deepEqual(state.restored, { turns: 1 });
    assert.equal(state.turns, 2);
  });

  it("fails closed when a snapshot is not JSON-compatible", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const loop: LoopStrategy = {
      name: "bad-snapshot-loop",
      revision: "1",
      snapshot: () => ({ callback: () => undefined }) as unknown as JsonValue,
      restore: () => undefined,
      async run(run) {
        const turn = await run.turn();
        if (turn.toolCalls.length > 0) await run.executeTools(turn.toolCalls);
      },
    };
    const agent = await createAgent({
      hooks: askEveryTool(),
      id: "bad-snapshot",
      model: { provider: "mock", model: "demo" },
      provider: twoTurnProvider()(),
      slots: { loop },
      tools: { add: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-1", name: "write" }) }] },
    });
    const refused = await (await agent.session()).run("go", { runState: { checkpoints, definitionRevision: "1" } });
    assert.equal(refused.status, "failed");
    assert.equal(refused.error?.code, "ERR_PRISM_LOOP_SNAPSHOT");
  });

  it("changes the fingerprint when a custom loop revision changes", async () => {
    const base = {
      id: "fp-loop",
      model: { provider: "mock", model: "demo" },
      slots: { loop: { name: "custom-loop", revision: "1", run: async () => undefined } as LoopStrategy },
    };
    const a = agentFingerprint(await createAgent(base), "1");
    const b = agentFingerprint(await createAgent({ ...base, slots: { loop: { ...base.slots.loop, revision: "2" } } }), "1");
    const c = agentFingerprint(await createAgent({ ...base, slots: undefined }), "1");
    assert.notEqual(a, b);
    assert.notEqual(a, c);
  });
});
