import { MemoryValidationError } from "../errors.js";
import { HARD_TOP_K_CAP, resolveMemoryLimits, type MemoryLimits } from "../limits.js";
import { RECALL_OVERSAMPLE } from "../scoring.js";
import type { MemoryVectorHit, RecallScoringOptions } from "../types.js";
import {
  DEFAULT_RECALL_KINDS,
  estimateNoteTokens,
  isMemoryNoteKind,
  noteFields,
  type MemoryFabric,
  type MemoryFabricExplainEntry,
  type MemoryFabricRecallOptions,
  type MemoryFabricRecallResult,
  type MemoryNoteHit,
  type MemoryNoteKind,
  type MemoryNoteMetadata,
} from "./types.js";

/** A recalled row plus its parsed fabric metadata (kind and validity already checked). */
export interface FabricCandidate {
  readonly hit: MemoryVectorHit;
  readonly metadata: MemoryNoteMetadata;
}

/** Bounded candidate loader shared by recall and the write path — one store query per call. */
export type FabricCandidateLoader = (
  query: string,
  kinds: ReadonlySet<MemoryNoteKind>,
  asOfMs: number,
  limit: number,
  signal?: AbortSignal,
  scoring?: RecallScoringOptions,
) => Promise<FabricCandidate[]>;

/**
 * Window one recall may inspect: the `topK` hits plus the oversampled rows a linked neighbor can
 * be promoted from. `topK` at the hard cap leaves no room to expand, which is what asking for
 * every recallable note already means.
 */
export function resolveCandidateLimit(topK: number): number {
  return Math.min(HARD_TOP_K_CAP, topK * RECALL_OVERSAMPLE);
}

function resolveRecallKinds(kinds: readonly MemoryNoteKind[] | undefined): ReadonlySet<MemoryNoteKind> {
  if (kinds === undefined) return new Set(DEFAULT_RECALL_KINDS);
  if (!Array.isArray(kinds) || kinds.length === 0) throw new MemoryValidationError("kinds must be a non-empty array");
  for (const kind of kinds) if (!isMemoryNoteKind(kind)) throw new MemoryValidationError(`Unknown memory note kind: ${String(kind)}`);
  return new Set(kinds);
}

function resolveRecallAsOf(asOf: string | Date | undefined): number {
  if (asOf === undefined) return Date.now();
  const ms = asOf instanceof Date ? asOf.getTime() : Date.parse(asOf);
  if (!Number.isFinite(ms)) throw new MemoryValidationError("asOf must be a valid Date or ISO timestamp");
  return ms;
}

/** Ceiling on the summed note tokens of one result; `undefined` = no ceiling beyond `topK`. */
function resolveBudget(budget: number | undefined): number | undefined {
  if (budget === undefined) return undefined;
  if (!Number.isSafeInteger(budget) || budget < 1) throw new MemoryValidationError("budget must be a positive safe integer");
  return budget;
}

interface ChosenHit {
  readonly candidate: FabricCandidate;
  /** True when the hit came in through a link from a seed hit, not from the query ranking. */
  readonly link: boolean;
}

export function createFabricRecall(deps: {
  readonly recallCandidates: FabricCandidateLoader;
  readonly limits: MemoryLimits;
}): MemoryFabric["recall"] {
  const { recallCandidates, limits } = deps;

  function toHit({ hit, metadata }: FabricCandidate): MemoryNoteHit {
    return {
      ...noteFields(metadata),
      id: hit.id,
      kind: metadata.kind,
      content: hit.text,
      ingestedAt: hit.createdAt,
      tokenCount: estimateNoteTokens(hit.text),
      ...(hit.importance === undefined ? {} : { importance: hit.importance }),
      ...(hit.consent === undefined ? {} : { consent: hit.consent }),
      scope: { tenantId: hit.tenantId, resourceId: hit.resourceId, threadId: hit.threadId },
      score: hit.score,
      ...(hit.similarity === undefined ? {} : { similarity: hit.similarity }),
      ...(hit.recency === undefined ? {} : { recency: hit.recency }),
    };
  }

  function toExplain(hit: MemoryVectorHit, link: boolean): MemoryFabricExplainEntry {
    return {
      id: hit.id,
      score: hit.score,
      ...(hit.similarity === undefined ? {} : { similarity: hit.similarity }),
      ...(hit.recency === undefined ? {} : { recency: hit.recency }),
      ...(hit.importance === undefined ? {} : { importance: hit.importance }),
      link,
      // Every returned hit passed the validity filter for this `asOf`; the flag is here so a
      // caller can record why a hit was admitted without re-deriving the window.
      valid: true,
    };
  }

  return async function recall(query: string, recallOptions: MemoryFabricRecallOptions = {}): Promise<MemoryFabricRecallResult> {
    const kinds = resolveRecallKinds(recallOptions.kinds);
    const asOfMs = resolveRecallAsOf(recallOptions.asOf);
    const topK = resolveMemoryLimits({ topK: recallOptions.topK ?? limits.topK }).topK;
    const budget = resolveBudget(recallOptions.budget);
    const candidates = await recallCandidates(
      query,
      kinds,
      asOfMs,
      resolveCandidateLimit(topK),
      recallOptions.signal,
      recallOptions.scoring,
    );

    const chosen = new Map<string, ChosenHit>();
    for (const candidate of candidates.slice(0, topK)) chosen.set(candidate.hit.id, { candidate, link: false });

    // 1-hop expansion, bounded by `topK`, inside the batch this recall already fetched: `Memory`
    // exposes no id lookup, so a neighbor outside the recalled window cannot be fetched.
    // ponytail: batch-only expansion; add an id/get path to `Memory` if distant links matter.
    const byId = new Map(candidates.map((candidate) => [candidate.hit.id, candidate]));
    let expansions = 0;
    for (const { candidate } of [...chosen.values()]) {
      if (expansions >= topK) break;
      for (const link of candidate.metadata.links ?? []) {
        if (expansions >= topK) break;
        if (chosen.has(link.id)) continue;
        const target = byId.get(link.id);
        if (target === undefined) continue;
        chosen.set(link.id, { candidate: target, link: true });
        expansions += 1;
      }
    }

    const hits: MemoryNoteHit[] = [];
    const explain: MemoryFabricExplainEntry[] = [];
    let usedTokens = 0;
    for (const { candidate, link } of chosen.values()) {
      const hit = toHit(candidate);
      // Prefix over the ranked order: the best hit is always returned, then the first note that
      // does not fit ends the result.
      if (hits.length > 0 && budget !== undefined && usedTokens + hit.tokenCount > budget) break;
      usedTokens += hit.tokenCount;
      hits.push(hit);
      explain.push(toExplain(candidate.hit, link));
    }
    return { hits, explain };
  };
}
