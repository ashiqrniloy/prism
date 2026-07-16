import type { AgentEvent, AgentSession } from "@arnilo/prism";

export type PrismSpanStatus = "ok" | "error";

export interface PrismSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(code: PrismSpanStatus, message?: string): void;
  addEvent?(name: string, attributes?: Readonly<Record<string, string | number | boolean>>): void;
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

export interface RunFeedbackTelemetry {
  readonly runId: string;
  readonly rating?: number;
  readonly hasComment: boolean;
  readonly tagCount: number;
  readonly scorerCount: number;
  readonly evaluationCount: number;
}

export interface EvaluationTelemetry {
  readonly runId: string;
  readonly status: "scored" | "skipped" | "failed";
  readonly score?: number;
  readonly hasReason: boolean;
}

export interface OpenTelemetryInstrumentation {
  readonly enabled: boolean;
  handleAgentEvent(event: AgentEvent): void;
  handleRunFeedback(feedback: RunFeedbackTelemetry): void;
  handleEvaluation(evaluation: EvaluationTelemetry): void;
  attachSession(session: Pick<AgentSession, "id" | "subscribe">): () => void;
}

export interface RecordedSpan {
  readonly name: string;
  readonly attributes: Record<string, string | number | boolean>;
  readonly status?: { readonly code: PrismSpanStatus; readonly message?: string };
  readonly ended: boolean;
  readonly events: readonly { readonly name: string; readonly attributes: Record<string, string | number | boolean> }[];
}

interface MutableRecordedSpan {
  name: string;
  attributes: Record<string, string | number | boolean>;
  status?: { code: PrismSpanStatus; message?: string };
  ended: boolean;
  events: { name: string; attributes: Record<string, string | number | boolean> }[];
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
      const record: MutableRecordedSpan = { name, attributes: { ...(options?.attributes ?? {}) }, ended: false, events: [] };
      spans.push(record);
      return {
        setAttribute(key, value) {
          record.attributes[key] = value;
        },
        setStatus(code, message) {
          record.status = { code, message };
        },
        addEvent(name, attributes) {
          record.events.push({ name, attributes: { ...(attributes ?? {}) } });
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
  const providerTokenCounter = meter?.createCounter("prism.provider.tokens", { description: "Provider-turn token usage" });
  const runTokenCounter = meter?.createCounter("prism.run.tokens", { description: "Aggregate agent-run token usage" });
  const feedbackCounter = meter?.createCounter("prism.run.feedback", { description: "Run feedback count" });
  const evaluationCounter = meter?.createCounter("prism.run.evaluation", { description: "Run evaluation count" });

  const activeSpans = new Map<SpanKey, { span: PrismSpan; sessionId: string; runId: string }>();

  const safe = (fn: () => void) => {
    if (!enabled) return;
    try {
      fn();
    } catch (error) {
      onExporterError(error);
    }
  };

  const endSpan = (key: SpanKey, status: PrismSpanStatus, message?: string) => {
    const active = activeSpans.get(key);
    if (!active) return;
    activeSpans.delete(key);
    try {
      active.span.setStatus(status, message);
    } finally {
      active.span.end();
    }
  };

  const endMatchingSpans = (
    predicate: (active: { sessionId: string; runId: string }) => boolean,
    message: string,
  ) => {
    for (const [key, active] of activeSpans) {
      if (predicate(active)) endSpan(key, "error", message);
    }
  };

  const handleAgentEvent = (event: AgentEvent) => {
    if (!enabled) return;

    switch (event.type) {
      case "agent_started":
        safe(() => {
          if (!tracer) return;
          const key = spanKey("agent", event.runId);
          endSpan(key, "error", "Duplicate agent start");
          activeSpans.set(key, {
            sessionId: event.sessionId,
            runId: event.runId,
            span: tracer.startSpan("prism.agent.run", {
              attributes: {
                "prism.session_id": event.sessionId,
                "prism.run_id": event.runId,
              },
            }),
          });
        });
        break;
      case "agent_finished":
        safe(() => {
          endSpan(spanKey("agent", event.runId), "ok");
          if (!event.usage || !runTokenCounter) return;
          if (event.usage.inputTokens !== undefined) runTokenCounter.add(event.usage.inputTokens, metricAttrs({ kind: "input" }));
          if (event.usage.outputTokens !== undefined) runTokenCounter.add(event.usage.outputTokens, metricAttrs({ kind: "output" }));
        });
        break;
      case "provider_turn_started":
        safe(() => {
          if (!tracer) return;
          const attempt = event.metadata.attempt ?? 1;
          const key = spanKey("provider", event.runId, event.turn, attempt);
          endSpan(key, "error", "Duplicate provider turn start");
          activeSpans.set(key, {
            sessionId: event.sessionId,
            runId: event.runId,
            span: tracer.startSpan("prism.provider.turn", {
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
          });
        });
        break;
      case "provider_turn_finished":
        safe(() => {
          const attempt = event.metadata.attempt ?? 1;
          const key = spanKey("provider", event.runId, event.turn, attempt);
          const active = activeSpans.get(key);
          if (active) {
            try {
              if (event.metadata.latencyMs !== undefined) active.span.setAttribute("prism.latency_ms", event.metadata.latencyMs);
              if (event.metadata.httpStatus !== undefined) active.span.setAttribute("http.status_code", event.metadata.httpStatus);
            } finally {
              endSpan(key, event.error ? "error" : "ok", event.error?.message);
            }
          }
          providerDuration?.record(event.metadata.latencyMs ?? 0, metricAttrs({
            provider_id: event.metadata.providerId,
            outcome: event.error ? "error" : "success",
          }));
          if (!event.usage || !providerTokenCounter) return;
          if (event.usage.inputTokens !== undefined) {
            providerTokenCounter.add(event.usage.inputTokens, metricAttrs({ provider_id: event.metadata.providerId, kind: "input" }));
          }
          if (event.usage.outputTokens !== undefined) {
            providerTokenCounter.add(event.usage.outputTokens, metricAttrs({ provider_id: event.metadata.providerId, kind: "output" }));
          }
          if (event.usage.cacheReadTokens) {
            providerTokenCounter.add(event.usage.cacheReadTokens, metricAttrs({ provider_id: event.metadata.providerId, kind: "cache_read" }));
          }
          if (event.usage.cacheWriteTokens) {
            providerTokenCounter.add(event.usage.cacheWriteTokens, metricAttrs({ provider_id: event.metadata.providerId, kind: "cache_write" }));
          }
        });
        break;
      case "tool_execution_started":
        safe(() => {
          if (!tracer) return;
          const key = spanKey("tool", event.runId, event.call.id);
          endSpan(key, "error", "Duplicate tool start");
          activeSpans.set(key, {
            sessionId: event.sessionId,
            runId: event.runId,
            span: tracer.startSpan("prism.tool.execute", {
              attributes: {
                "prism.session_id": event.sessionId,
                "prism.run_id": event.runId,
                "prism.tool_call_id": event.call.id,
                "prism.tool_name": event.call.name,
              },
            }),
          });
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
          const key = spanKey("tool", event.runId, toolCallId);
          const active = activeSpans.get(key);
          if (active) {
            try {
              active.span.setAttribute("prism.tool_status", event.metadata.status);
              active.span.setAttribute("prism.duration_ms", event.metadata.durationMs);
            } finally {
              endSpan(
                key,
                event.type === "tool_execution_finished" ? "ok" : "error",
                event.type === "tool_execution_finished" ? undefined : event.error.message,
              );
            }
          }
          toolDuration?.record(event.metadata.durationMs, metricAttrs({ status: event.metadata.status }));
        });
        break;
      case "error":
        safe(() => {
          if (event.runId) endMatchingSpans((active) => active.runId === event.runId, event.error.message);
          else if (event.sessionId) endMatchingSpans((active) => active.sessionId === event.sessionId, event.error.message);
        });
        break;
      default:
        break;
    }
  };

  const recordRunMetadata = (
    runId: string,
    eventName: string,
    spanName: string,
    attributes: Readonly<Record<string, string | number | boolean>>,
  ) => safe(() => {
    const active = activeSpans.get(spanKey("agent", runId));
    if (active?.span.addEvent) {
      active.span.addEvent(eventName, attributes);
      return;
    }
    if (!tracer) return;
    const span = tracer.startSpan(spanName, { attributes: { "prism.run_id": runId, ...attributes } });
    span.setStatus("ok");
    span.end();
  });

  return {
    enabled,
    handleAgentEvent,
    handleRunFeedback(feedback) {
      const rating = feedback.rating !== undefined && Number.isFinite(feedback.rating) && feedback.rating >= -1 && feedback.rating <= 1
        ? feedback.rating
        : undefined;
      const tagCount = boundedCount(feedback.tagCount);
      const scorerCount = boundedCount(feedback.scorerCount);
      const evaluationCount = boundedCount(feedback.evaluationCount);
      const attributes = {
        "prism.feedback.rating": rating ?? 0,
        "prism.feedback.has_rating": rating !== undefined,
        "prism.feedback.has_comment": Boolean(feedback.hasComment),
        "prism.feedback.tag_count": tagCount,
        "prism.feedback.scorer_count": scorerCount,
        "prism.feedback.evaluation_count": evaluationCount,
      };
      recordRunMetadata(feedback.runId, "prism.run.feedback", "prism.run.feedback", attributes);
      safe(() => feedbackCounter?.add(1, metricAttrs({
        rating: rating === undefined ? "none" : rating > 0 ? "positive" : rating < 0 ? "negative" : "neutral",
        linked_evaluation: evaluationCount > 0 ? "true" : "false",
      })));
    },
    handleEvaluation(evaluation) {
      const attributes = {
        "prism.evaluation.status": evaluation.status,
        "prism.evaluation.has_score": evaluation.score !== undefined && Number.isFinite(evaluation.score),
        "prism.evaluation.has_reason": Boolean(evaluation.hasReason),
        ...(evaluation.score !== undefined && Number.isFinite(evaluation.score) ? { "prism.evaluation.score": evaluation.score } : {}),
      };
      recordRunMetadata(evaluation.runId, "prism.run.evaluation", "prism.run.evaluation", attributes);
      safe(() => evaluationCounter?.add(1, metricAttrs({ status: evaluation.status })));
    },
    attachSession(session) {
      if (!enabled) return () => {};
      const subscription = session.subscribe();
      const iterator = subscription[Symbol.asyncIterator]();
      let active = true;
      void (async () => {
        try {
          while (active) {
            const next = await iterator.next();
            if (!active || next.done) break;
            handleAgentEvent(next.value);
          }
        } catch {
          // subscriber closed
        }
      })();
      return () => {
        active = false;
        void iterator.return?.();
        safe(() => endMatchingSpans((span) => span.sessionId === session.id, "Instrumentation detached"));
      };
    },
  };
}

function boundedCount(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 64) : 0;
}

interface OpenTelemetrySpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: { code: number; message?: string }): void;
  addEvent?(name: string, attributes?: Record<string, string | number | boolean>): void;
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
          addEvent(name, attributes) {
            span.addEvent?.(name, attributes ? { ...attributes } : undefined);
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
