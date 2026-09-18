import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEvent, AgentSession, CheckpointStore, ProviderRequest, RunLedger, RunOptions, RunRecord } from "../contracts.js";
import {
  AgentRunError,
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  loadAgentRunState,
  providerDone,
  providerTextDelta,
  resumeAgentRun,
  toolCallContent,
} from "../index.js";

type InMemoryLedger = { runs: RunRecord[]; ledger: RunLedger };

function createMemoryLedger(): InMemoryLedger {
  const runs: InMemoryLedger["runs"] = [];
  return {
    runs,
    ledger: {
      appendRun: async (record) => {
        runs.push(record);
      },
      appendEvent: async () => {},
      appendToolCall: async () => {},
      appendUsage: async () => {},
    },
  };
}

/** Captures the run id from `agent_started` while the run is in flight. */
async function runCapturingId(session: AgentSession, input: string, options: RunOptions) {
  const events: AgentEvent[] = [];
  const subscription = session.subscribe();
  const pump = (async () => {
    for await (const event of subscription) events.push(event);
  })();
  const outcome = await session.run(input, options).then(
    (result) => ({ result, error: undefined }),
    (error: unknown) => ({ result: undefined, error }),
  );
  await pump;
  const runId = events.find((event) => event.type === "agent_started")?.runId;
  assert.ok(runId, "run id captured from agent_started");
  return { runId, events, ...outcome };
}

function textOccurrences(request: ProviderRequest, text: string): number {
  return request.messages.filter((message) => message.content.some((block) => block.type === "text" && block.text.includes(text))).length;
}

/**
 * Agent whose first turn calls one tool and whose later turns answer in text. The tool can queue
 * a steer through `onTool`, exactly where a host would (mid-run, from inside the run).
 */
function turnPolicyAgent(options: {
  readonly requests: ProviderRequest[];
  readonly onTool?: (session: AgentSession) => void;
  readonly onGenerate?: (turn: number) => void;
}) {
  let turn = 0;
  let session: AgentSession | undefined;
  const agent = createAgent({
    id: "turn-policy",
    store: createMemorySessionStore(),
    model: { provider: "mock", model: "demo" },
    provider: {
      id: "mock",
      async *generate(request) {
        options.requests.push(request);
        turn += 1;
        options.onGenerate?.(turn);
        if (turn === 1) {
          yield { type: "tool_call" as const, call: toolCallContent("call-1", "digest", { value: "dossier" }) };
          yield providerDone();
          return;
        }
        yield providerTextDelta(`turn ${turn} complete`);
        yield providerDone();
      },
    },
    tools: [
      {
        name: "digest",
        parameters: {},
        execute: () => {
          if (session) options.onTool?.(session);
          return { toolCallId: "call-1", name: "digest", value: "ok" };
        },
      },
    ],
  });
  return {
    agent,
    attach: (active: AgentSession) => {
      session = active;
      return active;
    },
  };
}

describe("host turn policy stops", () => {
  it("stops at a turn boundary with host_policy and resumes with continue", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const requests: ProviderRequest[] = [];
    const { ledger, runs } = createMemoryLedger();
    const { agent } = turnPolicyAgent({ requests });
    const session = agent.createSession({ id: "stop-session" });
    let calls = 0;

    const stopped = await runCapturingId(session, "investigate", {
      runLedger: ledger,
      turnPolicy: {
        stop: (ctx) => {
          calls += 1;
          return ctx.turns >= 1 ? { action: "stop", reason: "l1-first-plan-paint" } : { action: "continue" };
        },
      },
      runState: { checkpoints, definitionRevision: "1", checkpointPolicy: "every-turn" },
    });
    // Two boundaries: turn 1 (continue) and turn 2 (stop) — one consult per provider request.
    assert.equal(calls, 2, "policy is consulted once per turn boundary");
    assert.ok(stopped.result, String(stopped.error));
    assert.equal(stopped.result.status, "succeeded");
    assert.equal(stopped.result.stopReason, "host_policy");
    assert.equal(stopped.result.stopDetail, "l1-first-plan-paint");
    assert.equal(requests.length, 1, "no provider call after the stop");
    const finished = stopped.events.find((event) => event.type === "agent_finished");
    assert.equal(finished?.type === "agent_finished" ? finished.finishReason : undefined, "host_policy");
    assert.equal(finished?.type === "agent_finished" ? finished.stopDetail : undefined, "l1-first-plan-paint");
    const finishRecord = runs.find((record) => record.status === "succeeded");
    assert.ok(finishRecord, "one finish ledger record");
    assert.equal(finishRecord.stopReason, "host_policy");
    assert.equal(finishRecord.stopDetail, "l1-first-plan-paint");

    const state = await loadAgentRunState(checkpoints, { runId: stopped.runId });
    assert.equal(state.state.status, "succeeded");
    assert.equal(state.state.stopReason, "host_policy");

    const resumed = await resumeAgentRun(
      agent,
      { runId: stopped.runId, sessionId: "stop-session" },
      { decision: "continue", expectedVersion: state.record.version },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(resumed.status, "succeeded");
    assert.equal(resumed.stopReason, undefined, "the resumed leg runs without a policy stop");
    assert.equal(requests.length, 2, "the resumed leg runs the next provider turn");
  });

  it("keeps requests byte-identical between an omitted policy and an always-continue policy", async () => {
    const baselineRequests: ProviderRequest[] = [];
    const baseline = await turnPolicyAgent({ requests: baselineRequests }).agent.createSession({ id: "policy-comparison" }).run("go");
    assert.equal(baseline.status, "succeeded");
    assert.equal(baseline.stopReason, undefined);

    const guardedRequests: ProviderRequest[] = [];
    const guarded = await turnPolicyAgent({ requests: guardedRequests })
      .agent.createSession({ id: "policy-comparison" })
      .run("go", { turnPolicy: { stop: () => ({ action: "continue" }) } });
    assert.equal(guarded.status, "succeeded");
    assert.equal(guarded.stopReason, undefined);
    assert.equal(guarded.text, baseline.text);
    assert.equal(guardedRequests.length, baselineRequests.length);
    assert.equal(
      JSON.stringify(guardedRequests),
      JSON.stringify(baselineRequests),
      "an always-continue policy must not perturb the provider request stream",
    );
  });

  it("fails closed with ERR_PRISM_TURN_POLICY and no continuable checkpoint when the callback throws", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const requests: ProviderRequest[] = [];
    let writes = 0;
    const counting: CheckpointStore = {
      ...checkpoints,
      async saveCheckpoint(input) {
        writes += 1;
        return checkpoints.saveCheckpoint(input);
      },
    };
    const { agent } = turnPolicyAgent({ requests });
    const session = agent.createSession({ id: "throwing-session" });

    const failed = await runCapturingId(session, "go", {
      turnPolicy: {
        stop: (ctx) => {
          if (ctx.turns >= 1) throw new Error("policy bug");
          return { action: "continue" };
        },
      },
      runState: { checkpoints: counting, definitionRevision: "1", checkpointPolicy: "every-turn" },
    });
    assert.ok(failed.error instanceof AgentRunError, "typed run error");
    assert.equal(failed.error.result.status, "failed");
    assert.equal(failed.error.result.error?.code, "ERR_PRISM_TURN_POLICY");
    assert.equal(failed.error.result.stopReason, undefined);
    assert.equal(requests.length, 1, "the throwing boundary never reached the provider");
    assert.ok(writes >= 1, "the failure still writes a terminal checkpoint");

    const state = await loadAgentRunState(counting, { runId: failed.runId });
    assert.equal(state.state.status, "failed");
    assert.equal(state.state.stopReason, undefined, "a failed run is never marked continuable");
    // Fail closed: a thrown policy cannot be continued, and writes no provider turn.
    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          { runId: failed.runId, sessionId: "throwing-session" },
          { decision: "continue", expectedVersion: state.record.version },
          { checkpoints: counting, definitionRevision: "1" },
        ),
      /Stale or non-running/,
    );
  });

  it("carries a steer queued before the stop into the resumed turn exactly once", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const requests: ProviderRequest[] = [];
    const steer = "also check the margin metric";
    const { agent, attach } = turnPolicyAgent({ requests, onTool: (active) => active.steer(steer) });
    const session = attach(agent.createSession({ id: "steer-session" }));

    const stopped = await runCapturingId(session, "investigate", {
      turnPolicy: { stop: (ctx) => (ctx.turns >= 1 ? { action: "stop", reason: "awaiting-review" } : { action: "continue" }) },
      runState: { checkpoints, definitionRevision: "1", checkpointPolicy: "every-turn" },
    });
    assert.ok(stopped.result, String(stopped.error));
    assert.equal(stopped.result.stopReason, "host_policy");
    assert.equal(requests.length, 1);
    assert.equal(textOccurrences(requests.at(0) as ProviderRequest, steer), 0, "the stopped leg never sends the steer");
    const state = await loadAgentRunState(checkpoints, { runId: stopped.runId });
    assert.equal(state.state.stopReason, "host_policy");

    const resumed = await resumeAgentRun(
      agent,
      { runId: stopped.runId, sessionId: "steer-session" },
      { decision: "continue", expectedVersion: state.record.version },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(resumed.status, "succeeded");
    const resumedRequest = requests[1];
    assert.ok(resumedRequest, "the resumed leg made a provider request");
    assert.equal(textOccurrences(resumedRequest, steer), 1, "the steer is delivered exactly once");
    assert.equal(
      resumed.content.filter((block) => block.type === "text").length,
      1,
      "the resumed leg produced exactly one assistant message",
    );
  });

  it("stops cleanly on turnPolicy.maxTurns and refuses to widen limits.maxTurns", async () => {
    const requests: ProviderRequest[] = [];
    const stopped = await turnPolicyAgent({ requests })
      .agent.createSession({ id: "cap-session" })
      .run("go", {
        turnPolicy: { maxTurns: 1 },
      });
    assert.equal(stopped.status, "succeeded");
    assert.equal(stopped.stopReason, "turn_limit");
    assert.equal(stopped.stopDetail, "maxTurns");
    assert.equal(requests.length, 1, "the cap ended the run instead of running turn 2");

    await assert.rejects(
      () =>
        turnPolicyAgent({ requests })
          .agent.createSession({ id: "widen-session" })
          .run("go", { limits: { maxTurns: 2 }, turnPolicy: { maxTurns: 3 } }),
      /cannot widen limits.maxTurns/,
    );
  });
  it("fails closed on an unusable stop reason and redacts a bounded one", async () => {
    const secret = "sk-live-turn-policy";
    const requests: ProviderRequest[] = [];
    const ended = await turnPolicyAgent({ requests })
      .agent.createSession({ id: "redact-session" })
      .run("go", {
        redactor: { redact: <T>(value: T): T => (typeof value === "string" ? (value.split(secret).join("[REDACTED]") as T) : value) },
        turnPolicy: { stop: () => ({ action: "stop", reason: `stopped with ${secret} in the reason` }) },
      });
    assert.equal(ended.status, "succeeded");
    assert.equal(ended.stopReason, "host_policy");
    assert.equal(ended.stopDetail, "stopped with [REDACTED] in the reason");
    assert.equal(requests.length, 0, "a stop at the first boundary makes no provider call");

    for (const reason of ["", "x".repeat(257)]) {
      await assert.rejects(
        () =>
          turnPolicyAgent({ requests })
            .agent.createSession({ id: "bad-reason" })
            .run("go", { turnPolicy: { stop: () => ({ action: "stop", reason }) } }),
        (error: unknown) => error instanceof AgentRunError && error.result.error?.code === "ERR_PRISM_TURN_POLICY",
      );
    }
    await assert.rejects(
      () =>
        turnPolicyAgent({ requests })
          .agent.createSession({ id: "async-decision" })
          .run("go", { turnPolicy: { stop: (() => Promise.resolve({ action: "continue" })) as never } }),
      (error: unknown) => error instanceof AgentRunError && error.result.error?.code === "ERR_PRISM_TURN_POLICY",
    );
  });
});
