/**
 * Dependency-free telemetry seam for RAG operations. When `telemetry` is omitted every
 * call site short-circuits on an optional chain — zero allocations, zero per-span work.
 * Implementations own timing/status; the seam only carries structure and attributes.
 */
export type RagTelemetryAttributeValue = string | number | boolean;

export interface RagTelemetrySpan {
  setAttribute(name: string, value: RagTelemetryAttributeValue): void;
  addEvent(name: string, attributes?: Readonly<Record<string, RagTelemetryAttributeValue>>): void;
  /** Flags the span as failed without carrying any error text (no user data leaves the host). */
  recordError(): void;
  end(): void;
}

export interface RagTelemetry {
  startSpan(name: string, attributes?: Readonly<Record<string, RagTelemetryAttributeValue>>, parent?: RagTelemetrySpan): RagTelemetrySpan;
}
