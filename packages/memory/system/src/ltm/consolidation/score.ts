/**
 * Scoring and the promotion gate (plan 188.3 Task 3).
 *
 * A transparent linear score, so a term can be ablated and a rejection has one reason. Nothing here
 * calls a model: durability is decided deterministically over what the extractor said and what
 * lexical analysis finds in the note, its evidence, and the repository's own documents.
 */
import { tmpdir } from "node:os";
import { lexicalCoverage, lexicalDice, lexicalTerms } from "@arnilo/prism-memory-core";
import { createFabricFileJail } from "../files.js";
import type { ExtractedNote } from "./extract.js";
import type { ConsolidationCandidate } from "./gather.js";

/** The terms of the score, all data so plan 188.6 can calibrate them. */
export interface PromotionWeights {
  readonly explicit: number;
  readonly correction: number;
  readonly outcome: number;
  readonly recurrence: number;
  readonly generality: number;
  readonly ephemerality: number;
  readonly derivability: number;
  readonly duplicate: number;
}

/** Provisional until plan 188.6 calibrates against paired evidence. */
export const DEFAULT_PROMOTION_WEIGHTS: PromotionWeights = {
  explicit: 1,
  correction: 1,
  outcome: 0.5,
  recurrence: 0.5,
  generality: 0.5,
  ephemerality: -1,
  derivability: -1,
  duplicate: -0.5,
};

export const DEFAULT_PROMOTION_MIN_SCORE = 0.5;
/** Distinct sessions at which recurrence reaches 1; `log2(1 + sessions)` is normalised by it. */
export const DEFAULT_RECURRENCE_SATURATION = 4;
/** Files whose content a note may simply restate; defaults to the repository's own instructions. */
export const DEFAULT_DERIVABLE_FROM: readonly string[] = ["AGENTS.md", "README.md", "package.json", "CLAUDE.md"];
export const MAX_DERIVABLE_FILE_BYTES = 64 * 1024;
export const MAX_DERIVABLE_FILES = 16;
/** A note whose terms are this covered by a `derivableFrom` file adds nothing a reader can look up. */
export const DERIVABLE_COVERAGE = 0.9;

export interface PromotionSignals {
  readonly explicit: number;
  readonly correction: number;
  readonly outcome: number;
  readonly recurrence: number;
  readonly generality: number;
  readonly ephemerality: number;
  readonly derivability: number;
  readonly duplicate: number;
}

export type PromotionRejection = "ephemeral" | "derivable" | "score";

export interface PromotionScore {
  readonly score: number;
  readonly signals: PromotionSignals;
  readonly accepted: boolean;
  /** The one reason a note was rejected; absent when accepted. */
  readonly reason?: PromotionRejection;
}

export interface PromotionExistingNote {
  readonly id: string;
  readonly kind: string;
  readonly text: string;
}

export interface DerivableSource {
  readonly path: string;
  readonly text: string;
  readonly terms: ReadonlySet<string>;
}

export interface PromotionScoreContext {
  /** The gathered candidates `note.evidence` resolves to. */
  readonly candidates: readonly ConsolidationCandidate[];
  /** Distinct sessions covering those candidates and any existing note an UPDATE would target. */
  readonly sessions: number;
  /** Same-kind active notes in the target scope, for the duplicate term. */
  readonly existing?: readonly PromotionExistingNote[];
  /** Contents of `derivableFrom` from `loadDerivableSources`; one analysis per file per pass. */
  readonly derivable?: readonly DerivableSource[];
  readonly weights?: Partial<PromotionWeights>;
  readonly minScore?: number;
  readonly scratchDir?: string;
}

/** `log2(1 + sessions)` normalised to reach 1 at `sessions = 4`; capped at 1. */
export function recurrenceSignal(sessions: number, saturation = DEFAULT_RECURRENCE_SATURATION): number {
  if (!Number.isFinite(sessions) || sessions <= 1) return 0;
  return Math.min(1, Math.log2(1 + sessions) / Math.log2(1 + saturation));
}

/**
 * Determine whether a note is only true for a moment: a line reference, a temp path, a commit hash,
 * a branch name, or a date it would outlive. A date is not ephemeral when the note states its own
 * validity bound (`since`, `until`, `as of`), which is the durable form of a dated claim.
 */
export function ephemeralReason(text: string, scratchDir = tmpdir()): string | undefined {
  if (/:\d+/.test(text)) return "line-reference";
  if (text.includes("/tmp/") || (scratchDir.length > 1 && text.includes(scratchDir))) return "temp-path";
  if (/\b[0-9a-f]{7,40}\b/.test(text)) return "commit-hash";
  if (/\bbranch\b[^\n]{0,40}[\w.-]+\/[\w./-]+/i.test(text)) return "branch-name";
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(text) && !/\b(?:valid|since|until|as of|expires)\b/i.test(text)) return "date";
  return undefined;
}

function derivability(note: ExtractedNote, derivable: readonly DerivableSource[]): number {
  if (note.derivable) return 1;
  const terms = lexicalTerms(note.text);
  if (terms.size === 0) return 0;
  return derivable.some((source) => lexicalCoverage(terms, source.terms) >= DERIVABLE_COVERAGE) ? 1 : 0;
}

function duplicateSignal(note: ExtractedNote, existing: readonly PromotionExistingNote[]): number {
  const terms = lexicalTerms(note.text);
  let max = 0;
  for (const other of existing) {
    if (other.kind !== note.kind) continue;
    max = Math.max(max, lexicalDice(terms, lexicalTerms(other.text)));
    if (max === 1) return 1;
  }
  return max;
}

/**
 * Score one extracted note and decide whether the gate accepts it.
 *
 * Precedence: ephemerality rejects unless the user said it explicitly, derivability rejects outright,
 * and an explicit user statement is never rejected for score. Secrets and the trust scan are Task 2's
 * job and happen before this point.
 */
export function scorePromotion(note: ExtractedNote, context: PromotionScoreContext): PromotionScore {
  const weights: PromotionWeights = { ...DEFAULT_PROMOTION_WEIGHTS, ...context.weights };
  const minScore = context.minScore ?? DEFAULT_PROMOTION_MIN_SCORE;
  if (!Number.isFinite(minScore)) throw new RangeError("minScore must be a finite number");
  for (const [name, weight] of Object.entries(weights)) {
    if (!Number.isFinite(weight)) throw new RangeError(`promote.weights.${name} must be a finite number`);
  }

  const sources = new Set(context.candidates.map((candidate) => candidate.source));
  const signals: PromotionSignals = {
    // An archived exchange is verbatim user speech, so it supports an explicit user statement the
    // same way a live "explicit" candidate does (plan 188.9 Task 8).
    explicit: note.explicit && (sources.has("explicit") || sources.has("exchange")) ? 1 : 0,
    correction: note.correction && sources.has("correction") ? 1 : 0,
    outcome: context.candidates.some((candidate) => candidate.signals.outcome === 1) ? 1 : 0,
    recurrence: recurrenceSignal(context.sessions),
    generality: note.generality,
    ephemerality: ephemeralReason(note.text, context.scratchDir) === undefined ? note.ephemerality : 1,
    derivability: derivability(note, context.derivable ?? []),
    duplicate: duplicateSignal(note, context.existing ?? []),
  };

  const score = (Object.keys(signals) as (keyof PromotionSignals)[]).reduce((sum, key) => sum + weights[key] * signals[key], 0);
  const explicit = signals.explicit === 1;
  if (signals.ephemerality === 1 && !explicit) return { score, signals, accepted: false, reason: "ephemeral" };
  if (signals.derivability === 1) return { score, signals, accepted: false, reason: "derivable" };
  if (!explicit && score < minScore) return { score, signals, accepted: false, reason: "score" };
  return { score, signals, accepted: true };
}

export interface SkippedDerivableSource {
  readonly path: string;
  readonly reason: "outside-root" | "missing" | "unreadable" | "truncated";
}

export interface DerivableSources {
  readonly sources: readonly DerivableSource[];
  /** Paths the jail refused or could not read; a status note is all a pass can do with them. */
  readonly skipped: readonly SkippedDerivableSource[];
}

/**
 * Read `derivableFrom` once per pass through the fabric file jail: inside the project root, each file
 * capped at 64 KiB, a symlink or `..` escape skipped with a note rather than silently trusted.
 */
export async function loadDerivableSources(root: string, files: readonly string[] = DEFAULT_DERIVABLE_FROM): Promise<DerivableSources> {
  const jail = createFabricFileJail(root, { maxFileBytes: MAX_DERIVABLE_FILE_BYTES });
  const sources: DerivableSource[] = [];
  const skipped: SkippedDerivableSource[] = [];
  const seen = new Set<string>();
  for (const path of files.slice(0, MAX_DERIVABLE_FILES)) {
    if (seen.has(path)) continue;
    seen.add(path);
    try {
      await jail.resolve(path);
    } catch {
      skipped.push({ path, reason: "outside-root" });
      continue;
    }
    try {
      const content = await jail.read(path);
      if (content.truncated) skipped.push({ path, reason: "truncated" });
      sources.push({ path, text: content.text, terms: lexicalTerms(content.text) });
    } catch (error) {
      skipped.push({ path, reason: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable" });
    }
  }
  return { sources, skipped };
}
