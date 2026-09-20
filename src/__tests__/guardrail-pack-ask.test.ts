/**
 * Plan 104 Task 3: pack `ask` rules — selective durable suspension without an all-tools gate.
 *
 * A matching call in a durable run suspends before dispatch (the pending decision names the rule),
 * and the same call in a run that cannot suspend is refused by the ordinary stage path instead of
 * failing the run. The pack is inline on purpose: it is the host-reachable form, and since Task 3 an
 * inline pack rides a checkpoint as its pattern rules (guardrail-pack-durability covers the shape).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgentEvent,
  type ContentBlock,
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

type GuardrailDecisionEvent = Extract<AgentEvent, { type: "guardrail_decision" }>;
type ToolBlockedEvent = Extract<AgentEvent, { type: "tool_execution_blocked" }>;

const PACK = {
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

const RULE = "pack:deploy-guard/ask-prod-version";

function deployAgent(script: (turn: number) => readonly ProviderEvent[], executions: string[]) {
  const requests: ProviderRequest[] = [];
  const store = createMemorySessionStore();
  let turn = 0;
  const agent = createAgent({
    id: "pack-ask",
    store,
    model: { provider: "mock", model: "demo" },
    provider: {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        turn += 1;
        for (const event of script(turn)) yield event;
      },
    },
    tools: [
      { name: "inspect", parameters: {}, execute: () => ({ toolCallId: "call-inspect", name: "inspect", value: "ok" }) },
      {
        name: "deploy",
        parameters: {},
        execute: (_args, context) => {
          executions.push(context.toolCallId);
          return { toolCallId: context.toolCallId, name: "deploy", value: "deployed" };
        },
      },
    ],
  });
  return { agent, requests, store };
}

const deployCall = (id: string, version: string) => providerToolCall(toolCallContent(id, "deploy", { version }));

/** `guardrail_decision` records that mean "awaiting a decision" (the ask gate). */
const askDecisions = (events: readonly AgentEvent[]): GuardrailDecisionEvent[] =>
  events
    .filter((event): event is GuardrailDecisionEvent => event.type === "guardrail_decision")
    .filter((event) => event.record.action === "interrupt");

/** The tool result the loop appended for a call, read from the session store (it is not an event). */
async function toolResultOf(store: ReturnType<typeof createMemorySessionStore>, sessionId: string) {
  const entries = await store.list(sessionId);
  for (const entry of [...entries].reverse()) {
    const block = entry.message?.content.find(
      (part: ContentBlock): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result",
    );
    if (block) return block;
  }
  return undefined;
}

describe("guardrail pack ask gate (plan 104 Task 3)", () => {
  it("suspends before dispatch, names the rule, and allow_once dispatches exactly once", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executions: string[] = [];
    const { agent, requests } = deployAgent(
      (turn) => (turn === 1 ? [deployCall("call-deploy", "prod-1"), providerDone()] : [providerTextDelta("shipped"), providerDone()]),
      executions,
    );
    const session = agent.createSession({ id: "ask-approve", guardrailPacks: [PACK] });
    const events: AgentEvent[] = [];
    const subscription = session.subscribe();
    const pump = (async () => {
      for await (const event of subscription) events.push(event);
    })();
    const suspended = await session.run("ship prod", { runState: { checkpoints, definitionRevision: "1" } });
    await pump;

    assert.equal(suspended.status, "suspended");
    assert.deepEqual(executions, [], "the gated call never dispatched");
    assert.equal(suspended.interruption?.kind, "tool_approval");
    assert.equal(suspended.interruption?.guardrail, RULE);
    const pending = suspended.interruption?.pendingDecisions ?? [];
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.guardrail, RULE);
    assert.deepEqual(pending[0]?.guardrailRule, { pack: "deploy-guard", rule: "ask-prod-version" });
    assert.ok(String(pending[0]?.reason).includes(RULE), "the reason names the rule");
    assert.ok(String(pending[0]?.reason).includes("Production tags need approval"), "the reason carries the pack's own text");
    assert.equal(pending[0]?.kind, "tool_approval");
    const recorded = askDecisions(events);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]?.record.guardrail, RULE);
    assert.equal(recorded[0]?.toolCallId, "call-deploy");
    assert.equal(JSON.stringify(recorded).includes("prod-1"), false, "the rule identity never echoes arguments");
    assert.equal(requests.length, 1, "the suspension costs no extra provider turn");

    const expectedVersion = suspended.runState?.version;
    const approvalId = pending[0]?.approvalId;
    assert.ok(approvalId, "the suspension carries a decision id");
    assert.ok(expectedVersion !== undefined, "suspended result carries its checkpoint version");
    const resumed = await resumeAgentRun(
      agent,
      { runId: suspended.runId, sessionId: suspended.sessionId },
      { decisions: [{ approvalId, outcome: "allow_once" }], expectedVersion },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(resumed.status, "succeeded");
    assert.deepEqual(executions, ["call-deploy"], "approval dispatches the call exactly once");
    assert.equal(requests.length, 2);
  });

  it("allow_for_run sticks to the same scope while a different scope suspends again", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executions: string[] = [];
    const { agent } = deployAgent((turn) => {
      if (turn === 1) return [deployCall("call-first", "prod-1"), providerDone()];
      if (turn === 2) return [deployCall("call-same-scope", "prod-1"), providerDone()];
      if (turn === 3) return [deployCall("call-other-scope", "prod-2"), providerDone()];
      return [providerTextDelta("done"), providerDone()];
    }, executions);
    const session = agent.createSession({ id: "ask-sticky", guardrailPacks: [PACK] });

    let result = await session.run("ship", {
      runState: { checkpoints, definitionRevision: "1", persistSessionState: true },
    });
    assert.equal(result.status, "suspended");
    assert.deepEqual(executions, []);
    const firstVersion = result.runState?.version;
    const firstApproval = result.interruption?.pendingDecisions?.[0]?.approvalId;
    assert.ok(firstVersion !== undefined && firstApproval, "the suspension carries its version and decision id");

    result = await resumeAgentRun(
      agent,
      { runId: result.runId, sessionId: result.sessionId },
      { decisions: [{ approvalId: firstApproval, outcome: "allow_for_run" }], expectedVersion: firstVersion },
      { checkpoints, definitionRevision: "1" },
    );
    // The same scope dispatches without a second suspension; the different version suspends again.
    assert.equal(result.status, "suspended");
    assert.equal(result.interruption?.guardrail, RULE);
    assert.deepEqual(executions, ["call-first", "call-same-scope"], "the run-wide approval covered the same scope");
    const checkpoint = await loadAgentRunState(checkpoints, { runId: result.runId });
    assert.equal(checkpoint.state.stickyDecisions?.[0]?.outcome, "allow_for_run");

    const secondVersion = result.runState?.version;
    assert.ok(secondVersion !== undefined);
    result = await resumeAgentRun(
      agent,
      { runId: result.runId, sessionId: result.sessionId },
      {
        decisions: (result.interruption?.pendingDecisions ?? []).map((entry) => ({ approvalId: entry.approvalId, outcome: "allow_once" as const })),
        expectedVersion: secondVersion,
      },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(result.status, "succeeded");
    assert.deepEqual(executions, ["call-first", "call-same-scope", "call-other-scope"]);
  });

  it("rejects the gated call without dispatching it and without failing the run", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executions: string[] = [];
    const { agent, store } = deployAgent(
      (turn) => (turn === 1 ? [deployCall("call-deploy", "prod-1"), providerDone()] : [providerTextDelta("skipped"), providerDone()]),
      executions,
    );
    const session = agent.createSession({ id: "ask-reject", guardrailPacks: [PACK] });
    const suspended = await session.run("ship", { runState: { checkpoints, definitionRevision: "1" } });
    assert.equal(suspended.status, "suspended");
    const expectedVersion = suspended.runState?.version;
    const approvalId = suspended.interruption?.pendingDecisions?.[0]?.approvalId;
    assert.ok(expectedVersion !== undefined && approvalId, "the suspension carries its version and decision id");

    const resumed = await resumeAgentRun(
      agent,
      { runId: suspended.runId, sessionId: suspended.sessionId },
      { decisions: [{ approvalId, outcome: "reject_once", reason: "not this tag" }], expectedVersion },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(resumed.status, "succeeded", "a rejected ask call does not fail the run");
    assert.deepEqual(executions, [], "the rejected call never dispatched");
    const refusal = await toolResultOf(store, "ask-reject");
    assert.equal(refusal?.name, "deploy");
    assert.equal(refusal?.error?.code, "approval_rejected");
  });

  it("blocks the call in a run that cannot suspend, naming the rule, without failing the run", async () => {
    const executions: string[] = [];
    const { agent, store } = deployAgent(
      (turn) => (turn === 1 ? [deployCall("call-deploy", "prod-1"), providerDone()] : [providerTextDelta("skipped"), providerDone()]),
      executions,
    );
    const session = agent.createSession({ id: "ask-non-durable", guardrailPacks: [PACK] });
    const events: AgentEvent[] = [];
    const subscription = session.subscribe();
    const pump = (async () => {
      for await (const event of subscription) events.push(event);
    })();
    const result = await session.run("ship");
    await pump;

    assert.equal(result.status, "succeeded", "no ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE run failure");
    assert.equal(result.runState, undefined, "the run stayed non-durable");
    assert.deepEqual(executions, [], "the blocked call never executed");
    const blocked = events.find((event): event is ToolBlockedEvent => event.type === "tool_execution_blocked");
    assert.equal(blocked?.reason, "guardrail_blocked");
    assert.ok(String(blocked?.error?.message).includes(RULE), "the event names the rule");
    const decision = events.find(
      (event): event is GuardrailDecisionEvent => event.type === "guardrail_decision" && event.record.action === "block",
    );
    assert.equal(decision?.record.guardrail, RULE);
    const refusal = await toolResultOf(store, "ask-non-durable");
    assert.ok(String(refusal?.error?.message).includes(RULE), "the model-visible refusal names the rule");
    assert.ok(String(refusal?.error?.message).includes("Production tags need approval"));
  });

  it("does not let an approval widen the pack: a deny rule re-trips at dispatch", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executions: string[] = [];
    const { agent, store } = deployAgent(
      (turn) => (turn === 1 ? [deployCall("call-deploy", "prod-1"), providerDone()] : [providerTextDelta("blocked"), providerDone()]),
      executions,
    );
    // An `ask` rule gates the call; a sibling `deny` rule matches the very same call. Approving the
    // gate must not skip the deny: the approval applies to the suspension, not to the ruleset.
    const pack = {
      id: "deploy-guard",
      rules: [...PACK.rules, { id: "deny-prod", tool: "deploy", argPath: "version", pattern: "^prod-", reason: "Production is frozen" }],
    };
    // `persistSessionState` keeps the pack alive across the suspension, so the resumed dispatch
    // still runs the deny rule; without it the resumed session would enforce nothing.
    const session = agent.createSession({ id: "ask-no-widen", guardrailPacks: [pack] });
    const suspended = await session.run("ship", {
      runState: { checkpoints, definitionRevision: "1", persistSessionState: true },
    });
    assert.equal(suspended.status, "suspended");
    const checkpoint = await loadAgentRunState(checkpoints, { runId: suspended.runId });
    assert.deepEqual(checkpoint.state.sessionState?.guardrailPacks?.packs?.[0]?.rules, pack.rules, "the checkpoint carries the rules");

    const expectedVersion = suspended.runState?.version;
    const approvalId = suspended.interruption?.pendingDecisions?.[0]?.approvalId;
    assert.ok(expectedVersion !== undefined && approvalId);
    const resumed = await resumeAgentRun(
      agent,
      { runId: suspended.runId, sessionId: suspended.sessionId },
      { decisions: [{ approvalId, outcome: "allow_once" }], expectedVersion },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(resumed.status, "succeeded", "the run continues after the refusal");
    assert.deepEqual(executions, [], "the approved call still never executed");
    const refusal = await toolResultOf(store, "ask-no-widen");
    assert.ok(String(refusal?.error?.message).includes("pack:deploy-guard/deny-prod"), "the denial names the deny rule, not the approved one");
  });

  it("does not gate calls the rule does not match", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executions: string[] = [];
    const { agent } = deployAgent((turn) => {
      if (turn === 1) return [providerToolCall(toolCallContent("call-inspect", "inspect", {})), providerDone()];
      if (turn === 2) return [deployCall("call-deploy", "staging-1"), providerDone()];
      return [providerTextDelta("done"), providerDone()];
    }, executions);
    const session = agent.createSession({ id: "ask-no-match", guardrailPacks: [PACK] });
    const result = await session.run("ship", { runState: { checkpoints, definitionRevision: "1" } });
    assert.equal(result.status, "succeeded");
    assert.equal(result.interruption, undefined);
    assert.deepEqual(executions, ["call-deploy"], "the durable run dispatched the non-matching call without a gate");
  });
});
