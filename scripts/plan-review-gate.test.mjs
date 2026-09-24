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

/** Plan 108 Task 1 — the supervisor failure-bridge / radius / counters / attribution review (plan 093 follow-ups). */
const PLAN_108_TASK_1 = {
  plan: "plans/108-Supervisor-Recovery-Telemetry-Follow-Ups.md",
  evidence: "docs/_evidence/phase108-primitive-review.md",
  required: [
    // Task 2 — coding lifecycle failure/recovery bridge
    "packages/prism-coding-tools/src/agent/supervisor-lifecycle.ts",
    "ObserveSupervisorLifecycleOptions",
    "lifecycleEvent",
    "packages/prism-coding-tools/src/agent/lifecycle.ts",
    "SubagentStoppedEvent",
    "DEFAULT_LIFECYCLE_MAX_REASON_BYTES",
    "scripts/phase10-freeze-manifest.json",
    "lifecycleEventMapping",
    // Task 3 — exact failureRadius ancestry
    "packages/prism-core/src/runtime/supervisor/supervisor.ts",
    "ChainContext",
    "noteDelegationStart",
    "countLiveDescendants",
    "settleDelegation",
    "DelegationMapping",
    // Task 4 — per-root-run counter read
    "packages/prism-core/src/runtime/supervisor/types.ts",
    "summary()",
    "childSummary",
    // Task 5 — limit attribution on the result and child_failed
    "src/run-limits.ts",
    "describeBudgetExhaustion",
    "src/contracts-run-state.ts",
    "AgentRunResult",
    "src/agent-session/session.ts",
    "buildRunResult",
    "src/agent-session/session/assemble.ts",
    "packages/prism-core/src/runtime/supervisor/spawn-tool.ts",
    "ChildFailureAttribution",
    "failureAttribution",
    "budget_exhausted",
    "child_failed",
    "consumed",
    "closestOtherAxes",
    "recentToolCalls",
    // the runnable confirmations
    "CONFIRMED",
  ],
  rejected: [
    "subagent_failed", // R1 — no new lifecycle kind
    "always attach", // R2 — default-off, not always-on, failure details
    "second supervisor subscription", // R3 — the stream is single-consumer
    "read counters on `child_failed`", // R4 — counters are final only at stop
    "require `summary`", // R5 — keep the optional source width
    "forward `usage`/`recentToolCalls`", // R6 — no lifecycle consumer needs them
    "dedupe by depth", // R7 — same-child same-depth paths stay identical
    "parentDelegationId", // R8 — walk-free recorded chain instead
    "reverse index", // R9 — a bounded scan needs no index
    "path + delegationId", // R10 — delegationId is already the unique key
    "resetSummary()", // R11 — one read+reset call, not a second method
    "supervisor_run_summary", // R12 — no root-run boundary exists
    "since: marker", // R13 — hosts already hold the snapshot
    "resetting on `delegate()`", // R14 — implicit resets are untrustworthy
    "supervisor-side subscription", // R15 — no always-on per-delegation subscription
    "re-derive", // R16 — usage has no axis counters or hashes
    "full `TimelineExhaustion`", // R17 — result.limit already carries the breach
    "second core event", // R18 — child_failed stays the single failure record
    "prose findings", // R19 — the gate reads a file and tokens
    "skipping the review", // R20 — two public shapes change
  ],
  completeTask: /^- \[x\] Task 1:/m,
};

/** Plan 109 Task 1 — the restore-compensation / audit-projection review (plan 094 follow-ups). */
const PLAN_109_TASK_1 = {
  plan: "plans/109-Checkpoint-Restore-Follow-Ups.md",
  evidence: "docs/_evidence/phase109-primitive-review.md",
  required: [
    // Task 2 — the executor, handler union, error report
    "src/checkpoint-restore.ts",
    "runCheckpointRestoreHooks",
    "normalizeRestoreHandler", // the planned executor-boundary normalization
    "CheckpointRestoreHandler",
    "CheckpointRestoreCompensation",
    "CheckpointRestoreError",
    "CheckpointRestoreAudit",
    "CheckpointRestoreAuditEntry",
    "CheckpointRestoreHook",
    "DEFAULT_CHECKPOINT_RESTORE_TIMEOUT_MS",
    "RunCheckpointRestoreHooksOptions",
    // Task 2 — hook contexts and options in both packages
    "src/contracts-run-state.ts",
    "AgentCheckpointRestoreContext",
    "AgentCheckpointRestoreHook",
    "AgentRunResumeOptions",
    "AgentRunLifecycleOptions",
    "src/agent-run-lifecycle.ts",
    "restoreHookOptions", // lifecycle + request hook merge (single normalization point)
    "src/agent-session/session/assemble.ts", // agent_resumed.restore emit
    "packages/prism-core/src/runtime/workflows/run/main.ts", // workflow restore block
    "packages/prism-core/src/runtime/workflows/run/scheduler.ts", // workflow_resumed.restore emit
    "packages/prism-core/src/runtime/workflows/types.ts",
    "WorkflowCheckpointRestoreContext",
    "WorkflowCheckpointRestoreHook",
    "RunWorkflowOptions",
    "src/contracts-protocol.ts", // agent_resumed.restore event variant
    // Task 3 — audit sources and projection seams
    "packages/prism-core/src/governance/observability/timeline.ts",
    "packages/prism-core/src/governance/observability/timeline-types.ts",
    "ExecutionTimeline",
    "ExecutionStep",
    "projectAgentTimeline",
    "projectWorkflowTimeline",
    "workflowMetadata", // the optional top-level field precedent
    // verification seams
    "src/__tests__/agent-run-restore-hooks.test.ts",
    "packages/prism-core/src/runtime/workflows/__tests__/run.test.ts",
    "packages/prism-core/src/governance/observability/__tests__/timeline.test.ts",
    "src/__tests__/public-export-contract.test.ts",
    "scripts/budgets.json",
    // docs the later tasks amend
    "docs/durable-runs.md",
    "docs/workflows.md",
    "docs/execution-timeline.md",
    // the runnable confirmation
    "CONFIRMED",
  ],
  rejected: [
    // Task 2
    "function-property", // R1 — no compensate hung off the function object
    "compensatehooks", // R2 — no parallel array paired by index
    "only for hooks that completed", // R3 — the failing hook's own compensate leads the pass
    'phase: "compensate"', // R4 — no second-direction flag on the restore hook
    "checkpoint_restore_failed", // R5 — no event for the failure path
    // Task 3
    "checkpoint_restored", // R6 — no new event kind for the audit
    "executionstep.metadata", // R7 — agent-only step metadata rejected as the default
    "projecting the compensation report", // R8 — a failed restore never claims/emits
    "no documentation change", // R9 — event-only requires the recorded decision
    // Task 1 itself
    "skip the review", // R10 — two public shapes change
    "artifact per task", // R11 — one inventory owns both items
    "registering the gate block later", // R12 — the gate precedes the code
    // plan 094's deferred-forever rejects
    "parallel hook groups", // R13 — no consumer, timeout already bounds the pass
    "resumeagentrunfrom", // R14 — resumeAgentRun already accepts the options
    "prose findings", // R15 — the gate reads a file and tokens
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

test("plan 108 Task 1 primitive review exists, names every reuse row, and skips no rejection", () => {
  assertPrimitiveReview(PLAN_108_TASK_1);
});

test("plan 109 Task 1 primitive review exists, names every reuse row, and skips no rejection", () => {
  assertPrimitiveReview(PLAN_109_TASK_1);
});

/** Plan 110 Task 1 — scoring surface, reset detail, and the uncovered conformance rows (plan 101 follow-ups). */
const PLAN_110_TASK_1 = {
  plan: "plans/110-Cache-Stability-Scoring-Surfaces-And-Conformance-Rows.md",
  evidence: "docs/_evidence/phase110-primitive-review.md",
  required: [
    "src/testing/prefix-stability-conformance.ts",
    "measureRequest",
    "tailClassifier",
    "sharedPrefixFraction",
    "runPrefixStabilityConformance",
    "fixtureProvider",
    "src/input.ts",
    "flattenInputGroups",
    "createDefaultPromptBuilder",
    "appendTailSegment",
    "src/agent-session/session/assemble.ts",
    "tailSegments.clear",
    "src/attention-compiler.ts",
    "src/skill-load.ts",
    "MAX_LOAD_SKILL_RESULT_BYTES",
    "foldedToolResultHeader",
    "src/context-budget.ts",
    "dropNext",
    "src/__tests__/invalidation-inventory.test.ts",
    "assembleTwice",
    "src/__tests__/context-budget.test.ts",
    "scorePrefixStability",
    "resetDetails",
    "foldableToolResultBytes",
    "inputLayout",
    "docs/prefix-stability-conformance.md",
    "CONFIRMED",
  ],
  rejected: [
    "wire marker",
    "second conformance runner",
    "pattern-matching host content",
    "allowedResets semantics",
    "raising `MAX_LOAD_SKILL_RESULT_BYTES`",
    "pinning eviction groups in production code",
    "skip the review",
    "evidence file per task",
    "registering the gate block later",
    "measureProviderPrefix",
    "adapter-level segment index",
    "parallel `fractions` array",
    "host-provided tool",
    "three requests per turn",
    "hardcoding caps",
    "drop legacy support",
  ],
  completeTask: /^- \[x\] Task 1:/m,
};

test("plan 110 Task 1 primitive review exists, names every reuse row, and skips no rejection", () => {
  assertPrimitiveReview(PLAN_110_TASK_1);
});

/** Plan 111 Task 1 — the reason-seam / semantic-reranker / demand-gate review (plan 102 follow-ups). */
const PLAN_111_TASK_1 = {
  plan: "plans/111-Deletion-Handler-Reason-Seam-And-Reranker-Embedder-Evidence.md",
  evidence: "docs/_evidence/phase111-primitive-review.md",
  required: [
    // Task 2 — the reason seam
    "packages/memory/src/propagation.ts",
    "packages/memory/src/fabric/repoint.ts",
    "DeletionPropagationContext",
    "createFabricRepointHandler",
    "legal_hold",
    "packages/memory/src/__tests__/deletion-propagation.test.ts",
    "docs/rag.md",
    "docs/memory-fabric.md",
    // Task 3 — the semantic reranker evidence
    "packages/memory/src/rag/__tests__/local-reranker-live.test.ts",
    "packages/memory/src/rag/local-reranker.ts",
    "packages/memory/src/rag/limits.ts",
    "docs/_evidence/phase102-local-rerank-latency.md",
    "createHashEmbedder",
    "DEFAULT_QUERY_CANDIDATES",
    // the runnable confirmations
    "CONFIRMED",
  ],
  rejected: [
    "second tombstone plane",
    "required field",
    "raising the pool",
    "GPU default",
    "propagateDeletion facade",
    "directory-move expansion",
    "store-level ranged read",
  ],
  completeTask: /^- \[x\] Task 1:/m,
};

test("plan 111 Task 1 primitive review exists, names every reuse row, and skips no rejection", () => {
  assertPrimitiveReview(PLAN_111_TASK_1);
});

/** Plan 112 Task 1 — the two-layer freeze / two-page duplication / demand-gate review (plan 103 follow-ups). */
const PLAN_112_TASK_1 = {
  plan: "plans/112-Family-Token-Table-Freeze-And-Budget-Provenance-Source.md",
  evidence: "docs/_evidence/phase112-primitive-review.md",
  required: [
    // Task 2 — the freeze target and its readers
    "src/usage-estimation.ts",
    "MODEL_FAMILY_TOKENS",
    "ModelFamilyTokens",
    "resolveModelFamily",
    "estimateTextTokensForFamily",
    "src/index.ts",
    "src/context-budget.ts",
    "estimateMessageTokens",
    "src/__tests__/usage-estimation.test.ts",
    "src/__tests__/usage-calibration.test.ts",
    "scripts/budget-gate.test.mjs",
    // Task 2 — the measured seam helpers and the one runtime consumer
    "estimateRequestExtrasTokens",
    "resolveHostTokenEstimator",
    "src/agent-session/session/provider-round.ts",
    // Task 3 — the two pages and the duplication
    "docs/agent-events.md",
    "docs/runs-and-usage.md",
    // the measured confirmations
    "Object.isFrozen",
    "input_assembly",
    "NaN",
    "Reflect.set",
    "TypeError",
    "CONFIRMED",
  ],
  rejected: [
    "shallow freeze", // R1 — table-level freeze leaves rows writable
    "typed readonly is enough", // R2 — Readonly is compile-time only
    "host-overridable ratio registry", // R3 — no supported runtime override
    "barrel promotion without demand", // R4 — one in-tree consumer each
    "request digest without demand", // R5 — under-count stays demand-gated
    "freezing every exported table", // R6 — sibling tables are a separate class
    "freeze lazily on first estimate", // R7
    "as const literal plus a runtime assertion", // R8
    "make the table private", // R9
    "skip the review", // R10
    "one evidence file per task", // R11
    "register the gate block later", // R12
    "move the whole `budgets` shape into runs-and-usage", // R13
    "link without a summary", // R14
    "docs conformance test", // R15
    "generated schema", // R16
  ],
  completeTask: /^- \[x\] Task 1:/m,
};

test("plan 112 Task 1 primitive review exists, names every reuse row, and skips no rejection", () => {
  assertPrimitiveReview(PLAN_112_TASK_1);
});

/** Plan 113 Task 1 — the Bun 1.4.2 measured inventory that gates Tasks 2–3. */
const PLAN_113_TASK_1 = {
  plan: "plans/113-Bun-Dev-Toolchain.md",
  evidence: "docs/_evidence/phase113-bun-inventory.md",
  required: [
    // runner probes
    "node:test",
    "bun --test",
    "--experimental-test-coverage",
    "--timeout=0",
    "process.execPath",
    "process.versions.node",
    "node:v8",
    // sqlite probes (the retired hard-block claim does not reproduce)
    "better-sqlite3",
    ":memory:",
    "23 pass",
    "24 pass",
    "0 fail",
    // lockfile / install / audit probes
    "bun.lock",
    "package-lock.json",
    "lockfileVersion",
    "hoisted",
    "trustedDependencies",
    "bun audit --audit-level=moderate",
    // repo contract the inventory must keep true
    "engines.node",
    "oven-sh/setup-bun",
    "CONFIRMED",
  ],
  rejected: [
    "bun:sqlite",
    "drop engines.node",
    "bun publish",
    "bun run --bun",
    "replace tsc",
    "dual lockfile",
    "rewrite node: imports",
    "coverageThreshold as the release gate",
    "expected throw naming issue 4290",
  ],
  completeTask: /^- \[x\] Task 1:/m,
};

test("plan 113 Task 1 measured inventory exists, names every probe, and skips no rejection", () => {
  assertPrimitiveReview(PLAN_113_TASK_1);
});

/** Plan 114 Task 1 — the Bun 1.4.2 coverage-semantics inventory and recalibration that Task 2 implements. */
const PLAN_114_TASK_1 = {
  plan: "plans/114-Bun-Coverage-Gate.md",
  evidence: "docs/_evidence/phase114-bun-coverage.md",
  required: [
    // semantics probes
    "bun test --coverage",
    "coverageThreshold",
    "lcov",
    "coveragePathIgnorePatterns",
    "All files",
    // floors and the artefacts they flow into
    "coverage-thresholds.json",
    "plan 023",
    "measured − 3pp",
    "phase23-coverage",
    // the decisions Task 2 executes
    "per-file",
    "aggregate",
    "branch floor",
    "ponytail:",
  ],
  rejected: [
    "c8",
    "nyc",
    "istanbul",
    "port the 60/70/75 numbers",
    "lcov as the gate",
    "skip the recalibration",
    "silently drop the branch floor",
  ],
  completeTask: /^- \[x\] Task 1:/m,
};

test("plan 114 Task 1 coverage inventory exists, names every probe, and skips no rejection", () => {
  assertPrimitiveReview(PLAN_114_TASK_1);
});

/** Plan 115 Task 1 — the default-suite budget inventory that gates Task 2's trim. */
const PLAN_115_TASK_1 = {
  plan: "plans/115-Bun-Toolchain-Follow-Ups.md",
  evidence: "docs/_evidence/phase115-suite-budget.md",
  required: [
    // runner contract the inventory measures
    "run-all-tests.mjs",
    "GATE_FILES",
    "with-build-lock.mjs",
    "phase54-legacy-registry.test.mjs",
    // the documented claim and its location
    "docs/release-and-install.md:317",
    "< 60s",
    // the two measured causes
    "PRISM_BUILD_LOCK_HELD",
    "phase113-bun-inventory.md",
    // measurement method
    "spec reporter",
    "worker",
  ],
  rejected: [
    "raise the budget first",
    "bun test for the whole suite",
    "drop the gate files",
    "estimate from file size",
    "scripts/*.test.mjs glob",
    "trust npm's docs",
  ],
  completeTask: /^- \[x\] Task 1:/m,
};

test("plan 115 Task 1 suite-budget inventory exists, names every probe, and skips no rejection", () => {
  assertPrimitiveReview(PLAN_115_TASK_1);
});

/** Plan 120 Task 0 — review-remediation inventory. Later tasks consume the evidence, not a re-derivation. */
const PLAN_120_TASK_0 = {
  plan: "plans/120-Implementation-Review-Remediation-And-Release-0-11-0.md",
  evidence: "docs/_evidence/phase120-primitive-review.md",
  required: [
    "src/contracts-core/session.ts:L50",
    "packages/prism-core/src/sessions/sqlite/persistence.ts:L438",
    "packages/prism-core/src/sessions/postgres/persistence.ts:L374",
    "packages/prism-core/src/sessions/codecs/cursor.ts:L1",
    "src/testing/session-store-conformance.ts:L112",
    "src/agent-session/session.ts:L880",
    "src/session-stores.ts:L107",
    "src/session-stores.ts:L160",
    "estimateTextTokensForFamily",
    "src/agent-session/session/tool-round.ts:L458",
    "src/leases.ts:L31",
    "docs/operations.md:23",
    "idempotencySeen",
    "--test-coverage-include=dist/**",
    "86.49",
    "src/__tests__/docs.test.ts:L3368",
    "hasCodingTools",
    "scripts/package-truth.mjs:L82",
    "109",
  ],
  rejected: ["skip the review", "full design essay", "jsonl implements readBranchPath", "delete expired lease rows", "c8"],
  completeTask: /^- \[x\] Task 0:/m,
};

test("plan 120 Task 0 primitive review exists, names every inventory row, and skips no rejection", () => {
  assertPrimitiveReview(PLAN_120_TASK_0);
});
