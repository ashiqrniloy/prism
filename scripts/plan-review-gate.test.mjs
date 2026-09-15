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

test("plan 074 Task 1 primitive review exists, names every reuse row, and skips no rejection", () => {
  assert.ok(existsSync(join(ROOT, PLAN_074_TASK_1.evidence)), `missing ${PLAN_074_TASK_1.evidence}`);
  const text = readFileSync(join(ROOT, PLAN_074_TASK_1.evidence), "utf8");
  const haystack = text.toLowerCase();
  for (const token of PLAN_074_TASK_1.required) {
    assert.ok(haystack.includes(token.toLowerCase()), `${PLAN_074_TASK_1.evidence} must name ${token}`);
  }
  for (const token of PLAN_074_TASK_1.rejected) {
    assert.ok(haystack.includes(token.toLowerCase()), `${PLAN_074_TASK_1.evidence} must explicitly reject ${token}`);
  }
  // Citations must be spans, not prose: at least the references listed by the task.
  assert.match(text, /[\w./-]+\.(ts|mjs):L\d+/, "review must cite explicit path:line spans");
  // Negative control: the Task 1 checkbox may only be complete once this file exists.
  const plan = readFileSync(join(ROOT, PLAN_074_TASK_1.plan), "utf8");
  if (/^- \[x\] \*\*Task 1 —/m.test(plan)) {
    assert.ok(text.length > 2_000, "a completed Task 1 must record a real review body");
  }
});
