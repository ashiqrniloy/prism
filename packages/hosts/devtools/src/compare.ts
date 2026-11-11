/**
 * Inspector comparison over existing 072 artifacts.
 * Does not invent a report schema: TimelineSummary + ExperimentAggregate fields only.
 * Invariant failures block quality winners so a good answer cannot average away a forbidden tool.
 */

import { DevtoolsError } from "./errors.js";

export interface InspectorCostSlice {
  readonly amount: number;
  readonly currency: string;
}

export interface InspectorSummarySlice {
  readonly durationMs: number;
  readonly errorCount: number;
  readonly toolCallCount: number;
  readonly status: string;
  readonly cost?: InspectorCostSlice;
}

export interface InspectorAggregateSlice {
  readonly macroMean?: number;
  readonly scorers?: Readonly<Record<string, { readonly mean: number; readonly ci95?: { readonly low: number; readonly high: number } }>>;
  readonly invariantsPassed?: boolean;
}

export interface InspectorCompareSide {
  readonly summary: InspectorSummarySlice;
  readonly aggregate?: InspectorAggregateSlice;
  readonly manifest?: { readonly runtimeRevision?: string; readonly datasetVersion?: string };
}

export type InspectorCompareWinner = "left" | "right" | "tie" | "unknown" | "invariant_blocked";

export interface InspectorComparison {
  readonly left: InspectorCompareSide;
  readonly right: InspectorCompareSide;
  readonly latencyWinner: InspectorCompareWinner;
  readonly costWinner: InspectorCompareWinner;
  readonly qualityWinner: InspectorCompareWinner;
}

const MAX_COMPARE_BYTES = 64 * 1024;

export function compareInspectorRuns(left: InspectorCompareSide, right: InspectorCompareSide): InspectorComparison {
  const invariantBlocked = left.aggregate?.invariantsPassed === false || right.aggregate?.invariantsPassed === false;
  return {
    left,
    right,
    latencyWinner: numericWinner(left.summary.durationMs, right.summary.durationMs, "lower"),
    costWinner: numericWinner(left.summary.cost?.amount, right.summary.cost?.amount, "lower"),
    qualityWinner: invariantBlocked ? "invariant_blocked" : qualityWinner(left.aggregate, right.aggregate),
  };
}

function qualityWinner(left?: InspectorAggregateSlice, right?: InspectorAggregateSlice): InspectorCompareWinner {
  const winner = numericWinner(left?.macroMean, right?.macroMean, "higher");
  const ids = Object.keys(left?.scorers ?? {});
  if (!ids.length || ids.length !== Object.keys(right?.scorers ?? {}).length) return winner;
  const pairs = ids.map((id) => [left?.scorers?.[id]?.ci95, right?.scorers?.[id]?.ci95] as const);
  if (pairs.some(([a, b]) => !a || !b)) return winner;
  // A macro winner needs every scorer's interval to support the same direction.
  return pairs.every(([a, b]) => (winner === "left" ? a!.low > b!.high : winner === "right" && b!.low > a!.high)) ? winner : "tie";
}

export function parseInspectorCompareBody(text: string): InspectorComparison {
  if (Buffer.byteLength(text, "utf8") > MAX_COMPARE_BYTES) {
    throw new DevtoolsError("compare body too large", "ERR_PRISM_DEVTOOLS_LIMIT", 413);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new DevtoolsError("invalid compare JSON", "ERR_PRISM_DEVTOOLS_REQUEST", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DevtoolsError("compare body must be { left, right }", "ERR_PRISM_DEVTOOLS_REQUEST", 400);
  }
  const body = parsed as { left?: unknown; right?: unknown };
  const left = asSide(body.left);
  const right = asSide(body.right);
  if (!left || !right) {
    throw new DevtoolsError("left and right must carry a metadata summary", "ERR_PRISM_DEVTOOLS_REQUEST", 400);
  }
  return compareInspectorRuns(left, right);
}

function asSide(value: unknown): InspectorCompareSide | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as { summary?: unknown; aggregate?: unknown; manifest?: unknown };
  const summary = asSummary(raw.summary);
  if (!summary) return undefined;
  const aggregate = asAggregate(raw.aggregate);
  const manifest = asManifest(raw.manifest);
  return {
    summary,
    ...(aggregate ? { aggregate } : {}),
    ...(manifest ? { manifest } : {}),
  };
}

function asSummary(value: unknown): InspectorSummarySlice | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const s = value as Record<string, unknown>;
  if (!finiteNonNeg(s.durationMs) || !finiteNonNeg(s.errorCount) || !finiteNonNeg(s.toolCallCount)) return undefined;
  if (typeof s.status !== "string" || s.status.length < 1 || s.status.length > 64) return undefined;
  const cost = asCost(s.cost);
  return {
    durationMs: s.durationMs as number,
    errorCount: s.errorCount as number,
    toolCallCount: s.toolCallCount as number,
    status: s.status,
    ...(cost ? { cost } : {}),
  };
}

function asCost(value: unknown): InspectorCostSlice | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const c = value as Record<string, unknown>;
  if (!finiteNonNeg(c.amount) || typeof c.currency !== "string" || c.currency.length < 1 || c.currency.length > 8) {
    return undefined;
  }
  return { amount: c.amount as number, currency: c.currency };
}

function asAggregate(value: unknown): InspectorAggregateSlice | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const a = value as Record<string, unknown>;
  const macroMean = a.macroMean === undefined ? undefined : finiteUnit(a.macroMean) ? (a.macroMean as number) : undefined;
  const invariantsPassed = typeof a.invariantsPassed === "boolean" ? a.invariantsPassed : undefined;
  let scorers: InspectorAggregateSlice["scorers"];
  if (a.scorers && typeof a.scorers === "object" && !Array.isArray(a.scorers)) {
    const entries = Object.entries(a.scorers).map(([id, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
      const raw = value as Record<string, unknown>;
      if (!finiteUnit(raw.mean)) return undefined;
      const interval = raw.ci95 as { low?: unknown; high?: unknown } | undefined;
      if (interval !== undefined && (!interval || !finiteUnit(interval.low) || !finiteUnit(interval.high) || interval.low > interval.high))
        return undefined;
      return [
        id,
        { mean: raw.mean, ...(interval ? { ci95: { low: interval.low as number, high: interval.high as number } } : {}) },
      ] as const;
    });
    if (entries.some((entry) => entry === undefined))
      throw new DevtoolsError("invalid scorer statistics", "ERR_PRISM_DEVTOOLS_REQUEST", 400);
    scorers = Object.fromEntries(entries as NonNullable<(typeof entries)[number]>[]);
  }
  if (macroMean === undefined && invariantsPassed === undefined && scorers === undefined) return undefined;
  return {
    ...(macroMean === undefined ? {} : { macroMean }),
    ...(scorers === undefined ? {} : { scorers }),
    ...(invariantsPassed === undefined ? {} : { invariantsPassed }),
  };
}

function asManifest(value: unknown): InspectorCompareSide["manifest"] | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const m = value as Record<string, unknown>;
  const runtimeRevision = shortId(m.runtimeRevision);
  const datasetVersion = shortId(m.datasetVersion);
  if (!runtimeRevision && !datasetVersion) return undefined;
  return {
    ...(runtimeRevision ? { runtimeRevision } : {}),
    ...(datasetVersion ? { datasetVersion } : {}),
  };
}

function finiteNonNeg(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finiteUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function shortId(value: unknown): string | undefined {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 && !value.includes("\0") ? value : undefined;
}

function numericWinner(left: number | undefined, right: number | undefined, prefer: "lower" | "higher"): InspectorCompareWinner {
  if (left === undefined || right === undefined) return "unknown";
  if (left === right) return "tie";
  if (prefer === "lower") return left < right ? "left" : "right";
  return left > right ? "left" : "right";
}
