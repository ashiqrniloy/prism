import type { MemoryVectorHit, MemoryVectorRecord, RecallScoringOptions } from "@arnilo/prism-memory-core";
import {
  HARD_TOP_K_CAP,
  type Memory,
  type MemoryLimits,
  MemoryValidationError,
  RECALL_OVERSAMPLE,
  resolveMemoryLimits,
} from "@arnilo/prism-memory-core";
import { ARCHIVE_SEARCH_COVERAGE, isActiveNote, MAX_ARCHIVED_HITS } from "./lifecycle/index.js";
import {
  baseScore,
  DEFAULT_SCOPE_PRIORS,
  type ScopeCandidateLoader,
  scopeOf,
  selectWithScopeReserve,
  shadowedExplain,
} from "./scope/recall.js";
import {
  type CreateMemoryFabricOptions,
  DEFAULT_RECALL_KINDS,
  estimateNoteTokens,
  isMemoryNoteKind,
  isMemoryNoteValidAt,
  MEMORY_NOTE_KINDS,
  type MemoryFabric,
  type MemoryFabricExplainEntry,
  type MemoryFabricRecallOptions,
  type MemoryFabricRecallResult,
  type MemoryNoteHit,
  type MemoryNoteKind,
  type MemoryNoteMetadata,
  noteFields,
  parseMemoryNoteMetadata,
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
  minSimilarity?: number,
) => Promise<FabricCandidate[]>;

/**
 * Window one recall may inspect: the `topK` hits plus the oversampled rows a linked neighbor can
 * be promoted from. `topK` at the hard cap leaves no room to expand, which is what asking for
 * every recallable note already means.
 */
export function resolveCandidateLimit(topK: number): number {
  return Math.min(HARD_TOP_K_CAP, topK * RECALL_OVERSAMPLE);
}

/**
 * One spelling for "every note kind" in every recall surface: `kinds: ["all"]` means
 * {@link MEMORY_NOTE_KINDS}, so recalling an episode or a procedure does not need the list.
 */
export function parseRecallKinds(value: unknown): readonly MemoryNoteKind[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) throw new MemoryValidationError("kinds must be a non-empty array");
  const kinds = new Set<MemoryNoteKind>();
  for (const kind of value) {
    if (kind === "all") for (const every of MEMORY_NOTE_KINDS) kinds.add(every);
    else if (isMemoryNoteKind(kind)) kinds.add(kind);
    else throw new MemoryValidationError(`Unknown memory note kind: ${String(kind)}`);
  }
  return [...kinds];
}

function resolveRecallKinds(kinds: readonly (MemoryNoteKind | "all")[] | undefined): ReadonlySet<MemoryNoteKind> {
  return new Set(parseRecallKinds(kinds) ?? DEFAULT_RECALL_KINDS);
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

/** Within a run of equal scores, a verified note comes before a candidate; the ranked order is otherwise kept. */
function verifiedFirst(chosen: readonly ChosenHit[]): ChosenHit[] {
  const out: ChosenHit[] = [];
  for (let start = 0; start < chosen.length; ) {
    let end = start + 1;
    while (end < chosen.length && chosen[end]!.candidate.hit.score === chosen[start]!.candidate.hit.score) end += 1;
    const run = chosen.slice(start, end);
    out.push(
      ...run.filter(({ candidate }) => candidate.metadata.status !== "candidate"),
      ...run.filter(({ candidate }) => candidate.metadata.status === "candidate"),
    );
    start = end;
  }
  return out;
}

export function createFabricRecall(deps: {
  readonly onRecall?: CreateMemoryFabricOptions["onRecall"];
  readonly loadCandidates: ScopeCandidateLoader;
  readonly limits: MemoryLimits;
  readonly memory: Memory;
  readonly getNotes?: (ids: readonly string[], signal?: AbortSignal) => Promise<readonly MemoryVectorRecord[]>;
  /** Additive priors applied by the scope loader; used here only for shadowed explain rows. */
  readonly priors?: import("./scope/recall.js").ScopePriors;
}): MemoryFabric["recall"] {
  const { loadCandidates, limits } = deps;

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
      ...(hit.coverage === undefined ? {} : { coverage: hit.coverage }),
      ...(hit.retrieval === undefined ? {} : { retrieval: hit.retrieval }),
      ...(hit.similarity === undefined ? {} : { similarity: hit.similarity }),
      ...(hit.recency === undefined ? {} : { recency: hit.recency }),
    };
  }

  function toExplain(hit: MemoryVectorHit, link: boolean): MemoryFabricExplainEntry {
    return {
      id: hit.id,
      score: hit.score,
      ...(hit.retrieval === undefined ? {} : { retrieval: hit.retrieval }),
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
    if (
      recallOptions.tRef &&
      (!Number.isFinite(Date.parse(recallOptions.tRef.from)) ||
        !Number.isFinite(Date.parse(recallOptions.tRef.to)) ||
        Date.parse(recallOptions.tRef.from) >= Date.parse(recallOptions.tRef.to))
    ) {
      throw new MemoryValidationError("tRef must be a valid increasing timestamp interval");
    }
    const kinds = resolveRecallKinds(recallOptions.kinds);
    const asOfMs = resolveRecallAsOf(recallOptions.asOf);
    const topK = resolveMemoryLimits({ topK: recallOptions.topK ?? limits.topK }).topK;
    const budget = resolveBudget(recallOptions.budget);
    const loaded = await loadCandidates(
      query,
      kinds,
      asOfMs,
      resolveCandidateLimit(topK),
      recallOptions.signal,
      recallOptions.scoring,
      recallOptions.minSimilarity ?? 0.35,
      recallOptions.touchedPaths,
    );
    const candidates = loaded.candidates;

    const eligible = candidates.filter((candidate) => {
      if (!recallOptions.tRef) return true;
      const time = candidate.metadata.tRef ?? candidate.hit.createdAt;
      return Date.parse(time) >= Date.parse(recallOptions.tRef.from) && Date.parse(time) < Date.parse(recallOptions.tRef.to);
    });
    const chosen = new Map<string, ChosenHit>();
    for (const candidate of eligible.slice(0, topK)) chosen.set(candidate.hit.id, { candidate, link: false });

    const ids = [...new Set([...chosen.values()].flatMap(({ candidate }) => (candidate.metadata.links ?? []).map((link) => link.id)))]
      .filter((id) => !chosen.has(id))
      .slice(0, topK);
    const linked = ids.length
      ? deps.getNotes === undefined
        ? await deps.memory.get(ids, { signal: recallOptions.signal })
        : await deps.getNotes(ids, recallOptions.signal)
      : [];
    const byId = new Map<string, FabricCandidate>();
    for (const record of linked) {
      const metadata = parseMemoryNoteMetadata(record.metadata);
      if (
        !metadata ||
        !kinds.has(metadata.kind) ||
        !isMemoryNoteValidAt(metadata, asOfMs) ||
        !isActiveNote(metadata, { asOfMs, allowCandidate: true })
      )
        continue;
      if (recallOptions.tRef) {
        const time = metadata.tRef ?? record.createdAt;
        if (Date.parse(time) < Date.parse(recallOptions.tRef.from) || Date.parse(time) >= Date.parse(recallOptions.tRef.to)) continue;
      }
      byId.set(record.id, { hit: { ...record, score: 0 }, metadata });
    }
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

    // Archive search (plan 188.4 Task 4): an explicit flag, or a weak active result, also looks at
    // archived notes. They never mix into the active ranking: they are appended after it.
    const bestActive = candidates.length === 0 ? 0 : baseScore(candidates[0]!.hit);
    const archivedCap = recallOptions.includeArchived === true ? topK : MAX_ARCHIVED_HITS;
    const searchArchives =
      recallOptions.includeArchived === true || (recallOptions.archiveSearch !== false && bestActive < ARCHIVE_SEARCH_COVERAGE);
    const archivedChosen: ChosenHit[] = [];
    if (searchArchives) {
      const archivedLoaded = await loadCandidates(
        query,
        kinds,
        asOfMs,
        resolveCandidateLimit(archivedCap),
        recallOptions.signal,
        recallOptions.scoring,
        // The active floor is what made this result weak; an archived note is judged by rank only.
        0,
        recallOptions.touchedPaths,
        true,
      );
      for (const candidate of archivedLoaded.candidates) {
        if (archivedChosen.length >= archivedCap) break;
        if (candidate.metadata.status !== "archived") continue;
        archivedChosen.push({ candidate, link: false });
      }
    }

    const ranked = [...verifiedFirst([...chosen.values()]), ...archivedChosen];
    const picked = new Set(
      selectWithScopeReserve(ranked, {
        ...(budget === undefined ? {} : { budget }),
        tokens: (item) => toHit(item.candidate).tokenCount,
        level: (item) => scopeOf(item.candidate),
      }),
    );
    const hits: MemoryNoteHit[] = [];
    const explain: MemoryFabricExplainEntry[] = [];
    for (const item of ranked) {
      if (!picked.has(item)) continue;
      const { candidate, link } = item;
      const hit = toHit(candidate);
      hits.push(hit);
      explain.push({
        ...toExplain(candidate.hit, link),
        ...(candidate.metadata.links === undefined ? {} : { links: candidate.metadata.links }),
      });
    }
    explain.push(...shadowedExplain(loaded.shadowed, deps.priors ?? DEFAULT_SCOPE_PRIORS, recallOptions.touchedPaths ?? []));
    // Observers are diagnostic only: a broken observer must not break a recall.
    try {
      deps.onRecall?.({
        query,
        options: recallOptions,
        candidates: [
          ...new Map(
            [...eligible, ...ranked.map((item) => item.candidate)].map(
              (candidate) => [candidate.hit.id, { id: candidate.hit.id, score: candidate.hit.score }] as const,
            ),
          ).values(),
        ],
        returnedIds: hits.map((hit) => hit.id),
      });
    } catch {
      /* Diagnostic observers cannot affect retrieval. */
    }
    return { hits, explain };
  };
}
