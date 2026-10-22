import type { MemoryNoteLink } from "./types.js";

/** Default neighbor edges the linker stores per note when a host enables it. */
export const DEFAULT_LINKER_TOP_K = 3;
/** Hard cap on linker edges and evolution patches; matches the recall top-K cap. */
export const HARD_MAX_FABRIC_LINK_TOP_K = 32;

export interface MemoryLinkCandidate {
  readonly id: string;
  readonly score: number;
}

const toWeight = (score: number): number => Math.round(Math.min(1, Math.max(0, score)) * 10_000) / 10_000;

/**
 * Deterministic linker edges: in-rank-order neighbors, weight = embedding similarity clamped to
 * [0,1]. Non-positive similarity and excluded ids (self, the note just superseded) never link.
 */
export function resolveNoteLinks(
  candidates: readonly MemoryLinkCandidate[],
  options: { readonly topK: number; readonly exclude?: readonly string[] },
): readonly MemoryNoteLink[] | undefined {
  const excluded = new Set(options.exclude ?? []);
  const links: MemoryNoteLink[] = [];
  for (const candidate of candidates) {
    if (excluded.has(candidate.id)) continue;
    const weight = toWeight(candidate.score);
    if (weight === 0) continue;
    links.push({ id: candidate.id, relation: "related", weight });
    if (links.length >= options.topK) break;
  }
  return links.length === 0 ? undefined : links;
}

/** Later groups win on the same id, so caller-supplied links override derived ones. */
export function mergeNoteLinks(...groups: (readonly MemoryNoteLink[] | undefined)[]): readonly MemoryNoteLink[] | undefined {
  const merged = new Map<string, MemoryNoteLink>();
  for (const group of groups) for (const link of group ?? []) merged.set(link.id, link);
  return merged.size === 0 ? undefined : [...merged.values()];
}
