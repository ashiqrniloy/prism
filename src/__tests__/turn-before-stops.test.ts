import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { AgentEvent, Session, CheckpointStore, ProviderRequest, RunLedger, RunOptions, RunRecord } from "../contracts.js";
import {
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  loadAgentRunState,
  providerDone,
  providerTextDelta,
  resumeAgentRun,
  toolCallContent,
  type HookRegistrar,
  type TurnBeforePayload,
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

/** Captures the run id from `run.started` while the run is in flight. */
async function runCapturingId(session: Session, input: string, options: RunOptions) {
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
  const runId = events.find((event) => event.type === "run.started")?.runId;
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
async function turnGateAgent(options: {
  readonly requests: ProviderRequest[];
  readonly onTool?: (session: Session) => void;
  readonly onGenerate?: (turn: number) => void;
  readonly onTurnBefore?: (registrar: HookRegistrar) => void;
}) {
  let turn = 0;
  let session: Session | undefined;
  const agent = await createAgent({
    id: "turn-before",
    slots: { store: createMemorySessionStore() },
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
    tools: {
      add: [
        {
          name: "digest",
          parameters: {},
          execute: () => {
            if (session) options.onTool?.(session);
            return { toolCallId: "call-1", name: "digest", value: "ok" };
          },
        },
      ],
    },
    ...(options.onTurnBefore ? { hooks: options.onTurnBefore } : {}),
  });
  return {
    agent,
    attach: (active: Session) => {
      session = active;
      return active;
    },
  };
}

describe("turn.before stops", () => {
  it("turn_before_stop_replaces_turn_policy", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const requests: ProviderRequest[] = [];
    const { ledger, runs } = createMemoryLedger();
    let calls = 0;
    const { agent } = await turnGateAgent({
      requests,
      onTurnBefore: (hooks) =>
        hooks.on("turn.before", (turn: TurnBeforePayload) => {
          calls += 1;
          return turn.turn > 1 ? { stop: "l1-first-plan-paint" } : undefined;
        }),
    });
    const session = await agent.session({ id: "stop-session", create: true });

    const stopped = await runCapturingId(session, "investigate", {
      runLedger: ledger,
      runState: { checkpoints, definitionRevision: "1", checkpointPolicy: "every-turn" },
    });
    // Two boundaries: turn 1 (continue) and turn 2 (stop) — one consult per provider turn.
    assert.equal(calls, 2, "the gate is consulted once per turn boundary");
    assert.ok(stopped.result, String(stopped.error));
    assert.equal(stopped.result.status, "stopped");
    assert.equal(stopped.result.stopReason, "hook_stop");
    assert.equal(stopped.result.stopDetail, "l1-first-plan-paint");
    assert.equal(requests.length, 1, "no provider call after the stop");
    const finished = stopped.events.find((event) => event.type === "run.completed");
    assert.equal(finished?.type === "run.completed" ? finished.stopReason : undefined, "hook_stop");
    assert.equal(finished?.type === "run.completed" ? finished.stopDetail : undefined, "l1-first-plan-paint");
    const finishRecord = runs.find((record) => record.status === "succeeded");
    assert.ok(finishRecord, "one finish ledger record");
    assert.equal(finishRecord.stopReason, "hook_stop");
    assert.equal(finishRecord.stopDetail, "l1-first-plan-paint");

    const state = await loadAgentRunState(checkpoints, { runId: stopped.runId });
    assert.equal(state.state.status, "succeeded");
    assert.equal(state.state.stopReason, "hook_stop");

    const resumed = await resumeAgentRun(
      agent,
      { runId: stopped.runId, sessionId: "stop-session" },
      { decision: "continue", expectedVersion: state.record.version },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(resumed.status, "completed");
    assert.equal(resumed.stopReason, undefined, "the resumed leg runs without a stop");
    assert.equal(requests.length, 2, "the resumed leg runs the next provider turn");
  });

  it("keeps requests byte-identical between no gate and an always-continue gate", async () => {
    const baselineRequests: ProviderRequest[] = [];
    const baseline = await (
      await (await turnGateAgent({ requests: baselineRequests })).agent.session({ id: "gate-identity", create: true })
    ).run("go");
    assert.equal(baseline.status, "completed");
    assert.equal(baseline.stopReason, undefined);

    const guardedRequests: ProviderRequest[] = [];
    const guarded = await (
      await (
        await turnGateAgent({
          requests: guardedRequests,
          onTurnBefore: (hooks) => hooks.on("turn.before", () => undefined),
        })
      ).agent.session({ id: "gate-identity", create: true })
    ).run("go");
    assert.equal(guarded.status, "completed");
    assert.equal(guarded.stopReason, undefined);
    assert.equal(guarded.text, baseline.text);
    assert.equal(guardedRequests.length, baselineRequests.length);
    assert.equal(
      JSON.stringify(guardedRequests),
      JSON.stringify(baselineRequests),
      "an always-continue gate must not perturb the provider request stream",
    );
  });

  it("fails closed with no continuable checkpoint when the handler throws", async () => {
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
    const { agent } = await turnGateAgent({
      requests,
      onTurnBefore: (hooks) =>
        hooks.on("turn.before", (turn) => {
          if (turn.turn > 1) throw new Error("gate bug");
          return undefined;
        }),
    });
    const session = await agent.session({ id: "throwing-session", create: true });

    const failed = await runCapturingId(session, "go", {
      runState: { checkpoints: counting, definitionRevision: "1", checkpointPolicy: "every-turn" },
    });
    assert.ok(failed.result, "a failed run returns its result");
    assert.equal(failed.result.status, "failed");
    assert.match(failed.result.error?.message ?? "", /gate bug/);
    assert.equal(failed.result.stopReason, undefined);
    assert.equal(requests.length, 1, "the throwing boundary never reached the provider");
    assert.ok(writes >= 1, "the failure still writes a terminal checkpoint");

    const state = await loadAgentRunState(counting, { runId: failed.runId });
    assert.equal(state.state.status, "failed");
    assert.equal(state.state.stopReason, undefined, "a failed run is never marked continuable");
    // Fail closed: a thrown gate cannot be continued, and writes no provider turn.
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
    const { agent, attach } = await turnGateAgent({
      requests,
      onTool: (active) => active.steer(steer),
      onTurnBefore: (hooks) => hooks.on("turn.before", (turn) => (turn.turn > 1 ? { stop: "awaiting-review" } : undefined)),
    });
    const session = attach(await agent.session({ id: "steer-session", create: true }));

    const stopped = await runCapturingId(session, "investigate", {
      runState: { checkpoints, definitionRevision: "1", checkpointPolicy: "every-turn" },
    });
    assert.ok(stopped.result, String(stopped.error));
    assert.equal(stopped.result.stopReason, "hook_stop");
    assert.equal(requests.length, 1);
    assert.equal(textOccurrences(requests.at(0) as ProviderRequest, steer), 0, "the stopped leg never sends the steer");
    const state = await loadAgentRunState(checkpoints, { runId: stopped.runId });
    assert.equal(state.state.stopReason, "hook_stop");

    const resumed = await resumeAgentRun(
      agent,
      { runId: stopped.runId, sessionId: "steer-session" },
      { decision: "continue", expectedVersion: state.record.version },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(resumed.status, "completed");
    const resumedRequest = requests[1];
    assert.ok(resumedRequest, "the resumed leg made a provider request");
    assert.equal(textOccurrences(resumedRequest, steer), 1, "the steer is delivered exactly once");
    assert.equal(
      resumed.content.filter((block) => block.type === "text").length,
      1,
      "the resumed leg produced exactly one assistant message",
    );
  });

  it("a stop at the first boundary makes no provider call and redacts a bounded reason", async () => {
    const secret = "sk-live-turn-policy";
    const requests: ProviderRequest[] = [];
    const ended = await (
      await (
        await turnGateAgent({
          requests,
          onTurnBefore: (hooks) => hooks.on("turn.before", () => ({ stop: `stopped with ${secret} in the reason` })),
        })
      ).agent.session()
    ).run("go", {
      redactor: { redact: <T>(value: T): T => (typeof value === "string" ? (value.split(secret).join("[REDACTED]") as T) : value) },
    });
    assert.equal(ended.status, "stopped");
    assert.equal(ended.stopReason, "hook_stop");
    assert.equal(ended.stopDetail, "stopped with [REDACTED] in the reason");
    assert.equal(requests.length, 0, "a stop at the first boundary makes no provider call");
  });

  it("truncates an over-long stop reason to the 256-byte bound", async () => {
    const requests: ProviderRequest[] = [];
    const ended = await (
      await (
        await turnGateAgent({
          requests,
          onTurnBefore: (hooks) => hooks.on("turn.before", () => ({ stop: "x".repeat(1000) })),
        })
      ).agent.session()
    ).run("go");
    assert.equal(ended.status, "stopped");
    assert.equal(ended.stopReason, "hook_stop");
    assert.equal(ended.stopDetail?.length, 256);
  });
});
