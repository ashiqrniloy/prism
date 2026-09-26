# Plan 131: Cyclic Workflow Follow-Ups: Iteration Replay, State Scoping, and Swarm Topology

## Objectives

- Implement **per-iteration replay forking** with interactive state/input injection in `replayWorkflow()`, enabling time-travel debugging and what-if exploration from any historical superstep iteration.
- Provide **scoped per-node state and subgraph isolation wrappers** (`withNodeScope`, `scopedSubgraphNode`, `createScopedState`), preventing state key collisions in multi-iteration cyclic workflows and deeply nested subgraphs.
- Introduce **declarative event-driven swarm topology** (`swarmRouterNode`, `publishSwarmEvent`, `defineSwarmWorkflow`), allowing agents in cyclic workflows to interact via pub/sub topic routing over the wave-based superstep engine.
- Deliver an end-to-end runnable example (`examples/cyclic-swarm-topology.ts`) and update documentation (`docs/workflows.md`, `docs/multi-agent-patterns.md`, `docs/index.md`).
- Verify all gates: 100% green workflow tests, full 9-stage `bun run test`, clean `typecheck`, and `release:gate` with zero removals.

## Expected Outcome

- `replayWorkflow(workflow, { sourceRunId, fromNodeId, iteration, injectState, injectInput }, options)` allows targeting a specific iteration of a completed cyclic run and injecting modified state or input for deterministic forking.
- `withNodeScope(scopeKey, node)` seamlessly isolates a node's reads and writes to `ctx.state[scopeKey]`, exposing `ctx.rootState` for explicit cross-scope reads.
- `scopedSubgraphNode({ scope, workflow, ... })` runs child workflows in isolated namespaces.
- `swarmRouterNode({ subscriptions, ... })` and `publishSwarmEvent(ctx, event)` provide declarative topic-based pub/sub routing across cyclic agents.
- `examples/cyclic-swarm-topology.ts` demonstrates a multi-agent event-driven swarm (triage, research, verification) with cyclic reflection and scoped state.
- Documentation fully updated in `docs/workflows.md` and `docs/multi-agent-patterns.md`.

## Tasks

- [x] Task 1: Per-iteration replay forking with interactive state injection
  - Acceptance Criteria:
    - Functional: `replayWorkflow` accepts `iteration?: number`, `injectState?: Record<string, unknown>`, and `injectInput?: unknown` in `ReplayWorkflowInput`.
    - Functional: when `iteration` is provided, verifies `iteration` is a valid non-negative integer and exists in `selectedNode.iterations`; throws `WorkflowCheckpointError` fail-closed if missing or not succeeded.
    - Functional: restores state at `stateVersionBefore` of the targeted iteration; merges `injectState` over restored state when specified; overrides workflow input with `injectInput` if provided.
    - Functional: historical outputs of predecessor nodes are resolved up to the superstep of the targeted iteration.
    - Performance: state restoration uses indexed `stateHistory[String(version)]` in O(1) without extra checkpoint walks.
    - Code Quality: clean TypeScript typings, zero non-null assertion budget increases, safe guards.
    - Security: state injection respects redactor and ownership scopes; untrusted state keys cannot break prototype or mutate immutable checkpoint metadata.
  - Approach:
    - Documentation Reviewed: `packages/prism-core/src/runtime/workflows/replay.ts`, `docs/workflows.md`.
    - Options Considered:
      - Mutate source checkpoint in-place: violates immutability and auditability. Rejected.
      - Superstep-only replay: too coarse when multiple nodes execute in the same superstep. Rejected.
      - Exact node-iteration targeted replay with state fork (chosen): surgical, deterministic, and mirrors LangGraph/Temporal replay semantics.
    - Chosen Approach: Extend `ReplayWorkflowInput` and `replayWorkflow` in `packages/prism-core/src/runtime/workflows/replay.ts` to look up `selected.iterations.find(it => it.iteration === input.iteration)`, restore `stateHistory[String(it.stateVersionBefore)]`, apply `input.injectState`, and seed the new run with lineage metadata.
    - API Notes and Examples:
      ```ts
      const replayed = await replayWorkflow(
        workflow,
        {
          sourceRunId: "run-1",
          fromNodeId: "reviewer",
          iteration: 1, // replay from 2nd iteration (0-indexed)
          injectState: { reviewerGuidance: "Focus on memory safety" },
        },
        { checkpoints },
      );
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/runtime/workflows/replay.ts`: add `iteration`, `injectState`, `injectInput` support.
      - `packages/prism-core/src/runtime/workflows/types.ts`: update `ReplayWorkflowInput` interface.
      - `packages/prism-core/src/runtime/workflows/__tests__/cyclic-replay-export.test.ts`: test iteration replay forking.
  - Test Cases to Write:
    - `replayWorkflow with iteration`: target iteration 1 of a 3-iteration reflection loop; verifies resumed run executes from iteration 1's state.
    - `replayWorkflow with injectState`: overrides guidance in state; verifies successor worker receives injected state.
    - `replayWorkflow with unknown iteration`: fails closed with `WorkflowCheckpointError`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `ReplayWorkflowInput` gains `iteration`, `injectState`, and `injectInput`.
    - Docs pages to create/edit: `docs/workflows.md`.
    - `docs/index.md` update: no (covered under workflows).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2: Scoped per-node state & subgraph isolation wrappers
  - Acceptance Criteria:
    - Functional: `createScopedState(rootState, scopeKey)` safely accesses `rootState[scopeKey]` defaulting to `{}`.
    - Functional: `withNodeScope(scopeKey, nodeDefinition)` wraps any workflow node (function, agent, tool, route) so `ctx.state` is scoped to `scopeKey`, `ctx.updateState(patch)` scopes updates under `scopeKey`, and `ctx.rootState` gives access to top-level state.
    - Functional: `scopedSubgraphNode({ scope, workflow, mapInput?, mapOutput? })` executes a nested workflow in an isolated state sub-namespace and maps deliverables back to parent state without collisions.
    - Performance: zero overhead on un-scoped nodes; scoping uses shallow proxy or object wrapper.
    - Code Quality: fully generic type inference preserving node parameters and return types.
    - Security: prototype pollution protected; scope key validated against alphanumeric/underscore identifiers.
  - Approach:
    - Documentation Reviewed: `packages/prism-core/src/runtime/workflows/nodes.ts`, `packages/prism-core/src/runtime/workflows/types.ts`.
    - Options Considered:
      - Enforce manual namespace prefixes in node code: error-prone and leaky. Rejected.
      - First-class higher-order wrapper `withNodeScope` and `scopedSubgraphNode` (chosen): composable, non-invasive, preserves existing node contracts.
    - Chosen Approach: Add `packages/prism-core/src/runtime/workflows/scoped.ts` exporting `withNodeScope`, `createScopedState`, and `scopedSubgraphNode`. Re-export from `packages/prism-core/src/runtime/workflows/index.ts`.
    - API Notes and Examples:
      ```ts
      const researcher = withNodeScope("researcher", functionNode({
        execute: async (ctx) => {
          // ctx.state is { notes: [] } inside state.researcher
          await ctx.updateState({ notes: ["found detail"] });
          return ctx.state.notes;
        },
      }));
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/runtime/workflows/scoped.ts`: implement scoping helpers.
      - `packages/prism-core/src/runtime/workflows/index.ts`: export scoping primitives.
      - `packages/prism-core/src/runtime/workflows/__tests__/scoped-state.test.ts`: comprehensive tests.
  - Test Cases to Write:
    - `withNodeScope isolated state`: two scoped nodes update their respective scopes without overwriting sibling keys.
    - `withNodeScope rootState access`: scoped node reads a global configuration from `ctx.rootState`.
    - `scopedSubgraphNode`: nested workflow executes with isolated state; output maps cleanly into parent state.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new `withNodeScope`, `createScopedState`, `scopedSubgraphNode` exports.
    - Docs pages to create/edit: `docs/workflows.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Declarative event-driven swarm topology
  - Acceptance Criteria:
    - Functional: `publishSwarmEvent(ctx, event: SwarmEvent)` records a typed topic event in `ctx.state.__swarmEvents`.
    - Functional: `swarmRouterNode({ subscriptions, getEvents?, defaultTargets? })` creates a `routeNode` that matches published events to subscribed target nodes.
    - Functional: `defineSwarmWorkflow({ id, agents, subscriptions, maxSupersteps, ... })` builds a cyclic superstep graph with `swarmRouterNode` and `activation: "any"`.
    - Performance: route selection is O(events × subscriptions) bounded by `maxSupersteps`.
    - Code Quality: strict typing for `SwarmEvent`, clean deduplication of active targets.
    - Security: route targets strictly constrained to declared nodes; unknown topics do not cause unhandled crashes.
  - Approach:
    - Documentation Reviewed: `packages/prism-core/src/runtime/workflows/nodes.ts`, `packages/prism-core/src/runtime/workflows/define.ts`, `docs/multi-agent-patterns.md`.
    - Options Considered:
      - Independent message broker / event emitter: introduces external process and breaks deterministic replay. Rejected.
      - Topic-matching `routeNode` over wave supersteps (chosen): builds directly on top of Plan 130's superstep engine and `routeNode` with full checkpoint durability and replay support.
    - Chosen Approach: Implement `packages/prism-core/src/runtime/workflows/swarm.ts` with `swarmRouterNode`, `publishSwarmEvent`, and `defineSwarmWorkflow`.
    - API Notes and Examples:
      ```ts
      const swarm = defineSwarmWorkflow({
        id: "support-swarm",
        maxSupersteps: 10,
        agents: { triage, billingSpecialist, technicalSpecialist },
        subscriptions: {
          "ticket:billing": ["billingSpecialist"],
          "ticket:technical": ["technicalSpecialist"],
          "escalation": ["triage"],
        },
      });
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/runtime/workflows/swarm.ts`: implement swarm routing and workflow factory.
      - `packages/prism-core/src/runtime/workflows/index.ts`: export swarm primitives.
      - `packages/prism-core/src/runtime/workflows/__tests__/swarm-topology.test.ts`: test event-driven swarm activations.
  - Test Cases to Write:
    - `swarmRouterNode dispatches by topic`: event `"ticket:billing"` activates only `billingSpecialist`.
    - `multi-topic fanout`: two distinct events activate both specialists concurrently in the same superstep.
    - `empty event drain`: no events drains cleanly to completion.
    - `defineSwarmWorkflow cyclic reflection`: specialist emits escalation event, routing back to triage within budget.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — exports `swarmRouterNode`, `publishSwarmEvent`, `defineSwarmWorkflow`, `SwarmEvent`.
    - Docs pages to create/edit: `docs/workflows.md`, `docs/multi-agent-patterns.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4: Example and multi-agent patterns documentation
  - Acceptance Criteria:
    - Functional: `examples/cyclic-swarm-topology.ts` demonstrates a complete event-driven swarm with triage, specialist agents, cyclic escalation, and scoped state.
    - Functional: example runs standalone (`bun examples/cyclic-swarm-topology.ts`) and exits 0 with no secrets.
    - Functional: test file `src/__tests__/cyclic-swarm-topology-example.test.ts` exercises the example and passes.
    - Documentation: `docs/multi-agent-patterns.md` updated with "Event-driven swarm topology" as the sixth pattern alongside handoff, crew, supervisor, spawn tool, and A2A.
    - Documentation: `docs/workflows.md` updated with iteration replay, state scoping, and swarm routing.
  - Approach:
    - Documentation Reviewed: `examples/cyclic-reflection.ts`, `docs/multi-agent-patterns.md`, `docs/workflows.md`.
    - Chosen Approach: Build the standalone example and integrate the pattern into multi-agent docs with architecture diagram and trade-offs table.
    - Files to Create/Edit:
      - `examples/cyclic-swarm-topology.ts`
      - `src/__tests__/cyclic-swarm-topology-example.test.ts`
      - `docs/workflows.md`
      - `docs/multi-agent-patterns.md`
  - Test Cases to Write:
    - `bun test src/__tests__/cyclic-swarm-topology-example.test.ts`: passes offline.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documents the new swarm and scoping capabilities.
    - Docs pages to create/edit:
      - `docs/workflows.md`: document iteration replay, `withNodeScope`, `scopedSubgraphNode`, and `swarmRouterNode`.
      - `docs/multi-agent-patterns.md`: add event-driven swarm section.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5: Final verification and release gate
  - Acceptance Criteria:
    - Functional: `bun test packages/prism-core/src/runtime/workflows` passes.
    - Functional: full `bun run test` (all 9 stages) passes.
    - Functional: `bun run typecheck` passes with zero errors.
    - Functional: `PRISM_RELEASE_POSTGRES_JOB=1 bun run release:gate` passes; compat baseline updated additively with 0 removals.
    - Code Quality: `bun run lint` passes with 0 diagnostics.
    - Non-null assertion budget: `packages/prism-core/src` stays within 414 ceiling.
    - CHANGELOG entry updated under `## [Unreleased]`.
  - Approach:
    - Chosen Approach: Run complete verification ladder and update compat baseline if new exports are added.
    - Files to Create/Edit:
      - `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-core.txt`
  - Test Cases to Write:
    - None new — runs full suite.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (verification only).
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.

## Compromises Made
- **Two-phase swarm event queueing (`__swarmEvents` and `__swarmActiveEvents`)**: If `swarmRouterNode` immediately wiped `__swarmEvents` upon routing, agents executing in that wave would have no way to inspect the event payload that triggered them. Promoting pending events into `__swarmActiveEvents` during router `select()` and clearing `__swarmEvents` gives agents access to the current wave's triggering events via `getActiveSwarmEvents(ctx)` while letting them publish new events into `__swarmEvents` for subsequent waves without collision.
- **Iteration state version mapping**: In cyclic runs where multiple nodes may run in the same superstep, targeting a replay to a specific iteration requires knowing the exact state before that iteration ran. Storing `stateVersionBefore?: number` on `WorkflowLoopIterationRecord` allows $O(1)$ state resolution via `stateHistory[String(it.stateVersionBefore)]` without walking prior checkpoint histories.
- **Bi-directional scoped proxying**: Rather than deep-cloning root state on every node execution, `withNodeScope` creates a scoped context wrapper providing isolated `ctx.state` mapped to `rootState[scopeKey]` with an explicit `ctx.rootState` escape hatch, avoiding allocation overhead on un-scoped workflows.

## Further Actions
- **Dead-letter queue / unhandled swarm event policy**: Currently, topics published without any matching subscriptions drain silently without failing the workflow. An opt-in policy for dead-letter queuing or error emission on unmatched topics could be added.
- **Cross-process distributed swarm events**: Swarm events currently reside deterministically in workflow checkpoint state across supersteps. An external adapter could bridge `publishSwarmEvent` to external pub/sub channels (`@arnilo/prism-channels` / NATS / Redis) for distributed execution across worker pools.

