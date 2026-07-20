# @arnilo/prism-observability-opentelemetry

Optional OpenTelemetry bridge for Prism `AgentEvent` streams. Core Prism emits metadata-only provider and tool timing events; this package maps them to spans and low-cardinality metrics without pulling OpenTelemetry into `@arnilo/prism`.

## Install

```bash
npm install @arnilo/prism @arnilo/prism-observability-opentelemetry @opentelemetry/api
```

`@opentelemetry/api` is an optional peer dependency. Pass mockable `PrismTracer` / `PrismMeter` interfaces when you want tests without the OpenTelemetry SDK.

## Usage

```ts
import { trace, metrics } from "@opentelemetry/api";
import { createOpenTelemetryInstrumentation, wrapOpenTelemetryApi } from "@arnilo/prism-observability-opentelemetry";

const { tracer, meter } = wrapOpenTelemetryApi(
  trace.getTracer("my-app"), metrics.getMeter("my-app"), { context, trace },
);
const telemetry = createOpenTelemetryInstrumentation({ tracer, meter });

const detach = telemetry.attachSession(session);
await session.run("hello");
detach();
```

Or handle events from an existing subscriber:

```ts
for await (const event of session.subscribe()) telemetry.handleAgentEvent(event);
```

Set `enabled: false` or omit both `tracer` and `meter` for a no-op adapter.

## Defaults

- OTel GenAI hierarchy: `invoke_agent prism` parents `chat {model}`, `execute_tool {tool}`, guardrail, and explicit delegation spans.
- Metadata-only spans: no prompts, tool arguments/results, evaluation explanations, or credentials.
- High-cardinality IDs (`sessionId`, `runId`, `requestId`, `toolCallId`) are span attributes, not metric labels.
- Metric labels are limited to `provider_id`, `outcome`, `status`, token `kind`, and feedback rating bucket/link presence; comments, tags, and linked IDs never become labels.
- `handleRunFeedback()` / `handleEvaluation()` add safe scalar metadata; evaluations use `gen_ai.evaluation.result`.
- `onTraceReference` or bounded `traceId(runId)` links existing evaluation records without persisting OTel objects.
- GenAI duration/token instruments use seconds/tokens and controlled labels; token usage is recorded once per provider operation.
- Run errors and detach close attributable outstanding spans exactly once.
- Exporter failures are isolated: instrumentation catches errors and forwards them to `onExporterError` without affecting the run.

## Profile inclusion

This optional package is installed by `@arnilo/prism-sdk` and `@arnilo/prism-all`. Installation does not enable instrumentation; hosts still provide and configure telemetry APIs/exporters.

## Related

- [Observability](../../docs/observability.md)
- [Agent events](../../docs/agent-events.md)
