# @arnilo/prism-observability

OpenTelemetry spans and metrics for `@arnilo/prism`, built from the agent event catalog with observe handlers.

## No phone-home

The package builds no exporter, opens no socket, and reads no `OTEL_*` variable. It takes `trace.getTracer(serviceName)` and `metrics.getMeter(serviceName)` from the global `@opentelemetry/api`. The host registers its own SDK and exporter first. With no tracer provider registered, the OTel API's no-op tracer makes this package a no-op. With `@opentelemetry/api` not installed, it adds a `warn` status note (see `agent.inspect()`) and registers nothing.

## Install

```bash
prism add @arnilo/prism-observability
bun add @opentelemetry/api   # optional peer; add your SDK + exporter in host code
```

```ts
import observability from "@arnilo/prism-observability";
import { createAgent } from "@arnilo/prism";

// host: register an OpenTelemetry SDK tracer provider with its own exporter first
const agent = await createAgent({
  model: "mock/main",
  packages: [mockProvider(), observability({ serviceName: "billing-agent" })],
});
```

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `serviceName` | `string` | `"prism"` | Name passed to `getTracer` and `getMeter`. |
| `content` | `"none" \| "metadata"` | `"none"` | `none` adds no model-derived attributes. `metadata` adds token counts and the stop reason to chat spans. Message text is never an attribute. |
| `fieldPolicy` | `{ drop?: string[]; hash?: string[] }` | none | Attribute paths (exact, or a prefix ending in `*`) to drop or replace with a token. |
| `metrics` | `boolean` | `true` | Record duration and token-usage histograms. |
| `enabled` | `boolean` | `true` | `false` registers nothing. |

## Spans and metrics

`invoke_agent` (run) > `chat <model>` (turn attempt) > `execute_tool <name>` (tool call), plus `prism.guardrail.evaluate`. `delegate.step`, `router.decision`, and `mcp.status` package events become span events on the run span, with bounded scalar fields only. Tool arguments are never attributes.

When an event carries `origin`, every span it opens also carries `prism.origin.agent`, `.vendor`, `.profile`, `.executed_by`, `.delegation_id`, and `.subagent_id` (the names are `ORIGIN_ATTRIBUTES`). Values are bounded to 128 characters; `profile` is kept only when it is a plain name (no path separators, `~`, or spaces) and is never a credential or home path. The `fieldPolicy` drop and hash rules apply to these attributes like any other, and no message text becomes an attribute.

`createWorkflowInstrumentation` parents each child agent's `invoke_agent` span on its workflow node span (matched by the child's session id from the `agent_event` that wraps its `run.started`), so one trace covers a whole workflow run. Hand the workflow's merged events to `handleWorkflowEvent`/`attachWorkflow`; a child instrumented only on its own agent still starts its own trace.

The timeline projectors stamp each step with `origin` and add `byOrigin`: steps grouped by agent, then sub-agent. A group with `executedBy: "external"` has `observed: true`: Prism watched that work, it did not execute it.

A host decision on a gated tool call is a `hitl` step. `run.suspended` opens one step per pending decision, `status: "suspended"`, with `metadata.toolCallId`, `toolName`, and `guardrail`; `decision.resolved` settles each matching step to `approved` or `denied` and records `metadata.via` (`inline` or `resume`). A decision whose suspension this timeline never saw — an inline answer, or a durable resume over a fresh timeline — adds a settled step before the tool runs. Decision steps carry the call id, the outcome, and `via` only, never the tool arguments.

`handleDelegation` takes the delegation lifecycle (`started` / `finished` / `error` / `rejected`) with the child's `origin` and opens one `prism.agent.delegate` child span under the parent run, attributed with the same `ORIGIN_ATTRIBUTES`.

## Evaluation telemetry

A host holding a `createOpenTelemetryInstrumentation()` instance can connect evals with
this structural adapter (no helper or exporter registration is needed):

```ts
import type { EvaluationTelemetry } from "@arnilo/prism-observability";
const telemetry = { handleEvaluation: (e: EvaluationTelemetry) => instrumentation.handleEvaluation(e) };
// Pass telemetry to scoreRun, scoreRunLive, runExperiment, or runScenario.
```

`handleEvaluation` emits `gen_ai.evaluation.result` with the evaluation name, status,
optional numeric score, and `hasReason` only. Reasons and model content never become
attributes. If the run has ended, it emits a finished standalone span; metrics use only
status labels. A simulator failure before a run uses its evaluation record id for standalone
correlation. Package setup keeps its instrumentation private: use a host-held instance for
this adapter. This does not register an SDK/exporter or require a kernel event.

## Cost

Observe handlers are never awaited. `message.delta` is not observed. Each event costs one span operation or one metric record. `@opentelemetry/api` loads only when this package is listed.

## Library surface

`createOpenTelemetryInstrumentation`, `wrapOpenTelemetryApi`, and `createInMemoryTelemetry` stay exported for hosts that drive spans themselves. The workflow spans (`createWorkflowInstrumentation`), the execution timeline (`createTimelineFolder`, `createWorkflowTimelineFolder`, `projectAgentTimeline`, `projectTraceTimeline`, `projectWorkflowTimeline`), the summaries (`summarizeTimeline`, `summarizeSession`), and the RAG telemetry seam (`createRagTelemetry`) moved here from the 0.12 governance observability subpath in plan 168 Task 6. `@arnilo/prism-workflows`, `@arnilo/prism-evals`, and `@arnilo/prism-memory-rag` are type-only references.
