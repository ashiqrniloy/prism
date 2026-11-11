/**
 * Union recall across the active memory scopes (plan 188.2 Task 4).
 *
 * Each scope keeps its own `Memory` (and therefore its own tenant/resource/thread isolation), so the
 * union is built by querying every scope, fusing the per-scope rankings with RRF, and adding one
 * bounded prior per scope. Priors are data: the table below is the only place a level influences the
 * ranking. A `path` note earns its prior only when one of its `applies_to` globs matches a file the
 * session touched, so a narrow note never outranks a project note elsewhere.
 *
 * Recall adds the two strength priors (plan 188.4 Task 3) here, after fusion and the scope prior: a
 * well-used note outranks an equally relevant neglected one, and neither prior can override relevance.
 */
import { fuseRankings, MemoryValidationError, type MemoryVectorHit, type RecallScoringOptions } from "@arnilo/prism-memory-system/core";
import type { FabricCandidate } from "../recall.js";
import type { FabricScopeLevel, MemoryFabricExplainEntry, MemoryNoteMetadata, MemoryNoteScope } from "../types.js";

export type ScopePriors = Readonly<Record<MemoryNoteScope, number>>;

/** Defaults from plan 188.2 Task 4. `path` only applies when its glob matches a touched path. */
export const DEFAULT_SCOPE_PRIORS: ScopePriors = Object.freeze({ path: 0.15, project: 0.1, team: 0.075, agent: 0.05, user: 0 });
export const MAX_SCOPE_PRIOR = 0.5;

/** Narrowest first: a lower index wins key shadowing. A private project note beats a shared team note. */
export const SCOPE_DEPTH: readonly MemoryNoteScope[] = ["path", "project", "team", "agent", "user"];

export function resolveScopePriors(input: Partial<Record<MemoryNoteScope, number>> | undefined): ScopePriors {
  const priors: Record<MemoryNoteScope, number> = { ...DEFAULT_SCOPE_PRIORS };
  if (input === undefined) return priors;
  for (const level of SCOPE_DEPTH) {
    const value = input[level];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_SCOPE_PRIOR) {
      throw new MemoryValidationError(`scope prior ${level} must be a number in [0,${MAX_SCOPE_PRIOR}]`);
    }
    priors[level] = value;
  }
  return priors;
}

export function scopeOf(candidate: FabricCandidate): MemoryNoteScope {
  return candidate.metadata.scope ?? "project";
}

/**
 * Glob match for `applies_to`: `/` is the separator, `**` crosses directories, `*` and `?` stay
 * inside one segment. Patterns and paths are project-root-relative with no `..` (validated on write).
 */
const GLOB_PATTERN_CACHE = new Map<string, RegExp>();
/** Compile once per distinct validated glob; the cache is bounded so an import cannot grow it forever. */
function globPattern(pattern: string): RegExp {
  const cached = GLOB_PATTERN_CACHE.get(pattern);
  if (cached !== undefined) return cached;
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!;
    if (char === "*" && pattern[index + 1] === "*") {
      index += 1;
      if (pattern[index + 1] === "/") {
        index += 1;
        source += "(?:[^/]+/)*";
      } else source += ".*";
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const compiled = new RegExp(`${source}$`);
  if (GLOB_PATTERN_CACHE.size >= 1_024) GLOB_PATTERN_CACHE.clear();
  GLOB_PATTERN_CACHE.set(pattern, compiled);
  return compiled;
}

export function globMatches(pattern: string, path: string): boolean {
  return globPattern(pattern).test(path);
}

/** The prior this candidate earns: `path` only on a touched-path glob match, otherwise its level. */
export function priorFor(metadata: MemoryNoteMetadata, priors: ScopePriors, touchedPaths: readonly string[]): number {
  const level = metadata.scope ?? "project";
  if (level !== "path") return priors[level];
  const globs = metadata.appliesTo ?? [];
  return globs.some((glob) => touchedPaths.some((path) => globMatches(glob, path))) ? priors.path : priors.project;
}

/** What shadows what: a note's `key`. */
function shadowKey(metadata: MemoryNoteMetadata): string | undefined {
  return metadata.key;
}

/** One hit dropped because a narrower scope holds the same `key`. */
export interface ShadowedCandidate {
  readonly candidate: FabricCandidate;
  readonly byId: string;
}

export interface ScopeRecallResult {
  readonly candidates: readonly FabricCandidate[];
  readonly shadowed: readonly ShadowedCandidate[];
}

/** A scope loader: one `Memory` per active storage level. */
export type ScopeCandidateLoader = (
  query: string,
  kinds: ReadonlySet<import("../types.js").MemoryNoteKind>,
  asOfMs: number,
  limit: number,
  signal?: AbortSignal,
  scoring?: RecallScoringOptions,
  minSimilarity?: number,
  touchedPaths?: readonly string[],
  allowArchived?: boolean,
  window?: { readonly from?: number; readonly to?: number },
) => Promise<ScopeRecallResult>;

export interface ScopeRecallScope {
  readonly level: FabricScopeLevel;
  readonly memory: import("@arnilo/prism-memory-system/core").Memory;
}

export function createScopeRecall(deps: {
  readonly scopes: readonly ScopeRecallScope[];
  readonly recallCandidates: (
    query: string,
    kinds: ReadonlySet<import("../types.js").MemoryNoteKind>,
    asOfMs: number,
    limit: number,
    signal?: AbortSignal,
    scoring?: RecallScoringOptions,
    minSimilarity?: number,
    source?: import("@arnilo/prism-memory-system/core").Memory,
    allowArchived?: boolean,
    window?: { readonly from?: number; readonly to?: number },
  ) => Promise<FabricCandidate[]>;
  readonly priors: ScopePriors;
  /** `w_R·σ(R) + w_S·σ(S)` for one note; absent keeps the pre-188.4 ranking. */
  readonly strengthPrior?: (metadata: MemoryNoteMetadata) => number;
}): ScopeCandidateLoader {
  const { scopes, recallCandidates, priors, strengthPrior } = deps;

  return async function load(
    query,
    kinds,
    asOfMs,
    limit,
    signal,
    scoring,
    minSimilarity,
    touchedPaths = [],
    allowArchived = false,
    window,
  ) {
    const perScope = await Promise.all(
      scopes.map(async (scope) => ({
        level: scope.level,
        memory: scope.memory,
        candidates: (
          await recallCandidates(query, kinds, asOfMs, limit, signal, scoring, minSimilarity, scope.memory, allowArchived, window)
        ).map((candidate) =>
          // A checked-in team note may carry no scope of its own: the store it lives in is the level.
          scope.level === "team" && candidate.metadata.scope === undefined
            ? { ...candidate, metadata: { ...candidate.metadata, scope: "team" as const } }
            : candidate,
        ),
      })),
    );
    // One active scope is the pre-188.2 path: no fusion and no prior, so scores stay the mode's own.
    if (perScope.length === 1) return { candidates: perScope[0]!.candidates, shadowed: [] };

    const all = perScope.flatMap((scope) => scope.candidates);
    // Key shadowing: the narrowest scope wins, regardless of rank. A note without a key never shadows.
    const winners = new Map<string, FabricCandidate>();
    const shadowed: ShadowedCandidate[] = [];
    for (const level of SCOPE_DEPTH) {
      for (const candidate of all.filter((item) => scopeOf(item) === level)) {
        const key = shadowKey(candidate.metadata);
        if (key === undefined) continue;
        const winner = winners.get(key);
        if (winner === undefined) {
          winners.set(key, candidate);
          continue;
        }
        // Only a wider scope loses to the winner; two notes in one scope with the same key both stay.
        if (SCOPE_DEPTH.indexOf(scopeOf(winner)) < SCOPE_DEPTH.indexOf(level)) {
          shadowed.push({ candidate, byId: winner.hit.id });
        }
      }
    }
    const dropped = new Set(shadowed.map(({ candidate }) => `${candidate.hit.resourceId}\u0000${candidate.hit.id}`));
    const visible = all.filter((candidate) => !dropped.has(`${candidate.hit.resourceId}\u0000${candidate.hit.id}`));

    const lists = perScope
      .map((scope) => ({
        hits: scope.candidates.filter((candidate) => visible.includes(candidate)).map((candidate) => candidate.hit),
        leg: (scope.memory.retrieval === "hybrid" ? "vector" : "lexical") as "vector" | "lexical",
      }))
      .filter((list) => list.hits.length > 0);
    const byKey = new Map(visible.map((candidate) => [`${candidate.hit.resourceId}\u0000${candidate.hit.id}`, candidate]));
    const fused: FabricCandidate[] = [];
    for (const entry of fuseRankings(lists)) {
      const candidate = byKey.get(`${entry.hit.resourceId}\u0000${entry.hit.id}`);
      if (candidate === undefined) continue;
      fused.push({
        metadata: candidate.metadata,
        hit: {
          ...candidate.hit,
          score: entry.score + priorFor(candidate.metadata, priors, touchedPaths) + (strengthPrior?.(candidate.metadata) ?? 0),
          retrieval: entry.retrieval,
        },
      });
    }
    fused.sort((a, b) => b.hit.score - a.hit.score || a.hit.id.localeCompare(b.hit.id));
    return { candidates: fused, shadowed };
  };
}

/**
 * Two-pass budget selection: the best hit of every scope that has one is reserved first, then the
 * rest fill by rank. The best overall hit is always returned, even when it alone exceeds the budget.
 */
export function selectWithScopeReserve<T>(
  ranked: readonly T[],
  options: {
    readonly budget?: number;
    readonly limit?: number;
    readonly tokens: (item: T) => number;
    readonly level: (item: T) => string;
  },
): T[] {
  const pool = options.limit === undefined ? ranked : ranked.slice(0, options.limit);
  if (pool.length === 0) return [];
  if (options.budget === undefined) return [...pool];
  const picked = new Set<T>();
  const levels = new Set<string>();
  let used = 0;
  const add = (item: T): void => {
    picked.add(item);
    used += options.tokens(item);
  };
  // Reserve one slot per scope, in rank order; a scope whose best hit does not fit is skipped.
  for (const item of pool) {
    const level = options.level(item);
    if (levels.has(level)) continue;
    levels.add(level);
    if (picked.size > 0 && used + options.tokens(item) > options.budget) continue;
    add(item);
  }
  // Fill the rest by rank; the first hit that does not fit ends the prefix (the old budget rule).
  for (const item of pool) {
    if (picked.has(item)) continue;
    if (used + options.tokens(item) > options.budget) break;
    add(item);
  }
  return pool.filter((item) => picked.has(item));
}

/** Explain rows for hits that lost to a narrower scope's key; kept for diagnosis, never returned as hits. */
export function shadowedExplain(
  shadowed: readonly ShadowedCandidate[],
  priors: ScopePriors,
  touchedPaths: readonly string[],
): MemoryFabricExplainEntry[] {
  return shadowed.map(({ candidate, byId }) => ({
    id: candidate.hit.id,
    score: candidate.hit.score + priorFor(candidate.metadata, priors, touchedPaths),
    link: false,
    valid: true,
    shadowedBy: byId,
  }));
}

/** The hit's mode similarity before the scope prior, used by the floor and by explain. */
export function baseScore(hit: MemoryVectorHit): number {
  return hit.similarity ?? hit.coverage ?? hit.score;
}
