import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEvent, AgentRunStateOptions, AgentSession, CheckpointStore, ProviderRequest } from "../contracts.js";
import {
  AgentRunStateError,
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  loadAgentRunState,
  providerDone,
  providerTextDelta,
  resumeAgentRun,
  resumeAgentRunStream,
  toolCallContent,
} from "../index.js";

/**
 * Simulates a host process dying: the checkpoint store is available up to the crash point and
 * rejects every write after it, so the last persisted checkpoint stays exactly as the crashed
 * process left it (a real crash writes nothing at all). Reopening the gate models the restarted
 * worker attaching to the same durable store.
 */
function crashableCheckpoints(inner: CheckpointStore) {
  const gate = { open: true };
  const store: CheckpointStore = {
    ...inner,
    async saveCheckpoint(input) {
      if (!gate.open) throw new Error("checkpoint store unavailable (simulated process death)");
      return inner.saveCheckpoint(input);
    },
  };
  return { store, gate };
}

function toolResultMessages(request: ProviderRequest, toolCallId: string): number {
  return request.messages.filter((message) =>
    message.content.some((block) => block.type === "tool_result" && block.toolCallId === toolCallId),
  ).length;
}

/** Runs a session while collecting its events, returning the run id from `agent_started`. */
async function runCapturingId(session: AgentSession, input: string, runState: AgentRunStateOptions) {
  const events: AgentEvent[] = [];
  const subscription = session.subscribe();
  const pump = (async () => {
    for await (const event of subscription) events.push(event);
  })();
  const settle = session.run(input, { runState });
  const outcome = await settle.then(
    (result) => ({ result, error: undefined }),
    (error: unknown) => ({ result: undefined, error }),
  );
  await pump;
  const runId = events.find((event) => event.type === "agent_started")?.runId;
  assert.ok(runId, "run id captured from agent_started");
  return { runId, ...outcome };
}

/** Agent whose first turn calls one tool and whose second turn crashes once (closing the store
 *  gate first, so post-crash writes are lost exactly as they are in a real process death). */
function crashOnceAgent(options: {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly requests: ProviderRequest[];
  readonly gate: { open: boolean };
}) {
  let turn = 0;
  let crashed = false;
  let executions = 0;
  const agent = createAgent({
    id: "crash-recovery",
    store: createMemorySessionStore(),
    model: { provider: "mock", model: "demo" },
    provider: {
      id: "mock",
      async *generate(request) {
        options.requests.push(request);
        turn += 1;
        if (turn === 1) {
          yield { type: "tool_call" as const, call: toolCallContent(options.toolCallId, options.toolName, { value: "dossier" }) };
          yield providerDone();
          return;
        }
        if (!crashed) {
          crashed = true;
          options.gate.open = false;
          throw new Error("simulated worker crash");
        }
        yield providerTextDelta("investigation complete");
        yield providerDone();
      },
    },
    tools: [
      {
        name: options.toolName,
        parameters: {},
        execute: () => {
          executions += 1;
          return { toolCallId: options.toolCallId, name: options.toolName, value: "persisted" };
        },
      },
    ],
  });
  return { agent, executions: () => executions };
}

describe("turn-boundary crash-recovery checkpoints", () => {
  it("resumes a crashed every-turn run with continue without re-dispatching a tool", async () => {
    const memory = createMemoryCheckpointStore();
    const { store: checkpoints, gate } = crashableCheckpoints(memory);
    const requests: ProviderRequest[] = [];
    const { agent, executions } = crashOnceAgent({ toolName: "digest", toolCallId: "call-1", requests, gate });
    const session = agent.createSession({ id: "crash-session" });

    const crashed = await runCapturingId(session, "investigate", {
      checkpoints,
      definitionRevision: "1",
      checkpointPolicy: "every-turn",
    });
    assert.match(String((crashed.error as Error).message), /checkpoint store unavailable/);
    assert.equal(executions(), 1);

    // The crash left a running checkpoint at the last turn boundary; no failed status overwrote it.
    const before = await loadAgentRunState(checkpoints, { runId: crashed.runId, sessionId: "crash-session" });
    assert.equal(before.state.status, "running");
    assert.equal(before.state.checkpointPolicy, "every-turn");
    gate.open = true;

    const resumedEvents: AgentEvent[] = [];
    for await (const event of resumeAgentRunStream(
      agent,
      { runId: crashed.runId, sessionId: "crash-session" },
      { decision: "continue", expectedVersion: before.record.version },
      { checkpoints, definitionRevision: "1" },
    )) {
      resumedEvents.push(event);
    }

    assert.equal(resumedEvents.filter((event) => event.type === "agent_resumed").length, 1);
    assert.equal(executions(), 1, "no tool re-dispatch on continue");
    assert.equal(resumedEvents.filter((event) => event.type === "tool_execution_started").length, 0);
    const finished = await loadAgentRunState(checkpoints, { runId: crashed.runId });
    assert.equal(finished.state.status, "succeeded");
    assert.equal(finished.state.checkpointPolicy, "every-turn");
    // claim + at least one resumed turn checkpoint + terminal write
    assert.ok(finished.record.version >= before.record.version + 2);
    // The resumed provider turn sees the pre-crash tool result exactly once.
    const finalRequest = requests.at(-1);
    assert.ok(finalRequest, "resumed provider request captured");
    assert.equal(toolResultMessages(finalRequest, "call-1"), 1);
  });

  it("refuses continue on a suspended approval checkpoint and leaves state untouched", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let turn = 0;
    let executions = 0;
    const agent = createAgent({
      id: "continue-vs-approval",
      store: createMemorySessionStore(),
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate() {
          turn += 1;
          if (turn === 1) {
            yield { type: "tool_call" as const, call: toolCallContent("gate-1", "gated", {}) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("finished");
          yield providerDone();
        },
      },
      tools: [
        {
          name: "gated",
          parameters: {},
          execute: () => {
            executions += 1;
            return { toolCallId: "gate-1", name: "gated", value: "done" };
          },
        },
      ],
    });
    const suspended = await agent.createSession({ id: "approval-session" }).run("go", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true, checkpointPolicy: "every-turn" },
    });
    assert.equal(suspended.status, "suspended");
    const suspendedState = suspended.runState;
    assert.ok(suspendedState, "suspension carries the durable state");
    const version = suspendedState.version;
    assert.ok(typeof version === "number", "suspension carries a checkpoint version");

    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          { runId: suspended.runId, sessionId: suspended.sessionId },
          { decision: "continue", expectedVersion: version },
          { checkpoints, definitionRevision: "1" },
        ),
      (error: unknown) => error instanceof AgentRunStateError && /Stale or non-running/.test(error.message),
    );
    const untouched = await loadAgentRunState(checkpoints, { runId: suspended.runId });
    assert.equal(untouched.record.version, version);
    assert.equal(untouched.state.status, "suspended");
    assert.equal(executions, 0);

    const approved = await resumeAgentRun(
      agent,
      { runId: suspended.runId, sessionId: suspended.sessionId },
      { decision: "approve", expectedVersion: version },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(approved.status, "succeeded");
    assert.equal(executions, 1);
  });

  it("fails closed on stale versions and changed fingerprints with zero checkpoint writes", async () => {
    const memory = createMemoryCheckpointStore();
    const { store: checkpoints, gate } = crashableCheckpoints(memory);
    let writes = 0;
    const counting: CheckpointStore = {
      ...checkpoints,
      async saveCheckpoint(input) {
        writes += 1;
        return checkpoints.saveCheckpoint(input);
      },
    };
    const requests: ProviderRequest[] = [];
    const { agent } = crashOnceAgent({ toolName: "digest", toolCallId: "call-1", requests, gate });
    const session = agent.createSession({ id: "guards-session" });
    const crashed = await runCapturingId(session, "go", {
      checkpoints: counting,
      definitionRevision: "1",
      checkpointPolicy: "every-turn",
    });
    const before = await loadAgentRunState(counting, { runId: crashed.runId });
    gate.open = true;
    writes = 0;

    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          { runId: crashed.runId, sessionId: "guards-session" },
          { decision: "continue", expectedVersion: before.record.version - 1 },
          { checkpoints: counting, definitionRevision: "1" },
        ),
      (error: unknown) => error instanceof AgentRunStateError && /Stale or non-running/.test(error.message),
    );
    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          { runId: crashed.runId, sessionId: "guards-session" },
          { decision: "continue", expectedVersion: before.record.version },
          { checkpoints: counting, definitionRevision: "2" },
        ),
      (error: unknown) => error instanceof AgentRunStateError && /fingerprint mismatch/.test(error.message),
    );
    assert.equal(writes, 0, "rejected resumes write nothing");
    const after = await loadAgentRunState(counting, { runId: crashed.runId });
    assert.equal(after.record.version, before.record.version);
    assert.equal(after.state.status, "running");
  });

  it("writes no turn checkpoints under the default decision policy", async () => {
    const memory = createMemoryCheckpointStore();
    let writes = 0;
    const counting: CheckpointStore = {
      ...memory,
      async saveCheckpoint(input) {
        writes += 1;
        return memory.saveCheckpoint(input);
      },
    };
    let turn = 0;
    const agent = createAgent({
      id: "default-policy",
      store: createMemorySessionStore(),
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate() {
          turn += 1;
          if (turn === 1) {
            yield { type: "tool_call" as const, call: toolCallContent("call-1", "digest", {}) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("finished");
          yield providerDone();
        },
      },
      tools: [{ name: "digest", parameters: {}, execute: () => ({ toolCallId: "call-1", name: "digest", value: "ok" }) }],
    });
    const result = await agent
      .createSession({ id: "default-session" })
      .run("go", { runState: { checkpoints: counting, definitionRevision: "1" } });
    assert.equal(result.status, "succeeded");
    assert.equal(writes, 0, "default policy leaves the checkpoint store untouched on a clean run");
  });
});
