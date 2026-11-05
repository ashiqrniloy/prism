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
| `propagateTraceContext` | `boolean` | `false` | Inject the current span as a W3C `traceparent`/`tracestate` into the outgoing provider request headers, so a gateway can join its spans to this run. |
| `usageMetadata` | `string[]` (≤32 items, each ≤128 chars) | `[]` | Dotted paths into `Usage.metadata` exported as `prism.usage.<path>` on the chat span. An allowlist: nothing is exported unless named, and `fieldPolicy` still applies. |

## Joining a gateway's traces

Nothing is propagated by default. A gateway (LiteLLM, or any proxy that honours W3C trace context) can only
join its spans to yours when the request carries the current trace:

```ts
observability({
  serviceName: "bench",
  content: "metadata",
  propagateTraceContext: true,
  usageMetadata: ["litellm.callId", "litellm.modelId"],
})
```

- **What is sent.** One `model.request` transform writes `traceparent` (and `tracestate` when the propagator
  produces one) through the API's `propagation.inject`; nothing else in the headers is touched, and
  `authorization` is never read or rewritten. The transform runs once per provider attempt and costs no
  request. Without a registered propagator it formats `traceparent` from the span's ids, and a throwing
  propagator falls back the same way instead of failing the run.
- **Which span.** The most recent chat attempt for the run, else the run span (the first `model.request`
  fires before the first chat span opens, so the first header names the run span), else a workflow span.
- **Never overwritten.** A caller-set `traceparent` wins; the transform returns no change rather than
  replacing it, so a host that already propagates keeps its own trace.
- **What comes back.** Point the same `usageMetadata` allowlist at whatever the provider put on
  `Usage.metadata` and the chat span carries `prism.usage.<path>` scalars — for LiteLLM, `usage.metadata.litellm`
  holds `callId`, `modelId`, `modelGroup`, `cost`, and friends (see `@arnilo/prism-provider-litellm`).
  With `content: "none"` no usage attribute is added at all; `fieldPolicy` (`drop`/`hash`) applies to these
  paths like any other attribute, and an object or absent path adds nothing.
- **Pairing with the proxy.** LiteLLM's `otel` callback exports its own spans; with the header above its
  `Received Proxy Server Request` span nests under your chat span AND its `litellm_request` child carries the
  cost headers' values, so a trace shows both sides of the call.

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

`createOpenTelemetryInstrumentation`, `wrapOpenTelemetryApi`, and `createInMemoryTelemetry` stay exported for hosts that drive spans themselves. The workflow spans (`createWorkflowInstrumentation`), the execution timeline (`createTimelineFolder`, `createWorkflowTimelineFolder`, `projectAgentTimeline`, `projectTraceTimeline`, `projectWorkflowTimeline`), the summaries (`summarizeTimeline`, `summarizeSession`), and the RAG telemetry seam (`createRagTelemetry`) moved here from the 0.12 governance observability subpath in plan 168 Task 6. `@arnilo/prism-workflows` and `@arnilo/prism-evals` are type-only references. The RAG telemetry types are declared here structurally, so this package never imports the experimental `@arnilo/prism-memory-rag`; a test asserts that package's `RagTelemetry` stays assignable to them.
