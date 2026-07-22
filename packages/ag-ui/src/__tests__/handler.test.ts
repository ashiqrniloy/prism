import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventType } from "@ag-ui/core";
import {
  createAgent,
  createAgentRunLifecycle,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  providerDone,
  providerTextDelta,
  toolCallContent,
  type AgentEventRecord,
  type AgentRunRef,
} from "@arnilo/prism";
import { createAgUiHandler, createPersistenceAgUiReplay } from "../index.js";

const authorization = { ownership: { userId: "user-1" } };

function body(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    threadId: "thread-1",
    runId: "run-1",
    state: {},
    messages: [{ id: "user-1", role: "user", content: "hello" }],
    tools: [],
    context: [],
    forwardedProps: {},
    ...overrides,
  });
}

async function events(response: Response) {
  return (await response.text()).trim().split("\n\n").filter(Boolean).map((line) => JSON.parse(line.slice(6)));
}

function request(value: string, suffix = "") {
  return new Request(`https://example.test/ag-ui${suffix}`, { method: "POST", headers: { "content-type": "application/json" }, body: value });
}

describe("createAgUiHandler", () => {
  it("runs only the final text user input through an authorized host session", async () => {
    const inputs: string[] = [];
    const agent = createAgent({
      model: { provider: "mock", model: "mock" },
      provider: {
        id: "mock",
        async *generate(requestValue) {
          const content = requestValue.messages.at(-1)?.content[0];
          inputs.push(content?.type === "text" ? content.text : "");
          yield providerTextDelta("done");
          yield providerDone();
        },
      },
    });
    const handler = createAgUiHandler({
      authorize: () => authorization,
      sessionFactory: () => agent.createSession({ id: "session-1" }),
    });

    const response = await handler(request(body({ messages: [
      { id: "old", role: "user", content: "old" },
      { id: "assistant", role: "assistant", content: "ignored" },
      { id: "latest", role: "user", content: [{ type: "text", text: "latest" }] },
    ] })));
    assert.equal(response.status, 200);
    const output = await events(response);
    assert.deepEqual(output.map((item) => item.type), [EventType.RUN_STARTED, EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_CONTENT, EventType.TEXT_MESSAGE_END, EventType.RUN_FINISHED]);
    assert.equal(output[0].runId, "run-1");
    assert.equal(inputs.at(-1), "latest");
  });

  it("rejects client state before authorization or session lookup", async () => {
    let calls = 0;
    const handler = createAgUiHandler({
      authorize: () => { calls += 1; return authorization; },
      sessionFactory: () => { calls += 1; throw new Error("must not run"); },
    });
    const response = await handler(request(body({ state: { client: "cannot mutate host" } })));
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  });

  it("maps a durable interrupt, verifies exact resume correlation, then resumes once", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let writes = 0;
    let turn = 0;
    let suspended: AgentRunRef | undefined;
    const agent = createAgent({
      id: "approval-agent",
      model: { provider: "mock", model: "mock" },
      store: createMemorySessionStore(),
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
      provider: {
        id: "mock",
        async *generate() {
          if (++turn === 1) yield { type: "tool_call" as const, call: toolCallContent("write-1", "write", { value: "approved" }) };
          else yield providerTextDelta("resumed");
          yield providerDone();
        },
      },
      tools: [{ name: "write", parameters: { type: "object" }, execute: () => ({ toolCallId: "write-1", name: "write", value: ++writes }) }],
    });
    const lifecycle = createAgentRunLifecycle({
      checkpoints,
      resolveAgent: () => ({ agent, definitionRevision: "1" }),
    });
    const handler = createAgUiHandler({
      authorize: () => authorization,
      sessionFactory: () => agent.createSession({ id: "approval-session" }),
      lifecycle,
      resolveRun: () => suspended ? { ref: suspended, agentId: "approval-agent" } : undefined,
      onSuspended: ({ run }) => { suspended = run.ref; },
    });

    const interrupted = await events(await handler(request(body())));
    const finish = interrupted.at(-1);
    assert.equal(finish.type, EventType.RUN_FINISHED);
    assert.equal(finish.outcome.type, "interrupt");
    assert.equal(writes, 0);

    const resumed = await events(await handler(request(body({
      runId: "run-2",
      parentRunId: "run-1",
      messages: [],
      resume: [{ interruptId: finish.outcome.interrupts[0].id, status: "resolved", payload: { decision: "approve" } }],
    }))));
    assert.equal(writes, 1);
    assert.ok(resumed.some((item) => item.type === EventType.TEXT_MESSAGE_CONTENT && item.delta === "resumed"));
    assert.equal(resumed.at(-1).type, EventType.RUN_FINISHED);

    const stale = await handler(request(body({
      runId: "run-3",
      parentRunId: "run-1",
      messages: [],
      resume: [{ interruptId: "run-1:999", status: "resolved", payload: { decision: "approve" } }],
    })));
    assert.equal(stale.status, 400);
    assert.equal(writes, 1);
  });

  it("replays one redacted terminal page without starting a new session", async () => {
    let queried: Record<string, unknown> | undefined;
    let sessions = 0;
    const replay = createPersistenceAgUiReplay({
      queryEvents: async (query) => {
        queried = query as Record<string, unknown>;
        const records: AgentEventRecord[] = [
          { id: "event-1", sessionId: "session-1", runId: "stored-run", type: "agent_started", timestamp: "2026-07-22T00:00:00.000Z", event: { type: "agent_started", sessionId: "session-1", runId: "stored-run" }, redacted: true },
          { id: "event-2", sessionId: "session-1", runId: "stored-run", type: "agent_finished", timestamp: "2026-07-22T00:00:01.000Z", event: { type: "agent_finished", sessionId: "session-1", runId: "stored-run" }, redacted: true },
        ];
        return { items: records };
      },
    }, {
      resolveRun: () => ({ ref: { sessionId: "session-1", runId: "stored-run" } }),
      ownership: (value: typeof authorization) => value.ownership,
    });
    const handler = createAgUiHandler({
      authorize: () => authorization,
      sessionFactory: () => { sessions += 1; throw new Error("terminal replay must not run"); },
      replay,
    });
    const output = await events(await handler(request(body(), "?cursor=cursor-1")));
    assert.deepEqual(output.map((item) => item.type), [EventType.RUN_STARTED, EventType.RUN_FINISHED]);
    assert.deepEqual(output.map((item) => item.prismEventId), ["event-1", "event-2"]);
    assert.equal(sessions, 0);
    assert.deepEqual(queried, { sessionId: "session-1", runId: "stored-run", cursor: "cursor-1", limit: 100, order: "asc", userId: "user-1" });
  });
});
