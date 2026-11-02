import { MemoryValidationError } from "@arnilo/prism-memory-core";
import { mergeNoteLinks } from "./links.js";
import type { MemoryNoteKind, MemoryNoteMetadata } from "./types.js";

/**
 * Cosine floor for near-duplicate candidates; similarity alone never retires a note.
 */
export const DEFAULT_CONSOLIDATION_THRESHOLD = 0.85;

export interface MemoryConsolidationCandidate {
  readonly id: string;
  readonly text: string;
  readonly score: number;
  readonly metadata: MemoryNoteMetadata;
}

export type MemoryConsolidationPlan =
  | { readonly action: "insert"; readonly similar?: string }
  | { readonly action: "update"; readonly id: string };

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
 * rewritten in place (same note) or retained with a similar link. No model, no tools.
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
  return { action: "insert", similar: candidate.id };
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
  const dates = incoming.dates ?? existing.dates;
  const validFrom = incoming.validFrom ?? existing.validFrom;
  const context = incoming.context ?? existing.context;
  const supersedes = incoming.supersedes ?? existing.supersedes;
  const promotedFrom = incoming.promotedFrom ?? existing.promotedFrom;
  const path = existing.path ?? incoming.path;
  const scope = incoming.scope ?? existing.scope;
  const appliesTo = incoming.appliesTo ?? existing.appliesTo;
  const key = incoming.key ?? existing.key;
  const subject = incoming.subject ?? existing.subject;
  const uses = existing.uses;
  const useSessions = existing.useSessions;
  const retrievals = existing.retrievals;
  const helpful = existing.helpful;
  const harmful = existing.harmful;
  const lastSession = existing.lastSession;
  // A trust flag survives an ordinary rewrite; only `memory.replace` or a clean human edit clears it.
  const flags = existing.flags;
  return {
    v: 1,
    kind: incoming.kind,
    ...(existing.unknown === undefined ? {} : { unknown: existing.unknown }),
    ...(tRef === undefined ? {} : { tRef }),
    ...(dates === undefined ? {} : { dates }),
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
    ...(scope === undefined ? {} : { scope }),
    ...(appliesTo === undefined ? {} : { appliesTo }),
    ...(key === undefined ? {} : { key }),
    ...(subject === undefined ? {} : { subject }),
    ...(uses === undefined ? {} : { uses }),
    ...(useSessions === undefined ? {} : { useSessions }),
    ...(retrievals === undefined ? {} : { retrievals }),
    ...(helpful === undefined ? {} : { helpful }),
    ...(harmful === undefined ? {} : { harmful }),
    ...(lastSession === undefined ? {} : { lastSession }),
    ...(flags === undefined ? {} : { flags }),
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
