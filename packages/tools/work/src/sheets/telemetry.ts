/**
 * Dependency-free telemetry seam for Sheets operations.
 * When `telemetry` is omitted, call-sites short-circuit on optional chaining without allocations.
 */

export type SheetsTelemetryAttributeValue = string | number | boolean;

export interface SheetsTelemetrySpan {
  setAttribute(name: string, value: SheetsTelemetryAttributeValue): void;
  addEvent(name: string, attributes?: Readonly<Record<string, SheetsTelemetryAttributeValue>>): void;
  recordError(): void;
  end(): void;
}

export interface SheetsTelemetry {
  startSpan(
    name: string,
    attributes?: Readonly<Record<string, SheetsTelemetryAttributeValue>>,
    parent?: SheetsTelemetrySpan,
  ): SheetsTelemetrySpan;
}

export const noopSheetsSpan: SheetsTelemetrySpan = {
  setAttribute() {},
  addEvent() {},
  recordError() {},
  end() {},
};

export const noopSheetsTelemetry: SheetsTelemetry = {
  startSpan() {
    return noopSheetsSpan;
  },
};
