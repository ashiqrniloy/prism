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
    execute: refineStep,                 // inline body
    until: (ctx) => ctx.state.passed === true,
    maxIterations: 5,
  });
  ```
- Exceeding `maxIterations` ends the run with a typed error carrying the iteration count and last body output (bounded).
- Existing DAG validations, limits, and replay unchanged for workflows without loop nodes.

## Tasks

- [x] Task 1 — Primitive Review: Scheduler State Machine Extension
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
      - `kind: "loop"` uses an inline `execute` body, `until`, and required `maxIterations`; referenced node bodies remain deferred because inline execution keeps validation and scheduler ownership simple.
      - `WorkflowLoopNodeContext` exposes a zero-based `iteration` and `previousOutput`; body output is bounded before it feeds the next iteration and `until` predicate.
      - Scheduler stores the completed-iteration counter and bounded last body output per loop node, checkpointing each completed iteration without retaining an unbounded history.
    - API Notes and Examples:
      ```ts
      export interface WorkflowLoopNodeContext extends WorkflowNodeContext {
        readonly iteration: number;      // zero-based
        readonly previousOutput?: unknown;
      }
      export interface LoopNodeDefinition extends WorkflowNodeBase {
        readonly kind: "loop";
        readonly execute: (ctx: WorkflowLoopNodeContext) => unknown | Promise<unknown>;
        readonly until: (ctx: WorkflowLoopNodeContext) => boolean | Promise<boolean>;
        readonly maxIterations: number; // required; hard-capped at 64
      }
      ```
      Body is inline `execute`; a referenced node id is deferred until durable sub-step semantics are implemented.
    - Files to Create/Edit:
      - `packages/workflows/src/types.ts` (loop context/definition and checkpoint iteration fields)
      - `packages/workflows/src/nodes.ts`, `packages/workflows/src/index.ts` (factory and public exports)
      - `packages/workflows/src/limits.ts`, `packages/workflows/src/define.ts` (64-iteration hard cap and required-cap validation)
      - `packages/workflows/src/run/node-execution.ts`, `packages/workflows/src/run/main.ts`, `packages/workflows/src/run/checkpoint.ts`, `packages/workflows/src/run/scheduler.ts` (counted dispatch, state, boundary checkpoints, typed error propagation)
      - `packages/workflows/src/checkpoint-core.ts`, `packages/workflows/src/checkpoints.ts` (last-output byte checks/redaction)
      - `packages/workflows/src/errors.ts` (`WorkflowLoopLimitError` / `ERR_PRISM_WORKFLOW_LOOP_LIMIT`)
      - `packages/workflows/src/__tests__/define.test.ts`, `packages/workflows/src/__tests__/run.test.ts` (validation, break, accumulation, exhaustion, checkpoint, and output-bound coverage)
      - `docs/workflows.md`, `docs/index.md`, `packages/workflows/README.md` (public node and limits documentation).
  - Test Cases to Write:
    - Break on first iteration; break mid; `maxIterations` exhausted → typed error with count + bounded last output.
    - Missing/oversized `maxIterations` → definition validation error.
    - State accumulation: body output feeds next iteration via ctx (documented contract).
    - DAG validation: workflows without loops unchanged (fixture replay byte-identical events).
    - Completed: `define.test.ts` and `run.test.ts` cover all cases above plus per-iteration checkpoint state and output bounds.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new node kind.
    - Docs pages to create/edit: `docs/workflows.md` — node-kind table row + "Iterative refinement" section with limits.
    - `docs/index.md` update: yes — Workflows entry description extended with `loopNode`.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion:
    - Primitive inventory confirmed the existing acyclic Kahn scheduler, `executeNode` dispatch, state/checkpoint chains, `maxFanOut` resolution pattern, and durable suspend/resume seams; loop execution stays package-local and leaves edge-cycle validation unchanged.

- [x] Task 2 — Durable Resume, Replay, and Saga Interaction
  - Acceptance Criteria:
    - Functional: suspend (HITL approval inside a loop body via tool node) resumes at the same iteration/step; a completed loop replays with per-iteration outputs in the event stream; saga compensation sees the loop as one node with an aggregated compensation record (documented: compensations register per iteration id — host-visible, deterministic).
    - Performance: resume does not re-execute completed iterations (checkpoint replay only).
    - Code Quality: iteration records versioned in the durable state schema additively; conformance extended.
    - Security: iteration count and outputs redaction-safe; ownership scoping identical to other node records.
  - Approach:
    - Documentation Reviewed: `docs/workflow-orchestration-primitives.md` (CheckpointStore/LeaseStore seams), `docs/workflows.md` (saga compensation), `packages/workflows/src/run/` durable paths.
    - Options Considered: treat whole loop as atomic (no per-iteration checkpoints) — rejected: resume would redo iterations (cost) or skip them (unsound).
    - Chosen Approach: checkpoint each completed iteration before advancing; store a bounded versioned iteration ledger with a terminal `done` marker so a crash after a successful body cannot cause re-execution. A `body` may be a function/tool sub-step; approved tool resumes re-enter the incomplete iteration with CAS-protected checkpoint ownership.
    - API Notes and Examples:
      ```ts
      const loop = loopNode({
        body: toolNode({ tool, args: () => ({ action: "refine" }), approval: { reason: "review" } }),
        until: (ctx) => ctx.previousOutput === "accepted",
        maxIterations: 3,
      });
      // WorkflowEvent: node_iteration_started / node_iteration_finished
      // fields: iteration, iterationId, done, bounded/redacted output
      // WorkflowCheckpointValue.nodes.loop.iterations is the durable ledger.
      ```
    - Files to Create/Edit:
      - `packages/workflows/src/types.ts`, `limits.ts`, `nodes.ts`, `define.ts`, `index.ts` (body form, stable iteration IDs, additive record/event contracts)
      - `packages/workflows/src/run/main.ts`, `run/node-execution.ts`, `run/checkpoint.ts`, `checkpoint-core.ts`, `checkpoints.ts`, `util.ts` (durable cursor/ledger restore, sub-step approval, output validation/redaction, event emission)
      - `packages/workflows/src/__tests__/run.test.ts`, `__tests__/checkpoints.test.ts`, `__tests__/checkpoint-conformance.ts`, `__tests__/define.test.ts` (resume, replay, crash boundary, bounds, conformance)
      - `packages/workflows/src/__tests__/saga.test.ts` (one-step aggregate/reverse iteration compensation contract)
      - `docs/workflows.md`, `docs/migration.md`, `docs/workflow-orchestration-primitives.md`, `packages/workflows/README.md` (durable semantics, additive schema, events, and saga boundary).
  - Test Cases to Write:
    - Suspend inside iteration 3 → resume completes iterations 3..N without re-running 1..2 (spy assertions).
    - Replay: event stream contains per-iteration outputs in order.
    - Compensation: failing loop mid-way triggers registered compensations in reverse iteration order.
    - Completed: run, checkpoint, and saga suites cover approved tool-body resume, replay events, crash-after-terminal-boundary recovery, redaction/byte bounds, and reverse aggregate compensation.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — durable semantics + events metadata.
    - Docs pages to create/edit:
      - `docs/workflows.md` (durable loop semantics, events, replay, and saga boundary)
      - `docs/migration.md` (additive checkpoint schema note and rollback compatibility)
      - `docs/workflow-orchestration-primitives.md` (primitive inventory/addendum and locked contract fields)
      - `packages/workflows/README.md` (package-facing durable loop summary)
    - `docs/index.md` update: no (Task 1 entry suffices).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion:
    - Durable loop state now restores the completed cursor and versioned iteration ledger; tool-body approvals re-enter the same incomplete iteration, replay emits fresh bounded iteration events, and a terminal iteration marker prevents crash-boundary re-execution. Saga runtime remains intentionally host-owned: one saga step carries the aggregate and hosts compensate stable iteration IDs in reverse order.

- [x] Task 3 — Conformance, Limits Freeze, and Release
  - Acceptance Criteria:
    - Functional: workflow conformance covers a bounded loop through both the memory adapter and the generic core checkpoint adapter; `maxNodes` counts declared node definitions once and loop executions use the separate `maxIterations` budget.
    - Performance: registered `workflow-loop` benchmark runs a five-iteration refinement through a mock provider within one frozen 50 ms node-execution envelope per iteration (250 ms total).
    - Code Quality: the reviewed workflow compat baseline is regenerated with additive exports only; Biome format/lint gates pass.
    - Security: no new trust boundary; `maxIterations` remains required and hard-capped at 64; benchmark stays network- and credential-free; release tarball excludes tests/source maps/source.
  - Approach:
    - Documentation Reviewed: `scripts/benchmark.mjs`, `scripts/budget-gates.mjs`, `scripts/budgets.json`, `scripts/benchmark-multi-agent.test.mjs`, `docs/workflows.md`, `docs/performance.md`, and `docs/release-and-install.md`.
    - Options Considered:
      - Add loop timing to `multi-agent-runtime`: rejected — that scenario measures a different multi-agent capacity envelope and would hide the loop-specific five-iteration budget.
      - Add a standalone parameterized scenario and focused gate: chosen — keeps the fixture, report schema, frozen ceiling, and network-free invariant independently reviewable.
    - Chosen Approach: add `workflow-loop` to the shared benchmark registry; run five serial `loopNode` iterations with one mock-provider agent call each; conformance the same loop through memory and generic core checkpoint adapters; freeze `maxNodes` as definition count and `maxIterations` as execution count; publish the workflow package independently as `0.3.2`.
    - API Notes and Examples:
      ```bash
      node scripts/benchmark.mjs --scenario workflow-loop --out /tmp/prism-workflow-loop.json
      npm run release:publish -- --dry-run --allow-dirty --allow-untagged
      ```
    - Files to Create/Edit:
      - `scripts/benchmark-scenarios/workflow-loop.mjs`, `scripts/benchmark-workflow-loop.test.mjs`, `scripts/benchmark.mjs`, `scripts/budgets.json`, `package.json` (scenario, frozen budget, gate, and npm-test wiring)
      - `packages/workflows/src/__tests__/checkpoints.test.ts`, `packages/workflows/src/__tests__/define.test.ts`, `packages/memory/src/conformance.ts` (adapter leg, independent budget test, and pre-existing syntax blocker)
      - `scripts/compat-baseline/arnilo__prism-workflows.txt`, `packages/workflows/package.json`, `package-lock.json`, `packages/workflows/CHANGELOG.md` (additive surface baseline and independent `0.3.2` package cut)
      - `docs/workflows.md`, `docs/performance.md`, `docs/migration.md`, `docs/release-and-install.md` (frozen accounting, benchmark evidence, migration, and package handoff)
  - Test Cases to Write:
    - Completed: memory and generic-core adapter loop conformance persists ordered iteration records with terminal `done` semantics.
    - Completed: `maxNodes: 1` permits five loop executions while `maxIterations: 5` bounds runtime; invalid hard-cap validation remains covered.
    - Completed: `workflow-loop` registry/report/budget/security gate proves five mock-provider calls, five finished records, one peak provider call, zero active work, and no credentials/network.
    - Completed: workflow package build/tests (94/94), Biome format/lint, workflow tarball dry-run, and additive compat baseline gate pass.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — limits accounting, benchmark evidence, package version, and release contract are public/operator-facing.
    - Docs pages to create/edit:
      - `docs/workflows.md`: frozen `maxNodes`/`maxIterations` accounting.
      - `docs/performance.md`: `workflow-loop` fixture, ceiling, and measured evidence.
      - `docs/migration.md`: `@arnilo/prism-workflows` `0.3.1 → 0.3.2` additive rollback note.
      - `docs/release-and-install.md`: independent package handoff and dry-run commands.
    - `docs/index.md` update: no — existing Workflows and Performance navigation entries already cover these pages.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion:
    - `workflow-loop` is registered as phase 45 and recorded 2026-08-31 at p50 2.356 ms, p95 6.443 ms (1.289 ms/iteration), against 250 ms total/50 ms per-iteration ceilings. `@arnilo/prism-workflows` is bumped to `0.3.2`; the reviewed compat baseline and tarball gate pass, and an injected-registry/real-npm dry-run publishes only that package. Workspace typechecks, workspace tests, coverage, Biome, and the workflow pack pass. Protected PostgreSQL evidence and actual tagged npm publication remain operator/CI gates. Full root `npm test` reaches the existing phase34 freeze and fails only on unrelated uncommitted `@arnilo/prism-wiki` metadata changes that expect `0.0.4` while the manifest remains `0.0.3`.

## Compromises Made

- Loop bodies support inline functions and function/tool sub-steps; arbitrary interior DAGs and nested workflow bodies remain deferred because they need a larger sub-scheduler contract.
- Saga compensation remains host-owned: workflow checkpoints/events expose one aggregate loop node plus stable iteration IDs, while saga handlers register and execute external compensation in reverse order.
- Loop iterations are serial within one scheduler slot and retain at most 64 bounded records; this keeps memory bounded while leaving parallel loop bodies out of scope.
- Task 3 benchmark evidence is deliberately network-free and uses the memory checkpoint adapter; protected database timing is not fabricated into the frozen budget.
- Actual npm publication and protected PostgreSQL evidence remain operator-owned; local release preview uses an injected 404 registry and `npm publish --dry-run`.

## Further Actions

- Operator/CI — high priority: reconcile the unrelated uncommitted `@arnilo/prism-wiki` `0.0.3` freeze mismatch and run the full root `npm test`/`sdk:ready` with protected PostgreSQL evidence before pushing the signed `@arnilo/prism-workflows@0.3.2` tag.
- Operator — release handoff: publish `@arnilo/prism-workflows@0.3.2` with the existing OIDC/provenance workflow; no new migration or runtime dependency is required.
