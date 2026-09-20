// Primitive-review gate: a plan's Task 1 review is an evidence artifact, so it must
// exist and must name the primitives it claims to have reviewed. Plan 074 Task 1 is
// the first entry; later plans of the 0.7.0 line append their own review here.
//
// Hermetic: reads docs only. Fails if the review is missing, stops naming a required
// primitive, or drifts from the plan's evidence path.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");

/** Plan 074 Task 1 — every reuse/gap row the review must justify (exact `covers:` spans). */
const PLAN_074_TASK_1 = {
  plan: "plans/074-Attention-Compiler.md",
  evidence: "docs/_evidence/phase74-primitive-review.md",
  required: [
    "src/input.ts", // assembleProviderInput / flattenInputGroups / prompt builder
    "src/context-budget.ts", // applyContextBudget / dropNext
    "src/tool-result-fold.ts", // ToolResultFoldOptions / deterministic stub gap
    "src/agent-session/session.ts", // autoCompact / compactBranch / compact() throw
    "src/contracts-core/compaction.ts", // CompactionOptions (missing host trigger)
    "packages/memory/src/compaction/observational-memory/compose.ts", // attach / compactAfterTokens
    "src/agent-session/session/assemble.ts", // assembleRoundContext / per-turn seam
    "src/cache-helpers.ts", // cache breakpoints
    "input_assembly", // middleware the compiler may not bypass
    "redactProviderRequest", // redaction ordering
    "AttentionBudgetError", // C9 fail-closed overflow
    "projection-only", // C7/C8
  ],
  rejected: ["second prompt builder", "12-layer", "handles", "nested `ContextPacket`s", "new npm package"],
};

/** Plan 104 Task 1 — the pack-durability / `ask` / refusal / subscriber review (plan 092 follow-ups). */
const PLAN_104_TASK_1 = {
  plan: "plans/104-Execution-Guardrail-Packs-Follow-Ups.md",
  evidence: "docs/_evidence/phase104-primitive-review.md",
  required: [
    // Task 2 — pack durability
    "src/guardrails.ts", // compileGuardrailPacks / resolveGuardrailPacks / ruleGuardrail
    "compileGuardrailPacks",
    "src/guardrail-packs/types.ts", // GuardrailPackRules.observe / GuardrailPackDefinition
    "GuardrailPackRules.observe",
    "src/agent-run-state.ts", // StoredAgentRunState.sessionState
    "sessionState",
    "persistDurable",
    "validateSessionState",
    "src/agent-run-lifecycle.ts", // the resume rebuild and its restore block
    "persistSessionState",
    // Task 3 — `ask` suspension
    "bindChargeToolRound",
    "buildPendingDecision",
    "matchStickyDecision",
    "bindDispatchToolCall",
    "src/contracts-run-state.ts", // PendingDecision / AgentRunInterruption
    "PendingDecision",
    "AgentRunInterruptionKind",
    "GuardrailRuleAction",
    // Task 4 — refusal text
    "src/tools.ts",
    "blocked()",
    "tool_execution_blocked",
    "guardrail_blocked",
    // Task 5 — subscriber ownership
    "src/agent-session/session.ts",
    "subscribe()",
    "EventSubscriber",
    "closeSubscribers()",
    "cleanupRun",
    "recordDurableResumption",
    "recordDurableDenial",
    "stream()",
    // Task 6 — decision-time revalidation
    "src/agent-approval.ts",
    "validateModifiedArguments",
    "resolveRunDecisions",
    "ERR_PRISM_DECISION_INVALID",
    // Task 7 — the walkthrough
    "examples/README.md",
    "docs/index.md",
  ],
  rejected: [
    "predicate function", // R1 — closure on interruptBeforeTool cannot round-trip
    "interruptBeforeToolTools", // R2 — tool-name list cannot express argument patterns
    "ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE", // R3 — no universal tool_input interrupt
    "guardrailAskRules", // R4 — no second rule list beside the compiled guardrails
    "agent_suspended` for an `ask", // R5 — no suspension in a non-durable run
    "pack-id-only", // R6 — the refusal names the rule, not just the pack
    "leave the message unchanged", // R8 — the model must see which rule refused
    "spares all subscribers", // R9 — default run-end close stays
    "subscribeLongLived", // R11 — one flag on SubscribeOptions, not a second method
    "durable queue", // R12 — live subscribers stay in-memory and bounded
    "merge packs into `agent.config.guardrails`", // R14 — packs stay session-scoped
    "per-pack state codec", // R20 — the pack owns its codec, not the host
    "second module-level pack registry", // R21 — validate against the installed registry
  ],
  completeTask: /^- \[x\] Task 1:/m,
};

function assertPrimitiveReview(spec) {
  assert.ok(existsSync(join(ROOT, spec.evidence)), `missing ${spec.evidence}`);
  const text = readFileSync(join(ROOT, spec.evidence), "utf8");
  const haystack = text.toLowerCase();
  for (const token of spec.required) {
    assert.ok(haystack.includes(token.toLowerCase()), `${spec.evidence} must name ${token}`);
  }
  for (const token of spec.rejected) {
    assert.ok(haystack.includes(token.toLowerCase()), `${spec.evidence} must explicitly reject ${token}`);
  }
  // Citations must be spans, not prose: at least the references listed by the task.
  assert.match(text, /[\w./-]+\.(ts|mjs):L\d+/, "review must cite explicit path:line spans");
  // Negative control: the Task 1 checkbox may only be complete once this file exists.
  const plan = readFileSync(join(ROOT, spec.plan), "utf8");
  if (spec.completeTask.test(plan)) {
    assert.ok(text.length > 2_000, "a completed Task 1 must record a real review body");
  }
}

test("plan 074 Task 1 primitive review exists, names every reuse row, and skips no rejection", () => {
  assertPrimitiveReview({ ...PLAN_074_TASK_1, completeTask: /^- \[x\] \*\*Task 1 —/m });
});

test("plan 104 Task 1 primitive review exists, names every reuse row, and skips no rejection", () => {
  assertPrimitiveReview(PLAN_104_TASK_1);
});
