import type { AgentEvent, AgentSession } from "@arnilo/prism";

export type PrismSpanStatus = "ok" | "error";
export type PrismSpanKind = "internal" | "client";
export type PrismContext = unknown;

export interface PrismSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(code: PrismSpanStatus, message?: string): void;
  addEvent?(name: string, attributes?: Readonly<Record<string, string | number | boolean>>): void;
  spanContext?(): { readonly traceId: string; readonly spanId: string };
  end(): void;
}

export interface PrismTracer {
  startSpan(name: string, options?: {
    readonly attributes?: Readonly<Record<string, string | number | boolean>>;
    readonly kind?: PrismSpanKind;
    readonly parent?: PrismSpan;
    readonly parentContext?: PrismContext;
  }): PrismSpan;
}

export interface PrismCounter { add(value: number, attributes?: Readonly<Record<string, string>>): void; }
export interface PrismHistogram { record(value: number, attributes?: Readonly<Record<string, string>>): void; }
export interface PrismMeter {
  createCounter(name: string, options?: { readonly description?: string; readonly unit?: string }): PrismCounter;
  createHistogram(name: string, options?: { readonly description?: string; readonly unit?: string }): PrismHistogram;
}

export interface TraceReference { readonly runId: string; readonly traceId: string; }
export interface OpenTelemetryInstrumentationOptions {
  readonly enabled?: boolean;
  readonly tracer?: PrismTracer;
  readonly meter?: PrismMeter;
  readonly parentContext?: PrismContext | ((event: Extract<AgentEvent, { type: "agent_started" }>) => PrismContext | undefined);
  readonly onTraceReference?: (reference: TraceReference) => void;
  readonly maxTraceReferences?: number;
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
  readonly name?: string;
  readonly status: "scored" | "skipped" | "failed";
  readonly score?: number;
  readonly hasReason: boolean;
}
export type DelegationTelemetry =
  | { readonly type: "started"; readonly runId: string; readonly delegationId: string; readonly childId: string }
  | { readonly type: "finished" | "error" | "rejected"; readonly runId: string; readonly delegationId: string; readonly childId: string; readonly message?: string };

export interface OpenTelemetryInstrumentation {
  readonly enabled: boolean;
  handleAgentEvent(event: AgentEvent): void;
  handleDelegation(event: DelegationTelemetry): void;
  handleRunFeedback(feedback: RunFeedbackTelemetry): void;
  handleEvaluation(evaluation: EvaluationTelemetry): void;
  traceId(runId: string): string | undefined;
  attachSession(session: Pick<AgentSession, "id" | "subscribe">): () => void;
}

export interface RecordedSpan {
  readonly name: string;
  readonly kind?: PrismSpanKind;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly attributes: Record<string, string | number | boolean>;
  readonly status?: { readonly code: PrismSpanStatus; readonly message?: string };
  readonly ended: boolean;
  readonly events: readonly { readonly name: string; readonly attributes: Record<string, string | number | boolean> }[];
}
interface MutableRecordedSpan extends Omit<RecordedSpan, "events"> {
  attributes: Record<string, string | number | boolean>;
  status?: { code: PrismSpanStatus; message?: string };
  ended: boolean;
  events: { name: string; attributes: Record<string, string | number | boolean> }[];
}
export interface RecordedMetric { readonly name: string; readonly kind: "counter" | "histogram"; readonly value: number; readonly attributes: Record<string, string>; }
export interface InMemoryTelemetry {
  readonly tracer: PrismTracer;
  readonly meter: PrismMeter;
  readonly spans: readonly RecordedSpan[];
  readonly metrics: readonly RecordedMetric[];
  clear(): void;
}

let memoryId = 0;
const hex = (length: number) => (++memoryId).toString(16).padStart(length, "0").slice(-length);
export function createInMemoryTelemetry(): InMemoryTelemetry {
  const spans: MutableRecordedSpan[] = [];
  const metrics: RecordedMetric[] = [];
  const tracer: PrismTracer = {
    startSpan(name, options) {
      const parent = options?.parent?.spanContext?.();
      const record: MutableRecordedSpan = {
        name, kind: options?.kind, traceId: parent?.traceId ?? hex(32), spanId: hex(16), parentSpanId: parent?.spanId,
        attributes: { ...(options?.attributes ?? {}) }, ended: false, events: [],
      };
      spans.push(record);
      return {
        setAttribute: (key, value) => { record.attributes[key] = value; },
        setStatus: (code, message) => { record.status = { code, message }; },
        addEvent: (eventName, attributes) => { record.events.push({ name: eventName, attributes: { ...(attributes ?? {}) } }); },
        spanContext: () => ({ traceId: record.traceId, spanId: record.spanId }),
        end: () => { record.ended = true; },
      };
    },
  };
  const meter: PrismMeter = {
    createCounter: (name) => ({ add: (value, attributes) => metrics.push({ name, kind: "counter", value, attributes: { ...(attributes ?? {}) } }) }),
    createHistogram: (name) => ({ record: (value, attributes) => metrics.push({ name, kind: "histogram", value, attributes: { ...(attributes ?? {}) } }) }),
  };
  return { tracer, meter, get spans() { return spans; }, get metrics() { return metrics; }, clear() { spans.length = metrics.length = 0; } };
}

type ActiveSpan = { span: PrismSpan; sessionId: string; runId: string };
const key = (...parts: (string | number)[]) => parts.join(":");
const attrs = (value: Record<string, string>) => value;

export function createOpenTelemetryInstrumentation(options: OpenTelemetryInstrumentationOptions = {}): OpenTelemetryInstrumentation {
  const enabled = options.enabled !== false && Boolean(options.tracer ?? options.meter);
  const tracer = options.tracer;
  const onExporterError = options.onExporterError ?? (() => {});
  const active = new Map<string, ActiveSpan>();
  const traceReferences = new Map<string, string>();
  const maxTraceReferences = finiteLimit(options.maxTraceReferences, 1024, 10_000, "maxTraceReferences");
  const meter = options.meter;
  const inferenceDuration = meter?.createHistogram("gen_ai.client.operation.duration", { description: "GenAI client operation duration", unit: "s" });
  const toolDuration = meter?.createHistogram("gen_ai.execute_tool.duration", { description: "Tool execution duration", unit: "s" });
  const tokenUsage = meter?.createHistogram("gen_ai.client.token.usage", { description: "GenAI token usage", unit: "token" });
  const agentDuration = meter?.createHistogram("gen_ai.invoke_agent.duration", { description: "Agent invocation duration", unit: "s" });
  const feedbackCounter = meter?.createCounter("prism.run.feedback", { description: "Run feedback count" });
  const evaluationCounter = meter?.createCounter("prism.run.evaluation", { description: "Run evaluation count" });
  const startedAt = new Map<string, number>();

  const safe = (fn: () => void) => { if (enabled) try { fn(); } catch (error) { try { onExporterError(error); } catch {} } };
  const finish = (spanKey: string, status: PrismSpanStatus, message?: string) => {
    const item = active.get(spanKey); if (!item) return;
    active.delete(spanKey);
    try { item.span.setStatus(status, message); } finally { item.span.end(); }
  };
  const finishWhere = (predicate: (item: ActiveSpan) => boolean, message: string) => {
    for (const [spanKey, item] of active) if (predicate(item)) finish(spanKey, "error", message);
  };
  const parent = (runId: string) => active.get(key("agent", runId))?.span;
  const rememberTrace = (runId: string, span: PrismSpan) => {
    const traceId = span.spanContext?.().traceId;
    if (!traceId) return;
    traceReferences.delete(runId); traceReferences.set(runId, traceId);
    while (traceReferences.size > maxTraceReferences) traceReferences.delete(traceReferences.keys().next().value!);
    options.onTraceReference?.({ runId, traceId });
  };
  const startChild = (spanKey: string, runId: string, sessionId: string, name: string, kind: PrismSpanKind, attributes: Record<string, string | number | boolean>) => {
    if (!tracer) return;
    finish(spanKey, "error", "Duplicate span start");
    active.set(spanKey, { runId, sessionId, span: tracer.startSpan(name, { kind, parent: parent(runId), attributes }) });
  };

  const handleAgentEvent = (event: AgentEvent) => {
    if (!enabled) return;
    switch (event.type) {
      case "agent_started": safe(() => {
        if (!tracer) return;
        const spanKey = key("agent", event.runId); finish(spanKey, "error", "Duplicate agent start");
        const parentContext = typeof options.parentContext === "function" ? options.parentContext(event) : options.parentContext;
        const span = tracer.startSpan("invoke_agent prism", { kind: "internal", parentContext, attributes: {
          "gen_ai.operation.name": "invoke_agent", "gen_ai.agent.name": "prism", "prism.session_id": event.sessionId, "prism.run_id": event.runId,
        } });
        active.set(spanKey, { span, sessionId: event.sessionId, runId: event.runId }); startedAt.set(event.runId, Date.now()); rememberTrace(event.runId, span);
      }); break;
      case "agent_finished": safe(() => {
        finishWhere((item) => item.runId === event.runId && item !== active.get(key("agent", event.runId)), "Agent finished with child span open");
        finish(key("agent", event.runId), "ok");
        const start = startedAt.get(event.runId); startedAt.delete(event.runId); if (start !== undefined) agentDuration?.record((Date.now() - start) / 1000, attrs({ "gen_ai.operation.name": "invoke_agent" }));
      }); break;
      case "agent_suspended": case "agent_denied": safe(() => {
        finishWhere((item) => item.runId === event.runId, event.type === "agent_suspended" ? "Agent suspended" : "Agent denied"); startedAt.delete(event.runId);
      }); break;
      case "provider_turn_started": safe(() => {
        const attempt = event.metadata.attempt ?? 1;
        startChild(key("provider", event.runId, event.turn, attempt), event.runId, event.sessionId, `chat ${event.metadata.model.model}`, "client", {
          "gen_ai.operation.name": "chat", "gen_ai.provider.name": event.metadata.providerId, "gen_ai.request.model": event.metadata.model.model,
          "prism.turn": event.turn, ...(event.metadata.attempt ? { "prism.attempt": event.metadata.attempt } : {}),
        });
      }); break;
      case "provider_turn_finished": safe(() => {
        const spanKey = key("provider", event.runId, event.turn, event.metadata.attempt ?? 1);
        const item = active.get(spanKey); if (item && event.metadata.httpStatus !== undefined) item.span.setAttribute("http.response.status_code", event.metadata.httpStatus);
        finish(spanKey, event.error ? "error" : "ok", event.error?.message);
        inferenceDuration?.record((event.metadata.latencyMs ?? 0) / 1000, attrs({ "gen_ai.operation.name": "chat", "gen_ai.provider.name": event.metadata.providerId, outcome: event.error ? "error" : "success" }));
        const usage = event.usage;
        if (usage?.inputTokens !== undefined) tokenUsage?.record(usage.inputTokens, attrs({ "gen_ai.operation.name": "chat", "gen_ai.provider.name": event.metadata.providerId, "gen_ai.token.type": "input" }));
        if (usage?.outputTokens !== undefined) tokenUsage?.record(usage.outputTokens, attrs({ "gen_ai.operation.name": "chat", "gen_ai.provider.name": event.metadata.providerId, "gen_ai.token.type": "output" }));
      }); break;
      case "tool_execution_started": safe(() => startChild(key("tool", event.runId, event.call.id), event.runId, event.sessionId, `execute_tool ${event.call.name}`, "internal", {
        "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": event.call.name, "gen_ai.tool.call.id": event.call.id,
      })); break;
      case "tool_execution_finished": case "tool_execution_error": case "tool_execution_blocked": safe(() => {
        const id = event.type === "tool_execution_finished" ? event.result.toolCallId : event.type === "tool_execution_error" ? event.call.id : event.toolCallId;
        finish(key("tool", event.runId, id), event.type === "tool_execution_finished" ? "ok" : "error", event.type === "tool_execution_finished" ? undefined : event.error.message);
        toolDuration?.record(event.metadata.durationMs / 1000, attrs({ "gen_ai.operation.name": "execute_tool", outcome: event.metadata.status }));
      }); break;
      case "guardrail_decision": safe(() => {
        if (!tracer) return;
        const span = tracer.startSpan("prism.guardrail.evaluate", { kind: "internal", parent: parent(event.runId), attributes: {
          "prism.guardrail.stage": event.record.stage, "prism.guardrail.action": event.record.action,
        } }); span.setStatus(event.record.action === "allow" ? "ok" : "error"); span.end();
      }); break;
      case "error": safe(() => {
        if (event.runId) { finishWhere((item) => item.runId === event.runId, event.error.message); startedAt.delete(event.runId); }
        else if (event.sessionId) finishWhere((item) => item.sessionId === event.sessionId, event.error.message);
      }); break;
      default: break;
    }
  };

  const recordRunEvent = (runId: string, eventName: string, attributes: Record<string, string | number | boolean>) => safe(() => {
    const span = parent(runId);
    if (span?.addEvent) span.addEvent(eventName, attributes);
    else if (tracer) { const ended = tracer.startSpan(eventName, { kind: "internal", attributes: { "prism.run_id": runId, ...attributes } }); ended.setStatus("ok"); ended.end(); }
  });

  return {
    enabled, handleAgentEvent,
    handleDelegation(event) { safe(() => {
      const spanKey = key("delegation", event.runId, event.delegationId);
      if (event.type === "started") startChild(spanKey, event.runId, "delegation", "prism.agent.delegate", "internal", { "prism.delegation.child": event.childId });
      else finish(spanKey, event.type === "finished" ? "ok" : "error", event.message);
    }); },
    handleRunFeedback(feedback) {
      const rating = feedback.rating !== undefined && Number.isFinite(feedback.rating) && feedback.rating >= -1 && feedback.rating <= 1 ? feedback.rating : undefined;
      const evaluationCount = boundedCount(feedback.evaluationCount);
      recordRunEvent(feedback.runId, "prism.run.feedback", {
        "prism.feedback.rating": rating ?? 0, "prism.feedback.has_rating": rating !== undefined, "prism.feedback.has_comment": Boolean(feedback.hasComment),
        "prism.feedback.tag_count": boundedCount(feedback.tagCount), "prism.feedback.scorer_count": boundedCount(feedback.scorerCount), "prism.feedback.evaluation_count": evaluationCount,
      });
      safe(() => feedbackCounter?.add(1, attrs({ rating: rating === undefined ? "none" : rating > 0 ? "positive" : rating < 0 ? "negative" : "neutral", linked_evaluation: evaluationCount ? "true" : "false" })));
    },
    handleEvaluation(evaluation) {
      const score = evaluation.score !== undefined && Number.isFinite(evaluation.score) ? evaluation.score : undefined;
      recordRunEvent(evaluation.runId, "gen_ai.evaluation.result", {
        "gen_ai.evaluation.name": evaluation.name?.slice(0, 128) || "prism.run", "prism.evaluation.status": evaluation.status,
        "prism.evaluation.has_reason": Boolean(evaluation.hasReason), ...(score !== undefined ? { "gen_ai.evaluation.score.value": score } : {}),
      });
      safe(() => evaluationCounter?.add(1, attrs({ status: evaluation.status })));
    },
    traceId: (runId) => traceReferences.get(runId),
    attachSession(session) {
      if (!enabled) return () => {};
      const iterator = session.subscribe()[Symbol.asyncIterator](); let attached = true;
      void (async () => { try { while (attached) { const next = await iterator.next(); if (!attached || next.done) break; handleAgentEvent(next.value); } } catch {} })();
      return () => { attached = false; void iterator.return?.(); safe(() => finishWhere((item) => item.sessionId === session.id, "Instrumentation detached")); };
    },
  };
}

const boundedCount = (value: number) => Number.isSafeInteger(value) && value > 0 ? Math.min(value, 64) : 0;
function finiteLimit(value: number | undefined, fallback: number, hard: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > hard) throw new RangeError(`${name} must be an integer from 1 to ${hard}`);
  return resolved;
}

interface OpenTelemetrySpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: { code: number; message?: string }): void;
  addEvent?(name: string, attributes?: Record<string, string | number | boolean>): void;
  spanContext?(): { traceId: string; spanId: string };
  end(): void;
}
interface OpenTelemetryTracer { startSpan(name: string, options?: { attributes?: Record<string, string | number | boolean>; kind?: number }, context?: unknown): OpenTelemetrySpan; }
interface OpenTelemetryMeter {
  createCounter(name: string, options?: { description?: string; unit?: string }): { add(value: number, attributes?: Record<string, string>): void };
  createHistogram(name: string, options?: { description?: string; unit?: string }): { record(value: number, attributes?: Record<string, string>): void };
}
export interface OpenTelemetryContextApi { active(): unknown; }
export interface OpenTelemetryTraceApi { setSpan(context: unknown, span: OpenTelemetrySpan): unknown; }
const rawSpan = Symbol("prism.otel.span");
type WrappedSpan = PrismSpan & { [rawSpan]?: OpenTelemetrySpan };

export function wrapOpenTelemetryApi(
  tracer: OpenTelemetryTracer,
  meter?: OpenTelemetryMeter,
  api?: { readonly context: OpenTelemetryContextApi; readonly trace: OpenTelemetryTraceApi },
): { tracer: PrismTracer; meter?: PrismMeter } {
  return {
    tracer: { startSpan(name, options) {
      const parent = (options?.parent as WrappedSpan | undefined)?.[rawSpan];
      const parentContext = options?.parentContext ?? (parent && api ? api.trace.setSpan(api.context.active(), parent) : undefined);
      const span = tracer.startSpan(name, { attributes: options?.attributes ? { ...options.attributes } : undefined, kind: options?.kind === "client" ? 2 : 0 }, parentContext);
      const wrapped: WrappedSpan = {
        [rawSpan]: span,
        setAttribute: (key, value) => span.setAttribute(key, value),
        setStatus: (code, message) => span.setStatus({ code: code === "ok" ? 1 : 2, message }),
        addEvent: (eventName, attributes) => span.addEvent?.(eventName, attributes ? { ...attributes } : undefined),
        spanContext: () => span.spanContext?.() ?? { traceId: "", spanId: "" },
        end: () => span.end(),
      };
      return wrapped;
    } },
    meter: meter ? {
      createCounter: (name, opts) => { const instrument = meter.createCounter(name, opts); return { add: (value, attributes) => instrument.add(value, attributes) }; },
      createHistogram: (name, opts) => { const instrument = meter.createHistogram(name, opts); return { record: (value, attributes) => instrument.record(value, attributes) }; },
    } : undefined,
  };
}
