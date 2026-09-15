# Phase 72 — Primitive Review: Timeline, Graph, Eval, Observability Inventory

Plan: [072-Host-Eval-And-Observability-Cockpit.md](../../plans/072-Host-Eval-And-Observability-Cockpit.md) Task 1.
Date: 2026-09-13.

---

## 1. Inventory

### 1.1 `AgentEvent` discriminated union

**File:** [`src/contracts-protocol.ts:L170–327`](../../src/contracts-protocol.ts#L170-L327)

32 variants. Key groups:

| Group | Variants | Carries I/O content? | Carries `Usage`? |
| --- | --- | --- | --- |
| **Lifecycle** | `agent_started`, `agent_finished`, `agent_suspended`, `agent_resumed`, `agent_denied` | Suspension payload (HITL) | `agent_finished.usage` |
| **Turns** | `turn_started`, `turn_finished` | No | No |
| **Provider** | `provider_turn_started`, `provider_turn_finished` | No (metadata only) | `provider_turn_finished.usage` |
| **Messages** | `message_started`, `message_delta`, `message_finished` | Yes (content blocks) | No |
| **Tools** | `tool_execution_started`, `tool_execution_progress`, `tool_execution_finished`, `tool_execution_error`, `tool_execution_blocked` | Yes (args, results, errors) | No |
| **Guardrails** | `guardrail_decision` | Yes (assessment, reason) | No |
| **Delegation** | `delegated_agent_step` | No (metadata only by design) | Yes (`DelegatedAgentStepUsage`) |
| **Compaction** | `compaction_started`, `compaction_finished` | Summary string only | No |
| **Retry/Error** | `retry_scheduled`, `error`, `run_limit_exceeded` | Error info | No |
| **Artifacts** | `artifact_validation_started/finished`, `artifact_revision_started`, `artifact_finished`, `artifact_failed` | Validation results | No |
| **Flow** | `steer_rejected`, `event_subscriber_overflow`, `queue_updated` | Steer: dropped message | No |

**Conclusion:** The union is complete for timeline folding. Each variant maps to one `ExecutionStepKind` except `message_*` (folded into the parent turn/provider step as I/O content under capture policy) and flow/queue events (metadata notes). No structural changes required.

### 1.2 `EvaluationTrace` and `createPersistenceTraceResolver`

**Types:** [`packages/prism-core/src/governance/evals/types.ts:L166–187`](../../packages/prism-core/src/governance/evals/types.ts#L166-L187)
**Resolver:** [`packages/prism-core/src/governance/evals/trace.ts`](../../packages/prism-core/src/governance/evals/trace.ts)

```ts
interface EvaluationTrace {
  readonly run: RunRecord;
  readonly events: readonly AgentEventRecord[];
  readonly toolCalls: readonly ToolCallRecord[];
  readonly usage: readonly UsageRecord[];
}
```

Resolver enforces:
- Ownership: `exactOwnershipMatches()` on every record — fail closed (`ERR_PRISM_EVAL_TRACE_OWNERSHIP`).
- Identity: sessionId + runId match on all records — fail closed (`ERR_PRISM_EVAL_TRACE_IDENTITY`).
- Bounds: pageSize (default 100 / hard 1,000), maxPages (default 20 / hard 100), maxBytes (default 4 MiB / hard 32 MiB).
- Redaction: `resolveRedactor()` applied before byte-length check.

**Conclusion:** `EvaluationTrace` is the raw ledger data. Timeline projection (`projectTraceTimeline`) will fold `.events` + `.toolCalls` + `.usage` into `ExecutionTimeline` — no new persistence, no schema changes. Ownership + redaction already enforced at resolve-time; projector need not re-check (caller supplies already-scoped trace).

### 1.3 `ScorerInput`, `scoreRun`, `runExperiment`, `defineDataset`, `createModelJudge`

**ScorerInput:** [`types.ts:L22–28`](../../packages/prism-core/src/governance/evals/types.ts#L22-L28)

```ts
interface ScorerInput<TInput, TExpected> {
  readonly result: AgentRunResult;
  readonly item?: DatasetItem<TInput, TExpected>;
  readonly expected?: TExpected;
  readonly signal?: AbortSignal;
  readonly target?: EvaluationTarget;     // { result, trace? }
}
```

**Missing fields (to add):**
- `timeline?: ExecutionTimeline` — projected, not raw events (R-E1)
- `environment?: unknown` — host-supplied external state snapshot (R-E3)

**DatasetItem:** `id`, `input`, `expected?`, `metadata?`. **No** `expectedTrajectory`.
- To add: `expectedTrajectory?: readonly ToolCallSpec[]` (R-E4)

**ModelJudgeRequest:** Receives `target: EvaluationTarget`. **No** `timeline`.
- To add: `target.timeline?: ExecutionTimeline` or `timeline` field on `EvaluationTarget` (R-E7)

**`runExperiment`:** Receives `agent`, `dataset`, `scorers`, `traceResolver?`, `traceLimits?`. **No** `timeline` option, **no** `toEnvironment` callback, **no** workflow runner.
- To add: `timeline?: "off" | "metadata" | "redacted_io"` option, `toEnvironment?` callback (R-E1, R-E3)

**`scoreRun`:** Constructs `target = { result, trace? }` and calls `scorer.score()`. Timeline projection hook goes here.

**Conclusion:** All additions are **additive** (optional fields). Default `timeline: "off"` preserves byte-identical existing behavior.

### 1.4 `RunLedger` / `AgentEventSource`

**RunLedger:** [`src/contracts-protocol.ts:L611–635`](../../src/contracts-protocol.ts#L611-L635)
Four append methods: `appendRun`, `appendEvent`, `appendToolCall`, `appendUsage`.
Record types: `RunRecord`, `AgentEventRecord`, `ToolCallRecord`, `UsageRecord`.
Batched/flushable wrapper: `FlushableRunLedger` with durability modes.

**AgentEventSource:** `append`, `page`, `subscribe`, `cleanup`.
Backends: Memory, PostgreSQL (LISTEN/NOTIFY), NATS JetStream, SQLite (no subscribe), A2A adapter.
HMAC cursor signing; foreign-cursor rejection; unredacted-append rejection.

**Conclusion:** No changes required. Timeline projectors consume ledger records via `EvaluationTrace` (offline) or `AgentEvent` stream (live) — both already available. No new persistence backends.

### 1.5 OTel adapter and `createProviderCapture`

**OTel:** [`packages/prism-core/src/governance/observability/instrumentation.ts`](../../packages/prism-core/src/governance/observability/instrumentation.ts)

Existing spans:
| Span | Kind | Agent Event trigger |
| --- | --- | --- |
| `invoke_agent prism` | internal | `agent_started` → terminal |
| `chat {model}` | client | `provider_turn_started` → `finished` |
| `execute_tool {name}` | internal | `tool_execution_started` → finished/error/blocked |
| `prism.guardrail.evaluate` | internal | `guardrail_decision` |
| `prism.agent.delegate` | internal | `handleDelegation` |

**Missing:** All workflow spans. No `invoke_workflow`, no `prism.workflow.node`. To add in R-O3 (Task 6).

**ProviderCapture:** [`src/capture.ts:L24–31`](../../src/capture.ts#L24-L31)
```ts
type CaptureRedaction = "secrets" | "all" | "none";
```
- `"secrets"` (default): drops message content, retains structure.
- `"all"`: drops content + errors.
- `"none"`: retains content after redactor pass.

Ring buffer: default 100, hard 10,000.

**Conclusion:** The timeline content-capture policy (`"metadata" | "redacted_io" | "full_io"`) is **new vocabulary** that aligns with but does not replace `CaptureRedaction`:

| Timeline policy | Closest capture analog | Difference |
| --- | --- | --- |
| `metadata` | `"secrets"` / `"all"` | No I/O of any kind on steps |
| `redacted_io` | `"none"` + redactor | I/O present after `SecretRedactor`, byte-capped |
| `full_io` | `"none"` + redactor | Same as `redacted_io` (secrets always redacted); host opts into residual content |

Timeline policy is **per-projection**, not per-provider. One projector call specifies one level. Document this distinction.

### 1.6 `WorkflowEvent` + `WorkflowCheckpointValue` + `buildGraph`

**WorkflowEvent:** [`types.ts:L354–467`](../../packages/prism-core/src/runtime/workflows/types.ts#L354-L467)

13 variants: `workflow_started`, `workflow_finished`, `workflow_suspended`, `workflow_resumed`, `node_started`, `node_finished`, `node_iteration_started`, `node_iteration_finished`, `node_failed`, `node_skipped`, `checkpoint_saved`, `agent_event`, `workflow_event_overflow`.

- **`node_finished` does NOT carry node I/O.** This is deliberate: keeps event stream lightweight.
- **`node_iteration_finished` carries `output?: unknown`** — bounded loop body output.
- **`agent_event` wraps `AgentEvent`** — carries I/O from agent nodes indirectly.

**WorkflowCheckpointValue:** [`types.ts:L273–293`](../../packages/prism-core/src/runtime/workflows/types.ts#L273-L293)
Node outputs live at `checkpoint.nodes[nodeId].output`. Workflow input at `checkpoint.workflowInput`.

**buildGraph:** [`define.ts:L146–174`](../../packages/prism-core/src/runtime/workflows/define.ts#L146-L174)
Returns: `{ successors: ReadonlyMap, predecessors: ReadonlyMap, indegree: ReadonlyMap }`.
Not JSON-serializable. No node kinds, no edge kinds, no labels, no nested workflow ids, no loop metadata.

**ConditionalNodeDefinition:** has `then?: readonly string[]` and `else?: readonly string[]`. These partition successors into then/else branches at runtime via `skip.ts`.

**`hashWorkflowDefinition`:** exists at [`util.ts:L26`](../../packages/prism-core/src/runtime/workflows/util.ts#L26). Reuse for `WorkflowGraphView.definitionHash`.

**WorkflowNodeKind:** `"agent" | "function" | "tool" | "conditional" | "fan_out" | "join" | "workflow" | "loop"`.

**WorkflowLimits:** `maxNodes` default 1,000 / hard 10,000. Already suitable for graph serialization caps.

**Conclusion:** `serializeWorkflowGraph` walks `WorkflowDefinition.nodes` and `.edges`, reading `node.kind`, `node.then`/`node.else` for conditional edge classification. Conditional node with `then` targets → edges marked `kind: "then"`; `else` targets → `kind: "else"`; regular edges → `kind: "always"`. No functions/closures serialized.

### 1.7 AG-UI step mapping

**Mapper:** [`packages/ag-ui/src/ag-ui-mapper.ts:L48–453`](../../packages/ag-ui/src/ag-ui-mapper.ts#L48-L453)

- `turn_started` → `STEP_STARTED` with `stepName: "turn:" + turn`
- `turn_finished` → `STEP_FINISHED` with matching step
- Tool calls → `TOOL_CALL_START/ARGS/RESULT/END`
- Messages → `TEXT_MESSAGE_*`
- Status changes → `STATE_SNAPSHOT`

**Conclusion:** AG-UI is a protocol translator, not a timeline projector. No timeline types. R-X5 (richer AG-UI steps from timeline kinds) stays deferred — not required for the objective.

### 1.8 Dev inspector timeline folding

**File:** [`packages/prism-coding-tools/src/dev/ui/inspector.ts`](../../packages/prism-coding-tools/src/dev/ui/inspector.ts)

`applyAgentEvent(view, event)` folds `AgentEvent` into a `RunView { items: TimelineItem[], usage, status }`. Window cap: `MAX_RENDERED_WINDOW = 400`.

`TimelineItem` kinds: `message`, `tool`, `turn`, `note`. Flat list, no parent/child tree, no step ids, no kind enum matching `ExecutionStepKind`.

**Conclusion:** The inspector's folding logic is **composition-only** — compiled into a standalone browser bundle, not exported. The internal data model (`TimelineItem`) is too simple for the `ExecutionTimeline` contract (no tree, no timing, no usage per step, no status enum). The inspector **cannot be reused** as the projector; a new `projectAgentTimeline` is required. Optionally, Task 7 can refactor the inspector to consume `projectAgentTimeline` internally — only if it deletes duplicated code without behavior changes.

---

## 2. What hosts can already do by composition

| Host need | Possible today? | How |
| --- | --- | --- |
| Final-output scoring | ✅ | `scoreRun` on `AgentRunResult.text` |
| LLM-as-judge | ✅ | `createModelJudge` (host callback) |
| Pairwise comparison | ✅ | `runComparison`, `assertPromptPromotion` |
| Agent experiment with CI gate | ✅ | `runExperiment` + `assertEvaluationThreshold` |
| Human feedback → eval | ✅ | `RunFeedbackStore` + `appendEvaluationFeedback` |
| Trace → dataset | ✅ | `datasetFromRuns` |
| Online sampled scoring | ✅ | `scoreRunLive` + `sampleRate` |
| Agent OTel spans | ✅ | `createOpenTelemetryInstrumentation` |
| Loopback event waterfall | ✅ | Dev inspector (composition only) |
| Cockpit waterfall from raw events | ⚠️ Custom | Host must switch on 20+ event variants |
| Trajectory scoring (tool sequence) | ⚠️ Custom | Host parses `target.trace.events` manually |
| Outcome/environment scoring | ❌ | No `environment` seam on `ScorerInput` |
| Workflow experiment | ❌ | Must wrap in throwaway agent |
| Workflow graph export (JSON/Mermaid) | ❌ | `buildGraph` returns Maps, no serialization |
| Workflow OTel spans | ❌ | Not instrumented |
| Cockpit aggregations (cost, latency) | ❌ | Host re-sums from provider events |
| Expected trajectory on dataset items | ❌ | No `expectedTrajectory` field |

---

## 3. What requires ONE new projector vs new stores

| Gap | Resolution | New store? |
| --- | --- | --- |
| `ExecutionTimeline` | New projector functions (`projectAgentTimeline`, `projectTraceTimeline`, `projectWorkflowTimeline`, `createTimelineFolder`) | **No** — reads existing events/traces/checkpoints |
| `WorkflowGraphView` | New pure function (`serializeWorkflowGraph`) | **No** — reads `WorkflowDefinition` |
| Run overlay | New pure function (`projectWorkflowGraphRun`) | **No** — reads checkpoint/events |
| Cockpit aggregations | New pure function (`summarizeTimeline`) | **No** — reads timeline |
| Mermaid / DOT | New pure string functions | **No** |
| Trajectory helpers | New scorer factories (`createToolCallMatchScorer`, etc.) | **No** |
| `ScorerInput.timeline` | Additive optional field | **No** |
| `ScorerInput.environment` | Additive optional field | **No** |
| `DatasetItem.expectedTrajectory` | Additive optional field | **No** |
| Workflow OTel | Extend existing `createOpenTelemetryInstrumentation` | **No** |

**Zero new stores.** All projectors are pure functions over existing data.

---

## 4. DatasetStore decision: **No** (skip in v1)

Rationale:
1. `defineDataset` + git-versioned JSON covers CI golden sets.
2. `datasetFromRuns` produces the next version in memory.
3. Hosts who need multi-tenant goldens already have Postgres and can store dataset JSON alongside their own tenancy model.
4. Adding `DatasetStore` would force a new persistence adapter contract (memory, SQLite, Postgres), migration, ownership model — cost disproportionate to demand.
5. If a host eval console needs ownership-scoped dataset APIs, revisit after 0.7.0 as a demand-gated P2.

**Decision:** R-E8 DatasetStore → **skip**. Record for revisit.

---

## 5. Workflow event I/O decision: **keep projector-joins-checkpoint**

Should `node_finished` carry node output on the event bus?

**Decision:** No.

Rationale:
1. `node_finished` omitting I/O is deliberate (keeps live event stream lightweight and bounded).
2. `node_iteration_finished` already carries bounded loop body output.
3. `agent_event` wraps `AgentEvent` which carries tool I/O from agent nodes.
4. The projector `projectWorkflowTimeline(events, checkpoint?)` joins checkpoint node outputs when provided.
5. Live cockpits without checkpoint access can read `getWorkflowRun()` on `node_finished` or use the iteration event output.
6. If live cockpits without any checkpoint access become a real host pattern, add opt-in `includeNodeOutput` on the event bus later — do not change the default event size.

**Decision:** No event schema change. Projector handles the join.

---

## 6. Frozen schema: `ExecutionTimeline` (R-T1)

```ts
type ExecutionStepKind =
  | "run"
  | "turn"
  | "provider"
  | "tool"
  | "guardrail"
  | "delegation"
  | "compaction"
  | "retry"
  | "hitl"
  | "artifact"
  | "workflow_node"
  | "loop_iteration"
  | "nested_workflow";

interface ExecutionStep {
  readonly id: string;
  readonly parentId?: string;
  readonly kind: ExecutionStepKind;
  readonly name: string;
  readonly order: number;
  readonly status: "running" | "succeeded" | "failed" | "blocked" | "skipped"
    | "suspended" | "denied" | "aborted";
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  readonly input?: unknown;       // omitted unless content policy allows
  readonly output?: unknown;
  readonly error?: ErrorInfo;
  readonly usage?: Usage;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface ExecutionTimeline {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly sessionId?: string;
  readonly workflowId?: string;
  readonly workflowRevision?: string;
  readonly status: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly input?: unknown;
  readonly result?: unknown;
  readonly usage?: Usage;
  readonly steps: readonly ExecutionStep[];
  readonly redacted: boolean;
  readonly content: "metadata" | "redacted_io" | "full_io";
}
```

Mapping from agent events to step kinds:

| Agent event | Step kind | `parentId` | Notes |
| --- | --- | --- | --- |
| `agent_started/finished` | `run` | — | root step |
| `turn_started/finished` | `turn` | run step | |
| `provider_turn_started/finished` | `provider` | current turn | carries `usage` |
| `tool_execution_*` | `tool` | current turn | carries args/result under policy |
| `guardrail_decision` | `guardrail` | current turn | |
| `delegated_agent_step` | `delegation` | current turn | |
| `compaction_*` | `compaction` | run step | |
| `retry_scheduled` | `retry` | run step | |
| `agent_suspended` | `hitl` | run step | |
| `artifact_*` | `artifact` | current turn | |
| `node_started/finished/failed/skipped` | `workflow_node` | run or parent node | |
| `node_iteration_*` | `loop_iteration` | loop node step | |
| nested workflow events | `nested_workflow` | parent node | |

Flat `steps` array stays the iteration API. Tree via `parentId`.

---

## 7. Frozen schema: `WorkflowGraphView` (R-G1)

```ts
interface WorkflowGraphNode {
  readonly id: string;
  readonly kind: WorkflowNodeKind;
  readonly label: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly nestedWorkflowId?: string;
  readonly loop?: { readonly maxIterations: number };
}

interface WorkflowGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: "always" | "then" | "else";
}

interface WorkflowGraphView {
  readonly schemaVersion: 1;
  readonly workflowId: string;
  readonly revision: string;
  readonly definitionHash: string;
  readonly nodes: readonly WorkflowGraphNode[];
  readonly edges: readonly WorkflowGraphEdge[];
}

interface WorkflowGraphNodeRunState {
  readonly status: WorkflowNodeStatus;
  readonly durationMs?: number;
  readonly attempt?: number;
  readonly errorCode?: string | number;
  readonly skippedReason?: string;
}
```

Edge kind derivation:
- For each `[from, to]` in `workflow.edges`:
  - If `from` is a conditional node:
    - If `to` is in `node.then` → `kind: "then"`
    - If `to` is in `node.else` → `kind: "else"`
    - Otherwise → `kind: "always"` (unconditional successor)
  - Otherwise → `kind: "always"`

Stable sort: nodes by `id.localeCompare()`, edges by `(from, to)`.

---

## 8. Scenario, trial, and manifest shapes (R-E12)

Frozen for Task 5 implementation:

### ToolCallSpec (for expectedTrajectory and match scorers)

```ts
interface ToolCallSpec {
  readonly name: string;
  readonly args?: (actual: JsonObject) => boolean;  // optional predicate
}
```

### Repeated trials

```ts
interface TrialConfig {
  readonly trials?: number;       // default 1, hard cap 16
  readonly seed?: number;
}

interface TrialReport {
  readonly sampleCount: number;
  readonly seed?: number;
  readonly method: "independent_runs";  // named, not claimed statistical
}
```

### Eval manifest

```ts
interface EvalManifest {
  readonly promptId?: string;
  readonly promptVersion?: string;
  readonly toolFingerprint?: string;
  readonly skillIds?: readonly string[];
  readonly model?: string;
  readonly policyRevision?: string;
  readonly runtimeRevision?: string;
  readonly datasetId?: string;
  readonly datasetVersion?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
```

Corrupt/missing required fields → fail closed (do not run experiment).
Hard invariant scorers (forbidden tool, approval-before-effect, environment 0/1) report independently — **cannot be averaged away** by a high text-quality mean.

### forEach step-scoring cap

`forEach: "tool" | "workflow_node"` with `maxStepScores`: default 32, hard 128. Excess steps skipped (not thrown), logged.

---

## 9. Bounds envelope confirmation

### Timeline bounds (new, consistent with existing ceilings)

| Dimension | Default | Hard cap | Rationale |
| --- | --- | --- | --- |
| Max steps | 1,000 | 10,000 | Matches `DEFAULT_MAX_NODES` / `HARD_MAX_NODES` |
| Per-step I/O bytes | 16 KiB | 256 KiB | Below `DEFAULT_MAX_NODE_OUTPUT_BYTES` (4 MiB) |
| Total timeline bytes | 4 MiB | 32 MiB | Matches `DEFAULT_TRACE_MAX_BYTES` / `HARD_TRACE_MAX_BYTES` |
| Mermaid/DOT max chars | 1 MiB | 4 MiB | Generous; most graphs << 100 KiB |
| Summary tool name cap | 64 | — | `other` bucket for remainder |

### Folding 1k events + 1k tool rows performance

- 1,000 `AgentEvent` records + 256 tool calls = ~1,256 items to fold.
- Inspector windowing: `MAX_RENDERED_WINDOW = 400` — only tail rendered (DOM concern, not projection).
- Eval trace envelope: default 4 MiB / hard 32 MiB.
- Timeline for 1,000 steps at `metadata` (no I/O): ~200–400 bytes/step → ~200–400 KiB. Well within 4 MiB.
- Timeline for 1,000 steps at `redacted_io` with 16 KiB I/O cap: worst case ~16 MiB. Within 32 MiB hard cap; default 4 MiB would reject at ~250 steps with full I/O → hosts who want 1k steps with I/O must raise cap explicitly.

**Conclusion:** Envelope is adequate. Folder `push` is O(1) per event (append to array + optional I/O redaction). No O(n²) rebuilds.

---

## 10. Import cycle analysis: no new package required

Current state — zero cross-imports:
- `governance/evals/` → does NOT import `runtime/workflows/`
- `governance/observability/` → does NOT import `runtime/workflows/` or `governance/evals/`
- `runtime/workflows/` → does NOT import `governance/evals/` or `governance/observability/`

Plan:
- **Timeline types** (`ExecutionTimeline`, `ExecutionStep`, `ExecutionStepKind`) → place in `governance/observability/timeline-types.ts`. Evals imports this (for `ScorerInput.timeline`). No cycle: evals depends on observability types, observability does not depend on evals.
- **Timeline projectors** → `governance/observability/timeline.ts` for agent/trace projectors. Workflow projector can also live here (imports workflow types as input parameter types only — no instantiation, no cycle).
- **Workflow graph types and functions** → `runtime/workflows/graph.ts` and `graph-export.ts`. No cross-dependency.
- **Scorer factories** → `governance/evals/trajectory.ts`. Imports timeline types from observability (one-way).
- **Summary** → `governance/observability/summary.ts`. Imports timeline types (same package).
- **Workflow OTel** → extends `governance/observability/instrumentation.ts`. Imports workflow event types as parameters.

**Dependency graph:**
```
evals/types ←─── evals/trajectory
    │                    │
    └──── imports ───────┘
              │
    observability/timeline-types
              │
    observability/timeline (projectors)
              │
    observability/summary

    workflows/types ←── workflows/graph
                    ←── workflows/graph-export
                    ←── observability/timeline (parameter types only)
                    ←── observability/instrumentation (event types)
```

No cycles. **No new package needed.** Colocate in existing `governance/observability` and `runtime/workflows`.

---

## 11. Security posture confirmation

| Boundary | Status | Notes |
| --- | --- | --- |
| Default metadata-only | ✅ Frozen | `content: "metadata"` is default; no I/O fields on steps |
| Redactor order | ✅ Correct | `SecretRedactor` runs before any I/O field is set on a step; `resolveRedactor` is the existing pattern |
| Ownership on persistence projectors | ✅ Already enforced | `createPersistenceTraceResolver` checks `exactOwnershipMatches` on every record before returning the trace. `projectTraceTimeline` receives already-scoped data. |
| Mermaid XSS | ✅ To implement | Node labels must be HTML-escaped and quote-wrapped in Mermaid syntax. Node ids are host-controlled but still escaped. R-G2 spec requires this. |
| Secrets never metric labels | ✅ Existing | `policyAttrs()` in instrumentation.ts; labels are low-cardinality controlled vocabulary. Timeline `metadata` on steps is `Readonly<Record<string, unknown>>` but docs will specify low-card only. |
| Workflow OTel labels | ✅ To document | `workflowId` is a metric label only if host treats it as controlled vocabulary (finite set). Unbounded unique ids must use span attributes, not metric labels. R-O3 spec requires documentation. |
| Graph overlay | ✅ Spec enforced | `WorkflowGraphNodeRunState` carries status/timing/error code — **no** node outputs. I/O stays on the timeline under content policy. |
| Content capture policy | ✅ New, aligned | `"metadata" | "redacted_io" | "full_io"` — all modes run `SecretRedactor`. No mode bypasses redaction. |

---

## 12. Files and tests later tasks add

| Task | Files to create | Tests to create |
| --- | --- | --- |
| **Task 2** (Timeline) | `governance/observability/timeline-types.ts`, `timeline.ts`, `__tests__/timeline.test.ts`; docs: `docs/execution-timeline.md` | 6 test cases per plan |
| **Task 3** (Graph) | `runtime/workflows/graph.ts`, `graph-export.ts`, `__tests__/graph.test.ts`; docs: `docs/workflows.md` graph section | 7 test cases per plan |
| **Task 4** (Trajectory) | `governance/evals/trajectory.ts`, `__tests__/trajectory.test.ts`; type additions to `types.ts`, `score.ts`, `experiment.ts`, `judge.ts` | 10 test cases per plan |
| **Task 5** (Dataset/Workflow exp) | `governance/evals/workflow-experiment.ts`, `scenarios.ts`, `__tests__/workflow-experiment.test.ts`, `__tests__/scenarios.test.ts`; type additions to `types.ts`, `dataset.ts`, `curate.ts` | 8+ test cases per plan |
| **Task 6** (Cockpit/OTel) | `governance/observability/summary.ts`, `__tests__/summary.test.ts`; extend `instrumentation.ts` | 4 test cases per plan |
| **Task 7** (Examples/Docs) | `examples/execution-timeline.ts`, `examples/behavior-evaluation.ts`; doc finalization | 3 test cases per plan |

---

## 13. Summary of decisions

| Decision | Outcome | Rationale |
| --- | --- | --- |
| `ExecutionTimeline.schemaVersion` | `1` | Frozen |
| `WorkflowGraphView.schemaVersion` | `1` | Frozen |
| Content policy enum | `"metadata" \| "redacted_io" \| "full_io"` | Aligned with but separate from `CaptureRedaction` |
| DatasetStore | **Skip** in v1 | Git + `datasetFromRuns` sufficient; revisit on demand |
| ExperimentStore | **Skip** (R-E9) | `serializeEvaluationReport` + CI logs sufficient |
| OpenInference mapper | **Skip** (R-O5) | OTel GenAI is the bet; Phoenix normalizes at ingest |
| Workflow event I/O | **Keep projector-joins-checkpoint** | No event schema change |
| New package | **Not needed** | No import cycles; colocate in existing modules |
| Inspector reuse | **New projector**, not inspector refactor | Inspector data model too simple; optional refactor in Task 7 |
| Trial hard cap | 16 | Small offline fixture; enough for uncertainty bands without cost explosion |
| forEach step-score cap | Default 32 / hard 128 | Prevent storage explosion on 200-tool runs |
| Hosted cockpit / React | **Rejected** | Product boundary |
| Studio / visual editor | **Rejected** | Product boundary |
| draw.io export | **Rejected** | Wrong package, XSS surface |
| 50-metric catalogue | **Rejected** | Match modes + budget + loop + schema + error class cover 80% CI |
