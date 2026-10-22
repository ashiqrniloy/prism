// Plan 025 Task 5 — focused behavior regressions for the approval/pending-decision
// surface (src/agent-approval.ts), which had no direct test (only indirect coverage via
// the resume flow). Behavior-backed: each test asserts an observable outcome (a synthesized
// legacy decision, a thrown error code, a sticky decision recorded, the remaining pending),
// not private state or call counts. Covers the D5 branches: pending-decision (new +
// legacy synthesis), approve/deny (allow_once/allow_for_run/reject_once/reject_for_run +
// sticky), unknown/duplicate id, reason + sticky limits, modified-args/elicitation scope
// guards, and the legacy-migration resume validation gate.

import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  decisionPrincipalRef,
  decisionScopesEqual,
  nestedApprovalId,
  nestedOutcomeToolResult,
  pathsEqual,
  pendingDecisionsOf,
  resolveRunDecisions,
} from "../agent-approval.js";
import { AGENT_RUN_STATE_SCHEMA_VERSION, type StoredAgentRunState } from "../agent-run-state.js";
import {
  type Agent,
  AgentDecisionError,
  DEFAULT_MAX_STICKY_DECISIONS,
  MAX_DECISION_REASON_BYTES,
  type PendingDecision,
  type StickyDecision,
} from "../contracts.js";

// Minimal agent: resolveRunDecisions only reads agent.config.{tools,guardrails,validator,redactor};
// every branch tested here throws or returns before reaching the agent-calling validation
// (modified-args/elicitation happy paths are covered indirectly by the resume suite).
const minimalAgent = { config: {} } as unknown as Agent;

function baseState(overrides: Partial<StoredAgentRunState> = {}): StoredAgentRunState {
  return {
    schemaVersion: AGENT_RUN_STATE_SCHEMA_VERSION,
    agentId: "approval-demo",
    definitionRevision: "1",
    fingerprint: "fp",
    runId: "run-1",
    sessionId: "session-1",
    model: { provider: "mock", model: "demo" },
    status: "suspended",
    counters: {
      turns: 1,
      providerAttempts: 1,
      toolRounds: 1,
      toolCalls: 1,
      wallTimeMs: 1,
      requestBytes: 1,
      responseBytes: 1,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 1,
      cost: 0,
    },
    deadlineAt: new Date().toISOString(),
    ...overrides,
  } as StoredAgentRunState;
}

const toolPending = (approvalId: string, toolName = "write"): PendingDecision => ({
  approvalId,
  kind: "tool_approval",
  toolCallId: approvalId,
  scope: { toolName },
  reason: "Tool side effect requires approval",
});

const elicitationPending = (approvalId: string): PendingDecision => ({
  approvalId,
  kind: "elicitation",
  scope: {},
  reason: "Elicitation requested",
  elicitationSchema: { type: "object" },
});

// ── pendingDecisionsOf: new + legacy synthesis + none ──────────────────────────

test("pendingDecisionsOf returns the new pendingDecisions when present", () => {
  const d = [toolPending("a1"), elicitationPending("e1")];
  const state = baseState({ interruption: { kind: "tool_approval", reason: "blocked", pendingDecisions: d } });
  assert.deepEqual(pendingDecisionsOf(state), d);
});

test("pendingDecisionsOf synthesizes the legacy single-approval shape from state.pending", () => {
  const state = baseState({
    pending: { call: { type: "tool_call", id: "c1", name: "write", arguments: {} }, status: "ready" },
    interruption: { kind: "tool_approval", reason: "legacy reason" },
  });
  assert.deepEqual(pendingDecisionsOf(state), [
    { approvalId: "c1", kind: "tool_approval", toolCallId: "c1", scope: { toolName: "write" }, reason: "legacy reason" },
  ]);
});

test("pendingDecisionsOf falls back to the default reason when the legacy state lacks an interruption reason", () => {
  const state = baseState({
    pending: { call: { type: "tool_call", id: "c2", name: "read", arguments: {} }, status: "ready" },
  });
  assert.deepEqual(pendingDecisionsOf(state), [
    {
      approvalId: "c2",
      kind: "tool_approval",
      toolCallId: "c2",
      scope: { toolName: "read" },
      reason: "Tool side effect requires approval",
    },
  ]);
});

test("pendingDecisionsOf returns undefined when no pending decisions or legacy pending", () => {
  assert.equal(pendingDecisionsOf(baseState()), undefined);
});

// ── resolveRunDecisions: approve/deny/sticky + unknown/duplicate/limits/scope ──

test("resolveRunDecisions records an allow_once approve with no sticky and drops it from remaining", async () => {
  const state = baseState({
    interruption: { kind: "tool_approval", reason: "r", pendingDecisions: [toolPending("a1"), toolPending("a2")] },
  });
  const res = await resolveRunDecisions({ agent: minimalAgent, state, decisions: [{ approvalId: "a1", outcome: "allow_once" }] });
  assert.equal(res.decisionsById.size, 1);
  assert.ok(res.decisionsById.has("a1"));
  assert.equal(res.stickyDecisions.length, 0);
  assert.deepEqual(
    res.remaining.map((d) => d.approvalId),
    ["a2"],
  );
});

test("resolveRunDecisions records an allow_for_run approve as a sticky decision", async () => {
  const state = baseState({ interruption: { kind: "tool_approval", reason: "r", pendingDecisions: [toolPending("a1")] } });
  const res = await resolveRunDecisions({ agent: minimalAgent, state, decisions: [{ approvalId: "a1", outcome: "allow_for_run" }] });
  assert.equal(res.stickyDecisions.length, 1);
  assert.equal(res.stickyDecisions[0].outcome, "allow_for_run");
  assert.equal(res.stickyDecisions[0].scope.toolName, "write");
});

test("resolveRunDecisions records reject_once deny with no sticky and reject_for_run as a sticky", async () => {
  const state = baseState({
    interruption: { kind: "tool_approval", reason: "r", pendingDecisions: [toolPending("d1"), toolPending("d2")] },
  });
  const once = await resolveRunDecisions({ agent: minimalAgent, state, decisions: [{ approvalId: "d1", outcome: "reject_once" }] });
  assert.equal(once.stickyDecisions.length, 0);
  const run = await resolveRunDecisions({
    agent: minimalAgent,
    state,
    decisions: [{ approvalId: "d2", outcome: "reject_for_run", reason: "denied" }],
  });
  assert.equal(run.stickyDecisions.length, 1);
  assert.equal(run.stickyDecisions[0].outcome, "reject_for_run");
  assert.equal(run.stickyDecisions[0].reason, "denied");
});

test("resolveRunDecisions fails closed on an unknown/foreign approval id", async () => {
  const state = baseState({ interruption: { kind: "tool_approval", reason: "r", pendingDecisions: [toolPending("a1")] } });
  await assert.rejects(
    () => resolveRunDecisions({ agent: minimalAgent, state, decisions: [{ approvalId: "foreign", outcome: "allow_once" }] }),
    (err: AgentDecisionError) => err.code === "ERR_PRISM_DECISION_UNKNOWN",
  );
});

test("resolveRunDecisions fails closed on a duplicate approval id in the batch", async () => {
  const state = baseState({ interruption: { kind: "tool_approval", reason: "r", pendingDecisions: [toolPending("a1")] } });
  await assert.rejects(
    () =>
      resolveRunDecisions({
        agent: minimalAgent,
        state,
        decisions: [
          { approvalId: "a1", outcome: "allow_once" },
          { approvalId: "a1", outcome: "allow_once" },
        ],
      }),
    (err: AgentDecisionError) => err.code === "ERR_PRISM_DECISION_DUPLICATE",
  );
});

test("resolveRunDecisions fails closed on an empty batch", async () => {
  const state = baseState({ interruption: { kind: "tool_approval", reason: "r", pendingDecisions: [toolPending("a1")] } });
  await assert.rejects(
    () => resolveRunDecisions({ agent: minimalAgent, state, decisions: [] }),
    (err: AgentDecisionError) => err.code === "ERR_PRISM_DECISION_INVALID",
  );
});

test("resolveRunDecisions fails closed when no pending decisions exist", async () => {
  await assert.rejects(
    () => resolveRunDecisions({ agent: minimalAgent, state: baseState(), decisions: [{ approvalId: "a1", outcome: "allow_once" }] }),
    (err: AgentDecisionError) => err.code === "ERR_PRISM_DECISION_UNKNOWN",
  );
});

test("resolveRunDecisions fails closed on an oversize reason", async () => {
  const state = baseState({ interruption: { kind: "tool_approval", reason: "r", pendingDecisions: [toolPending("a1")] } });
  await assert.rejects(
    () =>
      resolveRunDecisions({
        agent: minimalAgent,
        state,
        decisions: [{ approvalId: "a1", outcome: "allow_once", reason: "x".repeat(MAX_DECISION_REASON_BYTES + 1) }],
      }),
    (err: AgentDecisionError) => err.code === "ERR_PRISM_DECISION_LIMIT",
  );
});

test("resolveRunDecisions fails closed when sticky decisions exceed the per-run cap", async () => {
  const existing = Array.from(
    { length: DEFAULT_MAX_STICKY_DECISIONS },
    (_, i): StickyDecision => ({
      scope: { toolName: `t${i}` },
      outcome: "allow_for_run",
      decidedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  const state = baseState({
    stickyDecisions: existing,
    interruption: { kind: "tool_approval", reason: "r", pendingDecisions: [toolPending("over")] },
  });
  await assert.rejects(
    () => resolveRunDecisions({ agent: minimalAgent, state, decisions: [{ approvalId: "over", outcome: "allow_for_run" }] }),
    (err: AgentDecisionError) => err.code === "ERR_PRISM_DECISION_LIMIT",
  );
});

test("resolveRunDecisions rejects modifiedArguments on a non-tool_approval decision (scope guard)", async () => {
  const state = baseState({ interruption: { kind: "elicitation", reason: "r", pendingDecisions: [elicitationPending("e1")] } });
  await assert.rejects(
    () =>
      resolveRunDecisions({
        agent: minimalAgent,
        state,
        decisions: [{ approvalId: "e1", outcome: "allow_once", modifiedArguments: { x: 1 } }],
      }),
    (err: AgentDecisionError) => err.code === "ERR_PRISM_DECISION_SCOPE",
  );
});

test("resolveRunDecisions rejects an elicitation payload on a non-elicitation decision (scope guard)", async () => {
  const state = baseState({ interruption: { kind: "tool_approval", reason: "r", pendingDecisions: [toolPending("t1")] } });
  await assert.rejects(
    () =>
      resolveRunDecisions({ agent: minimalAgent, state, decisions: [{ approvalId: "t1", outcome: "allow_once", elicitation: { x: 1 } }] }),
    (err: AgentDecisionError) => err.code === "ERR_PRISM_DECISION_SCOPE",
  );
});

test("resolveRunDecisions rejects an unknown outcome", async () => {
  const state = baseState({ interruption: { kind: "tool_approval", reason: "r", pendingDecisions: [toolPending("a1")] } });
  await assert.rejects(
    () => resolveRunDecisions({ agent: minimalAgent, state, decisions: [{ approvalId: "a1", outcome: "maybe" as never }] }),
    (err: AgentDecisionError) => err.code === "ERR_PRISM_DECISION_INVALID",
  );
});

// ── pure helpers ───────────────────────────────────────────────────────────────

test("nestedApprovalId is bounded, deterministic, and prefixed", () => {
  const id = nestedApprovalId("run-1", "child-1");
  assert.ok(id.startsWith("sub_"));
  assert.equal(id.length, 4 + 64); // sub_ + sha256 hex
  assert.equal(nestedApprovalId("run-1", "child-1"), id);
  assert.notEqual(nestedApprovalId("run-2", "child-1"), id);
});

test("pathsEqual handles undefined and compares element-wise", () => {
  assert.equal(pathsEqual(undefined, undefined), true);
  assert.equal(pathsEqual(undefined, ["a"]), false);
  assert.equal(pathsEqual(["a", "b"], ["a", "b"]), true);
  assert.equal(pathsEqual(["a", "b"], ["a", "c"]), false);
  assert.equal(pathsEqual(["a"], ["a", "b"]), false);
});

test("decisionScopesEqual compares scalar fields and actionConstraints", () => {
  assert.equal(decisionScopesEqual({ toolName: "x" }, { toolName: "x" }), true);
  assert.equal(decisionScopesEqual({ toolName: "x" }, { toolName: "y" }), false);
  assert.equal(decisionScopesEqual({ toolName: "x", actionConstraints: { a: 1 } }, { toolName: "x", actionConstraints: { a: 1 } }), true);
  assert.equal(decisionScopesEqual({ toolName: "x", actionConstraints: { a: 1 } }, { toolName: "x", actionConstraints: { a: 2 } }), false);
  assert.equal(decisionScopesEqual({ toolName: "x", actionConstraints: { a: 1 } }, { toolName: "x" }), false);
});

test("nestedOutcomeToolResult shapes completed and failed nested outcomes", () => {
  assert.deepEqual(nestedOutcomeToolResult({ status: "completed", value: "ok" }, "c1", "write"), {
    toolCallId: "c1",
    name: "write",
    value: "ok",
  });
  assert.deepEqual(nestedOutcomeToolResult({ status: "completed" }, "c2", "read"), { toolCallId: "c2", name: "read" });
  assert.deepEqual(nestedOutcomeToolResult({ status: "failed", code: "ERR_X", message: "boom" }, "c3", "write"), {
    toolCallId: "c3",
    name: "write",
    error: { code: "ERR_X", message: "boom" },
  });
});

test("decisionPrincipalRef returns opaque principal id or undefined", () => {
  assert.equal(decisionPrincipalRef({ kind: "user", id: "u1" }), "u1");
  assert.equal(decisionPrincipalRef(undefined), undefined);
});
