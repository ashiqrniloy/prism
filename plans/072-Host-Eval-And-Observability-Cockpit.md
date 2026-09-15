# 072 — Host Eval, Observability Cockpit, and Behavioral Evidence

Roadmap phase: **0.7.0**, **first of seven plans** in the extended line (**072, 073, 074, 075, 077, 078, 079**; [076](076-Observational-Memory-Mastra-Parity.md) is superseded). Execute this plan **before** [073 — Host Completeness](073-Release-0-7-0-Host-Completeness.md). [077 — Work-Scope Memory Index](077-Work-Scope-Memory-Index.md) and [074 — Attention Compiler](074-Attention-Compiler.md) are independent of this plan and may run in parallel with 073; [075 — Memory Fabric](075-Memory-Fabric.md), [078 — host-owned subagent spawn](078-Host-Owned-Subagent-Spawn-And-Parallel-Agents.md) and [079 — messaging channels](079-Prism-Messaging-Channels-Telegram-Signal.md) joined the line on 2026-09-14. Do **not** publish after this plan alone. Together the seven plans ship `@arnilo/prism` **0.7.0** from baseline **0.6.0** (no 0.6.1 cut); [073 Tasks 28–29](073-Release-0-7-0-Host-Completeness.md) are the cut and are deferred until every plan in the line is closed.

Owns **R07** (behavioral/trajectory evaluation, scenarios, repeated trials, eval manifests) and **R15** (execution timeline, workflow graph, cockpit aggregations, workflow OTel). Plan 073 Task 15 wires these into inspector and host-journey gates; 073 Tasks 28–29 are the 0.7.0 package cut: they are **deferred** until 074, 075, 077, 078 and 079 are closed too (Task 27, the journey/evidence matrix, is complete).

Baseline: `@arnilo/prism` **0.6.0** (plans 070–071); evals at `@arnilo/prism-core/governance/evals`; observability at `@arnilo/prism-core/governance/observability`; workflows at `@arnilo/prism-core/runtime/workflows`.
Constraint: Prism stays a **harness**. Hosts own the cockpit UI, annotation UX, storage topology, and release policy. This plan ships **consumable contracts + projectors + scorers**, not LangSmith/Langfuse/Studio.

## Objectives

- Give hosts a complete, redacted, ordered **execution timeline** for every agent run and workflow run: initial input, each step with optional input/output, and the terminal result — live and from persistence.
- Give hosts a **serializable workflow graph** (definition + live/replay overlay) they can render in their own applications without embedding Prism UI.
- Close the eval gaps that block hosts from building their own evaluation systems: trajectory/step scoring, outcome/environment scoring, golden-path match, workflow experiments, multi-turn scenarios (clarification/refusal), approval-before-effect, failure injection, repeated trials with uncertainty, release manifests, and CI gates on those signals — all over the same timeline contract.
- Close the observability gaps that block hosts from building an observability cockpit: step waterfall, cost/latency/tool rollups, workflow OTel, correlation ids — still metadata-safe by default.
- Preserve product boundaries: no hosted control plane, no managed observability SaaS, no visual workflow editor, no Studio. `prism dev` stays loopback-only.

## Expected Outcome

- One host-facing projection, `ExecutionTimeline`, is the source of truth for “what the agent/workflow did,” produced from live `AgentEvent`/`WorkflowEvent` streams or from `EvaluationTrace` + workflow checkpoints.
- One host-facing projection, `WorkflowGraphView` (+ `WorkflowGraphRunView`), is the source of truth for “what the DAG looks like and which nodes ran,” with Mermaid and Graphviz DOT exporters.
- `@arnilo/prism-core/governance/evals` scores **timelines** (and optional host environment snapshots), not only final `AgentRunResult.text`.
- Hosts can implement a cockpit and an eval harness in their app with those two view-models plus existing `RunLedger` / `EvaluationStore` / `RunFeedbackStore` / OTel adapter — without forking Prism or parsing raw event unions.
- Default payload remains metadata-only. Step I/O is an explicit content-capture policy, always redacted, always byte-capped.

## Product Boundary (non-negotiable)

From `roadmap.md` Product Boundaries:

- Harness, not hosted platform. Hosts own UI, auth UX, storage, provider selection.
- No speculative product layer: Studio, visual workflows, hosted cloud, **managed observability** stay out.
- Core stays dependency-free. Optional packages stay inert on import.
- Redaction at every boundary. Ownership on every read.

Consequence: Prism does **not** ship an embeddable React cockpit, annotation-queue UI, failure-clustering service, or draw.io workflow editor. It ships JSON view-models, string exporters (Mermaid/DOT), scorers, and docs/examples that show how a host wires those into *their* app.

`@arnilo/prism-office/diagrams` is the wrong primitive (origin-enforced draw.io embed + mxGraph XML). Do not reuse it for agent/workflow graphs.
`@arnilo/prism-coding-tools/dev` is a loopback playground, not a production cockpit component. Do not promote it.

---

## Research Findings

### What hosts actually need (the user ask, restated)

Two host-owned systems, one shared record:

1. **Evaluation system** — offline golden sets, CI gates, online sampled scoring, pairwise/prompt promotion, production-incident → dataset. Must grade *path* and *outcome*, not only final text.
2. **Observability cockpit** — ordered reconstruction of a run: input → steps (I/O) → result; plus DAG graphics for workflows that the host renders in-product.

Industry 2026 consensus (LangSmith, Braintrust, Phoenix, DeepEval, Langfuse, Mastra, OpenAI Agents SDK, OTel GenAI): **the durable asset is the trace + the dataset + the scorers**, not the dashboard vendor. Prism already stores the raw materials (`AgentEvent`, `RunLedger`, `EvaluationTrace`, `WorkflowEvent`, checkpoints). It does not yet *project* them into something a host UI or scorer can consume without re-implementing a parser.

### Industry — evaluation

Sources: LangSmith evaluation + trajectory evals (`agentevals`); DeepEval trajectory metrics; Braintrust experiments/CI; Phoenix/OpenInference; τ²-bench; Reactify/Cipher 2026 roundups.

| Pattern | What it is | Who ships it | Prism today |
| --- | --- | --- | --- |
| Outcome eval | Black-box input → final output / environment state | τ²-bench `EnvironmentEvaluator` (DB hash); SWE-bench tests; DeepEval `TaskCompletionMetric` | `scoreRun` on `AgentRunResult.text` / content. **No environment/outcome seam.** |
| Trajectory eval | Ordered tool/LLM/handoff path | LangChain `createTrajectoryMatchEvaluator` (`strict` / `unordered` / `subset` / `superset`); DeepEval `StepEfficiencyMetric` / `PlanAdherenceMetric` / `ToolCorrectnessMetric` | `EvaluationTrace` is raw ledger rows. Scorers *may* receive `target.trace` but must parse `AgentEvent` themselves. **No match modes, no step records.** |
| Component eval | Score one span (retriever, tool, judge) | DeepEval span metrics; Phoenix evaluators | Possible if host writes a scorer over one tool call. **No first-class step target.** |
| LLM-as-judge | Rubric over output or trajectory | `createModelJudge` (host callback); DeepEval GEval; LangSmith judges | **Exists.** Host supplies the model. Pin rubric version. No judge ensemble, no calibration helper. |
| Pairwise / promotion | A vs B on a dataset | `runComparison`, `assertPromptPromotion` | **Exists.** |
| Offline experiment | Dataset × agent × scorers | `runExperiment`, `assertEvaluationThreshold`, `serializeEvaluationReport` | **Exists for agents.** Not for workflows. |
| Online / sampled live | Score production traffic | `scoreRunLive` + `sampleRate` | **Exists.** No drift/alert product (correct — host OTel/metrics). |
| Trace → dataset | Incident becomes a test | `datasetFromRuns` (plan 043) | **Exists.** Default `expected` only from feedback, never from untrusted output. |
| Human feedback | Ratings, tags, links to evals | `RunFeedbackStore`, `appendEvaluationFeedback` | **Exists.** |
| Golden trajectory on items | Expected tool sequence | LangSmith / agentevals reference trajectories; τ² `evaluation_criteria.actions` as *one* reference, not the only correct path | **Missing.** `DatasetItem` has `input` / `expected` / `metadata` only. |
| Workflow eval | Score DAG node path + outputs | LangSmith LangGraph experiments | `runExperiment` calls `session.run` only. **No `runWorkflow` experiment helper.** |
| 50-metric catalogues | Faithfulness, toxicity, BLEU, RAGAS, … | DeepEval, Ragas, Phoenix | **Out of scope.** Hosts write domain scorers. Prism ships a *few* deterministic trajectory/SLO helpers, not a research-metric zoo. |

τ²-bench lesson (important): **outcome ≠ trajectory.** An agent can leave the DB correct while violating policy, or follow the golden tool list and still fail the environment. τ² multiplies reward components (`DB`, `ACTION`, `COMMUNICATE`, `NL_ASSERTION`). Prism must let hosts attach an **environment snapshot** (ticket state, ERP facts, test suite, DB hash) as a scorer input, separate from the timeline.

Three-grader rule (industry, keep):

1. **Code** for checkable facts (schema, tool name/args, HTTP status, token/cost/latency ceilings, environment assertions).
2. **LLM judge** for subjective quality (tone, faithfulness, plan reasonableness) — already `createModelJudge`.
3. **Humans** to calibrate judges and seed `expected` via `RunFeedbackStore` — already the feedback seam.

Do not invert this. Do not LLM-judge “did it call `refund`.”

### Industry — observability

Sources: OpenTelemetry GenAI semantic conventions (`gen_ai.*`, still Development; dedicated `semantic-conventions-genai` repo after v1.42.0); OpenInference span kinds; Langfuse OTLP ingest; Mastra tracing; OpenAI Agents SDK traces/spans; Prism `docs/observability.md`.

Shared 2026 wire:

- Trace = one end-to-end workflow/run. Spans = tree (agent → chat → tool).
- OTel operations: `invoke_agent`, `chat`/`generate_content`, `execute_tool`, `invoke_workflow`, `plan`, `retrieval`, `create_agent`. Content (`gen_ai.input.messages` / `output.messages`) is **opt-in**.
- OpenInference kinds: `AGENT`, `LLM`, `TOOL`, `CHAIN`, `RETRIEVER`, `RERANKER`, `EMBEDDING`, `GUARDRAIL`, `EVALUATOR`, `PROMPT`.
- High-cardinality ids (`runId`, `sessionId`, `toolCallId`) are span attributes, never metric labels.
- Mastra: sampling (`always` / `never` / `ratio` / `custom`), request-context metadata on every span, exporters (storage + OTLP).
- OpenAI Agents SDK: `trace` / `agent_span` / `generation_span` / `function_span` / `guardrail_span` / `handoff_span`; `group_id` for conversation; custom processors; default-on tracing (Prism stays **explicit activation** — do not copy default-on).

Prism already maps:

| Agent event | OTel span | Gap |
| --- | --- | --- |
| `agent_started` / terminal | `invoke_agent prism` | none for agent runs |
| `provider_turn_*` | `chat {model}` | content opt-in is `createProviderCapture`, not the timeline |
| `tool_execution_*` | `execute_tool {tool}` | args/results redacted on events; timeline needs a policy |
| `guardrail_decision` | `prism.guardrail.evaluate` | none |
| `handleDelegation` | `prism.agent.delegate` | none |
| RAG | `rag_request` tree | exists |
| Workflow run | — | **no `invoke_workflow`**, no node spans |
| Feedback / eval | events + low-card metrics | exists |

Cockpit UIs in the market all consume the **same shape**: waterfall of spans with input/output drawers, token/cost rollup, tool histogram, error classification. Prism’s `AgentEvent` union *is* that waterfall, but every host currently re-folds it. The inspector UI (`docs/dev-inspector.md`) already does this folding for loopback — the folding logic is not a public projector.

### Industry — graphical workflow representation

Sources: LangGraph Studio; LangGraph4j Studio (`GET /init` returns **Mermaid** of the graph + input schema); VizLang (React Flow, local); LangGraphics (live overlay); Workflow Builder (embeddable React canvas for *end-user authoring*, separate from runtime); Temporal UI (history, not agent DAG).

Split the problem:

| Surface | Audience | Prism stance |
| --- | --- | --- |
| **Definition graph** (nodes, edges, kinds, conditionals, loops) | Host UI, docs, onboarding | **Ship.** JSON view-model + Mermaid + DOT from `defineWorkflow` / `buildGraph`. |
| **Run overlay** (which nodes ran/skipped/failed, durations, active node) | Host cockpit, ops | **Ship.** Overlay on the same view-model from checkpoint + `WorkflowEvent`. |
| **Live step-through debugger** (edit state, time-travel, hot-reload) | Agent IDE | **Do not ship.** That is Studio. Hosts can build it from checkpoints + `replayWorkflow` / `resumeWorkflow`. |
| **End-user visual authoring canvas** | PMs/customers editing flows | **Do not ship.** Hosts who want a canvas consume the JSON graph; Prism remains code-first `defineWorkflow`. |

LangGraph4j’s `/init` contract is the right shape to copy: `{ title, mermaid, inputs, threads }` — data, not a component.

### Prism inventory (what already holds)

**Evals** (`packages/prism-core/src/governance/evals/`, `docs/evaluations.md`):

- `defineScorer` / `defineDataset` / `scoreRun` / `scoreRunLive` / `runExperiment` / `runComparison`
- `createModelJudge` (host callback, bounded)
- `createPersistenceTraceResolver` → `EvaluationTrace { run, events, toolCalls, usage }`
- `datasetFromRuns`, `appendEvaluationFeedback`
- `assertEvaluationThreshold`, `serializeEvaluationReport`
- `EvaluationStore` (memory + `createPostgresEnterpriseState().evaluations`)
- ERP invariant scorers (`createErpInvariantScorers`) — structured facts, not prose
- Prompt promotion (`assertPromptPromotion`) over `runComparison`

**Observability**:

- `AgentEvent` discriminated union (`docs/agent-events.md`) — lifecycle, turns, provider turns, messages, tools, guardrails, compaction, retry, artifacts, HITL
- `RunLedger` + batched wrapper; SQLite/Postgres persistence
- Durable `AgentEventSource` (memory / Postgres LISTEN/NOTIFY / NATS JetStream)
- `createOpenTelemetryInstrumentation` / `createRagTelemetry` / `createInMemoryTelemetry`
- `createProviderCapture` (capped FIFO, content policy `all` / `secrets` / `none`)
- Dev inspector timeline (composition only, loopback)
- AG-UI maps `turn_*` → `STEP_STARTED` / `STEP_FINISHED` (protocol, not cockpit)

**Workflows** (`docs/workflows.md`):

- `defineWorkflow` / `buildGraph` → successor/predecessor/indegree maps (**not JSON, not Mermaid**)
- `WorkflowEvent`: started/finished/suspended/resumed, `node_started` / `node_finished` / `node_failed` / `node_skipped`, loop iteration events (iteration-finished **does** carry bounded output), `agent_event` wrap, overflow
- **`node_finished` does not carry node input or output.** I/O lives on `WorkflowNodeCheckpoint.output` inside checkpoints (`WorkflowCheckpointValue.workflowInput`, `nodes[id].output`)
- `getWorkflowRun` / `listWorkflowRuns` / `replayWorkflow` / `resumeWorkflow`
- Optional `runLedger` bridge for agent nodes

**Missing join:** no function that takes (events | trace | checkpoint) and returns “input, ordered steps with I/O, result.” Hosts reverse-engineer it. That is the whole gap.

### Gap analysis (why hosts cannot build the two systems yet)

1. **Raw ≠ usable.** `EvaluationTrace` and `AgentEvent[]` are complete but hostile. A cockpit or a trajectory scorer should not switch on 20 event variants.
2. **Workflow I/O is split.** Order/timing in `WorkflowEvent`; payloads in checkpoints. No projector joins them. Live `onEvent` cannot show node output without also polling the checkpoint.
3. **Evals score the ending, not the path.** `ScorerInput` is `result` + optional raw `target.trace`. No `steps[]`, no expected trajectory, no environment handle.
4. **`runExperiment` is agent-only.** Hosts with `defineWorkflow` cannot run the same dataset/CI loop over workflows without wrapping each item in a throwaway agent.
5. **No graph export.** `buildGraph` returns `Map`s. Hosts cannot feed React Flow / Mermaid / their ERP UI without re-deriving kinds, conditionals, loops, nested workflows.
6. **No cockpit aggregations.** Usage exists per provider turn; hosts re-sum. No public `{ totalTokens, cost, latencyMs, toolCounts, errorClass }` rollup from a timeline.
7. **No workflow OTel.** Agent spans exist; DAG runs are invisible in Datadog/Langfuse/Grafana.
8. **Content capture is fragmented.** Provider capture ≠ tool args ≠ workflow node I/O ≠ timeline drawers. Need **one** policy enum reused everywhere.

---

## Requirements Catalog

Each requirement: **what**, **why the host benefits**, **use cases**. Priority: P0 = cannot build either system without it; P1 = eval/cockpit quality; P2 = scale/ergonomics.

### Shared primitive — ExecutionTimeline

#### R-T1 — `ExecutionTimeline` view-model (P0)

**What.** A frozen, JSON-serializable document:

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
  readonly name: string;          // tool name, model id, node id, …
  readonly order: number;         // stable 0..n in emission order
  readonly status: "running" | "succeeded" | "failed" | "blocked" | "skipped" | "suspended" | "denied" | "aborted";
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  readonly input?: unknown;       // omitted unless content policy allows
  readonly output?: unknown;
  readonly error?: ErrorInfo;
  readonly usage?: Usage;
  readonly metadata?: Readonly<Record<string, unknown>>; // low-card only
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
  readonly usage?: Usage;         // run_total
  readonly steps: readonly ExecutionStep[];
  readonly redacted: boolean;
  readonly content: "metadata" | "redacted_io" | "full_io";
}
```

Tree via `parentId` (run → turn → provider/tool). Flat `steps` array stays the iteration API so scorers do not walk recursively.

**Why host benefits.** One type to render a cockpit waterfall *and* to score trajectories. Stops every host from writing an `AgentEvent` switch. Same document works live (fold events) and replay (fold ledger/checkpoint).

**Use cases.** Support-ops “show me what the agent did”; CI trajectory match; customer-facing “audit this refund”; ERP run replay; pairing a failed eval row with the exact tool call.

#### R-T2 — Projectors: live, persistence, workflow (P0)

**What.**

- `projectAgentTimeline(events, options)` — fold `AgentEvent` / `AgentEventRecord[]`
- `projectTraceTimeline(trace, options)` — fold `EvaluationTrace` (run + events + toolCalls + usage)
- `projectWorkflowTimeline(events, checkpoint?, options)` — fold `WorkflowEvent[]` + optional `WorkflowCheckpointValue` for I/O
- Incremental: `createTimelineFolder()` with `push(event)` for SSE/cockpit

Deterministic: same inputs → byte-identical JSON (sorted keys where maps exist; event order preserved).

**Why host benefits.** Live cockpit and offline eval share one folder. Incremental folder means the host SSE loop does not rebuild O(n) every frame.

**Use cases.** Inspector-like panel inside the host app; `datasetFromRuns` enrichment; post-hoc debug of a Postgres-backed run.

#### R-T3 — Content-capture policy (P0)

**What.** One enum, aligned with `createProviderCapture`’s `policy.redact`:

| Mode | Timeline contains |
| --- | --- |
| `metadata` (default) | kinds, names, status, timings, usage, error codes — **no** prompts, args, results, node payloads |
| `redacted_io` | input/output after `SecretRedactor` + field policy, byte-capped per step |
| `full_io` | redactor still runs (secrets never pass); host accepts residual prompt/tool content for replay debugging |

Fail closed on oversize (`ERR_PRISM_TIMELINE_BOUNDS`). Unredactable step → omit I/O, set `redacted: true`, never throw mid-fold for a single step (eval path may still fail closed when a scorer *requires* I/O).

**Why host benefits.** GDPR/ZDR/enterprise default stays safe. Debug/eval hosts opt in explicitly. One policy, not four capture systems.

**Use cases.** Production cockpit = `metadata`; staging replay = `redacted_io`; local `prism dev` = `redacted_io`; regulated tenant = `metadata` only.

#### R-T4 — Correlation fields (P0)

**What.** Timeline and each step carry `runId`, optional `sessionId`, `traceId` (OTel), `workflowId`/`nodeId`, `toolCallId`, `turn`. `onTraceReference` already exists; copy `traceId` onto the timeline when the host passes it.

**Why host benefits.** Cockpit can deep-link Grafana/Langfuse/Datadog from a Prism run, and eval records already have `traceId`.

**Use cases.** “Open this run in our APM”; join eval failure → OTel waterfall.

---

### Evaluation requirements

#### R-E1 — Score timelines, not only final text (P0)

**What.** Extend `ScorerInput` with optional `timeline?: ExecutionTimeline` (and keep `result` / `target.trace` for compat). `scoreRun` / `runExperiment` accept `projectTimeline: true` (default false for byte-identical old behavior) or an injected timeline. Scorers that need steps read `input.timeline.steps`.

**Why host benefits.** Trajectory metrics become ordinary `defineScorer` functions. No new runner.

**Use cases.** “Did it call `create_refund` before `send_email`?”; “no more than 3 tool rounds”; “never called `shell`.”

#### R-E2 — Built-in deterministic trajectory helpers (P0)

**What.** Small factory functions, not a 50-metric catalogue:

| Helper | Scores |
| --- | --- |
| `createToolCallMatchScorer({ mode: "strict" \| "unordered" \| "subset" \| "superset", expected: ToolCallSpec[] })` | Tool name (+ optional args predicate) vs timeline tool steps. Same four modes as LangChain `agentevals`. |
| `createStepBudgetScorer({ maxTurns?, maxToolCalls?, maxDurationMs?, maxTotalTokens?, maxCost? })` | 1 if under ceiling else 0; reason names the axis. |
| `createNoLoopScorer({ maxRepeatedToolCalls?: number })` | Detects identical tool+args bursts (bounded). |
| `createSchemaScorer({ schema })` | Final result / named step output vs host JSON schema validator already in core. |
| `createErrorClassScorer({ deny?: string[] })` | 0 if timeline contains denied error codes / `tool_execution_blocked` reasons. |

All pure, network-free, `[0,1]`, bounded.

**Why host benefits.** 80% of CI gates are these checks. Hosts should not reimplement match modes. Subjective quality stays `createModelJudge`.

**Use cases.** Policy: refund tool must appear; coding agent must not call `git push`; support agent must finish in ≤8 turns; cost cap $0.25/run as a *quality* gate complementary to `RunLimits`.

#### R-E3 — Outcome / environment scorer seam (P0)

**What.** `ScorerInput.environment?: unknown` supplied by the host (DB snapshot, ERP facts, ticket record, test-suite JSON). Optional `toEnvironment(item, result, timeline)` on `runExperiment`. Document that environment is **host-trusted** (not model output). Reuse the ERP invariant pattern: structured facts, 0/1 gates.

**Why host benefits.** τ²/SWE-bench style: “did the world change correctly?” cannot be graded from assistant text. This is the difference between a demo and a production eval.

**Use cases.** Refund landed in ledger; PR tests green; wiki page exists; CRM status = `closed`; inventory decremented once (idempotency).

#### R-E4 — Expected trajectory on dataset items (P1)

**What.** Additive `DatasetItem.expectedTrajectory?: readonly ToolCallSpec[]` (and optional per-step notes). Default `toItem` in `datasetFromRuns` does **not** invent one from production tool calls (untrusted). Host `toItem` may copy a human-graded path from feedback metadata.

**Why host benefits.** Golden-path tests without abusing `expected` (which remains the *outcome* gold). Matches agentevals + τ² “actions are one reference, not the only correct path” — `subset`/`superset` modes encode that.

**Use cases.** Regulated flow “KYC then transfer”; coding “read before write”; customer-support “search KB before escalate.”

#### R-E5 — Step-scoped evaluation records (P1)

**What.** Additive optional `EvaluationRecord.stepId?` / `nodeId?`. `scoreRun` can run a scorer per matching step (`forEach: "tool" | "workflow_node"`) with a frozen cap (e.g. 32 step-scores per run) so a 200-tool run cannot explode storage.

**Why host benefits.** Component-level eval: “retriever step faithfulness” vs “whole run.” Cockpit can badge the failing node.

**Use cases.** RAG: score each `retrieval` equivalent; workflow: score only the `commit` node; find which tool step started failing after a prompt change.

#### R-E6 — Workflow experiments (P1)

**What.** `runWorkflowExperiment({ workflow, dataset, scorers, runOptions, … })` mirrors `runExperiment` but calls `runWorkflow` / host `runner(item)`. Timeline projected from workflow events + final checkpoint. Same concurrency caps, ownership, redaction, `assertEvaluationThreshold`.

**Why host benefits.** Hosts whose product *is* a workflow (research DAG, ERP saga, coding goal-verify) cannot use `runExperiment` today without a fake agent wrapper.

**Use cases.** CI on `createCodingGoalVerifyWorkflow`; compare workflow revision `2026-09-01` vs `2026-09-14`; saga compensation path fixtures.

#### R-E12 — Multi-turn scenarios, repeated trials, approval-before-effect, release manifests (P1; absorbed from original completeness R07 / former 0.6.1 Task 15)

**What.** Keep single-run `runExperiment` compatible. Add opt-in:

- `runScenario` (or `runExperiment` scenario options): multi-turn including clarification and refusal; host-scripted user turns; bounded event/turn caps.
- `createApprovalBeforeEffectScorer`: 0 unless the matching approval/decision appears on the timeline *before* the effect/tool step (missing/stale approval fails).
- Controlled failure injection at scorer/runner seams (store failure, denied tool, unknown effect) so hosts can fixture those outcomes without mutating production.
- Repeated trials: `trials` count, recorded seed/config, sample count and named uncertainty method on the report. One trial must not be described as a statistical guarantee.
- Eval manifest: frozen binding of prompt, tools, skills, model, policy, runtime, and dataset revisions. Corrupt/missing required fields fail closed. Hard invariant scorers (forbidden tool, approval-before-effect, environment 0/1) **cannot be averaged away** by a high text-quality score.

Inspector quality/cost/latency **comparison UI** stays in plan 073 Task 15 (inspector package). This plan exports the report + `summarizeTimeline` those views consume.

**Why host benefits.** Completeness R07: a correct answer after a forbidden action is a failed release, not a high average. Manifests make prompt/tool/policy drift visible.

**Use cases.** CI gate on “never `shell` before approval”; clarify-then-refuse personal-assistant scenario; three-seed latency band on a golden set; bind `prompt@v3` + `policy@p2` into the evidence artifact.

#### R-E7 — Judge-over-timeline (P1)

**What.** `createModelJudge` already receives `target.trace`. Pass `target.timeline` (projected, policy `redacted_io`, byte-capped) instead of dumping raw events into the rubric. Keep host callback; do not add a provider dependency.

**Why host benefits.** Judges see a readable step list; cheaper and more stable than raw event JSON; still no credentials/tools in the judge.

**Use cases.** “Was this trajectory reasonable?” without a golden path; plan-adherence rubrics.

#### R-E8 — Dataset store (P2, defer unless Task 1 says hosts have no durable golden-set seam)

**What.** Optional `DatasetStore` mirroring `PromptStore`: immutable versions, ownership, cursor list, memory + SQLite/Postgres. Only if frozen `defineDataset` + host git files are proven insufficient.

**Why host benefits.** Production-to-eval flywheel with tenant-scoped durable goldens, not JSON in the repo.

**Use cases.** Multi-tenant eval consoles; shared golden sets across services.

**Ponytail:** skip in v1 if examples + `datasetFromRuns` + git-versioned JSON cover it. Record the decision in Task 1.

#### R-E9 — Experiment persistence (P2, skip)

`serializeEvaluationReport` is the artifact. Hosts put it in CI logs / object storage. Do **not** add `ExperimentStore`.

#### R-E10 — Failure clustering / Trace Intelligence (skip)

Mastra/LangSmith cluster traces with embeddings. That is a hosted product. Hosts can embed timeline summaries themselves. Out of scope.

#### R-E11 — Online drift product (skip)

`scoreRunLive` + OTel `prism.run.evaluation` metrics are enough. Alerting lives in the host’s Grafana/PagerDuty.

---

### Observability / cockpit requirements

#### R-O1 — Cockpit aggregations from a timeline (P0)

**What.** `summarizeTimeline(timeline)` →

```ts
interface TimelineSummary {
  readonly durationMs: number;
  readonly turnCount: number;
  readonly toolCallCount: number;
  readonly toolCounts: Readonly<Record<string, number>>; // names only, bounded cardinality (cap distinct tools)
  readonly providerAttempts: number;
  readonly usage?: Usage; // run_total
  readonly cost?: { amount: number; currency: string };
  readonly errorCount: number;
  readonly blockedToolCount: number;
  readonly suspended: boolean;
  readonly status: string;
}
```

Hard-cap distinct tool names (e.g. 64) + `other`. Never put free-text into the summary.

**Why host benefits.** Dashboard cards without re-walking events. SLO burn charts. Cost attribution per run/session.

**Use cases.** “Tokens and $ this session”; “top tools this week” (host rolls up summaries); “p95 duration by workflow id.”

#### R-O2 — Session / conversation grouping (P1)

**What.** `projectSessionTimelines(sessionId, traces[])` or document that `sessionId` is the `group_id`. Optional helper `summarizeSession(timelines[])` summing usage and concatenating steps with run separators.

**Why host benefits.** Cockpits are usually conversation-scoped, not single-`runId`. OpenAI Agents SDK `group_id` is this.

**Use cases.** Multi-turn support thread; coding session with several `session.run` calls; HITL resume as a second run on the same session.

#### R-O3 — Workflow OpenTelemetry (P1)

**What.** Map `WorkflowEvent` onto existing `PrismTracer`:

| Event | Span |
| --- | --- |
| `workflow_started` / `workflow_finished` | `invoke_workflow {workflowId}` (`INTERNAL`) |
| `node_started` / `node_finished`/`failed`/`skipped` | `prism.workflow.node {nodeId}` child |
| `node_iteration_*` | events on the node span, or child spans capped by `maxIterations` |
| `agent_event` | existing agent instrumentation when the host also attached the session |

Low-card labels: `workflowId` (host must treat ids as controlled vocabulary), node *kind*, status. Not `runId` on metrics.

**Why host benefits.** DAG runs show up next to LLM/tool spans in the APM the host already pays for. No new backend.

**Use cases.** Grafana Tempo waterfall of research DAG; Datadog GenAI; Langfuse OTLP ingest.

#### R-O4 — Sampling helper (P2)

**What.** Document + tiny `shouldSampleTrace({ rate, random, forceOnError })` consistent with eval `sampleRate`. Do not add Mastra-style always/never/custom config objects unless Task 1 finds a real duplication.

**Why host benefits.** Production timeline persistence can be expensive; errors should still record.

**Use cases.** 1% of happy path, 100% of `failed`/`suspended`.

#### R-O5 — OpenInference mapper (P2, demand-gated)

**What.** Optional mapper `timelineToOpenInferenceAttributes` or span-kind tags. Only if a host backend needs OpenInference and cannot read `gen_ai.*`. Phoenix already normalizes `gen_ai.*` → OpenInference at ingest.

**Why host benefits.** Phoenix/Arize without dual instrumentation.

**Use cases.** ML platform team already on Phoenix.

**Ponytail:** skip until a host asks. OTel GenAI is the Prism bet (already shipped).

#### R-O6 — Embeddable inspector / React cockpit (skip)

Host builds UI. Prism may add an **example** (static HTML or `examples/observability-cockpit.ts` that prints timeline JSON). Not a package of React components. No React Flow dependency.

#### R-O7 — Query language over traces (skip)

Postgres/SQLite `queryEvents` + host SQL is enough. No BTQL.

---

### Workflow graphics requirements

#### R-G1 — `WorkflowGraphView` JSON (P0)

**What.** Pure function `serializeWorkflowGraph(workflow): WorkflowGraphView`:

```ts
interface WorkflowGraphNode {
  readonly id: string;
  readonly kind: WorkflowNodeKind;
  readonly label: string;          // id, or metadata.title if present
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
```

Stable sort by node id / edge `(from,to)`. Functions (`when`, `execute`) are **not** serialized (they are code). Conditional `then`/`else` successor sets become `kind: "then" | "else"` edges; if both omitted, keep `always` on declared `workflow.edges`.

**Why host benefits.** Drop into React Flow, Cytoscape, internal design-system canvas, docs generators, or an ERP “process view” without executing the workflow or shipping JS closures.

**Use cases.** In-app “this is the approval DAG”; architecture docs; customer “what will the agent do?” before they hit Run; PM review of node kinds.

#### R-G2 — Mermaid and Graphviz DOT exporters (P0)

**What.** `workflowGraphToMermaid(view)` and `workflowGraphToDot(view)` — deterministic strings, no deps. Node shapes by kind (agent/tool/loop/conditional). Escape labels (no XSS in Mermaid). Cap nodes at existing `maxNodes`.

**Why host benefits.** GitHub/GitLab render Mermaid in READMEs; many hosts already have Mermaid in-product; DOT feeds Graphviz server-side SVG if they want images without a JS canvas.

**Use cases.** `README` of a workflow package; Notion/wiki embed; email a DOT SVG of last night’s failed run overlay.

#### R-G3 — Run overlay `WorkflowGraphRunView` (P0)

**What.** `projectWorkflowGraphRun(view, checkpoint | timeline)` adds per-node:

```ts
interface WorkflowGraphNodeRunState {
  readonly status: WorkflowNodeStatus;
  readonly durationMs?: number;
  readonly attempt?: number;
  readonly errorCode?: string | number;
  readonly skippedReason?: string;
}
```

Plus `activeNodeIds`, `runStatus`, `runId`. Overlay must not copy node outputs (those live on the timeline under content policy).

**Why host benefits.** Cockpit paints the DAG with green/red/grey without a second data model. Live: fold `WorkflowEvent` status; replay: checkpoint.

**Use cases.** Ops “where is this stuck”; HITL “paused on `approve_refund`”; postmortem “skipped the notify node.”

#### R-G4 — Live overlay from `onEvent` (P1)

**What.** `createWorkflowGraphRunFolder(view)` with `push(event)` updating node statuses incrementally.

**Why host benefits.** SSE/WebSocket cockpit without reloading checkpoints every event.

**Use cases.** Support tool watching a long research DAG; coding goal-verify progress.

#### R-G5 — Nested workflow drill-down (P1)

**What.** `nestedWorkflowId` on nodes of kind `workflow`; helper `collectWorkflowGraphs(root)` returns a map of graphs. Overlay correlates child `runId` from checkpoint node `runId`.

**Why host benefits.** Multi-agent / nested DAGs (supervisor + specialists) render as linked graphs, not one flat lie.

**Use cases.** Hierarchical crew recipe (plan 048); nested `workflowNode`.

#### R-G6 — Visual authoring / Studio (skip)

No canvas editor, no drag-drop, no hot-reload IDE. Hosts that want authoring consume `WorkflowGraphView` and compile *back* to their own `defineWorkflow` — out of Prism scope.

#### R-G7 — draw.io / mxGraph export (skip)

Wrong package, XSS/XXE surface, no benefit over Mermaid/JSON.

---

### Cross-cutting requirements

#### R-X1 — Fail-closed security (P0)

- Ownership on every resolve (same as `createPersistenceTraceResolver`).
- Redactor before any I/O field.
- No credentials, raw headers, or unredacted tool args in default timelines.
- Metric labels remain low-cardinality.
- Graph exporters escape labels; treat node ids as host-controlled but still escape.

#### R-X2 — Bounds (P0)

Reuse eval/workflow frozen caps: timeline max steps (default 1,000 / hard 10,000), per-step I/O bytes (default 16 KiB / hard 256 KiB), total timeline bytes (default 4 MiB / hard 32 MiB), mermaid/dot max chars. Exceed → typed error, no silent truncate of *structure* (truncating I/O strings is allowed with a flag).

#### R-X3 — Compat (P0)

All additions additive. `scoreRun` without `projectTimeline` remains byte-identical. `buildGraph` stays. No new required agent config. Explicit activation.

#### R-X4 — Docs + example host cockpit (P0)

Public API pages for timeline, graph, new scorers. One example: fold live events → timeline JSON → summary; serialize a workflow → Mermaid; `runExperiment` with `createToolCallMatchScorer`. No UI framework.

#### R-X5 — AG-UI mapping (P2)

Optional later: emit richer AG-UI steps from timeline kinds. Not required to reach the objective (hosts consume JSON directly).

---

## Suggestions (author)

1. **One projection, two products.** Do not invent an “eval trace” and a “cockpit trace.” `ExecutionTimeline` is both. Evals that need gold paths read `steps`; UIs that need waterfalls read `steps`.
2. **Copy LangGraph4j `/init`, not LangGraph Studio.** Mermaid + JSON + overlay. The IDE features (edit state, time-travel) already have runtime verbs (`resumeWorkflow`, `replayWorkflow`, checkpoints) — expose data, not a debugger chrome.
3. **Copy `agentevals` match modes, not DeepEval’s 50 metrics.** Match modes are finite and testable. Metric zoos rot and pull model judges into CI.
4. **Copy τ²’s split: environment vs actions.** R-E3 is more important than another LLM judge. ERP hosts already proved this with `createErpInvariantScorers`.
5. **Do not default-on tracing** (OpenAI Agents SDK does). Prism’s explicit activation is a feature for ZDR/enterprise. Keep it.
6. **Do not ship React Flow.** Hosts already have design systems. A JSON graph is the integration; a component would fight them.
7. **Dev inspector as the proof, not the product.** After projectors exist, the inspector *could* call them (optional follow-up) so loopback UI and production host UI share folding code. Nice, not required.
8. **DatasetStore is probably YAGNI.** Golden sets live in git for CI; `datasetFromRuns` produces the next version in memory; hosts who need multi-tenant goldens already have Postgres. Revisit if a host eval console needs ownership-scoped dataset APIs.
9. **Skip OpenInference in v1.** Prism already emits OTel GenAI; Phoenix maps it. Dual conventions are how 2024–2025 fragmented.
10. **Workflow `node_finished` I/O:** prefer projector-joins-checkpoint over bloating every event. Live I/O can read `getWorkflowRun` on `node_finished` or include optional redacted output on iteration events only (already there). If live cockpits without checkpoint access are a real host, add opt-in `includeNodeOutput` on the event bus later — do not change the default event size.

---

## Tasks

- [x] Task 1 — Primitive Review: Timeline, Graph, Eval, Observability Inventory
  - Acceptance Criteria:
    - Functional: inventory `AgentEvent` union, `EvaluationTrace` / `createPersistenceTraceResolver`, `scoreRun`/`runExperiment`/`defineDataset`/`createModelJudge`, `RunLedger`/`AgentEventSource`, OTel adapter + `createProviderCapture`, `WorkflowEvent` + `WorkflowCheckpointValue` + `buildGraph`, AG-UI step mapping, dev-inspector timeline folding. Record: which host needs are already possible by composition; which require *one* new projector vs new stores; DatasetStore yes/no; whether workflow events must grow I/O fields. Freeze the `ExecutionTimeline` / `WorkflowGraphView` field lists against this catalog (R-T1, R-G1).
    - Performance: confirm folding 1k events + 1k tool rows stays inside existing eval trace envelope (4 MiB default / 32 MiB hard) and inspector windowing (400 rows) rationale.
    - Code Quality: no new package unless Task 1 proves evals + workflows + observability cannot share types without a cyclic import; prefer types in evals or a tiny `governance/observability` export consumed by both.
    - Security: confirm default metadata-only; redactor order; ownership on persistence projectors; mermaid XSS; secrets never become metric labels.
  - Approach:
    - Documentation Reviewed:
      - `docs/evaluations.md`, `docs/observability.md`, `docs/runs-and-usage.md`, `docs/agent-events.md`, `docs/workflows.md`, `docs/dev-inspector.md`, `docs/diagrams.md`, `docs/index.md`
      - `packages/prism-core/src/governance/evals/{types,score,trace,experiment,curate,index}.ts`
      - `packages/prism-core/src/governance/observability/instrumentation.ts`
      - `packages/prism-core/src/runtime/workflows/{types,define,events}.ts`
      - `src/contracts-run-state.ts` (`AgentRunResult`), `src/run-ledger.ts`, `src/feedback.ts`
      - OTel GenAI agent/client spans; OpenInference README; LangSmith trajectory evals; DeepEval trajectory evals; Mastra tracing overview; OpenAI Agents SDK tracing; τ²-bench `docs/evaluation.md`
      - Product boundaries in `roadmap.md`
    - Options Considered:
      - Hosted cockpit package (React): rejected — product boundary; hosts own UI.
      - Reuse `@arnilo/prism-office/diagrams`: rejected — draw.io/mxGraph, not workflow DAGs.
      - Promote dev inspector to production embed: rejected — loopback-only, not an API.
      - Dual models (eval trace vs UI trace): rejected — one `ExecutionTimeline`.
      - New `@arnilo/prism-timeline` package: only if import cycles force it; otherwise colocate projectors with observability and import from evals.
    - Chosen Approach:
      - Record the inventory and freeze schemas in `docs/_evidence/phase72-primitive-review.md`. Implementation tasks may not add stores or UI packages this review rejected.
    - API Notes and Examples:
      ```ts
      // Decision record only this task — no production export yet.
      // Expected freeze:
      // ExecutionTimeline.schemaVersion = 1
      // WorkflowGraphView.schemaVersion = 1
      // content policy: "metadata" | "redacted_io" | "full_io"
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase72-primitive-review.md`: inventory, decisions, frozen field lists, DatasetStore yes/no, scenario/trial/manifest shapes (R-E12), R07/R15 ownership vs plan 073.
      - `plans/072-Host-Eval-And-Observability-Cockpit.md`: completion notes for this task.
    - References:
      - This plan’s Research Findings and Requirements Catalog.
      - Plans 040 (inspector), 042 (prompt registry), 043 (datasetFromRuns), 027 (ERP invariant scorers).
  - Test Cases to Write:
    - None (read-only). Decisions must name the files/tests later tasks add.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — review only.
    - Docs pages to create/edit: none (`docs/_evidence/` is not an index entry).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Notes:
    - Evidence document created: `docs/_evidence/phase72-primitive-review.md`. 13 sections covering full inventory, frozen schemas, and all decisions.
    - Inventoried: 32 `AgentEvent` variants, `EvaluationTrace` + resolver, `ScorerInput` + `scoreRun`/`runExperiment`/`defineDataset`/`createModelJudge`, `RunLedger`/`AgentEventSource` (5 backends), OTel adapter (5 span types, no workflow spans), `createProviderCapture` (3 policy modes), 13 `WorkflowEvent` variants, `WorkflowCheckpointValue`/`WorkflowNodeCheckpoint`, `buildGraph` (Maps, not JSON), AG-UI step mapping (turn-scoped only), dev-inspector folding (composition-only, not reusable).
    - Already possible by composition: final-output scoring, LLM-as-judge, pairwise, agent experiments, feedback, online scoring, agent OTel.
    - Requires one new projector (not stores): `ExecutionTimeline` projection, `WorkflowGraphView` serialization, cockpit aggregations, Mermaid/DOT export, trajectory scorer helpers.
    - Key decisions: DatasetStore → **skip v1**; ExperimentStore → **skip**; workflow event I/O → **keep projector-joins-checkpoint** (no event schema change); new package → **not needed** (no import cycles); inspector → **new projector** (inspector data model too simple); OpenInference → **skip**; trial hard cap → 16; forEach step-score cap → 32/128.
    - Frozen schemas: `ExecutionTimeline.schemaVersion = 1`, `WorkflowGraphView.schemaVersion = 1`, content policy `"metadata" | "redacted_io" | "full_io"`.
    - Bounds confirmed: 1k events fold to ~200–400 KiB at metadata, within 4 MiB default trace envelope. 32 MiB hard cap accommodates redacted_io with explicit opt-in.
    - Security confirmed: default metadata-only; redactor runs before I/O; ownership on persistence projectors via existing trace resolver; mermaid XSS via label escaping; graph overlay carries no node outputs.
    - Import cycle analysis: no cross-imports between evals/observability/workflows. Timeline types in `governance/observability/timeline-types.ts`, consumed by evals one-way.

- [x] Task 2 — `ExecutionTimeline` contract and projectors (R-T1, R-T2, R-T3, R-T4, R-X1, R-X2)
  - Acceptance Criteria:
    - Functional: export `projectAgentTimeline`, `projectTraceTimeline`, `projectWorkflowTimeline`, `createTimelineFolder` producing `ExecutionTimeline` with stable `order`, `parentId` tree, run-level `input`/`result` under content policy, `redacted` flag, optional `traceId`. Workflow projector joins checkpoint node outputs when provided; without checkpoint, steps exist with metadata only. Unknown event types ignored, not thrown.
    - Performance: 1,000 agent events + 256 tool calls fold p95 within existing eval trace envelope; folder `push` is amortized O(1) per event aside from I/O redact; default max steps 1,000.
    - Code Quality: no `any`; frozen types; projectors are pure besides redactor calls; colocated per Task 1 decision.
    - Security: default `metadata` omits prompts/args/results/node payloads; `redacted_io`/`full_io` always run `SecretRedactor`; oversize I/O truncated or omitted with flag; ownership not applicable on live fold (caller already authorized) but persistence path documents it uses already-scoped traces.
  - Approach:
    - Documentation Reviewed: Task 1 evidence; `docs/agent-events.md`; `docs/observability.md` capture policy; workflow checkpoint shapes.
    - Options Considered:
      - Mutate `AgentEvent` to carry a canonical step shape: rejected — events stay the log; timeline is a projection.
      - Put I/O on every `WorkflowEvent`: rejected as default (size); join checkpoint instead.
    - Chosen Approach:
      - Fold existing events/records. Content policy copied from provider-capture vocabulary so hosts learn one enum.
    - API Notes and Examples:
      ```ts
      const timeline = projectTraceTimeline(trace, { content: "redacted_io", redactor });
      // timeline.steps.map(s => [s.order, s.kind, s.name, s.status])
      const folder = createTimelineFolder({ content: "metadata" });
      for await (const event of session.subscribe()) folder.push(event);
      const live = folder.snapshot();
      ```
    - Files to Create/Edit (tentative until Task 1 freeze):
      - `packages/prism-core/src/governance/observability/timeline.ts` (or evals, per Task 1)
      - `packages/prism-core/src/governance/observability/timeline-types.ts`
      - `packages/prism-core/src/governance/observability/index.ts`
      - `packages/prism-core/src/governance/observability/__tests__/timeline.test.ts`
      - `docs/execution-timeline.md` (new)
      - `docs/observability.md`, `docs/evaluations.md`, `docs/index.md`
    - References: R-T1–R-T4; inspector folding as behavioral oracle, not a dependency.
  - Test Cases to Write:
    - Agent run with 2 turns, 1 tool: order `run/turn/provider/tool/turn/provider`, parentIds correct, default no args.
    - `redacted_io` includes redacted tool args; secret string absent.
    - Persistence trace round-trip equals live fold for the same events (order + kinds + names).
    - Workflow: 2-node DAG, checkpoint outputs appear only with checkpoint + `redacted_io`.
    - Bounds: 1,001st step fails closed with `ERR_PRISM_TIMELINE_BOUNDS`.
    - Incremental folder snapshot matches one-shot project.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new exported projector types/functions.
    - Docs pages to create/edit:
      - `docs/execution-timeline.md`: full API page (What / When / Inputs / Outputs / examples / security).
      - `docs/observability.md`: link timeline as the cockpit projection.
      - `docs/evaluations.md`: link timeline as scorer input (details in Task 3).
    - `docs/index.md` update: yes — Agent/session runtime (or Observability) entry: “Execution timeline projection for host cockpits and trajectory evals.”
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Notes:
    - Created `packages/prism-core/src/governance/observability/timeline-types.ts` — frozen types: `ExecutionTimeline`, `ExecutionStep`, `ExecutionStepKind` (13 kinds), `ExecutionStepStatus` (8 statuses), `TimelineContentPolicy` (`"metadata" | "redacted_io" | "full_io"`), `TimelineProjectionOptions`, `WorkflowTimelineProjectionOptions`, `TimelineFolder`, `WorkflowTimelineFolder`.
    - Created `packages/prism-core/src/governance/observability/timeline.ts` — 5 public functions: `projectAgentTimeline`, `projectTraceTimeline`, `projectWorkflowTimeline`, `createTimelineFolder`, `createWorkflowTimelineFolder`. Plus `TimelineError` class with `ERR_PRISM_TIMELINE_BOUNDS`.
    - Updated `packages/prism-core/src/governance/observability/index.ts` — barrel re-exports all new types and functions.
    - Created `packages/prism-core/src/governance/observability/__tests__/timeline.test.ts` — 12 tests, all passing:
      1. Agent run with 2 turns, 1 tool: order/parentIds/default no args ✅
      2. `redacted_io` includes redacted tool args; secret string absent ✅
      3. Persistence trace round-trip matches live fold (order + kinds + names) ✅
      4. Workflow: 2-node DAG, checkpoint outputs appear only with checkpoint + `redacted_io` ✅
      5. 1,001st step fails closed with `ERR_PRISM_TIMELINE_BOUNDS` ✅
      6. Incremental folder snapshot matches one-shot project ✅
      7. Unknown event types are ignored, not thrown ✅
      8. Workflow timeline folder matches one-shot project ✅
      9. traceId forwarded to timeline ✅
      10. Guardrail decision creates a step ✅
      11. Delegation event creates a step ✅
      12. maxSteps validation rejects invalid values ✅
    - Created `docs/execution-timeline.md` — full API page with What/When/Inputs/Outputs/Examples/Bounds/Security.
    - Updated `docs/observability.md` — linked timeline in APIs list and Related APIs section.
    - Updated `docs/evaluations.md` — linked timeline as scorer input in Related APIs.
    - Updated `docs/index.md` — added "Execution timeline" entry under Agent/session runtime.
    - All 26 observability tests pass (14 existing + 12 new). Clean `tsc --noEmit`. No new dependencies.

- [x] Task 3 — Workflow graph view-model, Mermaid, DOT, run overlay (R-G1, R-G2, R-G3, R-G4, R-G5)
  - Acceptance Criteria:
    - Functional: `serializeWorkflowGraph`, `workflowGraphToMermaid`, `workflowGraphToDot`, `projectWorkflowGraphRun`, `createWorkflowGraphRunFolder` exported from workflows package. Conditional then/else edges distinguished. Loop/nested metadata present. Overlay statuses match checkpoint + events. Nested `collectWorkflowGraphs` returns child graphs by id. Deterministic strings across runs.
    - Performance: 1,000-node graph serialize + mermaid within workflow define envelope; folder push O(1) per event.
    - Code Quality: no layout algorithm (hosts layout); no React; escaping for Mermaid/DOT special chars; functions/closures never serialized.
    - Security: labels escaped; no node output in graph overlay; definitionHash is the existing hash, not a new algorithm.
  - Approach:
    - Documentation Reviewed: `docs/workflows.md`; `buildGraph` in `define.ts`; LangGraph4j `/init` mermaid pattern.
    - Options Considered:
      - React Flow JSON with positions: rejected — layout is host CSS/canvas.
      - SVG generator: rejected — Mermaid/DOT cover image/docs; JSON covers apps.
    - Chosen Approach:
      - Data-only graph + two text exporters + overlay folder.
    - API Notes and Examples:
      ```ts
      const view = serializeWorkflowGraph(workflow);
      const mermaid = workflowGraphToMermaid(view);
      const overlay = projectWorkflowGraphRun(view, checkpoint);
      // host: render overlay.nodes + overlay.edges in their canvas
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/runtime/workflows/graph.ts`
      - `packages/prism-core/src/runtime/workflows/graph-export.ts`
      - `packages/prism-core/src/runtime/workflows/index.ts`
      - `packages/prism-core/src/runtime/workflows/__tests__/graph.test.ts`
      - `docs/workflows.md` (graph export section)
      - `docs/execution-timeline.md` (link overlay vs timeline I/O)
      - `docs/index.md`
    - References: R-G1–R-G5; `hashWorkflowDefinition`.
  - Test Cases to Write:
    - Linear 2-node: mermaid contains both ids and one arrow; DOT parseable-enough (quoted ids).
    - Conditional then/else: two edge kinds; skipped node `skipped` on overlay.
    - Loop node: `loop.maxIterations` on view; iteration events do not duplicate graph nodes.
    - Nested workflow: `nestedWorkflowId` set; `collectWorkflowGraphs` size 2.
    - Label with quotes/`-->` escaped in mermaid.
    - Overlay live folder: `node_started` → running; `node_failed` → failed + errorCode.
    - Byte-identical mermaid for shuffled `nodes` record insertion (sort).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new workflow exports.
    - Docs pages to create/edit: `docs/workflows.md` (What it does table + graph section with JSON/Mermaid examples); `docs/index.md` Workflows blurb extended with graph export.
    - `docs/index.md` update: yes — “typed DAG orchestration plus serializable graph/Mermaid overlay for host UIs.”
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Notes:
    - Created `packages/prism-core/src/runtime/workflows/graph.ts` — `serializeWorkflowGraph`, `collectWorkflowGraphs`, `projectWorkflowGraphRun`, `createWorkflowGraphRunFolder`, and types (`WorkflowGraphView`, `WorkflowGraphNode`, `WorkflowGraphEdge`, `WorkflowGraphRunView`, `WorkflowGraphRunNode`, `WorkflowGraphNodeRunState`, `WorkflowGraphRunFolder`).
    - Created `packages/prism-core/src/runtime/workflows/graph-export.ts` — `workflowGraphToMermaid` and `workflowGraphToDot` with shape assignments by node kind, label escaping (`#quot;`, `#lt;`, `#gt;`, `<br/>`), and deterministic sorting.
    - Updated `packages/prism-core/src/runtime/workflows/index.ts` — exported all graph serialization, export, and overlay APIs.
    - Created `packages/prism-core/src/runtime/workflows/__tests__/graph.test.ts` — 9 tests covering:
      1. Linear 2-node: Mermaid arrow + DOT quoted IDs ✅
      2. Conditional then/else edges + skipped node in checkpoint overlay ✅
      3. Loop node metadata (`loop.maxIterations`) + iteration events without DAG node duplication ✅
      4. Nested workflow (`nestedWorkflowId`) + `collectWorkflowGraphs` size 2 ✅
      5. Labels with quotes and `-->` safely escaped in Mermaid and DOT ✅
      6. Live folder: `node_started` -> running, `node_failed` -> failed + errorCode ✅
      7. Byte-identical Mermaid and DOT outputs across shuffled node insertion orders ✅
      8. Boundary limit `maxNodes` rejection with `WorkflowDefinitionError` ✅
      9. Overlay projection from `ExecutionTimeline` source ✅
    - Updated `docs/workflows.md` — added exports table entries and dedicated `## Graph serialization, Mermaid, DOT, and run overlay` section.
    - Updated `docs/execution-timeline.md` — linked graph overlay vs timeline I/O in Related APIs.
    - Updated `docs/index.md` — updated Workflows description to "typed DAG orchestration plus serializable graph/Mermaid overlay for host UIs."
    - All 133 workflow tests and 21 graph/timeline tests pass. Zero build errors or regressions.

- [x] Task 4 — Trajectory and outcome eval primitives (R-E1, R-E2, R-E3, R-E7, R-E12 scorers)
  - Acceptance Criteria:
    - Functional: `ScorerInput.timeline` and `ScorerInput.environment` additive. `scoreRun`/`runExperiment` option `timeline?: "off" | "metadata" | "redacted_io"` projects via Task 2 when not `off` (default `off`). Helpers `createToolCallMatchScorer`, `createStepBudgetScorer`, `createNoLoopScorer`, `createSchemaScorer`, `createErrorClassScorer`, `createApprovalBeforeEffectScorer` exported. Required/forbidden/ordered actions are `createToolCallMatchScorer` modes (strict/unordered/subset/superset) plus an optional deny-list. `createModelJudge` request includes `target.timeline` when projection enabled. Environment is host-supplied only. Hard invariant scorers return independent 0/1 results that `runExperiment` aggregates cannot average away.
    - Performance: match scorer O(steps + expected) with expected cap (default 64 / hard 256 calls); experiment cost dominated by agent runs, not scorers; network-free helpers.
    - Code Quality: helpers implemented as `defineScorer` factories; no extra packages; reuse `createJsonSchemaArgumentValidator` or existing schema check, do not add AJV.
    - Security: timeline passed to judges is already redacted; environment not logged by Prism; match scorer compares names/args after redaction (hosts who need arg match must opt into `redacted_io`).
  - Approach:
    - Documentation Reviewed: `docs/evaluations.md`; `agentevals` match modes; τ² environment evaluator; ERP invariant scorers.
    - Options Considered:
      - New `TrajectoryScorer` interface: rejected — ordinary `Scorer` + timeline field.
      - Bundle Ragas/DeepEval: rejected — deps + metric zoo.
    - Chosen Approach:
      - Additive scorer input + factories (including approval-before-effect) + judge target field. No second evaluator platform.
    - API Notes and Examples:
      ```ts
      const scorers = [
        createToolCallMatchScorer({ id: "path", mode: "superset", expected: [{ name: "search_kb" }] }),
        createStepBudgetScorer({ id: "budget", maxToolCalls: 8, maxDurationMs: 30_000 }),
        defineScorer({
          id: "ticket-closed",
          score: ({ environment }) => ({ score: environment?.status === "closed" ? 1 : 0 }),
        }),
      ];
      await runExperiment({ agent, dataset, scorers, timeline: "redacted_io", toEnvironment: async (item) => hostLoadTicket(item.id) });
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/governance/evals/types.ts`
      - `packages/prism-core/src/governance/evals/score.ts`
      - `packages/prism-core/src/governance/evals/experiment.ts`
      - `packages/prism-core/src/governance/evals/trajectory.ts`
      - `packages/prism-core/src/governance/evals/judge.ts`
      - `packages/prism-core/src/governance/evals/index.ts`
      - `packages/prism-core/src/governance/evals/__tests__/trajectory.test.ts`
      - `docs/evaluations.md`, `docs/execution-timeline.md`, `docs/index.md`
    - References: R-E1–R-E3, R-E7, R-E12 scorers; `erp-invariants.ts` as outcome-scorer precedent. Original completeness Task 15 ACs for required/forbidden/ordered actions and approval-before-effect live here.
  - Test Cases to Write:
    - strict match pass/fail; unordered; subset (extra tool fails); superset (extra tool ok).
    - good answer after forbidden tool → invariant 0, text scorer may still be 1; aggregate must not pass the invariant.
    - required ordering; missing/stale approval-before-effect → 0.
    - budget: over maxToolCalls → 0 with reason.
    - loop: three identical tool+args → 0.
    - environment scorer sees host object, not model text.
    - default `timeline: "off"` experiment JSON comparable to pre-change fixture (no timeline field required).
    - judge request contains `target.timeline` only when enabled; still no tools/credentials.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — scorer input + new factories + experiment option.
    - Docs pages to create/edit: `docs/evaluations.md` (trajectory/outcome sections, API table rows); `docs/execution-timeline.md` (eval consumers).
    - `docs/index.md` update: yes — Evaluations blurb: “trajectory/outcome scorers over execution timelines.”
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Notes:
    - Updated `packages/prism-core/src/governance/evals/types.ts`: added `timeline` and `environment` to `ScorerInput`, `timeline` to `EvaluationTarget`, `timeline`, `injectedTimeline`, and `environment` to `ScoreRunOptions`, `timeline` and `toEnvironment` to `RunExperimentOptions`, `invariantsPassed` to `ExperimentAggregate`, and `requireInvariants` to `EvaluationThresholds`.
    - Created `packages/prism-core/src/governance/evals/trajectory.ts`: implemented `createToolCallMatchScorer` (supporting `strict`, `unordered`, `subset`, `superset` and forbidden `deny` list), `createStepBudgetScorer` (turn, tool, duration, token, cost ceilings), `createNoLoopScorer` (detecting repetitive tool burst loops), `createSchemaScorer` (reusing `createJsonSchemaArgumentValidator`), `createErrorClassScorer` (denied error codes/blocked reasons), and `createApprovalBeforeEffectScorer` (HITL/guardrail prior approval enforcement).
    - Updated `packages/prism-core/src/governance/evals/judge.ts`: passed `target.timeline` to model judge request when projected, preserving absence of tools/credentials.
    - Updated `packages/prism-core/src/governance/evals/score.ts`: projected timeline from persistence trace when requested, forwarding `timeline` and `environment` to scorers and evaluation records.
    - Updated `packages/prism-core/src/governance/evals/experiment.ts`: subscribed and captured session timeline when `timeline !== "off"`, evaluated host `toEnvironment`, and computed `invariantsPassed` in `aggregateEvaluations`.
    - Updated `packages/prism-core/src/governance/evals/threshold.ts`: enforced that failing hard invariants reject CI threshold assertions regardless of high mean scores.
    - Updated `packages/prism-core/src/governance/evals/index.ts`: exported all trajectory scorers, options, and limits.
    - Created `packages/prism-core/src/governance/evals/__tests__/trajectory.test.ts`: 10 comprehensive tests covering strict/unordered/subset/superset match, forbidden tool invariant failing threshold, approval-before-effect ordering, budget limits, loop detection, environment scorers, default timeline off backward compatibility, judge timeline inclusion, schema validation, and error class scorers.
    - Updated `docs/evaluations.md`: added trajectory scorer table entries, dedicated `## Trajectory and outcome scoring` section, and invariant threshold docs.
    - Updated `docs/index.md`: updated Evaluations blurb to reflect trajectory/outcome scorers.
    - All 39 evals tests and 172 package-wide tests pass. Clean compile, no regressions.

- [x] Task 5 — Dataset expected trajectories, workflow experiments, scenarios, trials, manifests (R-E4, R-E5, R-E6, R-E12)
  - Completed:
    - Extended `DatasetItem` with optional `expectedTrajectory?: readonly ToolCallSpec[]` and ensured `defineDataset` freezes it recursively. Verified `datasetFromRuns` default `toItem` never fills it.
    - Added step-scoped scoring to `scoreRun`: `forEach: "tool" | "workflow_node"` and `maxStepScores` (default 32, hard max 128) populating `EvaluationRecord.stepId` and `nodeId`.
    - Created `runWorkflowExperiment` in `packages/prism-core/src/governance/evals/workflow-experiment.ts`: adapts items to workflow input, collects events via `createWorkflowEventBus`, loads checkpoints, projects `ExecutionTimeline` via `projectWorkflowTimeline`, and scores runs with `scoreRun` producing an `ExperimentReport` compatible with `assertEvaluationThreshold`.
    - Implemented `runScenario` in `packages/prism-core/src/governance/evals/scenarios.ts` supporting scripted multi-turn turns, behavior classifications (e.g. `refuse`, `clarify`), and turn-level assertions.
    - Added `wrapAgentWithFailureInjection` supporting store failure injection and tool execution denial without production mutations.
    - Added repeated-trial execution support via `resolveTrialsConfig` (`trials`, `seed`, `uncertaintyMethod: "standard_error" | "bootstrap"`), producing aggregated trial metrics in `ExperimentReport`.
    - Implemented `validateEvalManifest` and `EvalManifest` schema checking, failing closed on missing or corrupt required provenance fields (`runtimeRevision`, `datasetVersion`, `datasetId`).
    - Added comprehensive unit tests in `workflow-experiment.test.ts` (4 tests) and `scenarios.test.ts` (5 tests), plus updated `trajectory.test.ts` and `timeline.test.ts`. All 40 tests passing.
    - Updated documentation in `docs/evaluations.md`, `docs/prompt-registry.md`, and `docs/index.md`.
  - Acceptance Criteria:
    - Functional: `DatasetItem.expectedTrajectory` optional, frozen with the dataset. `datasetFromRuns` default `toItem` never fills it. `EvaluationRecord.stepId?`/`nodeId?` additive; `scoreRun({ forEach: "tool", maxStepScores })` emits ≤ cap records. `runWorkflowExperiment` runs `runWorkflow` (or host `runner`) per item, projects workflow timeline, scores, same aggregates/thresholds. `runScenario` (or opt-in experiment scenario options) covers multi-turn clarification/refusal with host-scripted turns. Repeated trials record seed, sample count, and named uncertainty method. Eval manifest binds prompt, tools, skills, model, policy, runtime, dataset revisions and fails closed on corrupt/missing required fields. Failure injection fixtures cover store failure and unknown effect without production mutation. Hard invariant failures cannot be averaged away.
    - Performance: `forEach` cap default 32 / hard 128; workflow experiment concurrency same 1–32 as `runExperiment`; 50-item workflow experiment within existing experiment envelope on mock nodes; trial count default 1 / hard cap recorded in Task 1 (small offline fixture stays in current test envelope); live judge costs explicitly charged (no silent unpaid judge).
    - Code Quality: reuse `runExperiment` internals (`mapPool`, `scoreRun`) rather than a second scheduler; workflow runner injected; `scenarios.ts` stays next to `experiment.ts`; no ExperimentStore (R-E9).
    - Security: workflow checkpoints/timelines redacted; ownership forwarded; no cross-tenant dataset items; step records do not copy tool payloads (ids only + score); privacy-redacted evaluation datasets; untrusted traces/judge output bounded.
  - Approach:
    - Documentation Reviewed: `dataset.ts`, `curate.ts`, `experiment.ts`, `docs/workflows.md`, `docs/prompt-registry.md`; Google ADK trajectory criteria and Salesforce Testing API are precedents, not dependencies.
    - Options Considered:
      - Force hosts to wrap workflows in `createAgent`: rejected — that is today’s pain.
      - ExperimentStore: rejected (R-E9).
      - New evaluator platform: rejected — bounded scenario/trial extension of current experiments.
    - Chosen Approach:
      - Additive dataset field; bounded forEach; thin `runWorkflowExperiment`; opt-in scenario runner + trials + manifest on the existing experiment report.
    - API Notes and Examples:
      ```ts
      await runWorkflowExperiment({
        workflow,
        dataset,
        scorers: [createToolCallMatchScorer({ id: "n", mode: "subset", expected: [] })],
        checkpoints: createMemoryWorkflowCheckpoints(),
        timeline: "metadata",
      });
      await runExperiment({
        agent, dataset, scorers, trials: 3, seed: 1,
        manifest: { promptId, toolFingerprint, policyRevision, runtimeRevision, datasetVersion },
      });
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/governance/evals/types.ts`
      - `packages/prism-core/src/governance/evals/dataset.ts`
      - `packages/prism-core/src/governance/evals/curate.ts`
      - `packages/prism-core/src/governance/evals/score.ts`
      - `packages/prism-core/src/governance/evals/workflow-experiment.ts`
      - `packages/prism-core/src/governance/evals/scenarios.ts` (proposed; original completeness Task 15 file)
      - `packages/prism-core/src/governance/evals/index.ts`
      - `packages/prism-core/src/governance/evals/__tests__/workflow-experiment.test.ts`
      - `packages/prism-core/src/governance/evals/__tests__/scenarios.test.ts` (proposed)
      - `docs/evaluations.md`, `docs/prompt-registry.md`, `docs/index.md`
    - References: R-E4–R-E6, R-E12; original completeness Task 15 files `scenarios.ts` / experiment options.
  - Test Cases to Write:
    - defineDataset freezes expectedTrajectory; duplicate item ids still fail.
    - datasetFromRuns default items have no expectedTrajectory.
    - forEach tool: 3 tools → 3 records with stepIds; 40 tools + max 32 → 32 scored + no throw (or explicit skip remainder — pick one in Task 1 and test it).
    - workflow experiment: functionNode DAG, scorer reads timeline.workflowId and node steps.
    - threshold helper works on workflow report.
    - clarify/refuse multi-turn scenario; store-failure injection; unknown-effect injection; deterministic seeds; repeated-trial aggregate with sample count; corrupt manifest fails closed; cost limit cancels judge; redaction.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — dataset shape, evaluation records, workflow experiment helper, scenario/trial/manifest options.
    - Docs pages to create/edit: `docs/evaluations.md` (dataset field, forEach, workflow experiments, scenarios, trials, manifests); `docs/prompt-registry.md` (manifest binds prompt versions).
    - `docs/index.md` update: yes — Evaluations blurb includes workflow experiments, scenarios, and manifests if not already covered in Task 4.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6 — Cockpit aggregations, session summary, workflow OTel (R-O1, R-O2, R-O3, R-T4)
  - Acceptance Criteria:
    - Functional: `summarizeTimeline` / `summarizeSession` exported. Tool name cardinality capped. `createOpenTelemetryInstrumentation` (or sibling `attachWorkflow`) maps workflow start/finish/node events; does not break existing agent span tests. Timeline `traceId` filled from `onTraceReference` when host passes the instrumentation handle.
    - Performance: summary O(steps); OTel disabled remains zero-alloc on the workflow path when not attached; enabled overhead stays under documented 5% excluding exporter.
    - Code Quality: reuse `PrismTracer`/`PrismMeter`; no new OTel dependency; workflow attach is explicit (`telemetry.attachWorkflow(bus)` or `onEvent` hook).
    - Security: summary has no payloads; metric labels low-card (kind, status, token type); workflowId only if host treats it as controlled — document that unbounded unique workflow ids must not be metric labels (use span attributes).
  - Approach:
    - Documentation Reviewed: `docs/observability.md`; OTel `invoke_workflow` conventions; instrumentation.ts agent mapping.
    - Options Considered:
      - Auto-attach workflows via runWorkflow: rejected — explicit activation.
      - OpenInference mapper: deferred (R-O5).
    - Chosen Approach:
      - Summary helpers over timeline; optional workflow OTel attach parallel to `attachSession`.
    - API Notes and Examples:
      ```ts
      const summary = summarizeTimeline(timeline);
      const detach = telemetry.attachWorkflow(bus); // explicit
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/governance/observability/summary.ts`
      - `packages/prism-core/src/governance/observability/instrumentation.ts`
      - `packages/prism-core/src/governance/observability/index.ts`
      - `packages/prism-core/src/governance/observability/__tests__/summary.test.ts`
      - `packages/prism-core/src/governance/observability/__tests__/instrumentation.test.ts`
      - `docs/observability.md`, `docs/execution-timeline.md`, `docs/index.md`
    - References: R-O1–R-O3; existing `handleEvaluation` isolation (exporter errors must not fail the workflow).
  - Test Cases to Write:
    - summary toolCounts caps at 64 + `other`.
    - session summary sums two runs’ tokens, does not double-count `run_total`+`provider_turn`.
    - workflow OTel: start/finish + 2 node spans, parent/child; exporter throw does not fail `runWorkflow`.
    - disabled tracer: no spans recorded.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — summary helpers + workflow attach.
    - Docs pages to create/edit: `docs/observability.md` (summary table, workflow span tree); `docs/execution-timeline.md`.
    - `docs/index.md` update: yes — Observability blurb includes workflow spans and timeline summaries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Notes:
    - Created `packages/prism-core/src/governance/observability/summary.ts`:
      - `TimelineSummary` and `SessionSummary` interfaces with bounded tool counts, token usage, cost, error/suspension counts, and status rollups.
      - `summarizeTimeline` and `summarizeSession` functions.
      - Cardinality guard: `MAX_SUMMARY_DISTINCT_TOOLS = 64`, lowest frequency tools overflow into `"other"`.
      - Token double-counting guard: draws from root `run_total` (or aggregates `turn`/`provider` steps when absent). Rounds cost to 6 decimals to avoid IEEE-754 drift.
    - Updated `packages/prism-core/src/governance/observability/timeline-types.ts` & `timeline.ts`:
      - Added `instrumentation?: { traceId(runId: string): string | undefined }` to `TimelineProjectionOptions`.
      - `buildTimeline` and `buildWorkflowTimeline` auto-resolve `traceId` from options or the instrumentation handle.
    - Updated `packages/prism-core/src/governance/observability/instrumentation.ts`:
      - Added `handleWorkflowEvent(event)` and `attachWorkflow(bus)` to `OpenTelemetryInstrumentation`.
      - Maps `workflow_started`/`workflow_finished` to `invoke_workflow {workflowId}` (`INTERNAL`) span and records `prism.workflow.duration` histogram.
      - Maps `node_started`/`node_finished`/`failed`/`skipped` to `prism.workflow.node {nodeId}` (`INTERNAL`) child spans.
      - Attaches `node_iteration_started`/`finished` events to active node spans.
      - Isolated exporter error handling via `safe()` and `onExporterError`.
      - Zero-alloc when telemetry is disabled (`enabled: false`).
    - Updated `packages/prism-core/src/governance/observability/index.ts`:
      - Exported `summarizeTimeline`, `summarizeSession`, `TimelineSummary`, `SessionSummary`, `MAX_SUMMARY_DISTINCT_TOOLS`, `addUsage`, and `capToolCounts`.
    - Created `packages/prism-core/src/governance/observability/__tests__/summary.test.ts`:
      - 5 test cases: tool count capping (64 + other), session summary token summation without double-counting, workflow OTel hierarchy & exporter throw isolation, disabled tracer no-ops, and timeline traceId resolution via instrumentation handle.
    - Updated documentation:
      - `docs/observability.md`: APIs list, `attachWorkflow` usage, workflow mapping table, `## Cockpit aggregations and session summaries` section, and low-cardinality metric guidance.
      - `docs/execution-timeline.md`: APIs list, `TimelineProjectionOptions.instrumentation` handle, and cockpit rollup notes.
      - `docs/index.md`: updated Observability and Execution timeline entries.
    - Test verification: 153/153 docs tests pass, 31/31 observability unit tests pass, full suite (564 tests) passing. Clean build and typecheck.

- [x] Task 7 — Host examples, docs closeout (R-X4). Inspector comparison UI is plan 073 Task 15.
  - Acceptance Criteria:
    - Functional: `examples/execution-timeline.ts` runs offline with mock provider: prints timeline JSON + summary + Mermaid for a 2-node workflow. `examples/behavior-evaluation.ts` (original completeness Task 15 example) runs a forbidden-tool + approval-before-effect + repeated-trial fixture network-free. Docs pages complete per prism-wiki API structure. `docs/index.md` entries live. Optional: dev inspector uses `projectAgentTimeline` internally **only if** it is a delete-code refactor (same UI); otherwise leave inspector folding to 073 Task 15. Do not ship inspector quality/cost/latency comparison here.
    - Performance: example finishes inside existing example envelope.
    - Code Quality: example is copy-paste host wiring, not a framework.
    - Security: example uses `content: "metadata"` by default; comments show how to opt into `redacted_io`.
  - Approach:
    - Documentation Reviewed: `examples/evals.ts`, `examples/evaluation-gate.ts`, `docs/index.md`, prism-wiki.md.
    - Options Considered:
      - New React example app: rejected.
      - Force inspector refactor: only if it deletes duplicated folding.
    - Chosen Approach:
      - Docs + one example is the host integration kit.
    - API Notes and Examples:
      ```ts
      import { projectAgentTimeline, summarizeTimeline } from "@arnilo/prism-core/governance/observability";
      import { serializeWorkflowGraph, workflowGraphToMermaid } from "@arnilo/prism-core/runtime/workflows";
      ```
    - Files to Create/Edit:
      - `examples/execution-timeline.ts`
      - `examples/behavior-evaluation.ts` (primitive fixtures; plan 073 Task 15 adds host-journey cases to this file or a sibling)
      - `docs/execution-timeline.md`, `docs/evaluations.md`, `docs/observability.md`, `docs/workflows.md`, `docs/index.md`
      - `src/__tests__/docs.test.ts` if it asserts index/export names
    - References: R-X4; examples/evals.ts style; original completeness Task 15 example name preserved.
  - Test Cases to Write:
    - Example files typecheck; docs.test includes new exports/pages if that suite lists them.
    - Index entries: Execution timeline; evaluations/observability/workflows blurbs updated.
    - behavior-evaluation example: forbidden tool fails invariant; manifest present; trials sample count visible.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API (docs/examples of Tasks 2–6). Yes if inspector refactor changes behavior — avoid behavior change.
    - Docs pages to create/edit: finalize all pages listed above.
    - `docs/index.md` update: yes if any blurb still stale.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Notes:
    - Created `examples/execution-timeline.ts`:
      - 2-node workflow (extractor agentNode + analyze functionNode) run with mock provider.
      - Projects `ExecutionTimeline` via `projectWorkflowTimeline` with `content: "metadata"` default.
      - Summarizes timeline via `summarizeTimeline`.
      - Serializes DAG via `serializeWorkflowGraph` and renders Mermaid via `workflowGraphToMermaid`.
      - Computes graph run overlay via `projectWorkflowGraphRun`.
      - Demonstrates live streaming timeline fold via `createTimelineFolder` alongside agent session.
    - Created `examples/behavior-evaluation.ts`:
      - Dynamic mock provider executing compliant (approval -> write) and destructive (drop database) tool paths.
      - Evaluates trajectory invariants: `createToolCallMatchScorer` (deny `drop_database`, `invariant: true`), `createApprovalBeforeEffectScorer` (`write_record`), and `createStepBudgetScorer`.
      - Audited with `validateEvalManifest` and executed over 3 repeated trials via `runExperiment`.
      - Demonstrates fail-closed invariant assertion (`assertEvaluationThreshold` throwing `EvalThresholdError` when invariant fails).
    - Updated `examples/README.md`: listed both new examples in the runnable commands list and files directory.
    - Updated `docs/execution-timeline.md` and `docs/evaluations.md`: referenced the new runnable host examples.
    - Verified: `npx tsc -p examples/tsconfig.json` compiles cleanly; `dist/__tests__/docs.test.js` passes 153/153 tests; both examples run to completion network-free.

## Compromises Made

- **Inspector folding integration**: Kept dev inspector (`packages/prism-coding-tools/src/dev/ui/inspector.ts`) as a standalone, zero-runtime-dependency browser bundle served verbatim at `/assets/inspector.js`. Importing `projectAgentTimeline` directly into the client-side bundle would require a browser-facing bundle build or pulling node-targeted runtime imports into the browser module. Full inspector comparison UI deferred to Plan 073 Task 15.
- **Dynamic workflow I/O retention**: Retained `content: "metadata"` as the default for `projectWorkflowTimeline` and `projectAgentTimeline`. Step payloads and checkpoint outputs are only attached when `content: "redacted_io"` or `"full_io"` is explicitly requested and a redactor is supplied.

## Further Actions

- **Plan 073 Task 15 (Inspector Comparison UI)**: Build the inspector quality/cost/latency comparison UI and host-journey evaluation fixtures over the new trajectory and graph primitives.
- **R-E8 (DatasetStore)**: Demand-gated persistence store for multi-tenant versioned evaluation datasets if host consoles require dynamic CRUD beyond immutable code/Git manifests.
- **R-O5 (OpenInference Mapper)**: Optional mapper `timelineToOpenInferenceAttributes` if hosts report integration needs with collectors that cannot directly consume OpenTelemetry GenAI semantic conventions.
- **R-X5 (AG-UI richer steps)**: Optional adapter mapping `ExecutionStepKind` to enhanced AG-UI client steps for advanced rich web cockpit visualizers.
