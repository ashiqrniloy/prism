export {
  createInMemoryTelemetry,
  createOpenTelemetryInstrumentation,
  wrapOpenTelemetryApi,
} from "./instrumentation.js";
export type {
  EvaluationTelemetry,
  InMemoryTelemetry,
  OpenTelemetryInstrumentation,
  OpenTelemetryInstrumentationOptions,
  PrismCounter,
  PrismHistogram,
  PrismMeter,
  PrismSpan,
  PrismSpanStatus,
  PrismTracer,
  RunFeedbackTelemetry,
  RecordedMetric,
  RecordedSpan,
} from "./instrumentation.js";

export const packageName = "@arnilo/prism-observability-opentelemetry";
