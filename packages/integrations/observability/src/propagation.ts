import type { ProviderRequest } from "@arnilo/prism";
import { type ActiveSpan, type PrismSpan, rawOpenTelemetrySpan, spanKey } from "./instrumentation.js";

/** The slice of `@opentelemetry/api`'s `propagation` the package uses. */
export interface OpenTelemetryPropagationApi {
  inject?(context: unknown, carrier: Record<string, string>, setter?: unknown): void;
  readonly defaultTextMapSetter?: unknown;
}

export interface TraceContextApi {
  readonly context?: { active(): unknown };
  readonly trace?: {
    setSpan?(context: unknown, span: unknown): unknown;
    getSpan?(context: unknown): unknown;
  };
  readonly propagation?: OpenTelemetryPropagationApi;
}

/** Only these two headers are ever written (W3C trace context, plan 214 Task 4). */
export const TRACE_CONTEXT_HEADERS = ["traceparent", "tracestate"] as const;

const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;

/**
 * Formats a W3C `traceparent` from a span's ids. Used when the API has no propagator (or the span is
 * not a wrapped OpenTelemetry span), so propagation still works against a stubbed tracer.
 */
export function formatTraceparent(spanContext: { readonly traceId: string; readonly spanId: string } | undefined): string | undefined {
  if (!spanContext) return undefined;
  if (!TRACE_ID.test(spanContext.traceId) || !SPAN_ID.test(spanContext.spanId)) return undefined;
  return `00-${spanContext.traceId}-${spanContext.spanId}-01`;
}

/**
 * The span a `model.request` transform should propagate: the most recently opened chat attempt for the
 * run, else the run span, else a workflow span (plan 214 Task 1 (a)). `model.request` fires before the
 * first attempt opens its chat span, so the first header carries the run span; later attempts carry
 * their own chat span.
 */
export function activeTraceSpan(active: ReadonlyMap<string, ActiveSpan>, runId: string): PrismSpan | undefined {
  if (runId === "") return undefined;
  const chatPrefix = `${spanKey("provider", runId)}:`;
  let chat: PrismSpan | undefined;
  for (const [key, item] of active) if (key.startsWith(chatPrefix)) chat = item.span;
  return chat ?? active.get(spanKey("agent", runId))?.span ?? active.get(spanKey("workflow", runId))?.span;
}

function headerValue(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const exact = headers[name];
  if (exact !== undefined) return exact;
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name);
  return match === undefined ? undefined : headers[match];
}

function withHeaders(request: ProviderRequest, headers: Record<string, string>): ProviderRequest {
  return { ...request, options: { ...(request.options ?? {}), headers: { ...(request.options?.headers ?? {}), ...headers } } };
}

/**
 * Injects the current span as a W3C trace context into the outgoing request headers, using the global
 * propagator when one is registered and `traceparent`/`tracestate` only. Returns `undefined` (keep the
 * request as-is) when there is no span, when the caller already set `traceparent`, or when nothing
 * valid could be injected. Never touches `authorization` or any other header.
 */
export function injectTraceContext(
  request: ProviderRequest,
  options: { readonly span: PrismSpan | undefined; readonly api: TraceContextApi },
): ProviderRequest | undefined {
  const { span, api } = options;
  if (!span) return undefined;
  const existing: Readonly<Record<string, string>> = request.options?.headers ?? {};
  if (headerValue(existing, "traceparent") !== undefined) return undefined;

  const carrier: Record<string, string> = {};
  const spanContext = span.spanContext?.();
  const raw = rawOpenTelemetrySpan(span);
  const inject = api.propagation?.inject;
  if (inject && raw !== undefined && api.trace?.setSpan && api.context?.active) {
    try {
      inject(api.trace.setSpan(api.context.active(), raw), carrier, api.propagation?.defaultTextMapSetter);
    } catch {
      // A broken propagator must not fail the run: fall back to the ids the span reports.
    }
  }
  const traceparent = carrier.traceparent ?? formatTraceparent(spanContext);
  if (traceparent === undefined) return undefined;
  const next: Record<string, string> = { traceparent };
  // Only a propagator-supplied tracestate rides along; a caller's own value belongs to another trace.
  const tracestate = carrier.tracestate;
  if (tracestate !== undefined && tracestate !== "") next.tracestate = tracestate;
  return withHeaders(request, next);
}
