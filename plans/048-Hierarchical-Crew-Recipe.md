# 048 — Hierarchical "Crew" Recipe with Manager Agent

Adoption-list item #9 (CrewAI hierarchical process parity — perception item).
Roadmap phase: **0.3.x**.
Baseline: `@arnilo/prism` **0.3.0**+.

## Objectives

- Ship `examples/crew-hierarchy.ts` + a pattern page showing CrewAI's headline orchestration — manager LLM decomposes a goal into tasks, assigns to role agents, validates outputs — expressed entirely on existing Prism primitives (agent nodes, `fan_out`/`join`, conditional nodes, nested workflows, supervisor delegation discipline).
- Zero new runtime, zero new primitives: prove the pattern composes from what ships today.
- Close the parity-perception gap: comparison tables check "hierarchical orchestration ✓/✗"; the example flips the ✗.

## Expected Outcome

- A runnable offline example (mock provider): a manager agent produces a typed task plan (structured output), tasks fan out to role specialists, a validator agent reviews results, the manager revises on validation failure (bounded retries via node `retries` or the plan-045 loop node when it ships), and the workflow returns the aggregated deliverable with per-agent attribution.
- Pattern page documents the mapping: CrewAI concept → Prism primitive (crew → workflow; manager → agent node + structured output; task → fan_out item; validation → conditional/join; process → DAG revision), plus where Prism's version is stronger (durable HITL, budgets, audit).

## Tasks

- [x] Task 1 — Example: Manager/Task/Validate Workflow on Existing Primitives
  - Acceptance Criteria:
    - Functional: example runs offline on the mock provider: manager emits `{ tasks: [{ role, instruction }] }` via structured output (`docs/structured-output.md`), `fan_out` executes specialists (one per task, bounded `maxFanOut`), `join` with host `reduce` aggregates, conditional validation node routes to revision or completion; whole flow a single `defineWorkflow` with a fixed revision id.
    - Performance: example completes within workflow benchmark envelope on mock provider (no network).
    - Code Quality: compile-checked in the examples build; typed plan schema via `Artifact`/structured-output seam; no `any`.
    - Security: role specialists activated with narrowed `toolNames` per `docs/agent-definitions.md` fail-closed activation; manager cannot invoke specialist tools directly (allow/deny enforced — asserted).
  - Approach:
    - Documentation Reviewed:
      - `docs/workflows.md` (node kinds, limits, revision semantics), `packages/workflows/src/types.ts` (`FanOutNodeDefinition`, `JoinNodeDefinition.reduce`, `ConditionalNodeDefinition`), `docs/structured-output.md`, `docs/agent-definitions.md`, `examples/workflow-parallel-research.ts` (closest existing example).
    - Options Considered:
      - Ship a `createCrew()` helper package: rejected — CrewAI's own docs push production users to Flow-style determinism; Prism's answer is "it's a workflow", and a helper would hide exactly the determinism that distinguishes Prism.
      - Example + mapping table: chosen — demonstrates composability, teaches the primitives, zero maintenance surface.
    - Chosen Approach:
      - One example, one pattern page; revision loop uses node `retries` today and links to plan 045's loop node as the cleaner future form.
    - API Notes and Examples:
      ```ts
      const crew = defineWorkflow({
        revision: "crew-demo-1", id: "support-crew",
        nodes: { manager, fan: fanOutNode({ items: (ctx) => ctx.state.plan.tasks, map: runSpecialist }), aggregate: joinNode({ reduce: (items) => items }), validate, complete },
        edges: [["manager","fan"],["fan","aggregate"],["aggregate","validate"],["validate","complete"]],
        limits: { maxFanOut: 8 },
      });
      ```
    - Files to Create/Edit:
      - `examples/crew-hierarchy.ts` (new), `examples/README.md` (entry).
  - Test Cases to Write:
    - Offline smoke (node --test): workflow completes; specialist outputs attributed per role; validation-failure fixture routes to revision path (mock scripted).
    - Narrowing: specialist attempting a manager-only tool is blocked (blocked-reason assertion).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (example only).
    - Docs pages to create/edit: `docs/multi-agent-patterns.md` (shared with plan 047 if that lands first — one page, handoff + crew sections) or `docs/workflows.md` pattern section.
    - `docs/index.md` update: yes — Multi-agent and interoperability entry for the pattern page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2 — Mapping Table and Comparative Notes
  - Acceptance Criteria:
    - Functional: mapping table CrewAI→Prism (crew/task/process/manager/agent→workflow/fan_out item/DAG/agent node/definition) with links; "where Prism is stronger" notes (durable HITL suspend/resume, budget caps, approval gates, audit) each linked to its doc page.
    - Performance: n/a.
    - Code Quality: docs tripwires pass; no unverifiable claims (every capability named links to its doc).
    - Security: notes call out that manager-generated task plans are model output — treated as untrusted data validated against the typed plan schema before fan-out (asserted in example).
  - Approach:
    - Documentation Reviewed: `docs/workflows.md`, `docs/supervisors.md`, CrewAI hierarchical-process docs (external, cited as the parity reference only).
    - Options Considered / Chosen Approach: table + links.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: pattern page (`docs/multi-agent-patterns.md` or `docs/workflows.md`), `docs/index.md`.
  - Test Cases to Write: docs tripwire; untrusted-plan validation covered by Task 1 schema check.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: yes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- **DAG Revision Branching**: Used conditional branching (`complete` vs `revise`) in the workflow DAG rather than cyclic edges, keeping full compatibility with Prism's DAG execution engine and checkpoint lineage.
- **Zero New Helpers**: Intentionally did not introduce a `createCrew()` runtime wrapper; standard `defineWorkflow`, `agentNode`, `fanOutNode`, `joinNode`, `conditionalNode`, and `ArtifactValidator` primitives demonstrate full parity without maintenance overhead.

## Further Actions

- **Bounded Loop Integration**: When Plan 045's in-graph `loopNode` refinement is standard in workflows, document an optional loop node recipe variant that loops back to the manager on validation failure within the same workflow execution. (Priority: Low / Enhancement).