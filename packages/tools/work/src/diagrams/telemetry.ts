/**
 * Dependency-free telemetry seam for Diagrams operations.
 * When `telemetry` is omitted, call-sites short-circuit on optional chaining without allocations.
 */

export type DiagramsTelemetryAttributeValue = string | number | boolean;

export interface DiagramsTelemetrySpan {
  setAttribute(name: string, value: DiagramsTelemetryAttributeValue): void;
  addEvent(name: string, attributes?: Readonly<Record<string, DiagramsTelemetryAttributeValue>>): void;
  recordError(): void;
  end(): void;
}

export interface DiagramsTelemetry {
  startSpan(
    name: string,
    attributes?: Readonly<Record<string, DiagramsTelemetryAttributeValue>>,
    parent?: DiagramsTelemetrySpan,
  ): DiagramsTelemetrySpan;
}

export const noopDiagramsSpan: DiagramsTelemetrySpan = {
  setAttribute() {},
  addEvent() {},
  recordError() {},
  end() {},
};

export const noopDiagramsTelemetry: DiagramsTelemetry = {
  startSpan() {
    return noopDiagramsSpan;
  },
};
