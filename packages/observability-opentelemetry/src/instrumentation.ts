import type { AgentEvent, AgentSession } from "@arnilo/prism";

export type PrismSpanStatus = "ok" | "error";

export interface PrismSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(code: PrismSpanStatus, message?: string): void;
  end(): void;
}

export interface PrismTracer {
  startSpan(name: string, options?: { readonly attributes?: Readonly<Record<string, string | number | boolean>> }): PrismSpan;
}

export interface PrismCounter {
  add(value: number, attributes?: Readonly<Record<string, string>>): void;
}

export interface PrismHistogram {
  record(value: number, attributes?: Readonly<Record<string, string>>): void;
}

export interface PrismMeter {
  createCounter(name: string, options?: { readonly description?: string }): PrismCounter;
  createHistogram(name: string, options?: { readonly description?: string; readonly unit?: string }): PrismHistogram;
}

export interface OpenTelemetryInstrumentationOptions {
  readonly enabled?: boolean;
  readonly tracer?: PrismTracer;
  readonly meter?: PrismMeter;
  readonly onExporterError?: (error: unknown) => void;
}

export interface OpenTelemetryInstrumentation {
  readonly enabled: boolean;
  handleAgentEvent(event: AgentEvent): void;
  attachSession(session: Pick<AgentSession, "subscribe">): () => void;
}

export interface RecordedSpan {
  readonly name: string;
  readonly attributes: Record<string, string | number | boolean>;
  readonly status?: { readonly code: PrismSpanStatus; readonly message?: string };
  readonly ended: boolean;
}

interface MutableRecordedSpan {
  name: string;
  attributes: Record<string, string | number | boolean>;
  status?: { code: PrismSpanStatus; message?: string };
  ended: boolean;
}

export interface RecordedMetric {
  readonly name: string;
  readonly kind: "counter" | "histogram";
  readonly value: number;
  readonly attributes: Record<string, string>;
}

export interface InMemoryTelemetry {
  readonly tracer: PrismTracer;
  readonly meter: PrismMeter;
  readonly spans: readonly RecordedSpan[];
  readonly metrics: readonly RecordedMetric[];
  clear(): void;
}

type SpanKey = string;

function spanKey(...parts: (string | number)[]): SpanKey {
  return parts.join(":");
}

function metricAttrs(attrs: Record<string, string>): Record<string, string> {
  return attrs;
}

export function createInMemoryTelemetry(): InMemoryTelemetry {
  const spans: MutableRecordedSpan[] = [];
  const metrics: RecordedMetric[] = [];

  const tracer: PrismTracer = {
    startSpan(name, options) {
      const record: MutableRecordedSpan = { name, attributes: { ...(options?.attributes ?? {}) }, ended: false };
      spans.push(record);
      return {
        setAttribute(key, value) {
          record.attributes[key] = value;
        },
        setStatus(code, message) {
          record.status = { code, message };
        },
        end() {
          record.ended = true;
        },
      };
    },
  };

  const meter: PrismMeter = {
    createCounter(name) {
      return {
        add(value, attributes) {
          metrics.push({ name, kind: "counter", value, attributes: { ...(attributes ?? {}) } });
        },
      };
    },
    createHistogram(name) {
      return {
        record(value, attributes) {
          metrics.push({ name, kind: "histogram", value, attributes: { ...(attributes ?? {}) } });
        },
      };
    },
  };

  return {
    tracer,
    meter,
    get spans() {
      return spans;
    },
    get metrics() {
      return metrics;
    },
    clear() {
      spans.length = 0;
      metrics.length = 0;
    },
  };
}

export function createOpenTelemetryInstrumentation(options: OpenTelemetryInstrumentationOptions = {}): OpenTelemetryInstrumentation {
  const enabled = options.enabled !== false && Boolean(options.tracer ?? options.meter);
  const onExporterError = options.onExporterError ?? (() => {});
  const tracer = options.tracer;
  const meter = options.meter;

  const providerDuration = meter?.createHistogram("prism.provider.turn.duration_ms", {
    description: "Provider turn latency",
    unit: "ms",
  });
  const toolDuration = meter?.createHistogram("prism.tool.execution.duration_ms", {
    description: "Tool execution latency",
    unit: "ms",
  });
  const tokenCounter = meter?.createCounter("prism.provider.tokens", { description: "Provider token usage" });

  const activeSpans = new Map<SpanKey, PrismSpan>();

  const safe = (fn: () => void) => {
    if (!enabled) return;
    try {
      fn();
    } catch (error) {
      onExporterError(error);
    }
  };

  const endSpan = (key: SpanKey, status: PrismSpanStatus, message?: string) => {
    const span = activeSpans.get(key);
    if (!span) return;
    span.setStatus(status, message);
    span.end();
    activeSpans.delete(key);
  };

  const handleAgentEvent = (event: AgentEvent) => {
    if (!enabled) return;

    switch (event.type) {
      case "agent_started":
        safe(() => {
          if (!tracer) return;
          const key = spanKey("agent", event.runId);
          activeSpans.set(
            key,
            tracer.startSpan("prism.agent.run", {
              attributes: {
                "prism.session_id": event.sessionId,
                "prism.run_id": event.runId,
              },
            }),
          );
        });
        break;
      case "agent_finished":
        safe(() => {
          endSpan(spanKey("agent", event.runId), "ok");
          if (!event.usage || !tokenCounter) return;
          tokenCounter.add(event.usage.inputTokens ?? 0, metricAttrs({ kind: "input", scope: "agent" }));
          tokenCounter.add(event.usage.outputTokens ?? 0, metricAttrs({ kind: "output", scope: "agent" }));
        });
        break;
      case "provider_turn_started":
        safe(() => {
          if (!tracer) return;
          const attempt = event.metadata.attempt ?? 1;
          const key = spanKey("provider", event.runId, event.turn, attempt);
          activeSpans.set(
            key,
            tracer.startSpan("prism.provider.turn", {
              attributes: {
                "prism.session_id": event.sessionId,
                "prism.run_id": event.runId,
                "prism.turn": event.turn,
                "prism.provider_id": event.metadata.providerId,
                "prism.model": event.metadata.model.model,
                ...(event.metadata.requestId ? { "prism.request_id": event.metadata.requestId } : {}),
                ...(event.metadata.attempt ? { "prism.attempt": event.metadata.attempt } : {}),
              },
            }),
          );
        });
        break;
      case "provider_turn_finished":
        safe(() => {
          const attempt = event.metadata.attempt ?? 1;
          const key = spanKey("provider", event.runId, event.turn, attempt);
          const span = activeSpans.get(key);
          if (span) {
            if (event.metadata.latencyMs !== undefined) span.setAttribute("prism.latency_ms", event.metadata.latencyMs);
            if (event.metadata.httpStatus !== undefined) span.setAttribute("http.status_code", event.metadata.httpStatus);
            if (event.error) span.setStatus("error", event.error.message);
            else span.setStatus("ok");
            span.end();
            activeSpans.delete(key);
          }
          providerDuration?.record(event.metadata.latencyMs ?? 0, metricAttrs({
            provider_id: event.metadata.providerId,
            outcome: event.error ? "error" : "success",
          }));
          if (!event.usage || !tokenCounter) return;
          tokenCounter.add(event.usage.inputTokens ?? 0, metricAttrs({ provider_id: event.metadata.providerId, kind: "input" }));
          tokenCounter.add(event.usage.outputTokens ?? 0, metricAttrs({ provider_id: event.metadata.providerId, kind: "output" }));
          if (event.usage.cacheReadTokens) {
            tokenCounter.add(event.usage.cacheReadTokens, metricAttrs({ provider_id: event.metadata.providerId, kind: "cache_read" }));
          }
          if (event.usage.cacheWriteTokens) {
            tokenCounter.add(event.usage.cacheWriteTokens, metricAttrs({ provider_id: event.metadata.providerId, kind: "cache_write" }));
          }
        });
        break;
      case "tool_execution_started":
        safe(() => {
          if (!tracer) return;
          const key = spanKey("tool", event.call.id);
          activeSpans.set(
            key,
            tracer.startSpan("prism.tool.execute", {
              attributes: {
                "prism.session_id": event.sessionId,
                "prism.run_id": event.runId,
                "prism.tool_call_id": event.call.id,
                "prism.tool_name": event.call.name,
              },
            }),
          );
        });
        break;
      case "tool_execution_finished":
      case "tool_execution_error":
      case "tool_execution_blocked":
        safe(() => {
          const toolCallId =
            event.type === "tool_execution_finished"
              ? event.result.toolCallId
              : event.type === "tool_execution_error"
                ? event.call.id
                : event.toolCallId;
          const key = spanKey("tool", toolCallId);
          const span = activeSpans.get(key);
          if (span) {
            span.setAttribute("prism.tool_status", event.metadata.status);
            span.setAttribute("prism.duration_ms", event.metadata.durationMs);
            if (event.type === "tool_execution_finished") span.setStatus("ok");
            else span.setStatus("error", event.error.message);
            span.end();
            activeSpans.delete(key);
          }
          toolDuration?.record(event.metadata.durationMs, metricAttrs({ status: event.metadata.status }));
        });
        break;
      default:
        break;
    }
  };

  return {
    enabled,
    handleAgentEvent,
    attachSession(session) {
      if (!enabled) return () => {};
      const subscription = session.subscribe();
      const iterator = subscription[Symbol.asyncIterator]();
      let active = true;
      void (async () => {
        try {
          while (active) {
            const next = await iterator.next();
            if (next.done) break;
            handleAgentEvent(next.value);
          }
        } catch {
          // subscriber closed
        }
      })();
      return () => {
        active = false;
        void iterator.return?.();
      };
    },
  };
}

interface OpenTelemetrySpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: { code: number; message?: string }): void;
  end(): void;
}

interface OpenTelemetryTracer {
  startSpan(name: string, options?: { attributes?: Record<string, string | number | boolean> }): OpenTelemetrySpan;
}

interface OpenTelemetryCounter {
  add(value: number, attributes?: Record<string, string>): void;
}

interface OpenTelemetryHistogram {
  record(value: number, attributes?: Record<string, string>): void;
}

interface OpenTelemetryMeter {
  createCounter(name: string, options?: { description?: string }): OpenTelemetryCounter;
  createHistogram(name: string, options?: { description?: string; unit?: string }): OpenTelemetryHistogram;
}

const OTEL_STATUS_OK = 1;
const OTEL_STATUS_ERROR = 2;

export function wrapOpenTelemetryApi(tracer: OpenTelemetryTracer, meter?: OpenTelemetryMeter): { tracer: PrismTracer; meter?: PrismMeter } {
  return {
    tracer: {
      startSpan(name, options) {
        const span = tracer.startSpan(name, options);
        return {
          setAttribute(key, value) {
            span.setAttribute(key, value);
          },
          setStatus(code, message) {
            span.setStatus({ code: code === "ok" ? OTEL_STATUS_OK : OTEL_STATUS_ERROR, message });
          },
          end() {
            span.end();
          },
        };
      },
    },
    meter: meter
      ? {
          createCounter(name, options) {
            const counter = meter.createCounter(name, options);
            return { add: (value, attributes) => counter.add(value, attributes) };
          },
          createHistogram(name, options) {
            const histogram = meter.createHistogram(name, options);
            return { record: (value, attributes) => histogram.record(value, attributes) };
          },
        }
      : undefined,
  };
}
