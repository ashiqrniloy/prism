import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { SessionStore } from "../contracts-core.js";
import {
  type Agent,
  type AgentEvent,
  AgentDecisionError,
  type Decision,
  type JsonObject,
  type PendingDecision,
  type Session,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  loadSuspendedRunEntry,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";
import { createSuspendedRunEntry } from "../suspended-run.js";

function parallelProvider() {
  let turn = 0;
  return {
    id: "mock",
    async *generate() {
      turn += 1;
      if (turn === 1) {
        yield { type: "tool_call" as const, call: toolCallContent("call-1", "write", { value: "a" }) };
        yield { type: "tool_call" as const, call: toolCallContent("call-2", "write", { value: "b" }) };
        yield providerDone();
        return;
      }
      yield providerTextDelta("finished");
      yield providerDone();
    },
  };
}

async function decisionAgent(executed: string[], provider = parallelProvider()) {
  const store = createMemorySessionStore();
  const agent = await createAgent({
    hooks: askEveryTool(),
    id: "decision-demo",
    model: { provider: "mock", model: "demo" },
    slots: { store },
    packages: [providerPackage("test-provider", [provider])],
    tools: {
      add: [
        {
          name: "write",
          parameters: {},
          execute: (args: JsonObject, context: { toolCallId: string }) => {
            executed.push(`${context.toolCallId}:${JSON.stringify(args)}`);
            return { toolCallId: context.toolCallId, name: "write", value: "done" };
          },
        },
      ],
    },
  });
  return { agent, store };
}

/** Run to a suspension: plan 168 Task 5 anchors a durable run on the store slot's entry, not a host store. */
async function suspend(
  agent: Agent,
  _store: SessionStore,
  sessionId: string,
): Promise<{ session: Session; runId: string; pending: readonly PendingDecision[] }> {
  const session = await agent.session({ id: sessionId, create: true });
  const first = await session.run("go");
  assert.equal(first.status, "suspended");
  return { session, runId: first.runId, pending: first.pending ?? [] };
}

/** Drain a resume; the last event is the run's terminal (or re-suspension) event. */
async function collect(events: AsyncIterable<AgentEvent>): Promise<readonly AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

async function resumeSuspended(session: Session, decisions: readonly Decision[]): Promise<AgentEvent | undefined> {
  return (await collect(session.resume(decisions))).at(-1);
}

const allowOnce = (approvalId: string, extra: Partial<Decision> = {}): Decision => ({ approvalId, outcome: "allow_once", ...extra });
const allowAll = (pending: readonly PendingDecision[]): Decision[] => pending.map((d) => allowOnce(d.approvalId));

describe("shared pending decisions", () => {
  it("collects a parallel tool round into one suspension and applies an approve-all batch", async () => {
    const executed: string[] = [];
    const { agent, store } = await decisionAgent(executed);
    const { session, pending } = await suspend(agent, store, "s1");
    assert.ok(pending[0]);

    assert.equal(executed.length, 0);
    assert.equal(pending.length, 2);
    assert.equal(pending[0]?.scope.toolName, "write");
    assert.match(pending[0]?.scope.argumentsHash ?? "", /^[a-f0-9]{64}$/);

    const last = await resumeSuspended(session, allowAll(pending));
    assert.equal(last?.type, "run.completed");
    assert.deepEqual(executed, ['call-1:{"value":"a"}', 'call-2:{"value":"b"}']);
  });

  // `session.resume` (the store-slot path) requires a decision for every pending request, unlike the
  // retired `resumeAgentRun`, whose strict-subset batch re-suspended with the remainder.
  it("fails a strict-subset batch closed and leaves the suspension untouched", async () => {
    const executed: string[] = [];
    const { agent, store } = await decisionAgent(executed);
    const { session, pending } = await suspend(agent, store, "s2");
    assert.ok(pending[0]);

    await assert.rejects(
      collect(session.resume([allowOnce(pending[0].approvalId)])),
      (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID",
    );
    const suspended = await loadSuspendedRunEntry(store, "s2");
    assert.equal(suspended?.state.interruption?.pendingDecisions?.length, 2);
    assert.equal(executed.length, 0);

    const done = await resumeSuspended(session, allowAll(pending));
    assert.equal(done?.type, "run.completed");
    assert.deepEqual(executed, ['call-1:{"value":"a"}', 'call-2:{"value":"b"}']);
  });

  it("fails the whole batch closed on unknown or duplicate approval ids", async () => {
    const { agent, store } = await decisionAgent([]);
    const { session, pending } = await suspend(agent, store, "s3");
    assert.ok(pending[0]);

    await assert.rejects(
      collect(
        session.resume([allowOnce(pending[0].approvalId), { approvalId: pending[0].approvalId, outcome: "reject_once" } as Decision]),
      ),
      (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_DUPLICATE",
    );
    await assert.rejects(collect(session.resume([allowOnce("foreign")])), (error: unknown) => {
      assert.ok(error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_UNKNOWN");
      assert.ok(!error.message.includes("foreign")); // non-enumerating
      return true;
    });
    // Every rejection left the suspension untouched.
    const suspended = await loadSuspendedRunEntry(store, "s3");
    assert.equal(suspended?.state.status, "suspended");
    assert.equal(suspended?.state.interruption?.pendingDecisions?.length, 2);
  });

  it("rejects invalid batches: empty, oversized reasons, mixed decision shapes", async () => {
    const { agent, store } = await decisionAgent([]);
    const { session, pending } = await suspend(agent, store, "s4");
    assert.ok(pending[0]);

    await assert.rejects(
      collect(session.resume([])),
      (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID",
    );
    await assert.rejects(
      collect(session.resume([allowOnce(pending[0].approvalId, { reason: "x".repeat(2049) })])),
      (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_LIMIT",
    );
    await assert.rejects(
      collect(session.resume([allowOnce(pending[0].approvalId, { elicitation: { a: 1 } })])),
      (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_SCOPE",
    );
  });

  it("reject_once continues the run with a blocked result and keeps the reason", async () => {
    const executed: string[] = [];
    const { agent, store } = await decisionAgent(executed);
    const { session, pending } = await suspend(agent, store, "s5");
    assert.ok(pending[0]);
    assert.ok(pending[1]);

    const last = await resumeSuspended(session, [
      { approvalId: pending[0].approvalId, outcome: "reject_once", reason: "not safe" },
      allowOnce(pending[1].approvalId),
    ]);
    assert.equal(last?.type, "run.completed");
    assert.deepEqual(executed, ['call-2:{"value":"b"}']);
  });

  it("allow_for_run sticks within the exact scope and expires at run end", async () => {
    const executed: string[] = [];
    let turn = 0;
    const { agent, store } = await decisionAgent(executed, {
      id: "mock",
      async *generate() {
        turn += 1;
        if (turn === 1) {
          yield { type: "tool_call" as const, call: toolCallContent("call-1", "write", { value: "same" }) };
          yield providerDone();
          return;
        }
        if (turn === 2) {
          yield { type: "tool_call" as const, call: toolCallContent("call-2", "write", { value: "same" }) };
          yield { type: "tool_call" as const, call: toolCallContent("call-3", "write", { value: "different" }) };
          yield providerDone();
          return;
        }
        yield providerTextDelta("finished");
        yield providerDone();
      },
    });
    const { session, pending } = await suspend(agent, store, "s6");
    assert.ok(pending[0]);

    const second = await resumeSuspended(session, [{ approvalId: pending[0].approvalId, outcome: "allow_for_run" }]);
    // call-2 matches the sticky scope (same tool + arguments) and runs without a suspension;
    // call-3 has different arguments and suspends the run again.
    assert.equal(second?.type, "run.suspended");
    assert.deepEqual(executed, ['call-1:{"value":"same"}', 'call-2:{"value":"same"}']);
    const remaining = (await loadSuspendedRunEntry(store, "s6"))?.state.interruption?.pendingDecisions ?? [];
    assert.ok(remaining[0]);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].toolCallId, "call-3");

    const done = await resumeSuspended(session, [allowOnce(remaining[0].approvalId)]);
    assert.equal(done?.type, "run.completed");
    // The suspension is resolved: the branch tip moved past its entry, so a second resume is stale.
    await assert.rejects(
      collect(session.resume([allowOnce(remaining[0].approvalId)])),
      (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_STALE",
    );
  });

  it("reject_for_run blocks later in-scope calls without executing them", async () => {
    const executed: string[] = [];
    let turn = 0;
    const { agent, store } = await decisionAgent(executed, {
      id: "mock",
      async *generate() {
        turn += 1;
        if (turn <= 2) {
          yield { type: "tool_call" as const, call: toolCallContent(`call-${turn}`, "write", { value: "same" }) };
          yield providerDone();
          return;
        }
        yield providerTextDelta("finished");
        yield providerDone();
      },
    });
    const { session, pending } = await suspend(agent, store, "s7");
    assert.ok(pending[0]);

    const last = await resumeSuspended(session, [
      { approvalId: pending[0].approvalId, outcome: "reject_for_run", reason: "denied for run" },
    ]);
    assert.equal(last?.type, "run.completed");
    assert.deepEqual(executed, []);
  });

  it("revalidates modified arguments and executes with them exactly once", async () => {
    const executed: string[] = [];
    const store = createMemorySessionStore();
    const agent = await createAgent({
      hooks: askEveryTool(),
      id: "modified-args-demo",
      model: { provider: "mock", model: "demo" },
      slots: { store },
      packages: [providerPackage("test-provider", [parallelProvider()])],
      validator: (_tool: unknown, args: unknown) =>
        typeof (args as { value?: unknown }).value === "string" ? undefined : "value must be a string",
      tools: {
        add: [
          {
            name: "write",
            parameters: {},
            execute: (args: JsonObject, context: { toolCallId: string }) => {
              executed.push(`${context.toolCallId}:${JSON.stringify(args)}`);
              return { toolCallId: context.toolCallId, name: "write", value: "done" };
            },
          },
        ],
      },
    });
    const { session, pending } = await suspend(agent, store, "s8");
    assert.ok(pending[0]);
    assert.ok(pending[1]);

    await assert.rejects(
      collect(session.resume([allowOnce(pending[0].approvalId, { modifiedArguments: { value: 42 } }), allowOnce(pending[1].approvalId)])),
      (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID",
    );
    // Atomic failure: still suspended with both decisions pending, nothing executed.
    assert.equal((await loadSuspendedRunEntry(store, "s8"))?.state.interruption?.pendingDecisions?.length, 2);
    assert.equal(executed.length, 0);

    const last = await resumeSuspended(session, [
      allowOnce(pending[0].approvalId, { modifiedArguments: { value: "edited" } }),
      allowOnce(pending[1].approvalId),
    ]);
    assert.equal(last?.type, "run.completed");
    assert.deepEqual(executed, ['call-1:{"value":"edited"}', 'call-2:{"value":"b"}']);
  });

  it("validates elicitation payloads against the recorded schema and resolves the call", async () => {
    const executed: string[] = [];
    const { agent, store } = await decisionAgent(executed);
    const { session, runId, pending } = await suspend(agent, store, "s9");
    assert.ok(pending[0]);
    const suspension = await loadSuspendedRunEntry(store, "s9");
    const tipEntry = (await session.entries()).at(-1);
    assert.ok(tipEntry);
    const tip = tipEntry.id;
    assert.ok(suspension);
    assert.ok(suspension.state.pendingCalls);
    const pendingCall = suspension.state.pendingCalls[0];
    assert.ok(pendingCall);
    const approvalId = pendingCall.approvalId;
    assert.equal(pending[0].approvalId, approvalId);

    // Re-publish the suspension as an elicitation entry (a package maps this in the ask path).
    await store.append(
      createSuspendedRunEntry({
        id: "entry-elicitation",
        sessionId: "s9",
        parentId: tip,
        runId,
        loop: suspension.loop,
        hookIds: suspension.hookIds,
        state: {
          ...suspension.state,
          pendingCalls: [pendingCall],
          interruption: {
            kind: "elicitation",
            reason: "Need operator input",
            pendingDecisions: [
              {
                approvalId,
                kind: "elicitation",
                toolCallId: "call-1",
                scope: { toolName: "write" },
                reason: "Need operator input",
                elicitationSchema: { type: "object", required: ["choice"] },
              },
            ],
          },
        },
      }),
    );

    await session.checkout("entry-elicitation");
    await assert.rejects(
      collect(session.resume([allowOnce(approvalId, { elicitation: {} })])),
      (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID",
    );
    const last = await resumeSuspended(session, [allowOnce(approvalId, { elicitation: { choice: "a" } })]);
    assert.equal(last?.type, "run.completed");
    assert.deepEqual(executed, []); // elicitation resolved the call without executing the tool
  });

  it("produces elicitation pending decisions from a tool's declared hook and enforces its validate fn", async () => {
    const executed: string[] = [];
    let turn = 0;
    const store = createMemorySessionStore();
    const agent = await createAgent({
      hooks: askEveryTool(),
      id: "elicitation-demo",
      model: { provider: "mock", model: "demo" },
      slots: { store },
      packages: [
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              turn += 1;
              if (turn === 1) {
                yield { type: "tool_call" as const, call: toolCallContent("call-1", "ask", { question: "Pick one" }) };
                yield providerDone();
                return;
              }
              yield providerTextDelta("finished");
              yield providerDone();
            },
          },
        ]),
      ],
      tools: {
        add: [
          {
            name: "ask",
            parameters: {},
            elicitation: () => ({
              schema: { type: "object", required: ["choice"], properties: { choice: { enum: ["a", "b"] } } },
              reason: "Pick one",
              validate: (payload) => {
                if (payload.choice !== "a" && payload.choice !== "b") throw new Error("unknown option");
              },
            }),
            execute: (_args: JsonObject, context: { toolCallId: string }) => {
              executed.push(context.toolCallId);
              return { toolCallId: context.toolCallId, name: "ask", value: "executed" };
            },
          },
        ],
      },
    });
    const { session, pending } = await suspend(agent, store, "s10");
    assert.ok(pending[0]);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.kind, "elicitation");
    assert.equal(pending[0]?.reason, "Pick one");
    assert.deepEqual(pending[0]?.elicitationSchema?.required, ["choice"]);

    // The tool's validate fn rejects out-of-set answers even though required keys are present.
    await assert.rejects(
      collect(session.resume([allowOnce(pending[0].approvalId, { elicitation: { choice: "z" } })])),
      (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID",
    );
    const last = await resumeSuspended(session, [allowOnce(pending[0].approvalId, { elicitation: { choice: "a" } })]);
    assert.equal(last?.type, "run.completed");
    assert.deepEqual(executed, []); // elicitation resolved without executing
  });
});
