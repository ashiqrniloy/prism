/**
 * Dependency-free telemetry seam for Document operations. When `telemetry` is omitted every
 * call site short-circuits on an optional chain — zero allocations, zero per-span work.
 * Implementations own timing/status; the seam only carries structure and allow-listed metadata attributes.
 */

export type DocumentsTelemetryAttributeValue = string | number | boolean;

export interface DocumentsTelemetrySpan {
  setAttribute(name: string, value: DocumentsTelemetryAttributeValue): void;
  addEvent(name: string, attributes?: Readonly<Record<string, DocumentsTelemetryAttributeValue>>): void;
  /** Flags the span as failed without carrying any error text (no user data leaves the host). */
  recordError(): void;
  end(): void;
}

export interface DocumentsTelemetry {
  startSpan(
    name: string,
    attributes?: Readonly<Record<string, DocumentsTelemetryAttributeValue>>,
    parent?: DocumentsTelemetrySpan,
  ): DocumentsTelemetrySpan;
}

export const noopDocumentsSpan: DocumentsTelemetrySpan = {
  setAttribute() {},
  addEvent() {},
  recordError() {},
  end() {},
};

export const noopDocumentsTelemetry: DocumentsTelemetry = {
  startSpan() {
    return noopDocumentsSpan;
  },
};
