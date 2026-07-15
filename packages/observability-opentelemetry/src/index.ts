export {
  createInMemoryTelemetry,
  createOpenTelemetryInstrumentation,
  wrapOpenTelemetryApi,
} from "./instrumentation.js";
export type {
  InMemoryTelemetry,
  OpenTelemetryInstrumentation,
  OpenTelemetryInstrumentationOptions,
  PrismCounter,
  PrismHistogram,
  PrismMeter,
  PrismSpan,
  PrismSpanStatus,
  PrismTracer,
  RecordedMetric,
  RecordedSpan,
} from "./instrumentation.js";

export const packageName = "@arnilo/prism-observability-opentelemetry";
