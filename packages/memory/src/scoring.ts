import type { JsonObject, SecretRedactor } from "@arnilo/prism";
import { MemoryValidationError } from "./errors.js";
import type { MemoryEntryInput, MemoryVectorHit, RecallScoringOptions } from "./types.js";
import { redactJson } from "./util.js";

// # ponytail: fixed oversample factor 4 for the re-rank candidate batch; adaptive fetch if recall quality measurably drops
export const RECALL_OVERSAMPLE = 4;

/** Importance applied to records without a stored value (legacy rows stay competitive by default). */
export const NEUTRAL_IMPORTANCE = 1;

/** Weight vector after resolver validation and sum-normalization. */
export interface ResolvedRecallScoring {
  readonly similarity: number;
  readonly recency: number;
  readonly importance: number;
  readonly halfLifeMs: number;
}

/** Clamp host-trusted importance into [0,1]; absent/non-finite → neutral. */
export function clampImportance(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return NEUTRAL_IMPORTANCE;
  return Math.min(1, Math.max(0, value));
}

/** Store trust boundary: importance must be a finite number when present; out-of-range clamps. */
export function normalizeImportance(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new MemoryValidationError("importance must be a finite number");
  return clampImportance(value);
}

/**
 * Host-owned importance derivation from a reflection record (e.g. a serialized
 * observational-memory reflection): runs at write time only, receives the reflection
 * after secret redaction, and its returned weight is clamped to [0,1]. No default
 * implementation ships — hosts own the heuristic (see docs for the frequency/prominence
 * recipe example); importance is never LLM-derived in the write path.
 */
export type ImportanceFromReflection = (reflection: JsonObject) => number;

/**
 * Write-time importance: an explicit `entry.importance` wins; otherwise the host hook
 * runs once over the redacted `entry.reflection`. Returns undefined (neutral at scoring)
 * when neither yields a value. Never called at recall.
 */
export function deriveEntryImportance(
  entry: Pick<MemoryEntryInput, "importance" | "reflection">,
  hook: ImportanceFromReflection | undefined,
  redactor?: SecretRedactor,
): number | undefined {
  if (entry.importance !== undefined) return normalizeImportance(entry.importance);
  if (entry.reflection === undefined || hook === undefined) return undefined;
  return normalizeImportance(hook(redactJson(entry.reflection, redactor)));
}

/**
 * Validate weights (finite, in [0,1]) and sum-normalize. Similarity keeps the remainder of 1;
 * weights overshooting 1 normalize down to similarity 0. Returns undefined when no composite
 * weight is set — recall then behaves exactly as before (unblended, unchanged ordering).
 */
export function resolveRecallScoring(options: RecallScoringOptions | undefined): ResolvedRecallScoring | undefined {
  const recencyWeight = options?.recencyWeight ?? 0;
  const importanceWeight = options?.importanceWeight ?? 0;
  if (recencyWeight === 0 && importanceWeight === 0) return undefined;
  for (const [label, value] of [
    ["recencyWeight", recencyWeight],
    ["importanceWeight", importanceWeight],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new MemoryValidationError(`${label} must be a finite number in [0,1]`);
    }
  }
  const halfLifeMs = options?.halfLifeMs;
  if (recencyWeight > 0 && (halfLifeMs === undefined || !Number.isFinite(halfLifeMs) || halfLifeMs <= 0)) {
    throw new MemoryValidationError("halfLifeMs must be a positive finite number when recencyWeight > 0");
  }
  const total = Math.max(1, recencyWeight + importanceWeight);
  return {
    similarity: 1 - (recencyWeight + importanceWeight) / total,
    recency: recencyWeight / total,
    importance: importanceWeight / total,
    halfLifeMs: halfLifeMs ?? Number.POSITIVE_INFINITY,
  };
}

/** Exponential half-life decay from the record timestamp; 1 (neutral) when missing/ill-dated. */
export function recencyOf(createdAt: string, halfLifeMs: number, now: number): number {
  if (!Number.isFinite(halfLifeMs)) return 1;
  const ageMs = now - Date.parse(createdAt);
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  return 2 ** (-ageMs / halfLifeMs);
}

/**
 * Pure composite re-rank over one candidate batch: blends similarity, recency, and importance
 * per hit and exposes the components. Tie-break matches store ordering (score desc, sequence asc, id asc).
 */
export function rerankRecallHits(
  hits: readonly MemoryVectorHit[],
  scoring: ResolvedRecallScoring,
  now: number = Date.now(),
): MemoryVectorHit[] {
  return hits
    .map((hit) => {
      const similarity = hit.score;
      const recency = recencyOf(hit.createdAt, scoring.halfLifeMs, now);
      const importance = clampImportance(hit.importance);
      const score = similarity * scoring.similarity + recency * scoring.recency + importance * scoring.importance;
      return { ...hit, score, similarity, recency, importance };
    })
    .sort((a, b) => b.score - a.score || a.sequence - b.sequence || a.id.localeCompare(b.id));
}
