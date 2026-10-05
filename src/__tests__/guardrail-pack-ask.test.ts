/**
 * Plan 104 Task 3: pack `ask` rules — selective durable suspension without an all-tools gate.
 *
 * A matching call in a durable run suspends before dispatch (the pending decision names the rule),
 * and the same call in a run that cannot suspend is refused by the ordinary stage path instead of
 * failing the run. The pack is inline on purpose: it is the host-reachable form, and since Task 3 an
 * inline pack rides a checkpoint as its pattern rules (guardrail-pack-durability covers the shape).
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
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
  type GuardrailRecord,
} from "../index.js";
import { kernelEvents } from "./kernel-event-helpers.js";
import { providerPackage } from "../provider-kit/index.js";

/** A kernel `guardrail.decision` package event, with its `data` merged in. */
interface GuardrailDecisionEvent {
  readonly sessionId: string;
  readonly runId: string;
  readonly record: GuardrailRecord;
  readonly toolName?: string;
  readonly toolCallId?: string;
}
type ToolBlockedEvent = Extract<AgentEvent, { readonly type: "tool.completed" }>;

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

async function deployAgent(script: (turn: number) => readonly ProviderEvent[], executions: string[]) {
  const requests: ProviderRequest[] = [];
  const store = createMemorySessionStore();
  let turn = 0;
  const agent = await createAgent({
    id: "pack-ask",
    slots: { store },
    model: { provider: "mock", model: "demo" },
    packages: [providerPackage("test-provider", [{
      id: "mock",
      async *generate(request) {
        requests.push(request);
        turn += 1;
        for (const event of script(turn)) yield event;
      },
    }])],
    tools: {
      add: [
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
    },
  });
  return { agent, requests, slots: { store } };
}

const deployCall = (id: string, version: string) => providerToolCall(toolCallContent(id, "deploy", { version }));

/** `guardrail_decision` records that mean "awaiting a decision" (the ask gate). */
const askDecisions = (events: readonly AgentEvent[]): GuardrailDecisionEvent[] =>
  kernelEvents<{ record: GuardrailRecord; toolName?: string; toolCallId?: string }>(events, "guardrail.decision").filter(
    (event) => event.record.action === "interrupt",
  );

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
    const { agent, requests } = await deployAgent(
      (turn) => (turn === 1 ? [deployCall("call-deploy", "prod-1"), providerDone()] : [providerTextDelta("shipped"), providerDone()]),
      executions,
    );
    const session = await agent.session({ guardrailPacks: [PACK] });
    const events: AgentEvent[] = [];
    const subscription = session.subscribe();
    const pump = (async () => {
      for await (const event of subscription) events.push(event);
    })();
    const suspended = await session.run("ship prod", { runState: { checkpoints, definitionRevision: "1" } });
    await pump;

    assert.equal(suspended.status, "suspended");
    assert.deepEqual(executions, [], "the gated call never dispatched");
    assert.equal(suspended.runState?.interruption?.kind, "tool_approval");
    assert.equal(suspended.runState?.interruption?.guardrail, RULE);
    const pending = suspended.pending ?? [];
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
    assert.equal(resumed.status, "completed");
    assert.deepEqual(executions, ["call-deploy"], "approval dispatches the call exactly once");
    assert.equal(requests.length, 2);
  });

  it("allow_for_run sticks to the same scope while a different scope suspends again", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executions: string[] = [];
    const { agent } = await deployAgent((turn) => {
      if (turn === 1) return [deployCall("call-first", "prod-1"), providerDone()];
      if (turn === 2) return [deployCall("call-same-scope", "prod-1"), providerDone()];
      if (turn === 3) return [deployCall("call-other-scope", "prod-2"), providerDone()];
      return [providerTextDelta("done"), providerDone()];
    }, executions);
    const session = await agent.session({ guardrailPacks: [PACK] });

    let result = await session.run("ship", {
      runState: { checkpoints, definitionRevision: "1", persistSessionState: true },
    });
    assert.equal(result.status, "suspended");
    assert.deepEqual(executions, []);
    const firstVersion = result.runState?.version;
    const firstApproval = result.pending?.[0]?.approvalId;
    assert.ok(firstVersion !== undefined && firstApproval, "the suspension carries its version and decision id");

    result = await resumeAgentRun(
      agent,
      { runId: result.runId, sessionId: result.sessionId },
      { decisions: [{ approvalId: firstApproval, outcome: "allow_for_run" }], expectedVersion: firstVersion },
      { checkpoints, definitionRevision: "1" },
    );
    // The same scope dispatches without a second suspension; the different version suspends again.
    assert.equal(result.status, "suspended");
    assert.equal(result.runState?.interruption?.guardrail, RULE);
    assert.deepEqual(executions, ["call-first", "call-same-scope"], "the run-wide approval covered the same scope");
    const checkpoint = await loadAgentRunState(checkpoints, { runId: result.runId });
    assert.equal(checkpoint.state.stickyDecisions?.[0]?.outcome, "allow_for_run");

    const secondVersion = result.runState?.version;
    assert.ok(secondVersion !== undefined);
    result = await resumeAgentRun(
      agent,
      { runId: result.runId, sessionId: result.sessionId },
      {
        decisions: (result.pending ?? []).map((entry) => ({
          approvalId: entry.approvalId,
          outcome: "allow_once" as const,
        })),
        expectedVersion: secondVersion,
      },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(result.status, "completed");
    assert.deepEqual(executions, ["call-first", "call-same-scope", "call-other-scope"]);
  });

  it("rejects the gated call without dispatching it and without failing the run", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executions: string[] = [];
    const {
      agent,
      slots: { store },
    } = await deployAgent(
      (turn) => (turn === 1 ? [deployCall("call-deploy", "prod-1"), providerDone()] : [providerTextDelta("skipped"), providerDone()]),
      executions,
    );
    const session = await agent.session({ guardrailPacks: [PACK], id: "ask-reject", create: true });
    const suspended = await session.run("ship", { runState: { checkpoints, definitionRevision: "1" } });
    assert.equal(suspended.status, "suspended");
    const expectedVersion = suspended.runState?.version;
    const approvalId = suspended.pending?.[0]?.approvalId;
    assert.ok(expectedVersion !== undefined && approvalId, "the suspension carries its version and decision id");

    const resumed = await resumeAgentRun(
      agent,
      { runId: suspended.runId, sessionId: suspended.sessionId },
      { decisions: [{ approvalId, outcome: "reject_once", reason: "not this tag" }], expectedVersion },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(resumed.status, "completed", "a rejected ask call does not fail the run");
    assert.deepEqual(executions, [], "the rejected call never dispatched");
    const refusal = await toolResultOf(store, "ask-reject");
    assert.equal(refusal?.name, "deploy");
    assert.equal(refusal?.error?.code, "approval_rejected");
  });

  it("blocks the call in a run that cannot suspend, naming the rule, without failing the run", async () => {
    const executions: string[] = [];
    const {
      agent,
      slots: { store },
    } = await deployAgent(
      (turn) => (turn === 1 ? [deployCall("call-deploy", "prod-1"), providerDone()] : [providerTextDelta("skipped"), providerDone()]),
      executions,
    );
    const session = await agent.session({ guardrailPacks: [PACK], id: "ask-non-durable", create: true });
    const events: AgentEvent[] = [];
    const subscription = session.subscribe();
    const pump = (async () => {
      for await (const event of subscription) events.push(event);
    })();
    const result = await session.run("ship");
    await pump;

    assert.equal(result.status, "completed", "no ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE run failure");
    assert.equal(result.runState, undefined, "the run stayed non-durable");
    assert.deepEqual(executions, [], "the blocked call never executed");
    const decision = kernelEvents<{ record: GuardrailRecord; toolName?: string; toolCallId?: string }>(events, "guardrail.decision").find(
      (event) => event.record.action === "block",
    );
    assert.equal(decision?.record.guardrail, RULE);
    const refusal = await toolResultOf(store, "ask-non-durable");
    assert.ok(String(refusal?.error?.message).includes(RULE), "the model-visible refusal names the rule");
    assert.ok(String(refusal?.error?.message).includes("Production tags need approval"));
  });

  it("deny wins over ask for the same call", async () => {
    const executions: string[] = [];
    const {
      agent,
      slots: { store },
    } = await deployAgent(
      (turn) => (turn === 1 ? [deployCall("call-deploy", "prod-1"), providerDone()] : [providerTextDelta("blocked"), providerDone()]),
      executions,
    );
    // An `ask` rule gates the call; a sibling `deny` rule matches the very same call. Roadmap §2.4:
    // any deny wins, so the call is refused outright instead of prompting.
    const pack = {
      id: "deploy-guard",
      rules: [...PACK.rules, { id: "deny-prod", tool: "deploy", argPath: "version", pattern: "^prod-", reason: "Production is frozen" }],
    };
    const session = await agent.session({ guardrailPacks: [pack], id: "ask-no-widen", create: true });
    const result = await session.run("ship");
    assert.equal(result.status, "completed", "the run continues after the refusal");
    assert.equal(result.runState?.interruption, undefined, "a deny match never suspends");
    assert.deepEqual(executions, [], "the call never executed");
    const refusal = await toolResultOf(store, "ask-no-widen");
    assert.ok(String(refusal?.error?.message).includes("pack:deploy-guard/deny-prod"), "the denial names the deny rule, not the ask rule");
  });

  it("does not gate calls the rule does not match", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const executions: string[] = [];
    const { agent } = await deployAgent((turn) => {
      if (turn === 1) return [providerToolCall(toolCallContent("call-inspect", "inspect", {})), providerDone()];
      if (turn === 2) return [deployCall("call-deploy", "staging-1"), providerDone()];
      return [providerTextDelta("done"), providerDone()];
    }, executions);
    const session = await agent.session({ guardrailPacks: [PACK] });
    const result = await session.run("ship", { runState: { checkpoints, definitionRevision: "1" } });
    assert.equal(result.status, "completed");
    assert.equal(result.runState?.interruption, undefined);
    assert.deepEqual(executions, ["call-deploy"], "the durable run dispatched the non-matching call without a gate");
  });
});
