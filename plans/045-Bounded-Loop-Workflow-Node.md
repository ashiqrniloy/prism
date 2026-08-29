# 045 — Bounded Loop Workflow Node

Adoption-list item #6 (LangGraph cycles / Mastra loop steps — reflexive refinement).
Roadmap phase: **0.3.x**.
Baseline: `@arnilo/prism-workflows` **0.3.0**.
Target: a `loop` node kind — bounded iterative refinement with a break predicate and a hard `maxIterations` cap. Sugar over a bounded unroll, still finite; DAG determinism preserved.

## Objectives

- Add `LoopNodeDefinition` (`kind: "loop"`) to `@arnilo/prism-workflows`: execute a body repeatedly until `until(ctx)` resolves true or `maxIterations` is hit.
- Hard-bounded: iteration count enforced by the scheduler (never by the predicate alone); over-limit is a deterministic fail-closed workflow error, not a hang.
- Durable semantics: each iteration checkpointed like any node execution; suspend/resume inside a loop resumes at the iteration boundary; replay shows per-iteration outputs.
- Zero change to existing node kinds; `maxNodes` accounting counts iterations deterministically (documented rule).

## Expected Outcome

- Hosts express "refine until critic passes, max 5" as one node instead of N hand-unrolled conditional blocks:
  ```ts
  const refine = loopNode({
    id: "refine",
    body: refineStep,                    // node id or inline function body
    until: (ctx) => ctx.state.passed === true,
    maxIterations: 5,
  });
  ```
- Exceeding `maxIterations` ends the run with a typed error carrying the iteration count and last body output (bounded).
- Existing DAG validations, limits, and replay unchanged for workflows without loop nodes.

## Tasks

- [ ] Task 1 — Primitive Review: Scheduler State Machine Extension
  - Acceptance Criteria:
    - Functional: inventory `packages/workflows/src/types.ts` (`WorkflowNodeKind` union, `WorkflowLimits`, edge tuples), `packages/workflows/src/run/node-execution.ts` (`executeNode` dispatch switch), `packages/workflows/src/run/main.ts` (scheduler state, `resolveMaxFanOut` precedent for limit resolution), saga/durable suspend paths. Confirm where iteration state lives (`SchedulerState` — per-node iteration counter, checkpointed), and that cycle-freeness validation of `edges` is untouched (loop body is an interior sub-execution, not a graph edge cycle).
    - Performance: loop overhead per iteration ≤ single node execution envelope; no per-iteration allocation growth (bounded iteration records).
    - Code Quality: `executeNode` gains one case; iteration state typed; no changes to conditional/fan_out/join semantics.
    - Security: `maxIterations` hard cap frozen (`HARD_MAX_LOOP_ITERATIONS`, e.g. 64); missing cap → definition rejected at validation; per-iteration output byte caps reuse `maxNodeOutputBytes`.
  - Approach:
    - Documentation Reviewed:
      - `packages/workflows/src/types.ts`, `packages/workflows/src/run/node-execution.ts`, `packages/workflows/src/run/main.ts`, `docs/workflows.md`, `docs/workflow-orchestration-primitives.md`.
    - Options Considered:
      - Allow cycles in `edges` (LangGraph-style general graphs): rejected — unbounded state space, breaks bounded-DAG determinism guarantees and existing validation.
      - Dedicated `loop` node with interior iteration: chosen — finite by construction, one validation rule, scheduler sees one node.
    - Chosen Approach:
      - `kind: "loop"` with `body` (inline `execute` or referenced node id executed as sub-step), `until`, `maxIterations`; scheduler wraps body execution in a counted loop with checkpoint-per-iteration.
    - API Notes and Examples:
      ```ts
      export interface LoopNodeDefinition extends WorkflowNodeBase {
        readonly kind: "loop";
        readonly execute: (ctx: WorkflowNodeContext & { iteration: number }) => unknown | Promise<unknown>;
        readonly until: (ctx: WorkflowNodeContext & { iteration: number }) => boolean | Promise<boolean>;
        readonly maxIterations: number;
      }
      ```
      (Body as inline `execute` — referencing another node id is the fallback option if inline keeps validation simple.)
    - Files to Create/Edit:
      - `packages/workflows/src/types.ts` (union + definition), `packages/workflows/src/run/node-execution.ts` (case), `packages/workflows/src/run/main.ts` (iteration state + limits), `packages/workflows/src/errors.ts` (`ERR_PRISM_WORKFLOW_LOOP_LIMIT`).
  - Test Cases to Write:
    - Break on first iteration; break mid; `maxIterations` exhausted → typed error with count + bounded last output.
    - Missing/oversized `maxIterations` → definition validation error.
    - State accumulation: body output feeds next iteration via ctx (documented contract).
    - DAG validation: workflows without loops unchanged (fixture replay byte-identical events).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new node kind.
    - Docs pages to create/edit: `docs/workflows.md` — node-kind table row + "Iterative refinement" section with limits.
    - `docs/index.md` update: yes — Workflows entry description extended.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 2 — Durable Resume, Replay, and Saga Interaction
  - Acceptance Criteria:
    - Functional: suspend (HITL approval inside a loop body via tool node) resumes at the same iteration/step; a completed loop replays with per-iteration outputs in the event stream; saga compensation sees the loop as one node with an aggregated compensation record (documented: compensations register per iteration id — host-visible, deterministic).
    - Performance: resume does not re-execute completed iterations (checkpoint replay only).
    - Code Quality: iteration records versioned in the durable state schema additively; conformance extended.
    - Security: iteration count and outputs redaction-safe; ownership scoping identical to other node records.
  - Approach:
    - Documentation Reviewed: `docs/workflow-orchestration-primitives.md` (CheckpointStore/LeaseStore seams), `docs/workflows.md` (saga compensation), `packages/workflows/src/run/` durable paths.
    - Options Considered: treat whole loop as atomic (no per-iteration checkpoints) — rejected: resume would redo iterations (cost) or skip them (unsound).
    - Chosen Approach: checkpoint per iteration boundary.
    - API Notes and Examples: events: `workflow_node_started`/`finished` per iteration with `iteration: n` metadata.
    - Files to Create/Edit: `packages/workflows/src/run/` durable modules (iteration checkpoint records), `packages/workflows/src/events` shapes if separate.
  - Test Cases to Write:
    - Suspend inside iteration 3 → resume completes iterations 3..N without re-running 1..2 (spy assertions).
    - Replay: event stream contains per-iteration outputs in order.
    - Compensation: failing loop mid-way triggers registered compensations in reverse iteration order.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — durable semantics + events metadata.
    - Docs pages to create/edit: `docs/workflows.md` (durable loop semantics), `docs/migration.md` (additive state schema note).
    - `docs/index.md` update: no (Task 1 entry suffices).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 3 — Conformance, Limits Freeze, and Release
  - Acceptance Criteria:
    - Functional: workflow package conformance suite gains a loop leg (memory + durable adapters where applicable); `maxNodes` counting rule documented (loop counts as its body executions against `maxNodes`? — decide: iterations count toward a separate `maxIterations` budget, `maxNodes` counts node definitions; record the decision in docs).
    - Performance: benchmark scenario `workflow-loop` (5-iteration refine, mock provider) within node-execution envelope × iterations.
    - Code Quality: additive-only compat baseline; biome clean.
    - Security: no new trust boundary; caps frozen and fail-closed.
  - Approach:
    - Documentation Reviewed: `scripts/benchmark-scenarios/` (multi-agent-runtime precedent), `docs/release-and-install.md`.
    - Options Considered / Chosen Approach: extend existing suites + parameterized benchmark runner; independent version bump.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: `scripts/benchmark-scenarios/` (scenario), `packages/workflows/src/__tests__/`, `docs/workflows.md` limits table.
  - Test Cases to Write: conformance loop leg; budget rule tests (`maxNodes` vs `maxIterations` accounting).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — limits surface.
    - Docs pages to create/edit: `docs/workflows.md`, `docs/performance.md` (scenario evidence row).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.