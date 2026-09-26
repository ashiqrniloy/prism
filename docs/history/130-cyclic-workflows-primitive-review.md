# Cyclic Workflows Primitive Review: Loop/Graph Primitives and Superstep Engine Justification

Plan: [130-Cyclic-Workflow-Graphs.md](../../plans/130-Cyclic-Workflow-Graphs.md) Task 1  
Date: 2026-09-25  
Baseline: Release `0.11.0` / `0.12.0` line in progress  
Scope: Primitive inventory, capability gap analysis, alternative evaluation, and architectural justification for cyclic workflow execution in `@arnilo/prism-core/runtime/workflows`.

---

## 1. Executive Summary & Review Scope

This review freezes the architectural inventory, capability gap analysis, alternative evaluation, and design justification for **Plan 130: Cyclic Workflow Graphs (Superstep Execution + Dynamic Routing)**.

### 1.1 Context and Problem Statement

Modern agentic architectures heavily depend on cyclic patterns:
- **Reflection loops**: A worker agent drafts a deliverable, a reviewer agent critiques or tests it, and back-edges route revisions to the worker until acceptance criteria are satisfied.
- **Planner ↔ Executor interleavings**: A planner decomposes an evolving problem, an executor carries out sub-tasks and observes environmental feedback, and control cycles back to the planner to adjust future actions.
- **Model-driven dynamic routing**: A node inspects intermediate state or LLM output and dynamically chooses which branch to activate next, creating conversational multi-turn workflows.

In `@arnilo/prism-core/runtime/workflows` today, all workflow definitions are enforced to be Directed Acyclic Graphs (DAGs). Attempting to declare an edge that introduces a cycle triggers an immediate, unconditional validation failure:
```
WorkflowDefinitionError: Workflow graph contains a cycle
```
(`packages/prism-core/src/runtime/workflows/define.ts:L141`).

Hosts seeking cyclic behavior are forced to either:
1. Collapse multi-agent cycles into a single monolithic `loopNode` body, destroying per-node observability, telemetry, and checkpointing.
2. Externalize the loop to host application code by repeatedly invoking `runWorkflow`, sacrificing durable single-run lifecycle, lease coordination, and unified state history.

### 1.2 Review Objectives

1. **Inventory existing primitives**: Rigorously analyze `loopNode`, `conditionalNode`, `fanOutNode`/`joinNode`, `suspend`/`resumeWorkflow`, `replayWorkflow`, and supervisor delegation to document what is already achievable today without new runtime machinery.
2. **Name the capability gaps precisely**: Articulate why existing primitives cannot cleanly express multi-agent cyclic collaboration.
3. **Evaluate and reject alternatives**: Critically assess candidate approaches (monolithic `loopNode` bodies, host-side recursion, event-driven reactive topologies, and Kahn scheduler indegree resets) with definitive architectural rationale.
4. **Justify the chosen design**: Detail why a Bulk Synchronous Parallel (BSP) / Pregel-inspired **superstep activation engine** with explicit bounds (`limits.maxSupersteps`), per-node activation semantics (`"all" | "any"`), and dynamic routing (`routeNode`) provides the minimal, fail-closed, and industry-aligned primitive set.
5. **Restate fail-closed invariants**: Ensure budget bounding, secret redaction, execution policy enforcement, and bit-for-bit backward compatibility remain strictly preserved.

---

## 2. Inventory of Existing Primitives (What is Achievable Today)

Before introducing any new runtime primitive, Prism requires an exhaustive audit of existing primitives to prove that the proposed capability cannot be cleanly composed from what already ships.

| Primitive / Surface | Source Location | Existing Contract & Capabilities | Achievable Workload Patterns | Inherent Boundary / Limitation |
|---|---|---|---|---|
| **`loopNode` (inline body)** | `packages/prism-core/src/runtime/workflows/types.ts:L155`, `run/node-execution.ts:L360-L420` | Executes an inline async function `execute(ctx)` repeatedly until `until(ctx)` evaluates to `true` or `maxIterations` (default/hard cap 64) is reached. Checkpoints iteration records (`WorkflowLoopIterationRecord[]`) into the node's state. | - Single-agent iterative refinement (e.g. LLM self-correction prompt loop within one session).<br>- Polling external resources until ready.<br>- Numerical relaxation / convergence loops. | The entire loop is encapsulated inside **one single graph node**. Downstream edges cannot be reached until the loop completely terminates. Cannot host multiple distinct graph nodes per iteration. |
| **`loopNode` (sub-step body)** | `packages/prism-core/src/runtime/workflows/types.ts:L163`, `run/node-execution.ts:L420-L460` | Executes a single interior `function` or `tool` node definition repeatedly with `until(ctx)`. Supports durable suspension before tool side effects. | - Bounded tool retries with approval gates.<br>- Repeated execution of a single atomic tool or function. | Restricted to exactly **one** child function or tool definition (`WorkflowLoopBodyDefinition`). Cannot express multi-node sub-graphs (e.g. Worker -> Tool -> Reviewer). |
| **`conditionalNode`** | `packages/prism-core/src/runtime/workflows/types.ts:L175`, `run/skip.ts:L6-L25` | Evaluates predicate `when(ctx)`. Activates static `then?: string[]` successors when true, or `else?: string[]` successors when false. Unchosen branches are transitively marked `skipped`. | - Binary branching in DAGs (e.g., pass vs fail paths).<br>- Bypassing expensive downstream stages.<br>- Static forward routing. | Edges must be strictly forward and acyclic. Routing targets are static configuration lists, not dynamic expressions. Cannot route backwards or repeat nodes. |
| **`fanOutNode` & `joinNode`** | `packages/prism-core/src/runtime/workflows/types.ts:L184,L191`, `run/node-execution.ts:L330-L360` | `fanOutNode` dynamically maps an array of items across concurrent workers within `concurrency` and `maxFanOut`. `joinNode` reduces upstream outputs into an aggregated value. | - Parallel role specialist execution (Hierarchical Crew pattern, `docs/multi-agent-patterns.md`).<br>- Map-reduce pipelines. | Strictly one-shot forward DAG execution. Re-running the fan-out based on join output requires an external loop. |
| **`suspend()` & `resumeWorkflow()`** | `packages/prism-core/src/runtime/workflows/run/main.ts`, `run/checkpoint.ts` | Allows any node to return `suspend({ reason, data?, resumeSchema? })`, saving a `status: "suspended"` checkpoint. `resumeWorkflow` claims the checkpoint with CAS `expectedVersion` and re-invokes the node with `ctx.resume`. | - Durable human-in-the-loop approval gates.<br>- Asynchronous webhooks and external confirmations.<br>- Zero-process suspension while awaiting input. | Re-enters the **same** suspended node only. It does not rewind, loop back, or branch to earlier nodes in the graph. |
| **`replayWorkflow()`** | `packages/prism-core/src/runtime/workflows/replay.ts` | Forks an existing succeeded run from a specific node (`fromNodeId`), copying terminal evidence outside the downstream closure and executing downstream nodes anew under an immutable lineage record. | - Re-evaluating a downstream DAG segment with modified inputs.<br>- Auditing and scenario counterfactual testing. | Spawns a **new independent run** (`runId` changes, separate checkpoint stream). It is a post-hoc replay utility, not an in-flight control-flow loop. |
| **Supervisor delegation** | `packages/prism-core/src/runtime/supervisor/`, `src/contracts.ts` | A parent agent session delegates tasks to allow-listed child agent sessions via `supervisor.delegate()` or `createSpawnAgentTool`. | - Dynamic sub-agent spawning during a conversational turn.<br>- Hierarchical tool dispatch. | Operates at the agent/session runtime level, not the workflow graph level. Lacks graph-level checkpoints, workflow state transactions, DAG event scheduling, and topological visualization. |

### 2.1 Pattern Coverage Matrix

Evaluating common multi-agent workflow patterns against the existing primitive set confirms what can and cannot be built today:

| Workflow Pattern | Expressible with Existing Primitives? | How it is Composed Today | Limitation / Compromise Incurred |
|---|:---:|---|---|
| **Single-Agent Self-Correction** | **Yes** | `loopNode` with inline `execute` or `generateValidateReviseLoop` (`src/agent-loops.ts:L37`). | Confined to one prompt/turn loop within one agent session. |
| **Static Branching Pipeline** | **Yes** | `conditionalNode` with `then` / `else` edge lists. | Forward only; cannot loop back on quality failure. |
| **Hierarchical Crew (One-Shot)** | **Yes** | Manager `agentNode` -> `fanOutNode` specialists -> `joinNode` aggregator (`examples/crew-hierarchy.ts`). | Complete DAG execution; revision requires re-instantiating the pipeline. |
| **Human-in-the-Loop Review Gate** | **Yes** | `functionNode` calling `suspend()`; resumed via `resumeWorkflow()`. | Pauses pipeline cleanly, but cannot send the deliverable back to an earlier worker node upon rejection. |
| **Multi-Agent Reflection Loop**<br>*(Worker -> Reviewer -> Worker until approved)* | **No** | **Fails validation** (`Workflow graph contains a cycle`). | Forces embedding all roles into a single `loopNode.execute`, losing distinct graph nodes, per-role telemetry, and discrete checkpoints. |
| **Planner ↔ Executor Cyclic Interleaving** | **No** | **Fails validation** (`Workflow graph contains a cycle`). | Requires host-side while-loop wrapping `runWorkflow`, fragmenting state across multiple disconnected runs. |
| **Model-Driven Dynamic Successor Selection** | **No** | Static `conditionalNode` branching only. | Cannot dynamically compute a target successor set from LLM output without pre-declaring rigid combinations. |

---

## 3. The Capability Gap

The audit identifies three fundamental capability gaps that prevent `@arnilo/prism-core/runtime/workflows` from serving as a complete substrate for cyclic multi-agent systems:

### Gap 1: Per-Node Checkpointing, Events, and Attribution Inside an Iteration

In multi-agent systems, collaboration occurs between distinct roles with distinct configurations (different system instructions, different models, different tool allow-lists, and distinct permissions).
- In a reflection cycle, Worker and Reviewer must be observable as distinct steps on the execution timeline (`projectWorkflowTimeline`).
- When all logic is crammed into a single `loopNode`, the workflow engine emits only `node_iteration_started` / `node_iteration_finished` for the outer loop node. There are no discrete `node_started`, `node_finished`, or `agent_event` records distinguishing the Worker phase from the Reviewer phase within an iteration.
- If a crash or timeout occurs during Reviewer execution in iteration 4, checkpoint recovery cannot identify that the Worker succeeded and only the Reviewer needs re-execution; the entire composite iteration is lost or must be re-run from the beginning.
- Furthermore, per-node resource limits (such as `timeoutMs`, `retries`, and `maxNodeOutputBytes`) apply to the whole loop rather than being enforced independently on Worker and Reviewer.

### Gap 2: Mixed Node Kinds per Iteration

A realistic iterative cycle rarely consists of a single function. A standard software engineering agent workflow consists of:
1. `agentNode` ("planner"): analyzes requirements and drafts changes.
2. `toolNode` ("linter_and_test_runner"): executes local tests or build commands in a sandbox.
3. `agentNode` ("code_reviewer"): reviews code diffs and test output.
4. `conditionalNode` or routing decision: decides whether to commit or loop back to "planner".

Today's `loopNode` supports only two shapes:
- `InlineLoopNodeDefinition`: a single raw JavaScript function `execute(ctx)`.
- `NodeLoopNodeDefinition`: a single child `WorkflowLoopBodyDefinition` (either one function or one tool).

It is syntactically and architecturally impossible to declare a heterogeneous graph of agents, tools, and conditionals inside a `loopNode` without manually simulating a mini-orchestrator inside the `execute` callback.

### Gap 3: Dynamic Successor Activation

Prism's `conditionalNode` requires pre-defining static arrays of successors: `then?: readonly string[]` and `else?: readonly string[]`.
- In dynamic agentic workflows (e.g. LangGraph's `Command(goto=...)` or AutoGen's dynamic routing), an agent or classifier inspects data and selects one or more destinations from a set of declared valid routes (e.g., `["revise_code"]`, `["request_clarification"]`, `["escalate_to_human"]`, `["deploy"]`).
- Expressing dynamic multi-way routing using binary `conditionalNode`s requires cascading trees of dummy nodes that clutter the graph, complicate Mermaid/DOT exports, and degrade execution latency.
- There is currently no primitive that allows a node to evaluate a dynamic selector function (`select: (ctx) => string[]`) and activate only the chosen subset of declared successor edges.

---

## 4. Evaluation of Rejected Alternatives

Four architectural alternatives were considered to address these gaps. Each was rejected based on Prism's design principles:

### Alternative A: Monolithic `loopNode.execute` Bodies (Do Nothing / Status Quo)

- **Description**: Recommend that hosts implement reflection loops by putting all role coordination inside a single `loopNode` whose `execute` function imperatively invokes multiple `AgentSession`s or functions.
- **Why Rejected**:
  1. **Destroys Observability**: Telemetry events (`WorkflowEvent`) are emitted only at node boundaries. The inner multi-agent dialogue becomes an opaque black box to event subscribers, AG-UI, and OpenTelemetry spans.
  2. **Coarse-Grained Checkpointing**: Checkpoint writes occur at the node or loop-iteration boundary. Individual agent steps within the iteration are uncheckpointed.
  3. **Loss of Graph Topology**: Graph serialization (`serializeWorkflowGraph`), Mermaid diagrams (`workflowGraphToMermaid`), and DOT views cannot visualize the agent interaction topology because it exists only as procedural TypeScript code inside a closure.
  4. **Violation of Declarative Orchestration**: Forces hosts to reinvent agent execution, error handling, and parameter passing instead of relying on the workflow engine's proven lifecycle.

### Alternative B: Host-Side Recursion Over `runWorkflow`

- **Description**: Hosts execute a workflow representing one iteration (e.g. Worker -> Reviewer). If the reviewer requests revisions, the host application code calls `runWorkflow` again with the previous run's output passed as input.
- **Why Rejected**:
  1. **Fragmented Durability**: Each iteration becomes a separate `runId`. There is no unified checkpoint history, no aggregate execution timeline, and no single source of truth for the complete business task.
  2. **Broken Coordination and Fencing**: `createWorkflowCoordinator` leases and executes single workflow runs. If an iterative task is split into multiple independent runs, workers cannot maintain atomic lease ownership or guarantee fair scheduling across the complete task lifecycle.
  3. **Suspension Failure**: If a human-in-the-loop review is requested in iteration 3, `suspend()` pauses only that discrete sub-run. The host application must build custom stateful machinery to remember which iteration it was on and restart the outer loop when the sub-run resumes.
  4. **Lineage Overhead**: Tracking provenance requires external bookkeeping or chaining dozens of `replayWorkflow` lineage records, multiplying database records and memory overhead.

### Alternative C: Event-Driven Topology (Reactive / Typed Event Bus as Edges)

- **Description**: Replace explicit graph edges with a pub/sub event bus where nodes emit typed domain events and downstream nodes subscribe to event patterns (similar to LlamaIndex Workflows).
- **Why Rejected / Deferred**:
  1. **Authoring Model Divergence**: Prism's workflow system is built around explicit, auditable graph topologies (`WorkflowDefinition.edges`). An event-driven architecture is a fundamentally different authoring paradigm, not merely a missing primitive.
  2. **Static Auditability**: Security and compliance teams inspect Prism workflow graphs to verify dataflow boundaries and authorization constraints. In a purely event-driven model, finding the complete topology requires runtime tracing or complex static analysis.
  3. **Cycle Bound Complexity**: Detecting cycles and enforcing fail-closed iteration bounds (`maxSupersteps`) becomes significantly harder when connections are dynamic event channels rather than static adjacency lists.
  4. **Composability**: Hosts needing event-driven routing can already compose it cleanly today using `conditionalNode`s inspecting shared JSON state (`ctx.state`).

### Alternative D: Extending the Kahn Scheduler with Indegree Resets

- **Description**: Maintain the existing Kahn topological sort algorithm in `packages/prism-core/src/runtime/workflows/run/scheduler.ts`, but allow backward edges. When a backward edge fires, decrement or reset the target node's `remainingIndegree` so it re-enters the `state.ready` queue.
- **Why Rejected**:
  1. **The Kahn Deadlock Trap**: Kahn's algorithm relies on the invariant that indegree reaches zero only when *all* upstream dependencies have completed. On a cyclic graph, a node that has both an initial entry edge (from a start node) and a back-edge (from a reviewer) has an initial indegree of 2. In iteration 1, it can never start because the back-edge has not run yet (deadlock). If the scheduler ignores back-edges on entry, it must know which edges belong to which iteration wave—introducing ad-hoc state tracking that breaks down when multiple concurrent branches exist.
  2. **Indegree Reset Ambiguity**: When multiple predecessors exist in a cycle, resetting indegrees on completion of any single predecessor causes premature activations; waiting for all causes deadlocks. This is the precise deadlock flaw identified in early AutoGen and solved in Microsoft Agent Framework (MAF) by moving to explicit activation semantics.
  3. **Regression Risk to DAG Execution**: Mutating the battle-tested, zero-overhead Kahn drain loop threatens bit-for-bit backward compatibility and performance on existing acyclic workflows.

---

## 5. Industry Survey & Baseline Comparisons

To ensure Prism adopts proven, interoperable, and industry-standard primitives, we benchmarked the three leading agent workflow frameworks:

| Framework | Cyclic Execution Mechanism | Loop Bound Guardrail | Node Activation Semantics | Dynamic Routing Primitive |
|---|---|---|---|---|
| **LangGraph** (`StateGraph`) | Cyclic edges allowed in graph definition. Nodes write to shared state. Superstep execution rounds synchronize parallel node executions. | `recursion_limit` (default: 25). Throws `GraphRecursionError` on breach. | Superstep wave: all nodes activated in step $N$ execute concurrently; their outputs trigger step $N+1$. | `Command(goto="node_id")` and conditional edges returning dynamic node strings. |
| **Microsoft Agent Framework (MAF)** | Bulk Synchronous Parallel (BSP) / Pregel-inspired supersteps. Iterations advance through synchronization barriers. Run succeeds on **idle drain**. | `max_iterations` (default: 100). Fails closed on breach. | Activation conditions (`all` vs `any`) configured per edge group. | Dynamic executor routing via message destinations. |
| **AutoGen** (GraphFlow) | Directed cyclic graphs with message-passing semantics between agents. | `max_turns` / iteration limits configured per conversation pattern. | Per-node `activation_condition`: `"all"` (all predecessors must arrive) vs `"any"` (any predecessor arrival fires node). | Dynamic speaker selection via selector functions / LLM judge. |

### 5.1 Key Industry Lessons Adopted by Prism

1. **The Superstep / Wave Execution Model is the Standard**: Both LangGraph and Microsoft Agent Framework execute cyclic graphs in discrete superstep waves. All active nodes in wave $K$ execute up to configured concurrency; completed nodes post activations for wave $K+1$; an execution barrier synchronizes the transition.
2. **Termination via Idle Drain**: In a cyclic graph, there is no single fixed "leaf" node. A run naturally and successfully terminates when all pending activations are exhausted and no nodes are currently running (the MAF model).
3. **Explicit Activation Semantics (`"all"` vs `"any"`) Eliminate Deadlocks**: To allow a node to serve both as a workflow entry point and as the recipient of a cycle back-edge, nodes must support `activation: "any"`. Nodes requiring multi-branch synchronization (joins within a cycle) use `activation: "all"`.
4. **Constrained Dynamic Routing (`routeNode`)**: Dynamic routing must be constrained to a statically declared successor set. This provides model-driven flexibility (LangGraph `Command(goto)`) while maintaining topological auditability and preventing unvetted arbitrary jumps.

---

## 6. Justification of the Superstep Engine & Prism Design Synthesis

Based on the primitive review, capability gap analysis, and industry survey, Plan 130 synthesizes these requirements into a cohesive, minimal design:

### 6.1 Architecture Overview

```
                               Workflow Definition
                                        │
                         Is graph cyclic OR opt-in?
                                   ┌────┴────┐
                                  No        Yes
                                   │         │
                     Kahn DAG Scheduler   Superstep Engine
                     (Bit-for-bit unchanged)   (run/superstep.ts)
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       │  Wave Loop: superstep = 0 .. maxSupersteps  │
                       │  1. Check budget: superstep < max          │
                       │  2. Drain pendingActivations into wave     │
                       │  3. Execute wave within concurrency pool   │
                       │  4. Nodes complete -> onNodeSucceeded      │
                       │     - routeNode / conditional evaluate     │
                       │     - Post activations (all vs any rule)   │
                       │  5. Barrier: wait for wave completion      │
                       │  6. Batch persist checkpoint (Schema v2)   │
                       │  7. Check Idle Drain -> Success            │
                       └───────────────────────────────────────────┘
```

### 6.2 Core Design Pillars

#### 1. Opt-In Cycle Policy with Fail-Closed Bounding
- In `defineWorkflow`, graphs containing cycles are rejected with `WorkflowDefinitionError: Workflow graph contains a cycle` unless `limits.maxSupersteps` is explicitly declared.
- `limits.maxSupersteps` is validated via the existing `validateWorkflowLimit` helper (positive safe integer, 1 to `HARD_MAX_SUPERSTEPS = 256`).
- Cyclic runs increment `state.superstep` on each wave. If `state.superstep >= limits.maxSupersteps` and pending work remains, execution immediately aborts and fails closed with `WorkflowSuperstepLimitError` (`ERR_PRISM_WORKFLOW_SUPERSTEP_LIMIT`).

#### 2. Dual-Engine Dispatch (Zero DAG Regressions)
- The execution engine is selected deterministically at run start:
  - If the definition is acyclic and does not declare `maxSupersteps`, the engine uses the existing `executeSchedulerBody` Kahn path bit-for-bit. Existing tests, event sequences, and checkpoint formats remain completely undisturbed.
  - If the definition contains cycles or opts into supersteps, the run dispatches to `run/superstep.ts`.
- Both engines share a unified completion seam: `onNodeSucceeded(state, nodeId, options, emit)`.

#### 3. Per-Node Activation Semantics (`"all"` vs `"any"`)
- Every node definition inherits `activation?: "all" | "any"` on `WorkflowNodeBase` (default `"all"`).
- **`"all"`**: The node activates only when *every* declared predecessor has fired and contributed an activation since the node's last execution.
- **`"any"`**: The node activates whenever *any* predecessor fires. This enables cycle re-entry nodes (e.g. `worker` receiving entry from `start` or feedback from `reviewer`) to re-fire smoothly without deadlocking.
- Fail-closed validation: Declaring `activation: "any"` on a node with zero predecessors is rejected at definition time as invalid configuration.

#### 4. Dynamic Routing Primitive (`routeNode`)
- Exported factory: `routeNode({ select })`.
- Definition shape: `RouteNodeDefinition` (`kind: "route"`, `select: (ctx) => readonly string[] | Promise<readonly string[]>`).
- Execution contract:
  - Evaluates `select(ctx)` against current state and upstream data.
  - Returns a subset of declared successor node IDs to activate next wave.
  - Runtime validation: All returned target IDs must be a subset of the node's declared successor edges in `workflow.edges`. An unknown target throws `WorkflowRuntimeError` (`ERR_PRISM_WORKFLOW_ROUTE_TARGET`) fail closed, preventing unauthorized control flow jumps.
  - Returning `[]` activates nothing, contributing to natural idle drain.

#### 5. Durable Checkpoints (Schema v2)
- Extends `WorkflowCheckpointValue` with an additive `execution` block:
  ```ts
  execution?: {
    readonly mode: "supersteps";
    readonly superstep: number;
    readonly maxSupersteps: number;
    readonly pending: Readonly<Record<string, { readonly from: readonly string[]; readonly round: number }>>;
  }
  ```
- Increments `WORKFLOW_CHECKPOINT_SCHEMA_VERSION` from `1` to `2`.
- Checkpoints from cyclic runs record node execution histories through the existing per-node `iterations[]` ledger (`WorkflowLoopIterationRecord`), avoiding unbounded growth while enabling mid-cycle `suspend()` and exact-once CAS resumption via `resumeWorkflow`.
- Checkpoint persistence cadence: exactly one checkpoint written per wave boundary, ensuring that wave-based execution matches or improves upon today's per-node write overhead.

---

## 7. Universal Invariants, Security Posture, and Threat Model

The superstep engine preserves all Prism universal invariants and defends against specific threat vectors introduced by cyclic topologies:

| Invariant / Threat Vector | Required Posture & Engine Enforcement |
|---|---|
| **Bounded Execution Budgets** | Cyclic workflows can easily become infinite money/resource sinks if unconstrained. The engine enforces an explicit `limits.maxSupersteps` (1–256). Exceeding this ceiling fails closed immediately with `WorkflowSuperstepLimitError` before dispatching any over-budget provider calls or tool actions. |
| **Fail-Closed Definition Validation** | A definition with cycles and no declared `limits.maxSupersteps` throws `WorkflowDefinitionError("Workflow graph contains a cycle")` with the exact historical error message. Self-loops (`["nodeA", "nodeA"]`) remain strictly forbidden. |
| **Controlled Control Flow (No Goto-Anywhere)** | `routeNode` cannot execute arbitrary jumps across the system. The selector's returned targets are validated at runtime against declared successors (`targets ⊆ declaredSuccessors`). Any undeclared target fails closed with `ERR_PRISM_WORKFLOW_ROUTE_TARGET`. |
| **Credential and Identity Isolation** | Node executions in cyclic waves reuse the standard `runNode` harness. Cycles do not widen tool allow-lists, relax `ExecutionPolicy` checks, or grant access to credentials. Tenant, account, and user ownership scopes propagate immutably across waves. |
| **Secret Redaction Across Waves** | Outputs from cyclic node executions and payloads stored in `pendingActivations` pass through `SecretRedactor` before being written to checkpoint stores or emitted over the `WorkflowEventBus`. |
| **Checkpoint Integrity & Tamper Resistance** | Checkpoint schema v2 persists `superstep` counters and pending activations under CAS versioning. Resuming a cyclic run requires verifying `definitionHash`, ensuring that workflow topology or limits cannot be tampered with between suspension and resumption. |
| **Process Safety Hard Caps** | All existing byte caps (`maxNodeOutputBytes` 4 MiB/16 MiB, `maxCheckpointBytes` 1 MiB/8 MiB, `maxStateBytes` 64 KiB/512 KiB) remain strictly enforced on every wave iteration. |

---

## 8. Plan Mapping & Downstream Task Directives

This review establishes the technical baseline and contract requirements for all subsequent tasks in [Plan 130](../../plans/130-Cyclic-Workflow-Graphs.md):

- **Task 2: Definition Surface (`types.ts`, `limits.ts`, `define.ts`, `nodes.ts`)**
  - Add `maxSupersteps?: number` to `WorkflowLimits` with `HARD_MAX_SUPERSTEPS = 256`.
  - Add `activation?: "all" | "any"` to `WorkflowNodeBase`.
  - Add `RouteNodeDefinition` and export `routeNode()` factory.
  - Update `defineWorkflow` to permit cycles only when `limits.maxSupersteps` is present, tagging the definition with `execution: "supersteps"`.
- **Task 3: Superstep Scheduler Engine (`run/superstep.ts`, `run/scheduler.ts`)**
  - Implement wave execution loop with synchronization barrier and idle-drain termination.
  - Implement round-based activation bookkeeping with `"all"` and `"any"` semantics.
  - Extract shared `onNodeSucceeded` seam between Kahn and superstep engines.
  - Introduce `WorkflowSuperstepLimitError` (`ERR_PRISM_WORKFLOW_SUPERSTEP_LIMIT`).
- **Task 4: `routeNode` Dynamic Routing End-to-End**
  - Wire `routeNode` execution in `run/node-execution.ts`.
  - Enforce declared successor subset validation and runtime fail-closed checks.
- **Task 5: Checkpoint Schema v2 (`run/checkpoint.ts`, `types.ts`, `limits.ts`)**
  - Bump `WORKFLOW_CHECKPOINT_SCHEMA_VERSION = 2`.
  - Persist `execution` block with `superstep`, `maxSupersteps`, and `pending` activations.
  - Implement CAS resume for mid-cycle suspended runs.
- **Task 6: Replay, Serialization, and Graph Export (`replay.ts`, `graph-export.ts`)**
  - Support latest-iteration evidence resolution for replay on cyclic graphs.
  - Update Mermaid and DOT exporters to render cycle back-edges cleanly.
- **Task 7: Example (`examples/cyclic-reflection.ts`)**
  - Build an offline, zero-network multi-agent reflection and dynamic routing demonstration.
- **Task 8: Documentation Updates (`docs/workflows.md`, `docs/index.md`)**
  - Update public documentation with cyclic workflow guide, limits, and node kind references.
- **Task 9: Final Verification (`release:gate`)**
  - Execute full test suites, typechecks, and compatibility gates.

---

## 9. Conclusion

Existing Prism primitives (`loopNode`, `conditionalNode`, `fanOutNode`, `suspend`, and `replay`) successfully address single-step iteration, parallel map-reduce, and linear pipelines, but cannot express multi-agent cyclic collaboration without sacrificing per-node observability, granular checkpointing, or declarative graph structure. 

The superstep activation engine proposed in Plan 130 directly mirrors established industry standards (LangGraph supersteps, Microsoft Agent Framework BSP execution, and AutoGen activation conditions), providing a bounded, fail-closed, durable, and fully backward-compatible solution for cyclic agent workflows.
