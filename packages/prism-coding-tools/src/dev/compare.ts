/**
 * Inspector comparison over existing 072 artifacts.
 * Does not invent a report schema: TimelineSummary + ExperimentAggregate fields only.
 * Invariant failures block quality winners so a good answer cannot average away a forbidden tool.
 */

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
  readonly meanScore?: number;
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
    qualityWinner: invariantBlocked ? "invariant_blocked" : numericWinner(left.aggregate?.meanScore, right.aggregate?.meanScore, "higher"),
  };
}

export function parseInspectorCompareBody(text: string): InspectorComparison {
  if (Buffer.byteLength(text, "utf8") > MAX_COMPARE_BYTES) {
    throw Object.assign(new Error("compare body too large"), { status: 413, code: "ERR_PRISM_DEV_LIMIT" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw Object.assign(new Error("invalid compare JSON"), { status: 400, code: "ERR_PRISM_DEV_ROUTE" });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("compare body must be { left, right }"), { status: 400, code: "ERR_PRISM_DEV_ROUTE" });
  }
  const body = parsed as { left?: unknown; right?: unknown };
  const left = asSide(body.left);
  const right = asSide(body.right);
  if (!left || !right) {
    throw Object.assign(new Error("left and right must carry a metadata summary"), { status: 400, code: "ERR_PRISM_DEV_ROUTE" });
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
  const meanScore = a.meanScore === undefined ? undefined : finiteUnit(a.meanScore) ? (a.meanScore as number) : undefined;
  const invariantsPassed = typeof a.invariantsPassed === "boolean" ? a.invariantsPassed : undefined;
  if (meanScore === undefined && invariantsPassed === undefined) return undefined;
  return {
    ...(meanScore === undefined ? {} : { meanScore }),
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
