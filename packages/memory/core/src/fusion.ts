import { MemoryValidationError } from "./errors.js";
import type { MemoryVectorHit } from "./types.js";

/** Which retrieval leg(s) surfaced a hit before fusion. */
export type RetrievalLeg = "vector" | "lexical";

export interface FusedCandidate {
  readonly hit: MemoryVectorHit;
  readonly score: number;
  readonly retrieval: RetrievalLeg | "hybrid";
}

function fusionKey(hit: Pick<MemoryVectorHit, "tenantId" | "resourceId" | "threadId" | "id">): string {
  return `${hit.tenantId}\u0000${hit.resourceId}\u0000${hit.threadId}\u0000${hit.id}`;
}

/** N-list RRF. Fusion key includes scope so the same id in two corpora stays two hits. */
export function fuseRankings(
  lists: readonly { readonly hits: readonly MemoryVectorHit[]; readonly leg: RetrievalLeg }[],
  { k = 60 }: { readonly k?: number } = {},
): readonly FusedCandidate[] {
  if (!Number.isFinite(k) || k < 0) throw new MemoryValidationError("fusion k must be finite and non-negative");
  const fused = new Map<string, { hit: MemoryVectorHit; score: number; bestRank: number; legs: Set<RetrievalLeg> }>();
  for (const { hits, leg } of lists) {
    const seen = new Set<string>();
    hits.forEach((hit, index) => {
      const key = fusionKey(hit);
      if (seen.has(key)) return;
      seen.add(key);
      const rank = index + 1;
      const contribution = 1 / (k + rank);
      const existing = fused.get(key);
      if (existing) {
        existing.score += contribution;
        existing.legs.add(leg);
        existing.bestRank = Math.min(existing.bestRank, rank);
        return;
      }
      fused.set(key, { hit, score: contribution, bestRank: rank, legs: new Set([leg]) });
    });
  }
  return [...fused.values()]
    .sort((a, b) => b.score - a.score || a.bestRank - b.bestRank || fusionKey(a.hit).localeCompare(fusionKey(b.hit)))
    .map(({ hit, legs, score }) => ({
      hit, score,
      retrieval: legs.size > 1 ? ("hybrid" as const) : ([...legs][0] as RetrievalLeg),
    }));
}
