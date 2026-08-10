import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAgent,
  createAgentRunLifecycle,
  createLoadSkillTool,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  createSkillRegistry,
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
    for await (const event of lifecycle.resumeStream(
      { runId: suspended.runId, sessionId: suspended.sessionId },
      {
        decision: "approve",
        expectedVersion: suspended.runState!.version!,
      },
      { agentId: "lifecycle-stream-demo", maxQueuedEvents: 64, overflow: "close" },
    ))
      events.push(event);

    assert.equal(calls, 1);
    assert.equal(
      events.some((event) => event.type === "agent_resumed"),
      true,
    );
    assert.equal(events.at(-1)?.type, "agent_finished");
  });

  it("opt-in persistSessionState: skill names ride the checkpoint and restore on resume (plan 015 Task 4)", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const requests: Array<{
      readonly messages: ReadonlyArray<{ readonly content: ReadonlyArray<{ readonly text?: string; readonly type: string }> }>;
    }> = [];
    const registry = createSkillRegistry([{ name: "brief", description: "Answer briefly.", instructions: "Be very brief." }]);
    const agent = createAgent({
      id: "persist-session-demo",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      provider: {
        id: "mock",
        async *generate(request: { messages: (typeof requests)[number]["messages"] }) {
          requests.push(request as never);
          if (requests.length === 1) {
            // non-durable run 1: load_skill dispatches (no gate) and populates the session catalog
            yield { type: "tool_call" as const, call: toolCallContent("call-load", "load_skill", { name: "brief" }) };
            return;
          }
          if (requests.length === 2) {
            yield providerDone();
            return;
          }
          if (requests.length === 3) {
            // durable run 2: gated write suspends after the catalog already holds "brief"
            yield { type: "tool_call" as const, call: toolCallContent("call-write", "write", {}) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("finished");
          yield providerDone();
        },
      },
      skills: registry,
      activateAllSkills: true,
      tools: [
        createLoadSkillTool({ registry }),
        { name: "write", parameters: {}, execute: () => ({ toolCallId: "call-write", name: "write", value: "done" }) },
      ],
    });
    const session = agent.createSession({ id: "persist-session" });
    await session.run("go");
    const suspended = await session.run("go", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true, persistSessionState: true },
    });
    const record = await checkpoints.loadCheckpoint({ namespace: "prism.agent-run", key: suspended.runId });
    assert.deepEqual(
      (record!.value as { sessionState: { loadedSkillNames: string[] } }).sessionState.loadedSkillNames,
      ["brief"],
      "checkpoint carries the loaded-skill name catalog",
    );

    const lifecycle = createAgentRunLifecycle({
      checkpoints,
      resolveAgent: () => ({ agent, definitionRevision: "1" }),
    });
    const events = [];
    for await (const event of lifecycle.resumeStream(
      { runId: suspended.runId, sessionId: suspended.sessionId },
      { decision: "approve", expectedVersion: suspended.runState!.version! },
      { agentId: "persist-session-demo", maxQueuedEvents: 64, overflow: "close", persistSessionState: true },
    )) {
      events.push(event);
    }
    assert.equal(events.at(-1)?.type, "agent_finished");
    assert.equal(requests.length, 4, "resumed run produced the final provider turn");
    const resumedTurn = requests[3]!;
    const resumedText = resumedTurn.messages
      .flatMap((m) => m.content)
      .map((b) => (b.type === "text" && b.text ? b.text : ""))
      .join("\n");
    assert.match(resumedText, /Skill brief:\nBe very brief\./, "restored catalog renders the body from the live registry");
  });

  it("persistSessionState off keeps the checkpoint at the 0.1.2 shape (plan 015 Task 4)", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const agent = createAgent({
      id: "persist-session-off",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      provider: {
        id: "mock",
        async *generate() {
          yield { type: "tool_call" as const, call: toolCallContent("call-write", "write", {}) };
          yield providerDone();
        },
      },
      tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-write", name: "write", value: "done" }) }],
    });
    const suspended = await agent.createSession({ id: "persist-session-off" }).run("go", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    const record = await checkpoints.loadCheckpoint({ namespace: "prism.agent-run", key: suspended.runId });
    assert.equal("sessionState" in (record!.value as object), false, "no sessionState key with the opt-in off");
  });
});
