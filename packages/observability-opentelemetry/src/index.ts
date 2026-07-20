export {
  createInMemoryTelemetry,
  createOpenTelemetryInstrumentation,
  wrapOpenTelemetryApi,
} from "./instrumentation.js";
export type {
  DelegationTelemetry,
  EvaluationTelemetry,
  InMemoryTelemetry,
  OpenTelemetryInstrumentation,
  OpenTelemetryInstrumentationOptions,
  OpenTelemetryContextApi,
  OpenTelemetryTraceApi,
  PrismContext,
  PrismCounter,
  PrismHistogram,
  PrismMeter,
  PrismSpan,
  PrismSpanKind,
  PrismSpanStatus,
  PrismTracer,
  TraceReference,
  RunFeedbackTelemetry,
  RecordedMetric,
  RecordedSpan,
} from "./instrumentation.js";

export const packageName = "@arnilo/prism-observability-opentelemetry";
