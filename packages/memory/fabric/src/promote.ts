import type { JsonSchema } from "@arnilo/prism";
import { MemoryValidationError } from "@arnilo/prism-memory-core";
import { DEFAULT_MAX_CONSOLIDATION_CANDIDATES } from "./consolidation/gather.js";
import {
  DEFAULT_DERIVABLE_FROM,
  DEFAULT_PROMOTION_MIN_SCORE,
  DEFAULT_PROMOTION_WEIGHTS,
  type PromotionWeights,
} from "./consolidation/score.js";

export const DEFAULT_PROMOTE_MIN_TURNS_BETWEEN = 8;
/** The hard cap keeps a misconfigured threshold from making a candidate immortal. */
export const HARD_PROMOTE_MIN_TURNS_BETWEEN = 1_000;
/**
 * Session consolidation, off by default: `promote: false` (or absent) makes no extractor call.
 * The candidate lifecycle itself lives in `lifecycle` (verification by use is `verifyAfterSessions`).
 */
export interface MemoryFabricPromoteConfig {
  /** The extractor model; default: the agent's model. */
  readonly model?: string;
  /** Acceptance floor. Default 0.5 (provisional until plan 188.6). */
  readonly minScore?: number;
  /** Per-term weight overrides; every term defaults to {@link DEFAULT_PROMOTION_WEIGHTS}. */
  readonly weights?: Partial<PromotionWeights>;
  /** Candidates per pass. Default 48. */
  readonly maxCandidates?: number;
  /** Turns between background passes. Default 8. */
  readonly minTurnsBetween?: number;
  /** Files a note may not merely restate. Default `["AGENTS.md", "README.md", "package.json", "CLAUDE.md"]`. */
  readonly derivableFrom?: readonly string[];
}

export interface ResolvedPromoteConfig {
  readonly enabled: boolean;
  readonly model?: string;
  readonly minScore: number;
  readonly weights?: Readonly<Partial<PromotionWeights>>;
  readonly maxCandidates: number;
  readonly minTurnsBetween: number;
  readonly derivableFrom: readonly string[];
}

const promotionWeightSchema: JsonSchema = { type: "number", minimum: -8, maximum: 8 };

export const memoryFabricPromoteSchema = {
  anyOf: [
    { const: false },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        model: { type: "string", minLength: 1, maxLength: 4096 },
        minScore: { type: "number", minimum: 0, maximum: 8 },
        weights: {
          type: "object",
          additionalProperties: false,
          properties: Object.fromEntries(Object.keys(DEFAULT_PROMOTION_WEIGHTS).map((name) => [name, promotionWeightSchema])),
        },
        maxCandidates: { type: "integer", minimum: 1, maximum: 256 },
        minTurnsBetween: { type: "integer", minimum: 1, maximum: HARD_PROMOTE_MIN_TURNS_BETWEEN },
        derivableFrom: { type: "array", maxItems: 16, items: { type: "string", minLength: 1, maxLength: 200 } },
      },
    },
  ],
} as const;

export function resolvePromoteConfig(value: false | MemoryFabricPromoteConfig | undefined): ResolvedPromoteConfig {
  const bounded = (name: string, raw: number | undefined, fallback: number, max: number): number => {
    if (raw === undefined) return fallback;
    if (!Number.isSafeInteger(raw) || raw < 1 || raw > max)
      throw new MemoryValidationError(`promote.${name} must be an integer in [1,${max}]`);
    return raw;
  };
  const enabled = value !== undefined && value !== false;
  const config = value === undefined || value === false ? undefined : value;
  const minScore = config?.minScore ?? DEFAULT_PROMOTION_MIN_SCORE;
  if (!Number.isFinite(minScore) || minScore < 0) throw new MemoryValidationError("promote.minScore must be a finite non-negative number");
  return {
    enabled,
    ...(config?.model === undefined ? {} : { model: config.model }),
    minScore,
    ...(config?.weights === undefined ? {} : { weights: config.weights }),
    maxCandidates: bounded("maxCandidates", config?.maxCandidates, DEFAULT_MAX_CONSOLIDATION_CANDIDATES, 256),
    minTurnsBetween: bounded("minTurnsBetween", config?.minTurnsBetween, DEFAULT_PROMOTE_MIN_TURNS_BETWEEN, HARD_PROMOTE_MIN_TURNS_BETWEEN),
    derivableFrom: config?.derivableFrom ?? DEFAULT_DERIVABLE_FROM,
  };
}

/** One pass's counts, kept in session state for `memory:status`. */
export interface FabricConsolidationReport {
  readonly pass: string;
  readonly at: string;
  readonly candidates: number;
  readonly extracted: number;
  readonly accepted: number;
  readonly rejected: {
    readonly score: number;
    readonly ephemeral: number;
    readonly derivable: number;
    readonly trust: number;
    readonly secret: number;
  };
  readonly written: number;
  readonly updated: number;
  readonly exceptions: number;
  readonly retired: number;
  /** Actual extractor calls: 1 for a valid pass, 2 after one bounded repair. */
  readonly modelCalls: number;
  /** Extractor calls spent correcting a malformed answer; never more than 1. */
  readonly correctionCalls?: number;
}

/** Per-session consolidation state: the cursor, the last pass's counts, and trust-scan refusals. */
export interface FabricPromoteState {
  /** The last entry id a pass covered; gathering resumes after it. */
  readonly cursor?: string;
  /** The last completed pass, replayed by `memory:status`. */
  readonly last?: FabricConsolidationReport;
  /** Notes the extractor's output refused for the trust scan. */
  readonly refused: number;
}

export const INITIAL_PROMOTE_STATE: FabricPromoteState = { refused: 0 };

export function readPromoteState(value: unknown): FabricPromoteState {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return INITIAL_PROMOTE_STATE;
  const record = value as { cursor?: unknown; last?: unknown; refused?: unknown };
  return {
    ...(typeof record.cursor === "string" && record.cursor.length > 0 ? { cursor: record.cursor } : {}),
    ...(readReport(record.last) === undefined ? {} : { last: readReport(record.last)! }),
    refused: typeof record.refused === "number" && Number.isSafeInteger(record.refused) && record.refused >= 0 ? record.refused : 0,
  };
}

/** Fail-closed read of a persisted report: a malformed one is simply absent from `memory:status`. */
function readReport(value: unknown): FabricConsolidationReport | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const numbers = ["candidates", "extracted", "accepted", "written", "updated", "exceptions", "retired", "modelCalls"] as const;
  if (numbers.some((key) => typeof record[key] !== "number" || !Number.isSafeInteger(record[key]))) return undefined;
  if (
    typeof record.pass !== "string" ||
    record.pass.length === 0 ||
    typeof record.at !== "string" ||
    !Number.isFinite(Date.parse(record.at))
  )
    return undefined;
  const rejected = record.rejected;
  if (rejected === null || typeof rejected !== "object" || Array.isArray(rejected)) return undefined;
  const reasons = ["score", "ephemeral", "derivable", "trust", "secret"] as const;
  const rejectedRecord = rejected as Record<string, unknown>;
  if (reasons.some((key) => typeof rejectedRecord[key] !== "number" || !Number.isSafeInteger(rejectedRecord[key]))) return undefined;
  return {
    pass: record.pass,
    at: record.at,
    candidates: record.candidates as number,
    extracted: record.extracted as number,
    accepted: record.accepted as number,
    rejected: Object.fromEntries(reasons.map((key) => [key, rejectedRecord[key]])) as FabricConsolidationReport["rejected"],
    written: record.written as number,
    updated: record.updated as number,
    exceptions: record.exceptions as number,
    retired: record.retired as number,
    modelCalls: record.modelCalls as number,
    ...(typeof record.correctionCalls === "number" && Number.isSafeInteger(record.correctionCalls) && record.correctionCalls >= 0
      ? { correctionCalls: record.correctionCalls }
      : {}),
  };
}

export interface FabricNoteCensus {
  readonly candidate: number;
  readonly verified: number;
  readonly archived: number;
  readonly reconsolidate?: number;
}
