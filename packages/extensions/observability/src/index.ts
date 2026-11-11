/**
 * `@arnilo/prism-extensions/observability` — OpenTelemetry spans and metrics from the agent event catalog, plus the
 * workflow spans, execution timeline, summaries, and RAG telemetry seam that moved here from
 * the 0.12 governance observability subpath (plan 168 Task 6).
 *
 * Observe handlers only. It builds no exporter, opens no socket, and reads no OpenTelemetry environment variable: the host
 * registers its own OpenTelemetry SDK, and with none registered the OTel API's no-op tracer makes this a no-op.
 *
 * ```ts
 * import observability from "@arnilo/prism-extensions/observability";
 * packages: [mockProvider(), observability({ serviceName: "billing-agent" })];
 * ```
 */

import manifest from "../../package.json" with { type: "json" };
import { type AgentEvent, definePackage, type PackageAPI } from "@arnilo/prism";
import { type ObservabilityConfig, observabilityConfigSchema, toFieldPolicy } from "./config.js";
import { createInstrumentationParts, wrapOpenTelemetryApi } from "./instrumentation.js";
import { activeTraceSpan, injectTraceContext } from "./propagation.js";

export {
  type ObservabilityConfig,
  type ObservabilityFieldPolicyConfig,
  observabilityConfigSchema,
  toFieldPolicy,
} from "./config.js";
export {
  activeTraceSpan,
  formatTraceparent,
  injectTraceContext,
  type OpenTelemetryPropagationApi,
  TRACE_CONTEXT_HEADERS,
  type TraceContextApi,
} from "./propagation.js";
export {
  type ActiveSpan,
  createInMemoryTelemetry,
  createInstrumentationParts,
  createOpenTelemetryInstrumentation,
  type DelegationTelemetry,
  type EvaluationTelemetry,
  type InMemoryTelemetry,
  type InstrumentationParts,
  type OpenTelemetryContextApi,
  type OpenTelemetryInstrumentation,
  type OpenTelemetryInstrumentationOptions,
  type OpenTelemetryTraceApi,
  type PrismContext,
  type PrismCounter,
  type PrismHistogram,
  type PrismMeter,
  type PrismSpan,
  type PrismSpanKind,
  type PrismSpanStatus,
  type PrismTracer,
  rawOpenTelemetrySpan,
  type RecordedMetric,
  type RecordedSpan,
  type RunFeedbackTelemetry,
  type SpanTracker,
  spanKey,
  type TelemetryFieldPolicy,
  type TelemetryFieldPolicyDecision,
  type TelemetryFieldPolicyInput,
  type TraceReference,
  wrapOpenTelemetryApi,
} from "./instrumentation.js";

export { ORIGIN_ATTRIBUTES, originAttributes } from "./origin.js";
export type { CreateRagTelemetryOptions } from "./rag-telemetry.js";
export { createRagTelemetry } from "./rag-telemetry.js";

// ─── ExecutionTimeline ────────────────────────────────────────────────────────

export {
  createTimelineFolder,
  createWorkflowTimelineFolder,
  projectAgentTimeline,
  projectTraceTimeline,
  projectWorkflowTimeline,
  TimelineError,
} from "./timeline.js";
export type {
  ExecutionStep,
  ExecutionStepKind,
  ExecutionStepStatus,
  ExecutionTimeline,
  StepOrigin,
  TimelineContentPolicy,
  TimelineOriginGroup,
  TimelineExhaustion,
  TimelineFolder,
  TimelineProjectionOptions,
  TimelineTurn,
  WorkflowTimelineFolder,
  WorkflowTimelineProjectionOptions,
} from "./timeline-types.js";

// ─── Summary / Cockpit Aggregations ──────────────────────────────────────────

export type { SessionSummary, TimelineSummary } from "./summary.js";
export {
  addUsage,
  capToolCounts,
  MAX_SUMMARY_DISTINCT_TOOLS,
  summarizeSession,
  summarizeTimeline,
} from "./summary.js";

// ─── Workflow Spans ──────────────────────────────────────────────────────────

export type { WorkflowInstrumentation } from "./workflow-instrumentation.js";
export { createWorkflowInstrumentation } from "./workflow-instrumentation.js";

const PACKAGE = "@arnilo/prism-extensions/observability";

/** The slice of `@opentelemetry/api` the package uses. */
export interface OpenTelemetryApiModule {
  readonly trace: { getTracer(name: string): unknown; setSpan(context: unknown, span: unknown): unknown };
  readonly metrics: { getMeter(name: string): unknown };
  readonly context: { active(): unknown };
  /** Present on the real API; optional here so a stub without it still works. */
  readonly propagation?: {
    inject?(context: unknown, carrier: Record<string, string>, setter?: unknown): void;
    readonly defaultTextMapSetter?: unknown;
  };
}
export type OpenTelemetryApiLoader = () => Promise<OpenTelemetryApiModule>;

const loadOpenTelemetryApi: OpenTelemetryApiLoader = async () => (await import("@opentelemetry/api" as string)) as OpenTelemetryApiModule;

/** Events the instrumentation maps. `message.delta` is deliberately absent: it is the hot path and carries text. */
const OBSERVED = [
  "run.started",
  "run.completed",
  "run.failed",
  "run.suspended",
  "decision.resolved",
  "turn.started",
  "turn.completed",
  "tool.started",
  "tool.completed",
  "package.event",
] as const;

async function setup(prism: PackageAPI<ObservabilityConfig>, load: OpenTelemetryApiLoader) {
  const config = prism.config;
  if (config.enabled === false) {
    prism.status.note("info", "observability is disabled by config; no hooks registered");
    return;
  }
  let api: OpenTelemetryApiModule;
  try {
    api = await load();
  } catch {
    prism.status.note(
      "warn",
      "@opentelemetry/api is not installed; observability exports nothing. Install it and register an SDK tracer provider.",
    );
    return;
  }
  const serviceName = config.serviceName ?? "prism";
  const wrapped = wrapOpenTelemetryApi(
    api.trace.getTracer(serviceName) as Parameters<typeof wrapOpenTelemetryApi>[0],
    config.metrics === false ? undefined : (api.metrics.getMeter(serviceName) as Parameters<typeof wrapOpenTelemetryApi>[1]),
    { context: api.context, trace: api.trace } as Parameters<typeof wrapOpenTelemetryApi>[2],
  );
  const { instrumentation, tracker } = createInstrumentationParts({
    tracer: wrapped.tracer,
    meter: wrapped.meter,
    fieldPolicy: toFieldPolicy(config.fieldPolicy),
    includeUsage: config.content === "metadata",
    ...(config.usageMetadata ? { usageMetadata: config.usageMetadata } : {}),
    onExporterError: (error) => prism.log.warn("observability exporter error", { error: String(error) }),
  });
  for (const name of OBSERVED) prism.hooks.on(name, ((event: AgentEvent) => instrumentation.handleAgentEvent(event)) as never);
  if (config.propagateTraceContext === true) {
    // One header injection per provider attempt; the transform returns `undefined` (no change) when
    // there is no span or the caller already set `traceparent`.
    prism.hooks.on("model.request", (request, context) =>
      injectTraceContext(request, { span: activeTraceSpan(tracker.active, context.runId), api }),
    );
    prism.status.note("info", "observability: W3C trace context is injected into provider request headers (traceparent, tracestate)");
  }
}

/** Test seam: the same definition with a stubbed `@opentelemetry/api` loader. */
export function createObservabilityDefinition(load: OpenTelemetryApiLoader = loadOpenTelemetryApi) {
  return definePackage<ObservabilityConfig>({
    name: PACKAGE,
    version: manifest.version,
    description: "OpenTelemetry spans and metrics over the agent event catalog. Exports nothing itself: the host registers the SDK.",
    requires: { api: 1 },
    config: observabilityConfigSchema,
    setup: (prism) => setup(prism, load),
  });
}

export default createObservabilityDefinition();
