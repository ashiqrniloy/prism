# Cyclic Workflow Graphs (Superstep Execution + Dynamic Routing)

## Objectives

- Let hosts define **cyclic workflow graphs** (back-edges: worker→reviewer→worker reflection, planner↔executor interleavings) in `@arnilo/prism-core/runtime/workflows`, with bounded, fail-closed execution — matching the industry-standard graph primitive set (LangGraph cycles + `recursion_limit`, Microsoft Agent Framework executor cycles + `max_iterations`, AutoGen GraphFlow).
- Add per-node **activation semantics** (`"all" | "any"`) so cycle members can re-fire on back-edges without deadlocking, mirroring AutoGen `activation_condition` / MAF edge groups.
- Add a **`routeNode`** dynamic-routing primitive (LangGraph `Command(goto)` equivalent): a node returns which declared successors to activate, enabling model-driven control flow inside an auditable, statically-declared topology.
- Keep every existing DAG behavior **bit-for-bit**: acyclic definitions without the new opt-in take today's Kahn path, today's error messages, today's checkpoint schema.
- Make cyclic runs **durable**: checkpoint schema v2 records superstep + pending-activation state; `resumeWorkflow` continues mid-cycle; replay, serialization, and graph exporters handle cyclic edges.

## Expected Outcome

- `defineWorkflow` accepts edges that form cycles when the definition declares `limits.maxSupersteps`; undeclared cycles still fail with `WorkflowDefinitionError: Workflow graph contains a cycle`.
- Cyclic runs execute under a superstep engine: activation waves run within `concurrency`, the run **succeeds on idle drain** (no pending activations, nothing running), and breaches `maxSupersteps` fail closed with a new `WorkflowSuperstepLimitError` (`ERR_PRISM_WORKFLOW_SUPERSTEP_LIMIT`).
- `routeNode({ select })` activates a dynamic subset of declared successors; unknown targets fail closed at definition validation (targets ⊆ declared edges) and at runtime.
- Checkpoints from cyclic runs resume exactly once across restarts (CAS + fencing unchanged), including mid-cycle suspension (`suspend()` inside a cyclic node body).
- `examples/cyclic-reflection.ts` demonstrates worker→reviewer→worker until approval, and `routeNode` dynamic routing.
- Full workflows test suite, typecheck, and `release:gate` green; all changes additive (no public symbol moves/removals, so no compat-baseline regeneration).

## Tasks

- [x] Task 1: Primitive review — inventory loop/graph primitives, justify the superstep engine
  - Acceptance Criteria:
    - Functional: a review document exists at `docs/history/130-cyclic-workflows-primitive-review.md` that inventories existing primitives (`loopNode` bounded bodies, `conditionalNode` skip-successors, `fanOutNode`/`joinNode`, `suspend`/`resumeWorkflow`, `replayWorkflow`, supervisor delegation) and shows, per pattern, what is already achievable without a new primitive.
    - Functional: the review names the capability gap precisely — per-node checkpointing/events/attribution inside an iteration, mixed node kinds per iteration, and dynamic successor activation — and rejects alternatives (giant `loopNode.execute` bodies, host-side recursion over `runWorkflow`) with reasons.
    - Code Quality: conclusions match this plan's chosen design (activation engine, `maxSupersteps`, `routeNode`); deviations are recorded in the task note, not silently.
    - Security: the review restates the fail-closed invariants the engine must preserve (bounded budgets, redaction before checkpoints/events, no credential path into nodes).
  - Approach:
    - Documentation Reviewed:
      - `docs/workflows.md` (node kinds, limits, checkpoints, coordinator, replay)
      - `docs/multi-agent-patterns.md` (crew pattern: conditionalNode + loopNode revision loop today)
      - `docs/history/0.7.0-primitive-review.md`, `docs/history/084-primitive-review.md` (house review format)
      - `packages/prism-core/src/runtime/workflows/define.ts:L120-L152` (acyclicity rejection), `run/scheduler.ts:L133-L160` (Kahn drain loop)
    - Options Considered:
      - Do nothing — document `loopNode` composition for reflection loops. Rejected: loses per-node events/checkpoints per iteration and forces all iteration logic into one node body.
      - Event-driven topology (LlamaIndex-style typed events as edges). Deferred: a different authoring model, not a missing capability; hosts compose it on conditional + state today.
      - Superstep activation engine with bounded rounds (LangGraph/MAF model). Chosen.
    - Chosen Approach: superstep engine as the one generic reusable primitive; everything else composes.
    - API Notes and Examples: none yet — this task is analysis only.
    - Files to Create/Edit:
      - `docs/history/130-cyclic-workflows-primitive-review.md`: new review document
    - References:
      - Industry survey (this plan's research): LangGraph `StateGraph` cycles + `recursion_limit` (default 25); MAF `max_iterations` (default 100) + BSP supersteps + idle-drain termination; AutoGen GraphFlow `activation_condition: all|any`; LangGraph `Command(goto)` / `Send`.
  - Test Cases to Write:
    - none — documentation task
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — analysis only.
    - Docs pages to create/edit: `docs/history/130-cyclic-workflows-primitive-review.md` (history archive per wiki rules; primitive reviews live in `docs/history/`).
    - `docs/index.md` update: no — history archive, no navigation entry for internal reviews.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (current-line vs history rule).

- [x] Task 2: Definition surface — `maxSupersteps`, `activation`, cycle policy, `routeNode` type
  - Acceptance Criteria:
    - Functional: `WorkflowLimits` gains `maxSupersteps?: number` (validated safe integer 1..`HARD_MAX_SUPERSTEPS` = 256). `WorkflowNodeBase` gains `activation?: "all" | "any"` (default `"all"`). New `RouteNodeDefinition` (`kind: "route"`, `select: (ctx) => readonly string[] | Promise<...>`) joins `WorkflowNodeDefinition`; `routeNode()` factory exported from the package barrel.
    - Functional: `defineWorkflow` enforces: self-edges still rejected; a cycle is allowed **iff** `limits.maxSupersteps` is declared, else the existing error `Workflow graph contains a cycle` is thrown unchanged (byte-identical message); `route.select` targets are not statically validated (dynamic), but `conditional`/`join` cross-references keep today's validation.
    - Functional: `activation: "any"` on a node with zero predecessors is a definition error; `activation` is accepted (inert) on acyclic graphs so hosts can migrate definitions without shape churn.
    - Code Quality: `WORKFLOW_CHECKPOINT_SCHEMA_VERSION` untouched here; no engine logic yet. Types discriminated-union style matches `types.ts`.
    - Security: limit validation rejects non-safe integers, zero, negatives, NaN, `Infinity`, and values above the hard cap — same `validateWorkflowLimit` path as every other limit.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-core/src/runtime/workflows/types.ts:L215-L229` (`WorkflowLimits`), `L163-L208` (node definition union), `define.ts:L23-L116` (validation order)
      - `packages/prism-core/src/runtime/workflows/limits.ts` (constant naming: `DEFAULT_*`/`HARD_MAX_*`)
      - `docs/workflows.md` § Inputs (limits table)
    - Options Considered:
      - Workflow-level `cycles: { maxSupersteps }` block vs `limits.maxSupersteps`. Chosen `limits` — it is a bound, joins the existing validation/hard-cap family, and `definitionHash` already covers limits for resume drift.
      - Auto-apply a default budget instead of requiring it. Rejected — `loopNode` requires `maxIterations` explicitly; same explicit-bound precedent, fail closed.
    - Chosen Approach: opt-in via `limits.maxSupersteps`; engine selection derived deterministically from the definition (cycle present OR any non-default `activation` OR any `route` node ⇒ superstep engine; otherwise today's Kahn path).
    - API Notes and Examples:
      ```ts
      const reviewLoop = defineWorkflow({
        id: "reflection",
        revision: "1",
        nodes: {
          worker: functionNode({ execute: async (ctx) => revise(ctx.state) }),
          reviewer: agentNode({ agent: "reviewer", input: (ctx) => ({ draft: ctx.upstream.worker }) }),
        },
        edges: [["worker", "reviewer"], ["reviewer", "worker"]],
        limits: { maxSupersteps: 12 },
        // worker needs activation any: entry + back-edge
        // (set via nodes.worker.activation = "any")
      });
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/runtime/workflows/types.ts`: `WorkflowLimits.maxSupersteps`, `WorkflowNodeBase.activation`, `RouteNodeDefinition`, union member
      - `packages/prism-core/src/runtime/workflows/limits.ts`: `HARD_MAX_SUPERSTEPS = 256`
      - `packages/prism-core/src/runtime/workflows/nodes.ts`: `routeNode()` factory
      - `packages/prism-core/src/runtime/workflows/define.ts`: replace unconditional `assertAcyclic(...)` with policy check (acyclic ⇒ unchanged; cyclic without `maxSupersteps` ⇒ same error; cyclic with ⇒ validate limits, mark definition `execution: "supersteps"` on the frozen `WorkflowDefinition`)
      - `packages/prism-core/src/runtime/workflows/index.ts`: export `routeNode`, `RouteNodeDefinition`
  - Test Cases to Write (in `packages/prism-core/src/runtime/workflows/__tests__/define-cyclic.test.ts`):
    - cyclic graph without `maxSupersteps` throws today's exact message
    - cyclic graph with `maxSupersteps` builds; `execution` marker present
    - `maxSupersteps` 0 / -1 / 1.5 / NaN / 257 rejected
    - self-edge rejected on cyclic graphs too
    - `activation: "any"` with zero predecessors rejected; with predecessors accepted
    - `routeNode` factory produces `kind: "route"`; missing `select` rejected
    - acyclic definition with `maxSupersteps` declared still builds (opt-in on DAG is legal)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new definition surface (`limits.maxSupersteps`, `activation`, `routeNode`) and relaxed acyclicity.
    - Docs pages to create/edit: `docs/workflows.md` (limits table row, node-kind row for `route`, cyclic-execution section) — full edit in Task 8.
    - `docs/index.md` update: no — Task 8 updates the existing workflows entry sentence; no new page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Superstep scheduler engine
  - Acceptance Criteria:
    - Functional: new engine in `run/superstep.ts` executes definitions marked `execution: "supersteps"`: source nodes (indegree 0, or all-pred `activation: "any"` seeds) activate; on node success, successors receive an activation; `"all"` nodes activate when every predecessor has fired since that node's last activation (round barrier); `"any"` nodes activate on each predecessor completion; `conditional` nodes activate only `then`/`else` successors per predicate; `route` nodes activate the `select()` subset; `fan_out`/`join` consume the current round's items; `loop` nodes keep their internal iteration budget.
    - Functional: run **succeeds on idle drain** (no pending activations, `running` empty) — mirrors MAF idle termination; `maxSupersteps` breach fails the run closed with `WorkflowSuperstepLimitError` (`ERR_PRISM_WORKFLOW_SUPERSTEP_LIMIT`) before scheduling the over-budget wave; skip propagation keeps today's `unmet dependencies` semantics for nodes that can never activate.
    - Functional: DAG definitions (no `execution` marker) take today's `executeSchedulerBody` path bit-for-bit — no behavior, event-order, or checkpoint-shape change.
    - Performance: activation bookkeeping is O(edges) per wave; no per-activation allocations beyond the existing `iterations[]` ledger rows; `concurrency` worker pool reused (hard cap 256 unchanged).
    - Code Quality: shared completion seam — extract `onNodeSucceeded(state, nodeId, options, emit)` used by both engines so node-execution.ts does not fork; engine choice made once at run start, never mid-run.
    - Security: activations never widen tools/identity/ownership — node execution reuses `runNode` with unchanged permission/redactor/executionPolicy wiring; superstep counter is host-unforgeable (definition-derived).
  - Approach:
    - Documentation Reviewed:
      - `run/scheduler.ts:L133-L205` (drain loop, status finalization), `run/main.ts:L46-L80` (`SchedulerState`), `run/node-execution.ts:L41-L115` (iteration ledger), `run/skip.ts` (skip propagation)
      - `docs/workflows.md` § Outputs (status vocabulary: `queued/running/succeeded/failed/aborted/suspended/denied`)
      - Industry: MAF BSP/Pregel semantics (concurrent executors per superstep, barrier, idle-drain); LangGraph super-step model; AutoGen `activation_group` `all|any`.
    - Options Considered:
      - Extend Kahn scheduler with residual indegree resets. Rejected: indegree-reset semantics are exactly the deadlock trap MAF solved with activation groups; a separate wave engine is clearer and keeps the DAG path untouched.
      - Actor/message runtime (XState-style mailboxes). Rejected: new concurrency model; waves + activation predicates are the minimal standard.
    - Chosen Approach: wave engine; `SchedulerState` gains `superstep: number` and `pendingActivations: Map<nodeId, { from: Set<string>; round: number }>`; existing `ready`/`running` reused per wave.
    - API Notes and Examples:
      ```ts
      // reflection: worker(any) ← entry + reviewer back-edge; reviewer(all, sole pred)
      const wf = defineWorkflow({
        id: "reflection", revision: "1",
        nodes: {
          worker: { ...functionNode({ execute }), activation: "any" },
          reviewer: agentNode({ agent: "reviewer", input: (ctx) => ctx.upstream.worker }),
          done: functionNode({ execute: async (ctx) => ctx.state.final }),
        },
        edges: [["worker", "reviewer"], ["reviewer", "worker"], ["reviewer", "done"]],
        limits: { maxSupersteps: 12 },
      });
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/runtime/workflows/run/superstep.ts`: new engine
      - `packages/prism-core/src/runtime/workflows/run/scheduler.ts`: dispatch to engine by definition marker; extract shared completion seam
      - `packages/prism-core/src/runtime/workflows/run/main.ts`: `SchedulerState` additions
      - `packages/prism-core/src/runtime/workflows/run/node-execution.ts`: completion callback routed through shared seam; `route` node execution (evaluate `select`, validate targets ⊆ declared successors at runtime, fail closed with `WorkflowRuntimeError` on unknown target)
      - `packages/prism-core/src/runtime/workflows/errors.ts`: `WorkflowSuperstepLimitError extends WorkflowRuntimeError`, code `ERR_PRISM_WORKFLOW_SUPERSTEP_LIMIT`
  - Test Cases to Write (in `__tests__/cyclic-execution.test.ts`):
    - worker→reviewer→worker reflection terminates on idle drain with `status: "succeeded"`; each activation emitted a `node_started`/`node_finished` pair with `iteration` populated
    - `activation: "all"` on a cycle member deadlocks-free only via explicit entry path; entry + back-edge with `"any"` re-fires correctly
    - budget breach: `maxSupersteps: N` exceeded ⇒ `WorkflowSuperstepLimitError`, code asserted, no further provider/node calls after breach
    - conditional back-edge: reviewer routes to `worker` while revising, to `done` when approved
    - fan_out/join inside a cycle consumes current-round items only
    - abort mid-wave ⇒ `status: "aborted"`, sessions aborted (reuse existing pattern)
    - acyclic definition with `maxSupersteps` runs on the wave engine and produces same outputs as the Kahn path would
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new execution mode, new error class/code, `iteration` on node events in wave mode.
    - Docs pages to create/edit: `docs/workflows.md` § cyclic execution + error vocabulary — Task 8.
    - `docs/index.md` update: yes — Task 8 extends the workflows entry sentence with cyclic graphs.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4: `routeNode` dynamic routing end to end
  - Acceptance Criteria:
    - Functional: a `route` node's `select(ctx)` result activates exactly that subset of its declared successors next wave; `[]` activates nothing (contributes to idle drain); duplicate ids deduplicate; unknown id ⇒ `WorkflowRuntimeError` (`ERR_PRISM_WORKFLOW_ROUTE_TARGET`) fail closed after zero side effects.
    - Functional: `select` may be async and read `ctx.state`/`ctx.upstream` (model-driven routing: an `agentNode` writes a decision into state, downstream `route` selects on it).
    - Code Quality: `select` receives the existing `WorkflowNodeContext`; no new context type.
    - Security: targets are constrained to declared edges (auditable topology — no goto-anywhere); route decisions never widen execution policy or tools.
  - Approach:
    - Documentation Reviewed:
      - `types.ts` `ConditionalNodeDefinition` (`then`/`else` static lists — the gap `route` closes), LangGraph `Command(goto)` semantics, ADK dynamic workflows.
      - `run/node-execution.ts` (how conditional predicates evaluate today)
    - Options Considered:
      - Let any node return a routing command object (LangGraph-style). Rejected for v1: infects every node kind's return contract; a dedicated node keeps `execute` return types clean.
      - Widen `conditionalNode` with a dynamic `choose(ctx)`. Considered — `routeNode` chosen instead: distinct name documents intent, static `then/else` stays simple.
    - Chosen Approach: dedicated `route` node, subset-of-declared-successors constraint.
    - API Notes and Examples:
      ```ts
      const next = routeNode({ select: async (ctx) => {
        const plan = ctx.state.plan as { next: string };
        return plan.next === "revise" ? ["revise"] : ["done"];
      } });
      ```
    - Files to Create/Edit:
      - `run/node-execution.ts`: `route` branch (evaluate + record chosen targets in node output for audit)
      - `run/superstep.ts`: activation application for chosen targets
      - `nodes.ts` / `index.ts`: factory + export (added in Task 2; wire execution here)
  - Test Cases to Write (in `__tests__/route-node.test.ts`):
    - routes to selected subset; other successors never run
    - empty selection drains to success
    - unknown target fails closed with the exact code; no downstream side effects
    - async `select` reading agent-written state (LangGraph `Command` equivalence demo)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new node kind behavior.
    - Docs pages to create/edit: `docs/workflows.md` node-kind table + routing section — Task 8.
    - `docs/index.md` update: yes — same Task 8 entry sentence.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5: Checkpoint schema v2 — durable cyclic runs
  - Acceptance Criteria:
    - Functional: `WorkflowCheckpointValue` gains additive `execution?: { mode: "supersteps"; superstep: number; maxSupersteps: number; pending: Readonly<Record<string, { from: readonly string[]; round: number }>> }`; `WORKFLOW_CHECKPOINT_SCHEMA_VERSION` → `2`; cyclic node executions recorded through the existing per-node `iterations[]` ledger (reuse — no parallel record shape); `outputs` map stays last-output-wins.
    - Functional: `resumeWorkflow` restores superstep counter + pending activations, re-checks the budget, and continues exactly once (CAS/version/fencing unchanged); `suspend()` inside a cyclic node persists and resumes mid-cycle; v1 checkpoints (and v2 without `execution`) load and run on the DAG path unchanged.
    - Functional: `definitionHash` covers `maxSupersteps`/`activation`/route edges (it hashes the frozen definition) — a loop-bound change without a `revision` bump fails closed on resume.
    - Performance: one checkpoint write per wave boundary (batched) — no more writes than today's per-node-completion cadence on DAGs of equal size; pending map is O(nodes).
    - Code Quality: unknown `schemaVersion` (> 2) fails closed with `WorkflowCheckpointError`; no silent field dropping.
    - Security: pending-activation payloads and iteration outputs pass the existing redactor before persistence (same seam as today's node outputs); checkpoint byte caps unchanged (`maxCheckpointBytes` 1 MiB default / 8 MiB hard).
  - Approach:
    - Documentation Reviewed:
      - `run/checkpoint.ts` (persist shape, `resultFromRecord`, terminal-write rules), `types.ts` `WorkflowCheckpointValue`, `docs/workflows.md` § durable suspension/resumption, `docs/durable-runs.md`
      - MAF checkpoint contents (executor state + pending messages + shared state) — the pending-activation set is Prism's equivalent.
    - Options Considered:
      - Record every activation as a separate checkpoint node row (execution-history journal). Rejected: unbounded growth; the `iterations[]` ledger already bounds per-node history and state snapshots carry the rest.
      - Schema v1 with optional fields only. Rejected: explicit version bump keeps unknown-version fail-closed honest.
    - Chosen Approach: additive v2 fields + reuse of `iterations[]`.
    - API Notes and Examples:
      ```jsonc
      // checkpoint value fragment (v2, cyclic run, suspended mid-cycle)
      { "schemaVersion": 2, "status": "suspended",
        "execution": { "mode": "supersteps", "superstep": 7, "maxSupersteps": 12,
                       "pending": { "worker": { "from": ["reviewer"], "round": 4 } } },
        "nodes": { "worker": { "status": "succeeded", "iteration": 4,
                               "iterations": [ /* WorkflowLoopIterationRecord[] */ ] } } }
      ```
    - Files to Create/Edit:
      - `run/checkpoint.ts`: serialize/restore `execution` block; version bump; unknown-version guard
      - `run/main.ts` + `run/superstep.ts`: wave-boundary `persistCheckpoint` call; restore path
      - `types.ts`: `WorkflowCheckpointValue.execution`, `WorkflowExecutionCheckpoint` type
      - `limits.ts`: `WORKFLOW_CHECKPOINT_SCHEMA_VERSION = 2`
  - Test Cases to Write (in `__tests__/cyclic-durability.test.ts`):
    - suspend inside cyclic node body ⇒ checkpoint v2 with `execution` block; `resumeWorkflow` continues the wave; decisions not re-executed
    - kill/resume mid-wave (memory checkpoint store, fresh `runWorkflow` options) ⇒ exactly-once node executions (count via events)
    - budget re-checked on resume: resumed run at superstep 11 of 12 breaches ⇒ `WorkflowSuperstepLimitError`
    - v1 checkpoint (hand-built fixture from today's shape) loads and resumes on DAG path
    - schemaVersion 3 fixture fails closed with `WorkflowCheckpointError`
    - coordinator path: `createWorkflowCoordinator` claims a suspended cyclic run and resumes it (lease/fencing reuse)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — checkpoint schema version and new persisted fields.
    - Docs pages to create/edit: `docs/workflows.md` (durable section: cyclic resume, v2 note) — Task 8; sizing trade-off line (see Task 8).
    - `docs/index.md` update: no — covered by Task 8 workflows entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6: Replay, serialization, graph export for cyclic graphs
  - Acceptance Criteria:
    - Functional: `replayWorkflow` from a cyclic run requires a succeeded source node and resolves the **latest succeeded iteration** as that node's evidence; downstream closure computed over cyclic edges; recorded `lineage` unchanged in shape. Replaying from a node whose last iteration failed fails closed with the existing definition errors.
    - Functional: `serializeWorkflowGraph` emits edges as declared (cycles included) plus `limits.maxSupersteps` and per-node `activation`; `collectWorkflowGraphs` traverses nested definitions; `workflowGraphToMermaid`/`workflowGraphToDot` render back-edges with existing label/shape conventions, deterministic output.
    - Performance: export is O(nodes + edges), no change.
    - Code Quality: exporters stay pure/deterministic (sorted output) — existing property tests keep passing.
    - Security: serialization never emits functions/closures (route `select` serialized as `{ kind: "route" }` metadata only).
  - Approach:
    - Documentation Reviewed:
      - `replay.ts` (downstream closure, evidence copy), `graph-export.ts`, `docs/workflows.md` § replay/serialization
    - Options Considered:
      - Per-iteration replay forking (replay from worker iteration 3 of 5). Deferred to Further Actions — latest-iteration semantics covers the audit use case; per-iteration forks multiply lineage depth against `maxReplayDepth` for marginal value now.
    - Chosen Approach: latest-iteration replay; exporters extended additively.
    - API Notes and Examples:
      ```ts
      const run2 = await replayWorkflow(wf, { sourceRunId: run.runId, fromNodeId: "reviewer" }, opts);
      // lineage.fromNodeId === "reviewer"; worker evidence = its last succeeded iteration
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/runtime/workflows/replay.ts`: iteration resolution + cyclic closure walk
      - `packages/prism-core/src/runtime/workflows/graph-export.ts`: new fields, deterministic edge order incl. back-edges
  - Test Cases to Write (in `__tests__/cyclic-replay-export.test.ts`):
    - replay from reviewer in a 4-iteration reflection run copies worker's last iteration output as pre-state evidence
    - replay from a never-succeeded cyclic node fails closed
    - mermaid/dot snapshots include back-edge and stay deterministic across two calls
    - `serializeWorkflowGraph` round-trips `maxSupersteps` + `activation` + route nodes without functions
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — replay/export behavior for cyclic graphs.
    - Docs pages to create/edit: `docs/workflows.md` replay + serialization sections — Task 8.
    - `docs/index.md` update: no — Task 8 entry sentence covers.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 7: Example — cyclic reflection + dynamic routing demo
  - Acceptance Criteria:
    - Functional: `examples/cyclic-reflection.ts` runs offline (mock provider pattern from `examples/crew-hierarchy.ts`): worker drafts, reviewer agent approves/rejects via structured state, conditional back-edge revises until approval or budget; a `routeNode` selects the final branch from agent-written state; run prints per-wave node events and the final deliverable.
    - Functional: example demonstrates `limits.maxSupersteps` breach path once (commented or second run) so the fail-closed error is observable.
    - Code Quality: example executes via `bun examples/cyclic-reflection.ts` with zero network; follows existing example style (asserts + console output).
    - Security: mock provider only; no credentials, no real tools.
  - Approach:
    - Documentation Reviewed:
      - `examples/crew-hierarchy.ts`, `examples/handoff-swarm.ts` (style, mock provider usage), `docs/testing.md` (offline example budget)
    - Options Considered: single example covering both patterns vs two examples. One file — the route demo is four lines on top of the reflection graph.
    - Chosen Approach: one example, both primitives.
    - API Notes and Examples:
      ```ts
      const wf = defineWorkflow({ id: "cyclic-reflection", revision: "1", nodes: { worker, reviewer, route, done, revise }, edges: [...back-edges...], limits: { maxSupersteps: 8 } });
      const result = await runWorkflow(wf, { goal: "ship it" }, { agentFactory, onEvent: console.log });
      ```
    - Files to Create/Edit:
      - `examples/cyclic-reflection.ts`: new example
  - Test Cases to Write:
    - examples are executed by the existing examples test sweep (`docs/testing.md` offline budget) — verify it is picked up; if examples are enumerated in a test file, add it there
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — new example, no API change.
    - Docs pages to create/edit: `docs/workflows.md` implementation-example section links the demo (Task 8); `docs/testing.md` only if it enumerates examples.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 8: Docs — workflows page, index, error-code sweep
  - Acceptance Criteria:
    - Functional: `docs/workflows.md` gains: cyclic-execution section (opt-in `maxSupersteps`, activation semantics, idle-drain success, budget fail-closed error), `route` node row + routing subsection, checkpoint v2 resume notes, replay latest-iteration semantics, updated limits table with `maxSupersteps` default-required/hard 256, and the implementation example link.
    - Functional: sizing trade-off stated on the page (plan-rule): one line naming the new write cadence — "the superstep engine writes one checkpoint per activation wave (never more than the per-node-completion cadence it replaces); hosts that opt into `limits.maxSupersteps` on acyclic graphs keep the existing cadence" — plus the `maxSupersteps` requirement default (none; explicit).
    - Functional: `docs/index.md` workflows entry sentence extended with cyclic graphs + dynamic routing (one sentence, current-line, no version narrative).
    - Functional: error-contract sweep — grep `scripts/`, `examples/`, and every workspace for `Workflow graph contains a cycle`, `ERR_PRISM_WORKFLOW_SUPERSTEP_LIMIT`, `ERR_PRISM_WORKFLOW_ROUTE_TARGET`, `schemaVersion` assertions; update any test asserting the old acyclicity message to the scoped behavior (message unchanged for undeclared cycles, so expectation is no edits — verify, don't assume).
    - Code Quality: page follows the wiki API-page structure; no release narrative in body.
    - Security: docs state that route targets are constrained to declared edges and budgets are host-unforgeable.
  - Approach:
    - Documentation Reviewed:
      - `docs/workflows.md` (full page), `docs/index.md` (multi-agent/workflow grouping), `.agents/skills/create-plan/references/prism-wiki.md`
    - Options Considered: separate `docs/cyclic-workflows.md` page. Rejected — one workflows page is the contract surface; splitting fragments the limits/checkpoint story.
    - Chosen Approach: extend `docs/workflows.md` in place.
    - API Notes and Examples: covered by page edits.
    - Files to Create/Edit:
      - `docs/workflows.md`: sections above
      - `docs/index.md`: workflows entry sentence
      - `docs/multi-agent-patterns.md`: one-line note that reflection loops now compose as cyclic workflows (crew-pattern revision loop row)
  - Test Cases to Write:
    - `src/__tests__/docs.test.ts`-style docs lint (if it asserts index links/pages) stays green
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — this task is the documentation of Tasks 2–6.
    - Docs pages to create/edit: as listed.
    - `docs/index.md` update: yes — workflows entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 9: Final verification
  - Acceptance Criteria:
    - Functional: `bun test packages/prism-core/src/runtime/workflows` green (145 tests across 18 files); full `bun test` green (all 9 stages passed); typecheck green (zero errors); `bun run release:gate` green (with `PRISM_RELEASE_POSTGRES_JOB=1`).
    - Functional: no public symbol moved/removed (additive-only diff) — confirmed via `scripts/compat-baseline/arnilo__prism-core.txt` with zero removals (`REMOVED (0): []`), +12 new cyclic symbols added cleanly.
    - Performance: no regression on existing DAG workflow benchmarks/tests (DAG path untouched, zero scheduler regression).
    - Code Quality: CHANGELOG entry added under `## [Unreleased]` summarizing cyclic graphs, `routeNode`, checkpoint v2, and security properties.
  - Approach:
    - Documentation Reviewed: `plans/129-Release-0-12-0.md` (release/gate flow), `.agents/skills/prism-execution/SKILL.md` (invariants)
    - Options Considered: fold verification into Task 8. Kept separate — plans treat final verification as its own checkable gate.
    - Chosen Approach: run the suites; record results in this plan.
    - API Notes and Examples:
      ```bash
      bun test packages/prism-core/src/runtime/workflows && bun test && bun run release:gate
      ```
    - Files to Create/Edit:
      - `CHANGELOG.md`: next-version entry
  - Test Cases to Write:
    - none new — this task runs existing suites
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — verification only (CHANGELOG is history, not API docs).
    - Docs pages to create/edit: `none` — Task 8 delivered the docs.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

## Compromises Made
- **Non-null assertion budget guard**: The cyclic engine implementation initially introduced 8 non-null assertions across `define.ts`, `replay.ts`, `run/main.ts`, `run/node-execution.ts`, and `run/superstep.ts` that threatened the strict `packages/prism-core` budget ceiling (414). These were refactored into safe TypeScript guards (`if (!curr) break;`, `?.push()`, `if (nodeState)`), keeping the count at 413 <= 414 without weakening any checks.
- **Compat baseline declaration statement collapse**: Re-exporting cyclic types and helpers from `packages/prism-core/src/runtime/workflows/index.ts` caused `parseDeclarationFile` to record single-statement multi-export collapse diffs. Audited the symbol diff to confirm zero removals (`diff.removed.length === 0`), and cleanly updated the baseline via `release.mjs gate --update-baseline` (`+12` symbols added, `0` deleted).
- **Replay iteration-level step injection deferred**: Per-step replay forking within cyclic loops was deferred in favor of superstep-level and node-level replay determinism. Supersteps record full iteration indexes in execution history, ensuring deterministic re-execution without requiring interactive in-flight mutation of active superstep queues.
- **DAG scheduler bypass**: The DAG topological sort scheduler remains completely untouched; cyclic workflows opt in explicitly when cycles or `maxSupersteps` are declared.

## Further Actions
- **Action**: Per-iteration replay forking with interactive state injection.
  - *Rationale*: Time-travel debugging during cyclic workflow execution currently restores up to a chosen node's latest iteration output. Allowing hosts to inject custom inputs or state changes into a specific historical superstep iteration would enable interactive loop debugging.
  - *Priority*: Medium.
- **Action**: Declarative event-driven swarm topology.
  - *Rationale*: While `routeNode` dynamic routing and cyclic supersteps allow multi-agent reflection loops, complex reactive swarms may benefit from pub/sub topic routing across workflow nodes.
  - *Priority*: Low (host-demand-driven; can compose over current agent channels).
- **Action**: Scoped per-node state and subgraph isolation wrappers.
  - *Rationale*: Currently, cyclic subgraphs and nodes share workflow state namespaces. Providing first-class state scoping prefixes reduces collision risks in deeply nested cyclic workflows without altering execution primitives.
  - *Priority*: Low.
