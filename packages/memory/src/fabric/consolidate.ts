import { MemoryValidationError } from "../errors.js";
import { mergeNoteLinks } from "./links.js";
import type { MemoryNoteKind, MemoryNoteMetadata } from "./types.js";

/**
 * Cosine floor at which an existing same-kind note counts as the same note.
 * # ponytail: fixed threshold; make it host-tuned per embedder only if recall-driven consolidation misfires
 */
export const DEFAULT_CONSOLIDATION_THRESHOLD = 0.85;

export interface MemoryConsolidationCandidate {
  readonly id: string;
  readonly text: string;
  readonly score: number;
  readonly metadata: MemoryNoteMetadata;
}

export type MemoryConsolidationPlan =
  | { readonly action: "insert" }
  | { readonly action: "update"; readonly id: string }
  | { readonly action: "supersede"; readonly id: string };

/** Token comparison so punctuation, case, and spacing rewording is not a contradiction. */
export function normalizeNoteText(text: string): string {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join(" ");
}

/** Stable order union; `undefined` when both sides are empty. */
export function unionStrings(left: readonly string[] | undefined, right: readonly string[] | undefined): readonly string[] | undefined {
  const merged = [...new Set([...(left ?? []), ...(right ?? [])])];
  return merged.length === 0 ? undefined : merged;
}

/**
 * Deterministic default consolidation: an existing same-kind note above the threshold is either
 * rewritten in place (same note) or superseded (same subject, changed content). No model, no tools.
 */
export function planMemoryConsolidation(input: {
  readonly kind: MemoryNoteKind;
  readonly text: string;
  readonly path?: string;
  readonly threshold: number;
  readonly candidate?: MemoryConsolidationCandidate;
}): MemoryConsolidationPlan {
  const candidate = input.candidate;
  if (candidate === undefined || candidate.score < input.threshold) return { action: "insert" };
  if (input.kind === "file") {
    // Two paths are two documents even when their text is close: never supersede across paths.
    if (candidate.metadata.path !== input.path) return { action: "insert" };
    return { action: "update", id: candidate.id };
  }
  if (normalizeNoteText(candidate.text) === normalizeNoteText(input.text)) return { action: "update", id: candidate.id };
  return { action: "supersede", id: candidate.id };
}

/**
 * Merge for the update-in-place path: annotations union, the incoming note's claims win, and the
 * existing record's `validTo` is dropped unless the new note sets one (a reassertion is valid again).
 */
export function mergeNoteMetadata(existing: MemoryNoteMetadata, incoming: MemoryNoteMetadata): MemoryNoteMetadata {
  const keywords = unionStrings(existing.keywords, incoming.keywords);
  const tags = unionStrings(existing.tags, incoming.tags);
  const links = mergeNoteLinks(existing.links, incoming.links);
  const sourceEntryIds = unionStrings(existing.sourceEntryIds, incoming.sourceEntryIds);
  const tRef = incoming.tRef ?? existing.tRef;
  const validFrom = incoming.validFrom ?? existing.validFrom;
  const context = incoming.context ?? existing.context;
  const supersedes = incoming.supersedes ?? existing.supersedes;
  const promotedFrom = incoming.promotedFrom ?? existing.promotedFrom;
  const path = existing.path ?? incoming.path;
  return {
    v: 1,
    kind: incoming.kind,
    ...(tRef === undefined ? {} : { tRef }),
    ...(validFrom === undefined ? {} : { validFrom }),
    ...(incoming.validTo === undefined ? {} : { validTo: incoming.validTo }),
    ...(keywords === undefined ? {} : { keywords }),
    ...(tags === undefined ? {} : { tags }),
    ...(context === undefined ? {} : { context }),
    ...(links === undefined ? {} : { links }),
    ...(sourceEntryIds === undefined ? {} : { sourceEntryIds }),
    ...(supersedes === undefined ? {} : { supersedes }),
    ...(promotedFrom === undefined ? {} : { promotedFrom }),
    ...(path === undefined ? {} : { path }),
  };
}

/** Threshold validation shared with the fabric settings resolver. */
export function resolveConsolidationThreshold(value: unknown): number {
  if (value === undefined) return DEFAULT_CONSOLIDATION_THRESHOLD;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new MemoryValidationError("consolidate.threshold must be a finite number in [0,1]");
  }
  return value;
}
