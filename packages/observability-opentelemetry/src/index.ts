export type {
  DelegationTelemetry,
  EvaluationTelemetry,
  InMemoryTelemetry,
  OpenTelemetryContextApi,
  OpenTelemetryInstrumentation,
  OpenTelemetryInstrumentationOptions,
  OpenTelemetryTraceApi,
  PrismContext,
  PrismCounter,
  PrismHistogram,
  PrismMeter,
  PrismSpan,
  PrismSpanKind,
  PrismSpanStatus,
  PrismTracer,
  RecordedMetric,
  RecordedSpan,
  RunFeedbackTelemetry,
  TraceReference,
} from "./instrumentation.js";
export {
  createInMemoryTelemetry,
  createOpenTelemetryInstrumentation,
  wrapOpenTelemetryApi,
} from "./instrumentation.js";

export const packageName = "@arnilo/prism-observability-opentelemetry";
