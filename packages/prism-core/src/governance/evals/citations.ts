import { type ArtifactCitation, type CitationLiveSource, checkCitationIntegrity } from "@arnilo/prism";
import { defineScorer } from "./scorer.js";
import type { Scorer } from "./types.js";

export interface CitationIntegrityItem {
  readonly citation: ArtifactCitation;
  readonly live?: CitationLiveSource;
  readonly boundRevision?: string;
}

export interface CitationIntegrityScorerOptions {
  readonly id?: string;
}

/** Invariant 0 on missing source, hash/span mismatch, or revoked ACL. `support` cannot raise the score. */
export function createCitationIntegrityScorer<TInput = unknown, TExpected = unknown>(
  options?: CitationIntegrityScorerOptions,
): Scorer<TInput, TExpected> {
  return defineScorer({
    id: options?.id ?? "citation_integrity",
    description: "citation source/hash/span/ACL integrity; semantic support is ignored",
    score(input) {
      const env = input.environment as { citations?: readonly CitationIntegrityItem[] } | undefined;
      const items = env?.citations;
      if (!Array.isArray(items)) {
        return { score: 0, reason: "no citation environment", metadata: { invariant: true } };
      }
      for (const item of items) {
        if (!item?.citation) {
          return { score: 0, reason: "missing_source", metadata: { invariant: true } };
        }
        const result = checkCitationIntegrity(item.citation, item.live, {
          ...(item.boundRevision === undefined ? {} : { boundRevision: item.boundRevision }),
        });
        if (!result.ok) {
          return { score: 0, reason: result.reason, metadata: { invariant: true, reason: result.reason } };
        }
      }
      return { score: 1, metadata: { invariant: true } };
    },
  });
}
