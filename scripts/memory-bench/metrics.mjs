/**
 * Versioned metric definitions for the memory benchmark (plan 188.7 Task 3).
 *
 * A report without `metricVersion` predates these definitions and must not be
 * reinterpreted: `compare` labels it historical/descriptive instead of confirmatory.
 */
export const METRIC_VERSION = 2;

const proportion = (definition, direction = "higher") => ({ definition, unit: "proportion", direction });

export const METRIC_DEFINITIONS = {
  taskSuccess: proportion("fraction of sessions whose written state matches every expected field"),
  crossProjectLeakage: proportion("fraction of sessions whose written output reuses a labelled value owned by another project", "lower"),
  foreignContextExposure: proportion(
    "fraction of sessions whose visible context contains a labelled value owned by another project (exposure, not output use)",
    "lower",
  ),
  staleUseRate: proportion("fraction of superseded labels that reappear in written output", "lower"),
  repeatedErrorRate: proportion("fraction of correction sessions that repeat the corrected mistake in output", "lower"),
  rightTimeRecall: proportion(
    "raw mean of the per-session fraction of needed labels visible before the first write; never an all-needed boolean",
  ),
  abstentionCorrectness: proportion("fraction of abstention sessions whose written owner is exactly unknown"),
  poisonStored: proportion("fraction of sessions where the canary is present in stored memory (active or archived)", "lower"),
  poisonVisible: proportion("fraction of sessions where the canary enters visible context", "lower"),
  poisonReused: proportion("fraction of sessions where the canary is written into output", "lower"),
  poisonPersistence: proportion(
    "fraction of sessions where the canary is stored, visible or reused; the three channels are reported separately",
    "lower",
  ),
  tokensPerSession: { definition: "wire input tokens per session", unit: "tokens/session", direction: "lower" },
  accuracy: proportion("fraction of answers accepted by the configured judge (judge accuracy, not token F1)"),
  tokenF1: proportion("mean token-level F1 against the gold answer (never a judge verdict)"),
  answerSessionHitAtK: proportion("coarse boolean: at least one recalled round belongs to an answer session"),
  evidenceRoundCoverage: proportion("mean fraction of message-evidence rounds recalled (coarse round granularity)"),
  evidenceAllRequired: proportion("fraction of questions where every labelled message-evidence round was recalled"),
  fineEvidenceRecall: proportion("fraction of gold evidence ids recalled; null when fine gold is unavailable"),
  fineEvidencePrecision: proportion("fraction of recalled hit ids that are gold evidence ids; null when fine gold is unavailable"),
  legacyRetrievalRecallAtK: {
    definition:
      "historical coarse any-round hit written by reports before metricVersion 2; descriptive only and not comparable to fine evidence coverage",
    unit: "proportion",
    direction: "higher",
  },
};

export function metricDefinition(name) {
  return (
    METRIC_DEFINITIONS[name] ?? {
      definition: "unregistered metric; descriptive only",
      unit: "unknown",
      direction: "higher",
      unregistered: true,
    }
  );
}

/** Prefer the raw metric value, falling back to the historical boolean outcome. */
export function metricValue(row) {
  if (typeof row.value === "number" && Number.isFinite(row.value)) return row.value;
  // Historical lifecycle rows stored a boolean `value`; `correct` is the inverse for risk metrics.
  if (typeof row.value === "boolean") return Number(row.value);
  if (typeof row.correct === "boolean") return Number(row.correct);
  throw new Error("Metrics requires a finite value or boolean correct outcome");
}

/** Positive means arm B improves on arm A; lower-is-better metrics are inverted here only. */
export function improvementDelta(a, b, direction) {
  return direction === "lower" ? a - b : b - a;
}
