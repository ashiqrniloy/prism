/**
 * Plan 104 Task 6: decision-time revalidation of modified arguments includes the session's pack rules.
 *
 * An approval that edits arguments into a state a pack rule refuses is rejected while the decision is
 * validated (`ERR_PRISM_DECISION_INVALID`, rule named) instead of being accepted and only stopped at
 * dispatch — and a rejected batch is atomic, so no `allow_for_run` allowance is written for it. A pack
 * restores from the checkpoint, so the resumed session is the only party that can supply these rules;
 * they are passed explicitly and never merged into `agent.config.guardrails`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AgentDecisionError,
  type JsonObject,
  type ProviderEvent,
  type ProviderRequest,
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  loadAgentRunState,
  providerDone,
  providerTextDelta,
  providerToolCall,
  resumeAgentRun,
  toolCallContent,
} from "../index.js";

const ASK_PACK = {
  id: "deploy-guard",
  rules: [
    {
      id: "ask-prod-version",
      tool: "deploy",
      argPath: "version",
      pattern: "^prod-",
      action: "ask" as const,
      reason: "Production tags need approval",
    },
  ],
};
const ASK_RULE = "pack:deploy-guard/ask-prod-version";

const DENY_PACK = {
  id: "deploy-guard",
  rules: [
    {
      id: "no-prod-version",
      tool: "deploy",
      argPath: "version",
      pattern: "^prod-",
      action: "deny" as const,
      reason: "Production tags are frozen",
    },
  ],
};
const DENY_RULE = "pack:deploy-guard/no-prod-version";

/**
 * `persistSessionState` is what lets the pack ride the checkpoint (plan 104 T2), so the resumed session
 * is the party that holds the compiled rules this task revalidates with.
 */
const DURABLE = (checkpoints: ReturnType<typeof createMemoryCheckpointStore>, extra: Record<string, unknown> = {}) => ({
  checkpoints,
  definitionRevision: "1",
  persistSessionState: true,
  ...extra,
});

function deployAgent(executions: string[], calls: JsonObject[]) {
  const requests: ProviderRequest[] = [];
  let turn = 0;
  const agent = createAgent({
    id: "decision-revalidation",
    store: createMemorySessionStore(),
    model: { provider: "mock", model: "demo" },
    provider: {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        turn += 1;
        const events: readonly ProviderEvent[] =
          turn === 1
            ? [providerToolCall(toolCallContent("call-deploy", "deploy", { version: "prod-1" })), providerDone()]
            : [providerTextDelta("shipped"), providerDone()];
        for (const event of events) yield event;
      },
    },
    tools: [
      {
        name: "deploy",
        parameters: {},
        execute: (args, context) => {
          executions.push(context.toolCallId);
          calls.push(args);
          return { toolCallId: context.toolCallId, name: "deploy", value: "deployed" };
        },
      },
    ],
  });
  return { agent, requests };
}

/** Suspends one deploy call and returns the pieces a resume needs. */
async function suspend(session: ReturnType<ReturnType<typeof createAgent>["createSession"]>, options: Record<string, unknown>) {
  const suspended = await session.run("ship the release", { runState: options as never });
  assert.equal(suspended.status, "suspended");
  const approvalId = suspended.interruption?.pendingDecisions?.[0]?.approvalId;
  const expectedVersion = suspended.runState?.version;
  assert.ok(approvalId !== undefined && expectedVersion !== undefined, "the suspension carries a decision id and version");
  return { ref: { runId: suspended.runId, sessionId: suspended.sessionId }, approvalId, expectedVersion };
}

describe("pack decision-time revalidation (plan 104 Task 6)", () => {
  it("rejects an approve-with-edits that still trips the pack rule, naming it", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executions: string[] = [];
    const calls: JsonObject[] = [];
    const { agent } = deployAgent(executions, calls);
    const session = agent.createSession({ id: "revalidate-ask", guardrailPacks: [ASK_PACK] });
    const { ref, approvalId, expectedVersion } = await suspend(session, DURABLE(checkpoints));

    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          ref,
          { decisions: [{ approvalId, outcome: "allow_once", modifiedArguments: { version: "prod-2" } }], expectedVersion },
          DURABLE(checkpoints),
        ),
      (error: unknown) =>
        error instanceof AgentDecisionError &&
        error.code === "ERR_PRISM_DECISION_INVALID" &&
        error.message.includes(`rule ${ASK_RULE}`) &&
        error.message.includes("Production tags need approval") &&
        !error.message.includes("prod-2"),
    );
    assert.deepEqual(executions, [], "the edited call never dispatched, so no effect could be recorded");
    const untouched = await loadAgentRunState(checkpoints, ref);
    assert.equal(untouched.record.version, expectedVersion, "a refused decision leaves the checkpoint untouched");
    assert.equal(untouched.state.stickyDecisions ?? undefined, undefined, "no sticky decision is written");

    // The same suspension is still decidable as-is: the refusal changed nothing but the decision.
    const resumed = await resumeAgentRun(
      agent,
      ref,
      { decisions: [{ approvalId, outcome: "allow_once" }], expectedVersion },
      DURABLE(checkpoints),
    );
    assert.equal(resumed.status, "succeeded");
    assert.deepEqual(calls, [{ version: "prod-1" }]);
  });

  it("dispatches an approve-with-edits that no pack rule refuses", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executions: string[] = [];
    const calls: JsonObject[] = [];
    const { agent } = deployAgent(executions, calls);
    const session = agent.createSession({ id: "revalidate-benign", guardrailPacks: [ASK_PACK] });
    const { ref, approvalId, expectedVersion } = await suspend(session, DURABLE(checkpoints));

    const resumed = await resumeAgentRun(
      agent,
      ref,
      { decisions: [{ approvalId, outcome: "allow_once", modifiedArguments: { version: "staging-2" } }], expectedVersion },
      DURABLE(checkpoints),
    );

    assert.equal(resumed.status, "succeeded");
    assert.deepEqual(calls, [{ version: "staging-2" }], "the edit dispatches, the pack does not fire");
    assert.deepEqual(executions, ["call-deploy"]);
  });

  it("refuses an edit into a pack deny rule instead of letting the run die at dispatch", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executions: string[] = [];
    const calls: JsonObject[] = [];
    const { agent } = deployAgent(executions, calls);
    const session = agent.createSession({ id: "revalidate-deny", guardrailPacks: [DENY_PACK] });
    // The all-tools gate suspends before dispatch; the pack rule would have blocked at dispatch.
    const { ref, approvalId, expectedVersion } = await suspend(session, DURABLE(checkpoints, { interruptBeforeTool: true }));

    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          ref,
          { decisions: [{ approvalId, outcome: "allow_once", modifiedArguments: { version: "prod-9" } }], expectedVersion },
          DURABLE(checkpoints, { interruptBeforeTool: true }),
        ),
      (error: unknown) =>
        error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID" && error.message.includes(`rule ${DENY_RULE}`),
    );
    assert.deepEqual(executions, [], "the run does not reach dispatch");

    const resumed = await resumeAgentRun(
      agent,
      ref,
      { decisions: [{ approvalId, outcome: "allow_once", modifiedArguments: { version: "staging-9" } }], expectedVersion },
      DURABLE(checkpoints, { interruptBeforeTool: true }),
    );
    assert.equal(resumed.status, "succeeded");
    assert.deepEqual(calls, [{ version: "staging-9" }], "the deny rule refuses only what it matches");
  });

  it("does not write an allow_for_run allowance for a pack-violating edit", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executions: string[] = [];
    const calls: JsonObject[] = [];
    const { agent } = deployAgent(executions, calls);
    const session = agent.createSession({ id: "revalidate-sticky", guardrailPacks: [ASK_PACK] });
    const { ref, approvalId, expectedVersion } = await suspend(session, DURABLE(checkpoints));

    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          ref,
          { decisions: [{ approvalId, outcome: "allow_for_run", modifiedArguments: { version: "prod-3" } }], expectedVersion },
          DURABLE(checkpoints),
        ),
      (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID",
    );
    const untouched = await loadAgentRunState(checkpoints, ref);
    assert.equal(untouched.state.stickyDecisions ?? undefined, undefined, "the run-wide allowance was never recorded");
    assert.equal(untouched.record.version, expectedVersion);

    // Nothing was remembered: the same edited request is refused again, while the unedited allowance
    // still resumes the run (the pack is not bypassed, and it is not blanket-refusing either).
    await assert.rejects(
      () =>
        resumeAgentRun(
          agent,
          ref,
          { decisions: [{ approvalId, outcome: "allow_for_run", modifiedArguments: { version: "prod-3" } }], expectedVersion },
          DURABLE(checkpoints),
        ),
      (error: unknown) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID",
    );
    const resumed = await resumeAgentRun(
      agent,
      ref,
      { decisions: [{ approvalId, outcome: "allow_for_run" }], expectedVersion },
      DURABLE(checkpoints),
    );
    assert.equal(resumed.status, "succeeded");
    assert.deepEqual(calls, [{ version: "prod-1" }], "the unedited allowance dispatched the call it was given");
  });
});
