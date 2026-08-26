import type { RagTelemetry, RagTelemetryAttributeValue, RagTelemetrySpan } from "@arnilo/prism-rag";
import type { PrismMeter, PrismSpan, PrismTracer } from "./instrumentation.js";

export interface CreateRagTelemetryOptions {
  readonly tracer: PrismTracer;
  /** Optional latency histogram; records one sample per ended span (milliseconds). */
  readonly meter?: PrismMeter;
  /**
   * Transform an attribute value before recording; return undefined to drop the attribute
   * entirely (e.g. tenant-id redaction). Runs after the allow-list check.
   */
  readonly attributeFilter?: (name: string, value: RagTelemetryAttributeValue) => RagTelemetryAttributeValue | undefined;
}

/** Only these span names and `rag.*`-shaped keys ever reach the tracer. */
const SPAN_NAMES = new Set([
  "rag_request",
  "rag_index",
  "embedding.query",
  "embedding.index",
  "retrieval.vector_search",
  "retrieval.lexical",
  "retrieval.fusion",
  "retrieval.rerank",
  "prompt.assembly",
]);
const EVENT_NAMES = new Set(["chunk_retrieved"]);
const ATTRIBUTE_KEY = /^rag\.[a-z0-9_.]+$/;

/**
 * Adapts the dependency-free prism-rag telemetry seam onto a PrismTracer (OpenTelemetry or
 * the in-memory test tracer). Span names and attributes map verbatim; anything outside the
 * allow-list is dropped before it can carry raw chunk or document text out of the host.
 */
export function createRagTelemetry(options: CreateRagTelemetryOptions): RagTelemetry {
  const { tracer, meter, attributeFilter } = options;
  const histogram = meter?.createHistogram("rag.operation.duration");
  const underlying = new WeakMap<RagTelemetrySpan, PrismSpan>();

  const cleanAttributes = (
    attributes: Readonly<Record<string, RagTelemetryAttributeValue>> | undefined,
  ): Record<string, RagTelemetryAttributeValue> => {
    const cleaned: Record<string, RagTelemetryAttributeValue> = {};
    for (const [name, value] of Object.entries(attributes ?? {})) {
      if (!ATTRIBUTE_KEY.test(name)) continue;
      const filtered = attributeFilter ? attributeFilter(name, value) : value;
      if (filtered === undefined) continue;
      cleaned[name] = filtered;
    }
    return cleaned;
  };

  return {
    startSpan(name, attributes, parent) {
      if (!SPAN_NAMES.has(name)) {
        return noopRagSpan;
      }
      const prism = tracer.startSpan(name, {
        attributes: cleanAttributes(attributes),
        ...(parent ? { parent: underlying.get(parent) } : {}),
      });
      const startedAt = performance.now();
      let failed = false;
      const wrapper: RagTelemetrySpan = {
        setAttribute: (key, value) => {
          if (!ATTRIBUTE_KEY.test(key)) return;
          const filtered = attributeFilter ? attributeFilter(key, value) : value;
          if (filtered === undefined) return;
          prism.setAttribute(key, filtered);
        },
        addEvent: (eventName, eventAttributes) => {
          if (!EVENT_NAMES.has(eventName)) return;
          prism.addEvent?.(eventName, cleanAttributes(eventAttributes));
        },
        recordError: () => {
          failed = true;
        },
        end: () => {
          prism.setStatus(failed ? "error" : "ok");
          histogram?.record(Math.max(0, performance.now() - startedAt), { name });
          prism.end();
        },
      };
      underlying.set(wrapper, prism);
      return wrapper;
    },
  };
}

const noopRagSpan: RagTelemetrySpan = {
  setAttribute() {},
  addEvent() {},
  recordError() {},
  end() {},
};
