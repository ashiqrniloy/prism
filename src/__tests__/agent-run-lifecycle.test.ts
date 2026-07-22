import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createAgent,
  createAgentRunLifecycle,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  createMockProvider,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "../index.js";

describe("agent run lifecycle", () => {
  it("streams an authorized durable approval through the shared core path", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const store = createMemorySessionStore();
    let calls = 0;
    const agent = createAgent({
      id: "lifecycle-stream-demo",
      store,
      model: { provider: "mock", model: "demo" },
      provider: (() => {
        let turn = 0;
        return {
          id: "mock",
          async *generate() {
            turn += 1;
            if (turn === 1) {
              yield { type: "tool_call" as const, call: toolCallContent("call-lifecycle", "write", {}) };
              yield providerDone();
              return;
            }
            yield providerTextDelta("finished");
            yield providerDone();
          },
        };
      })(),
      tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-lifecycle", name: "write", value: ++calls }) }],
    });
    const suspended = await agent.createSession({ id: "lifecycle-session" }).run("go", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    const lifecycle = createAgentRunLifecycle({
      checkpoints,
      resolveAgent: ({ agentId }) => {
        assert.equal(agentId, "lifecycle-stream-demo");
        return { agent, definitionRevision: "1" };
      },
    });
    const events = [];
    for await (const event of lifecycle.resumeStream({ runId: suspended.runId, sessionId: suspended.sessionId }, {
      decision: "approve",
      expectedVersion: suspended.runState!.version!,
    }, { agentId: "lifecycle-stream-demo", maxQueuedEvents: 64, overflow: "close" })) events.push(event);

    assert.equal(calls, 1);
    assert.equal(events.some((event) => event.type === "agent_resumed"), true);
    assert.equal(events.at(-1)?.type, "agent_finished");
  });
});
