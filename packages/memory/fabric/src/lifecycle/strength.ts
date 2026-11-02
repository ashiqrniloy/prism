/**
 * The two strengths of a note (plan 188.4 Task 3, Bjork & Bjork 1992).
 *
 * Storage strength S only accumulates evidence of value — being explicit, used across sessions,
 * helpful, outcome-tagged — and a user correction is the only thing that lowers it. Retrieval
 * strength R is ACT-R base-level activation over the use log, measured in scope sessions since each
 * use, so a project left alone does not decay while another project runs (D7). Recall adds both as
 * small bounded priors after fusion; neither can override relevance on its own (D8).
 */
import type { MemoryNoteKind, MemoryNoteMetadata, MemoryNoteUseEvent } from "../types.js";

/** How much each kind of note is expected to be needed again; a lower `d` forgets slower. */
export type MemoryNoteDecay = Readonly<Record<Exclude<MemoryNoteKind, "concept">, number>> & {
  /** Unused: the lifecycle never decays, archives or evicts a concept (plan 207); a value would only rank it. */
  readonly concept?: number;
};

/** Coefficients of `S = explicit + sessions·log(1+useSessions) + helpful − harmful + outcome`. */
export interface StorageWeights {
  readonly explicit: number;
  readonly sessions: number;
  readonly helpful: number;
  readonly harmful: number;
  readonly outcome: number;
}

/** Additive recall priors, one per strength. Each bounds its prior, so relevance stays dominant. */
export interface StrengthWeights {
  readonly retrieval: number;
  readonly storage: number;
}

/** The positive term of S is bounded in practice; the cap keeps a hostile counter from inflating it. */
export const MAX_STORAGE_WEIGHT = 10;
/** A prior never exceeds its weight, and both weights are capped so a note cannot buy rank. */
export const MAX_STRENGTH_WEIGHT = 0.5;

/**
 * Provisional per-kind decay (plan 188.6 fits these): episodes are one-off, a preference outlives
 * both; `working` and `file` take the fact value because the plan does not name them.
 */
export const DEFAULT_DECAY: MemoryNoteDecay = Object.freeze({
  working: 0.4,
  episode: 0.8,
  fact: 0.4,
  preference: 0.2,
  procedure: 0.4,
  // A standing decision outlives a fact, like a preference.
  decision: 0.2,
  file: 0.4,
  // Verbatim history is detail, not a lesson: it fades faster than a fact but slower than an episode.
  exchange: 0.5,
});

export const DEFAULT_STORAGE_WEIGHTS: StorageWeights = Object.freeze({
  explicit: 1,
  sessions: 0.5,
  helpful: 0.5,
  harmful: 1,
  outcome: 0.5,
});

/** Two small priors: a note with perfect strengths earns at most 0.1, under a 0.15 scope prior. */
export const DEFAULT_STRENGTH_WEIGHTS: StrengthWeights = Object.freeze({ retrieval: 0.05, storage: 0.05 });

/** The logistic function: every prior lands in (0,1) whatever the strength is. */
export function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function count(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function term(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * `S = a·explicit + b·log(1+useSessions) + c·helpful − d·harmful + e·outcome`, clamped at 0.
 * `explicit` and `outcome` are the two `prism.promotion` signals the consolidation pass records.
 */
export function storageStrength(
  metadata: Pick<MemoryNoteMetadata, "useSessions" | "helpful" | "harmful" | "promotion">,
  weights: StorageWeights = DEFAULT_STORAGE_WEIGHTS,
): number {
  const signals = metadata.promotion?.signals;
  const strength =
    weights.explicit * term(signals?.explicit) +
    weights.sessions * Math.log(1 + count(metadata.useSessions)) +
    weights.helpful * count(metadata.helpful) -
    weights.harmful * count(metadata.harmful) +
    weights.outcome * term(signals?.outcome);
  return Math.max(0, strength);
}

/** The use log plus the counter: the terms { age, weight } of the activation sum. */
function activationAges(uses: readonly MemoryNoteUseEvent[] | undefined, clock: number): number[] {
  const now = Number.isFinite(clock) && clock > 0 ? Math.floor(clock) : 0;
  return (uses ?? []).map((use) => Math.max(1, now - (Number.isFinite(use.s) ? use.s : 0) + 1));
}

/**
 * Uses older than the 32-event log, approximated by Petrov (2006): `n` events evenly spaced between
 * the oldest logged age and the note's creation ordinal (0), summed as an integral of `t^-d`.
 */
function unloggedActivation(missing: number, ages: readonly number[], clock: number, d: number): number {
  const now = Number.isFinite(clock) && clock > 0 ? Math.floor(clock) : 0;
  const oldest = now + 1;
  const newest = ages.length === 0 ? oldest : Math.max(...ages);
  if (oldest <= newest) return missing * oldest ** -d;
  if (d === 1) return (missing / (oldest - newest)) * Math.log(oldest / newest);
  return (missing / (oldest - newest)) * ((oldest ** (1 - d) - newest ** (1 - d)) / (1 - d));
}

/**
 * `R = ln Σ (clock − s + 1)^(−d)` over the use log, with `clock` the scope-session ordinal (Task 2).
 * A note with no use counts one use at its creation ordinal (0 for a note written before the clock
 * existed), so an unused note still has a floor to fall from.
 */
export function retrievalStrength(
  metadata: Pick<MemoryNoteMetadata, "uses" | "useSessions" | "created">,
  clock: number,
  d: number,
): number {
  const decay = Number.isFinite(d) && d > 0 && d < 1 ? d : DEFAULT_DECAY.fact;
  const ages = activationAges(metadata.uses, clock);
  let total = ages.reduce((sum, age) => sum + age ** -decay, 0);
  const missing = Math.max(0, count(metadata.useSessions) - ages.length);
  if (missing > 0) total += unloggedActivation(missing, ages, clock, decay);
  // No use at all: one use at the creation ordinal, so a newly written note starts recent.
  if (ages.length === 0 && missing === 0) total += Math.max(1, Math.floor(clock) - (metadata.created ?? 0) + 1) ** -decay;
  return Math.log(total);
}

export interface StrengthPriorOptions {
  readonly decay?: MemoryNoteDecay;
  readonly storageWeights?: StorageWeights;
  readonly weights?: StrengthWeights;
}

/**
 * The bounded recall prior `w_R·σ(R) + w_S·σ(S)`, added after fusion and the scope prior. Its two
 * weights cap it, so a much more relevant note never loses to a well-used one.
 */
export function strengthPrior(
  metadata: Pick<MemoryNoteMetadata, "kind" | "uses" | "useSessions" | "helpful" | "harmful" | "promotion">,
  clock: number,
  options: StrengthPriorOptions = {},
): number {
  const weights = options.weights ?? DEFAULT_STRENGTH_WEIGHTS;
  const decay = options.decay ?? DEFAULT_DECAY;
  const d = decay[metadata.kind] ?? DEFAULT_DECAY.fact;
  const r = logistic(retrievalStrength(metadata, clock, d));
  const s = logistic(storageStrength(metadata, options.storageWeights ?? DEFAULT_STORAGE_WEIGHTS));
  return weights.retrieval * r + weights.storage * s;
}

/**
 * S normalised to [0,1) for the core `importance` column (D14): a note with no evidence scores 0,
 * an explicit note 0.5, and each extra session or helpful turn adds less than the one before.
 */
export function noteImportance(strength: number): number {
  const value = Number.isFinite(strength) && strength > 0 ? strength : 0;
  return value / (1 + value);
}
