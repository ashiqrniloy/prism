/**
 * Validated `packageConfig` for `@arnilo/prism-memory-fabric` (plan 158 Task 4).
 *
 * Every secret field is a ref (`env:` / `keyring:`) and fails validation as a literal. The schema
 * declares no `required` key: a required field with no default would fail package conformance, so
 * `setup` checks what it needs and notes the reason instead of throwing.
 */
import { isAbsolute, relative, resolve } from "node:path";
import type { JsonSchema } from "@arnilo/prism";
import { HARD_TOP_K_CAP, MemoryValidationError } from "@arnilo/prism-memory-core";
import type { MemoryWorkerLimitOptions } from "@arnilo/prism-memory-observational";
import {
  HARD_RULES_TOKENS,
  type MemoryFabricRulesConfig,
  type ResolvedFabricRulesOptions,
  resolveFabricRulesOptions,
} from "./delivery/rules.js";
import {
  HARD_CUE_TOKENS,
  HARD_CUES_PER_TURN,
  type MemoryFabricCuesConfig,
  type ResolvedFabricCuesOptions,
  resolveFabricCuesOptions,
} from "./delivery/cues.js";
import {
  HARD_DIRECTORY_FILES,
  HARD_DIRECTORY_TOKENS,
  HARD_DIRECTORY_TOPICS,
  type MemoryFabricDirectoryConfig,
  type ResolvedFabricDirectoryOptions,
  resolveFabricDirectoryOptions,
} from "./directory.js";
import {
  DEFAULT_LESSON_ARCHIVE_SESSIONS,
  DEFAULT_LESSON_NUDGE_TURNS,
  MAX_LESSON_ARCHIVE_SESSIONS,
  MAX_LESSON_NUDGE_TURNS,
} from "./lessons.js";
import { MAX_BIND_THRESHOLD, resolveBindThreshold } from "./ontology/bind.js";
import { MAX_CLAIMS_RENDERED_LIMIT, MAX_CONCEPT_PRIOR, resolveConceptPrior, resolveMaxClaimsRendered } from "./ontology/render.js";

export type {
  MemoryFabricRulesConfig,
  MemoryFabricCuesConfig,
  MemoryFabricTeamConfig,
  ResolvedFabricRulesOptions,
  ResolvedFabricCuesOptions,
  ResolvedFabricTeamOptions,
};

import { DECISION_POINTS, type MemoryFabricDecisionsConfig, type ResolvedDecisionsConfig, resolveDecisionsConfig } from "./decisions.js";
import { type MemoryFabricTeamConfig, type ResolvedFabricTeamOptions, resolveFabricTeamOptions } from "./delivery/team.js";
import {
  type ArchiveConfig,
  type CapacityLimits,
  DEFAULT_ARCHIVE_CONFIG,
  DEFAULT_CAPACITY,
  DEFAULT_DECAY,
  DEFAULT_DUPLICATE_DICE,
  DEFAULT_EPISODE_MIN_CLUSTER,
  DEFAULT_EXCHANGE_CAPACITY,
  DEFAULT_STORAGE_WEIGHTS,
  DEFAULT_STRENGTH_WEIGHTS,
  DEFAULT_VERIFY_AFTER_SESSIONS,
  DEFAULT_WIDEN_CONFIG,
  type ExchangeCapacityLimits,
  HARD_VERIFY_AFTER_SESSIONS,
  MAX_ARCHIVE_BELOW,
  MAX_DUPLICATE_DICE,
  MAX_EPISODE_CLUSTER,
  MAX_FABRIC_CAPACITY_NOTES,
  MAX_FABRIC_CAPACITY_TOKENS,
  MAX_GRACE_SESSIONS,
  MAX_STORAGE_WEIGHT,
  MAX_STRENGTH_WEIGHT,
  MAX_WIDEN_CONTRADICTIONS,
  MAX_WIDEN_PROJECTS,
  MAX_WIDEN_SIBLINGS,
  type MemoryNoteDecay,
  MIN_DUPLICATE_DICE,
  MIN_WIDEN_CONTRADICTIONS,
  MIN_WIDEN_PROJECTS,
  MIN_WIDEN_SIBLINGS,
  type StorageWeights,
  type StrengthWeights,
} from "./lifecycle/index.js";
import { type MemoryFabricPromoteConfig, memoryFabricPromoteSchema, type ResolvedPromoteConfig, resolvePromoteConfig } from "./promote.js";
import { type MemoryFabricStateConfig, type ResolvedStateConfig, resolveStateConfig } from "./state.js";

export type { MemoryFabricStateConfig, ResolvedStateConfig } from "./state.js";

import { projectResourceId, resolveProjectIdentity } from "./scope/identity.js";
import { resolveScopePriors, type ScopePriors } from "./scope/recall.js";
import type { FabricScopeLevel, MemoryFabricConsolidationOptions, MemoryNoteKind } from "./types.js";

/** `project.id` must be `<slug>--<id8>`: the resource suffix the identity resolver produces. */
const PROJECT_ID = /^[a-z0-9-]{1,40}--[0-9a-f]{8}$/;

/** One enabled scope level and the resource it resolves to. */
export interface ResolvedFabricScope {
  readonly level: FabricScopeLevel;
  readonly resourceId: string;
}

/** The scope levels this fabric instance reads and writes, narrowest first. */
export interface MemoryFabricScopesConfig {
  readonly tenantId?: string;
  /** Additive recall priors, each in [0,0.5]. Defaults: path 0.15, project 0.10, agent 0.05, user 0. */
  readonly priors?: {
    readonly path?: number;
    readonly project?: number;
    /** Shared team notes: between project and agent. Default 0.075. */
    readonly team?: number;
    readonly agent?: number;
    readonly user?: number;
  };
  /** User-wide preferences. Default `true`. */
  readonly user?: boolean;
  /** Lessons proven across projects. Default `true`. */
  readonly agent?: boolean;
  /**
   * The project scope: a stable identity from the git remote, else the real path. Default on.
   * Pass `false` to turn it off, or an `id` for a server whose project is not a git checkout.
   */
  readonly project?: false | MemoryFabricProjectScopeConfig;
}

export interface MemoryFabricProjectScopeConfig {
  /** Workspace root used for detection; the host passes it. Default `process.cwd()`. */
  readonly root?: string;
  /** Overrides detection; must match `^[a-z0-9-]{1,40}--[0-9a-f]{8}$`. */
  readonly id?: string;
}

/** The markdown (OKF) store: canonical note files with a derived SQLite index, under `tools.root`. */
export interface MemoryFabricMarkdownStoreConfig {
  /** Directory under `tools.root`; default `notes`. */
  readonly dir?: string;
}

/** The Postgres vector store. `connection` is a ref; a literal fails validation. */
export interface MemoryFabricPostgresStoreConfig {
  /** `env:NAME` or `keyring:NAME`. */
  readonly connection?: string;
  readonly schema?: string;
  readonly table?: string;
}

/** File tools are jailed to `root`; without it they fail closed. */
export interface MemoryFabricToolsConfig {
  readonly root?: string;
  readonly maxFileBytes?: number;
}

/** The scoped policy layer: a filesystem scope root plus its knobs. */
export interface MemoryFabricScopedConfig {
  readonly scopeRoot: string;
  readonly policy?: {
    readonly promotion?: { readonly reuseThreshold?: number };
    readonly activation?: { readonly topK?: number; readonly minSimilarity?: number };
    readonly facts?: { readonly block?: string; readonly maxChars?: number };
    readonly approval?: { readonly default?: "off" | "staged" };
  };
}

export interface MemoryFabricInjectConfig {
  /**
   * Relevance floor for a passively injected hit. Default `0.2`, chosen by the plan 188.9 Task 5
   * rule (cheapest cell at the evidence-sized cost whose per-ability answer visibility does not
   * fall below the 600/3/0.35 control).
   */
  readonly minSimilarity?: number;
  /** Minimum confidence for any passively injected hit. Default `0.2`; below it only the cue is shown. */
  readonly minScore?: number;
  /** At or above this confidence a hit renders full text; below it renders a pointer card. Default `0.35`. */
  readonly fullTextScore?: number;
  /**
   * What a pointer card shows (plan 210 Task 3.1). `head` (default): the first 120 characters of the user half.
   * `query`: the same width, centred on the query terms across both halves of the exchange.
   */
  readonly cardExcerpt?: "head" | "query";
  /** Whole notes delivered per turn, best first. Default `12`. */
  readonly topK?: number;
  /**
   * Rendered-token ceiling for the injected block, about 4k tokens per user turn when opted in.
   * Default `4000`. Delivery fills by rank with whole notes and skips a note that does not fit, so
   * the block never exceeds this budget.
   */
  readonly budgetTokens?: number;
  readonly query?: "task" | "user";
  readonly kinds?: readonly import("./types.js").MemoryNoteKind[];
}

/**
 * The note lifecycle (plan 188.4). Verification is by use across separate sessions; a candidate is
 * confirmed when `verifyAfterSessions` distinct sessions cite it with no harmful evidence.
 */
export interface MemoryFabricLifecycleConfig {
  /** Distinct sessions a candidate must be used in before it is verified. Default 2. */
  readonly verifyAfterSessions?: number;
  /**
   * Retrieval-strength decay per kind, in (0,1): higher forgets faster. `working` and `file` follow
   * `fact`. Provisional until plan 188.6.
   */
  readonly decay?: Partial<Record<Exclude<MemoryNoteKind, "working" | "file">, number>>;
  /** Storage-strength coefficients. Default `{explicit:1, sessions:0.5, helpful:0.5, harmful:1, outcome:0.5}`. */
  readonly storageWeights?: Partial<StorageWeights>;
  /** Recall priors for R and S, each default 0.05 and capped at 0.5. */
  readonly recall?: { readonly retrieval?: number; readonly storage?: number };
  /**
   * Archive thresholds: a note archives only when both strengths are below them and it is past the
   * grace window. Provisional until plan 188.6.
   */
  readonly archive?: {
    readonly retrievalBelow?: number;
    readonly storageBelow?: number;
    readonly graceSessions?: number;
  };
  /**
   * Per-scope budgets: notes and estimated tokens, `user`/`agent`/`project`. A `path` note spends the
   * project budget. Defaults 200/20k for profiles and 500/60k for a project.
   */
  readonly capacity?: Partial<Record<"user" | "agent" | "project", { readonly notes?: number; readonly tokens?: number }>>;
  /**
   * The raw-history tier, separate from fact/preference/procedure capacity: exchanges above
   * `hotTokens` are demoted to the searchable archive, never deleted. Default 200,000 tokens.
   */
  readonly exchangeCapacity?: { readonly hotTokens?: number };
  /**
   * Merging: duplicate folds always, episode clusters only when `episodes` is set (off until plan
   * 188.6 fits the rules) — one model call per cluster.
   */
  readonly merge?: {
    readonly duplicateDice?: number;
    readonly episodes?: false | { readonly minCluster?: number; readonly model?: string };
  };
  /**
   * Scope widening and narrowing (plan 188.4 Task 6): a verified lesson in `minProjects` projects may
   * live at `agent` (never fewer than 2 — one compromised project cannot widen), path notes may widen
   * to their project across `minSiblings` sibling subtrees, and a wider note that
   * `contradictionsToSupersede` projects contradict is superseded.
   */
  readonly widen?: {
    readonly minProjects?: number;
    readonly minSiblings?: number;
    readonly contradictionsToSupersede?: number;
  };
}

export interface ResolvedMergeConfig {
  readonly duplicateDice: number;
  /** Absent when episode merging is off. */
  readonly episodes?: { readonly minCluster: number; readonly model?: string };
}

export interface ResolvedWidenConfig {
  readonly minProjects: number;
  readonly minSiblings: number;
  readonly contradictionsToSupersede: number;
}

export interface ResolvedLifecycleConfig {
  readonly verifyAfterSessions: number;
  readonly decay: MemoryNoteDecay;
  readonly storageWeights: StorageWeights;
  readonly recall: StrengthWeights;
  readonly archive: ArchiveConfig;
  readonly capacity: Readonly<Record<"user" | "agent" | "project", CapacityLimits>>;
  readonly exchangeCapacity: ExchangeCapacityLimits;
  readonly merge: ResolvedMergeConfig;
  readonly widen: ResolvedWidenConfig;
}

const DECAY_KINDS = ["episode", "fact", "preference", "procedure", "decision", "exchange"] as const;
const CAPACITY_LEVELS = ["user", "agent", "project"] as const;
const STORAGE_TERMS = ["explicit", "sessions", "helpful", "harmful", "outcome"] as const;

export const memoryFabricLifecycleSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verifyAfterSessions: { type: "integer", minimum: 1, maximum: HARD_VERIFY_AFTER_SESSIONS },
    decay: {
      type: "object",
      additionalProperties: false,
      properties: {
        episode: { type: "number", minimum: 0, maximum: 1 },
        fact: { type: "number", minimum: 0, maximum: 1 },
        preference: { type: "number", minimum: 0, maximum: 1 },
        procedure: { type: "number", minimum: 0, maximum: 1 },
        exchange: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    storageWeights: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(STORAGE_TERMS.map((term) => [term, { type: "number", minimum: 0, maximum: MAX_STORAGE_WEIGHT }])),
    },
    recall: {
      type: "object",
      additionalProperties: false,
      properties: {
        retrieval: { type: "number", minimum: 0, maximum: MAX_STRENGTH_WEIGHT },
        storage: { type: "number", minimum: 0, maximum: MAX_STRENGTH_WEIGHT },
      },
    },
    archive: {
      type: "object",
      additionalProperties: false,
      properties: {
        retrievalBelow: { type: "number", minimum: -MAX_ARCHIVE_BELOW, maximum: 0 },
        storageBelow: { type: "number", minimum: 0, maximum: MAX_ARCHIVE_BELOW },
        graceSessions: { type: "integer", minimum: 0, maximum: MAX_GRACE_SESSIONS },
      },
    },
    capacity: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        CAPACITY_LEVELS.map((level) => [
          level,
          {
            type: "object",
            additionalProperties: false,
            properties: {
              notes: { type: "integer", minimum: 1, maximum: MAX_FABRIC_CAPACITY_NOTES },
              tokens: { type: "integer", minimum: 1, maximum: MAX_FABRIC_CAPACITY_TOKENS },
            },
          },
        ]),
      ),
    },
    exchangeCapacity: {
      type: "object",
      additionalProperties: false,
      properties: {
        hotTokens: { type: "integer", minimum: 1, maximum: MAX_FABRIC_CAPACITY_TOKENS },
      },
    },
    merge: {
      type: "object",
      additionalProperties: false,
      properties: {
        duplicateDice: { type: "number", minimum: MIN_DUPLICATE_DICE, maximum: MAX_DUPLICATE_DICE },
        episodes: {
          type: "object",
          additionalProperties: false,
          properties: { minCluster: { type: "integer" }, model: { type: "string" } },
        },
      },
    },
    widen: {
      type: "object",
      additionalProperties: false,
      properties: {
        minProjects: { type: "integer", minimum: MIN_WIDEN_PROJECTS, maximum: MAX_WIDEN_PROJECTS },
        minSiblings: { type: "integer", minimum: MIN_WIDEN_SIBLINGS, maximum: MAX_WIDEN_SIBLINGS },
        contradictionsToSupersede: { type: "integer", minimum: MIN_WIDEN_CONTRADICTIONS, maximum: MAX_WIDEN_CONTRADICTIONS },
      },
    },
  },
} as const;

function bounded(label: string, value: number, min: number, max: number, exclusive = false): number {
  const ok = Number.isFinite(value) && (exclusive ? value > min && value < max : value >= min && value <= max);
  if (!ok) throw new MemoryValidationError(`${label} must be a number in ${exclusive ? `(${min},${max})` : `[${min},${max}]`}`);
  return value;
}

export function resolveLifecycleConfig(value: MemoryFabricLifecycleConfig | undefined): ResolvedLifecycleConfig {
  const verifyAfterSessions = value?.verifyAfterSessions ?? DEFAULT_VERIFY_AFTER_SESSIONS;
  if (!Number.isSafeInteger(verifyAfterSessions) || verifyAfterSessions < 1 || verifyAfterSessions > HARD_VERIFY_AFTER_SESSIONS) {
    throw new MemoryValidationError(`lifecycle.verifyAfterSessions must be an integer in [1,${HARD_VERIFY_AFTER_SESSIONS}]`);
  }
  const decay: Record<Exclude<MemoryNoteKind, "concept">, number> = { ...DEFAULT_DECAY };
  for (const kind of DECAY_KINDS) {
    const input = value?.decay?.[kind];
    if (input !== undefined) decay[kind] = bounded(`lifecycle.decay.${kind}`, input, 0, 1, true);
  }
  const storageWeights: Record<keyof StorageWeights, number> = { ...DEFAULT_STORAGE_WEIGHTS };
  for (const term of STORAGE_TERMS) {
    const input = value?.storageWeights?.[term];
    if (input !== undefined) storageWeights[term] = bounded(`lifecycle.storageWeights.${term}`, input, 0, MAX_STORAGE_WEIGHT);
  }
  const recall = {
    retrieval: bounded(
      "lifecycle.recall.retrieval",
      value?.recall?.retrieval ?? DEFAULT_STRENGTH_WEIGHTS.retrieval,
      0,
      MAX_STRENGTH_WEIGHT,
    ),
    storage: bounded("lifecycle.recall.storage", value?.recall?.storage ?? DEFAULT_STRENGTH_WEIGHTS.storage, 0, MAX_STRENGTH_WEIGHT),
  };
  const archive = {
    retrievalBelow: bounded(
      "lifecycle.archive.retrievalBelow",
      value?.archive?.retrievalBelow ?? DEFAULT_ARCHIVE_CONFIG.retrievalBelow,
      -MAX_ARCHIVE_BELOW,
      0,
    ),
    storageBelow: bounded(
      "lifecycle.archive.storageBelow",
      value?.archive?.storageBelow ?? DEFAULT_ARCHIVE_CONFIG.storageBelow,
      0,
      MAX_ARCHIVE_BELOW,
    ),
    graceSessions: value?.archive?.graceSessions ?? DEFAULT_ARCHIVE_CONFIG.graceSessions,
  };
  if (!Number.isSafeInteger(archive.graceSessions) || archive.graceSessions < 0 || archive.graceSessions > MAX_GRACE_SESSIONS) {
    throw new MemoryValidationError(`lifecycle.archive.graceSessions must be an integer in [0,${MAX_GRACE_SESSIONS}]`);
  }
  const capacity: Record<string, CapacityLimits> = { ...DEFAULT_CAPACITY };
  const capacityFor = (level: string): CapacityLimits => capacity[level]!;
  for (const level of CAPACITY_LEVELS) {
    const input = value?.capacity?.[level];
    if (input?.notes !== undefined) {
      if (!Number.isSafeInteger(input.notes) || input.notes < 1 || input.notes > MAX_FABRIC_CAPACITY_NOTES) {
        throw new MemoryValidationError(`lifecycle.capacity.${level}.notes must be an integer in [1,${MAX_FABRIC_CAPACITY_NOTES}]`);
      }
      capacity[level] = { ...capacityFor(level), notes: input.notes };
    }
    if (input?.tokens !== undefined) {
      if (!Number.isSafeInteger(input.tokens) || input.tokens < 1 || input.tokens > MAX_FABRIC_CAPACITY_TOKENS) {
        throw new MemoryValidationError(`lifecycle.capacity.${level}.tokens must be an integer in [1,${MAX_FABRIC_CAPACITY_TOKENS}]`);
      }
      capacity[level] = { ...capacityFor(level), tokens: input.tokens };
    }
  }
  const exchangeCapacity = {
    hotTokens: value?.exchangeCapacity?.hotTokens ?? DEFAULT_EXCHANGE_CAPACITY.hotTokens,
  };
  if (
    !Number.isSafeInteger(exchangeCapacity.hotTokens) ||
    exchangeCapacity.hotTokens < 1 ||
    exchangeCapacity.hotTokens > MAX_FABRIC_CAPACITY_TOKENS
  ) {
    throw new MemoryValidationError(`lifecycle.exchangeCapacity.hotTokens must be an integer in [1,${MAX_FABRIC_CAPACITY_TOKENS}]`);
  }
  const merge = resolveMergeConfig(value?.merge);
  const widen = resolveWidenConfig(value?.widen);
  return {
    verifyAfterSessions,
    decay,
    storageWeights,
    recall,
    archive,
    capacity: capacity as unknown as Readonly<Record<"user" | "agent" | "project", CapacityLimits>>,
    exchangeCapacity,
    merge,
    widen,
  };
}

function resolveWidenConfig(value: MemoryFabricLifecycleConfig["widen"]): ResolvedWidenConfig {
  const integer = (label: string, input: number | undefined, min: number, max: number, fallback: number): number => {
    const resolved = input ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
      throw new MemoryValidationError(`${label} must be an integer in [${min},${max}]`);
    }
    return resolved;
  };
  return {
    minProjects: integer(
      "lifecycle.widen.minProjects",
      value?.minProjects,
      MIN_WIDEN_PROJECTS,
      MAX_WIDEN_PROJECTS,
      DEFAULT_WIDEN_CONFIG.minProjects,
    ),
    minSiblings: integer(
      "lifecycle.widen.minSiblings",
      value?.minSiblings,
      MIN_WIDEN_SIBLINGS,
      MAX_WIDEN_SIBLINGS,
      DEFAULT_WIDEN_CONFIG.minSiblings,
    ),
    contradictionsToSupersede: integer(
      "lifecycle.widen.contradictionsToSupersede",
      value?.contradictionsToSupersede,
      MIN_WIDEN_CONTRADICTIONS,
      MAX_WIDEN_CONTRADICTIONS,
      DEFAULT_WIDEN_CONFIG.contradictionsToSupersede,
    ),
  };
}

function resolveMergeConfig(value: MemoryFabricLifecycleConfig["merge"]): ResolvedMergeConfig {
  const duplicateDice = value?.duplicateDice ?? DEFAULT_DUPLICATE_DICE;
  if (!Number.isFinite(duplicateDice) || duplicateDice < MIN_DUPLICATE_DICE || duplicateDice > MAX_DUPLICATE_DICE) {
    throw new MemoryValidationError(`lifecycle.merge.duplicateDice must be a number in [${MIN_DUPLICATE_DICE},${MAX_DUPLICATE_DICE}]`);
  }
  const episodes = value?.episodes;
  if (episodes === undefined || episodes === false) return { duplicateDice };
  const minCluster = episodes.minCluster ?? DEFAULT_EPISODE_MIN_CLUSTER;
  if (!Number.isSafeInteger(minCluster) || minCluster < 2 || minCluster > MAX_EPISODE_CLUSTER) {
    throw new MemoryValidationError(`lifecycle.merge.episodes.minCluster must be an integer in [2,${MAX_EPISODE_CLUSTER}]`);
  }
  if (episodes.model !== undefined && (typeof episodes.model !== "string" || episodes.model.length === 0)) {
    throw new MemoryValidationError("lifecycle.merge.episodes.model must be a non-empty string");
  }
  return { duplicateDice, episodes: { minCluster, ...(episodes.model === undefined ? {} : { model: episodes.model }) } };
}

/** The exchange archive knobs (plan 188.9 Task 7). */
export interface MemoryFabricExchangesConfig {
  /** `false` keeps the archive off; absent in an object means on. Default off. */
  readonly enabled?: boolean;
  /**
   * Add a condensed `## Steps` trace of each turn's tool rounds to its exchange (plan 209 Task 2): tool,
   * argument summary, outcome, first error line, result entry id; never result bodies. Default off.
   */
  readonly steps?: boolean;
  /** Most tool rounds listed per exchange. Default 24, at most {@link MAX_EXCHANGE_STEPS}. */
  readonly maxSteps?: number;
}

/** The cited lesson notebook (plan 209 Task 4). */
export interface MemoryFabricLessonsConfig {
  /**
   * After a turn with a lesson signal (a correction, an explicit "remember", a failed-then-fixed command,
   * an approval denial), the next request's tail carries one line asking the agent to record a cited
   * lesson. Ids and fixed text only, never in the prefix, no model call. Needs the exchange archive. Default off.
   */
  readonly nudge?: boolean;
  /** Turns a nudge waits after the last one in the same session. Default 5. */
  readonly minTurnsBetweenNudges?: number;
  /** Scope sessions without a use after which a lesson leaves default recall (archived, never deleted). Default 20. */
  readonly archiveAfterSessions?: number;
}

export interface ResolvedFabricLessonsOptions {
  readonly nudge: boolean;
  readonly minTurnsBetweenNudges: number;
  readonly archiveAfterSessions: number;
}

export const DEFAULT_EXCHANGE_STEPS = 24;
export const MAX_EXCHANGE_STEPS = 64;

/** {@link MemoryFabricExchangesConfig} with the write scope the archive resolved. */
export interface ResolvedFabricExchangesOptions {
  readonly enabled: boolean;
  /** The scope an exchange is written to; never `path`. */
  readonly scope: "user" | "agent" | "project";
  /** The step trace; `false` (the default) stores dialogue only. */
  readonly steps: false | { readonly maxSteps: number };
}

/** The preset names. A later name is additive; each one is a written contract (README `## Conversational preset`). */
export type MemoryFabricPresetName = "conversational" | "coding";

/**
 * Bumped when a preset's contents change inside its contract (ranking, budgets, delivery, read path).
 * `memory:status` and the setup status note report it, so a measurement is attributable to a revision.
 */
export const CONVERSATIONAL_PRESET_REVISION = 1;
export const CODING_PRESET_REVISION = 2;

/** Validated `packageConfig` for `@arnilo/prism-memory-fabric`. */
export interface MemoryFabricConfig {
  /**
   * A named, measured configuration (plan 188.11 Task 3). It expands before any other resolution; an
   * explicitly given top-level field replaces the preset's value for that field (no deep merge).
   * Default none: the fields below keep their own defaults.
   */
  readonly preset?: MemoryFabricPresetName;
  /** Whether the fabric's tools are enabled for a session. Default `true` (installing is the opt-in). */
  readonly enabled?: boolean;
  /**
   * Retrieval mode. `"lexical"` (default) needs no embeddings package: notes are searched by BM25.
   * `"hybrid"` adds the embedding leg through the `embeddings` service, falling back to lexical
   * when no service is present.
   */
  readonly retrieval?: "lexical" | "hybrid";
  /** Whether indexed notes (`fact`/`procedure`/`file`) are available. Default `true`. */
  readonly semantic?: boolean;
  readonly inject?: false | MemoryFabricInjectConfig;
  /** The long-term memory index in the prompt prefix. Default on when `semantic` or `tools.root` is set. */
  readonly directory?: boolean | MemoryFabricDirectoryConfig;
  /**
   * Standing rules (plan 209 Task 3): a small always-loaded slice of verified rules in the prompt prefix,
   * stable between rebuilds, an editable `rules.md` per scope (markdown store), and opt-in confirmed capture
   * of rules from user turns (`capture: "confirm"`). Default on, capture off; `false` computes and shows nothing.
   */
  readonly rules?: false | MemoryFabricRulesConfig;
  /**
   * Path cues: path-scoped notes shown once when a file tool touches a matching file. Default on;
   * `false` makes no index query and adds no tail lines.
   */
  readonly cues?: false | MemoryFabricCuesConfig;
  /**
   * The team store: a checked-in directory under the project root that the fabric recalls as scope
   * `team`. Off by default; needs a project scope and `tools.root` (the index lives there).
   */
  readonly team?: false | MemoryFabricTeamConfig;
  /** The scope levels this fabric reads and writes, narrowest first. */
  readonly scopes?: MemoryFabricScopesConfig;
  readonly store?:
    | "memory"
    | "markdown"
    | { readonly markdown: MemoryFabricMarkdownStoreConfig }
    | { readonly sqlite: { readonly path: string } }
    | { readonly postgres: MemoryFabricPostgresStoreConfig };
  readonly tools?: MemoryFabricToolsConfig;
  readonly scoped?: MemoryFabricScopedConfig;
  readonly workingMemoryTemplate?: string;
  readonly limits?: {
    readonly maxEntryTextChars?: number;
    readonly maxWorkingMemoryBytes?: number;
    readonly maxVectorDimensions?: number;
    readonly rebuildBatchSize?: number;
    readonly rebuildMs?: number;
  };
  readonly consolidate?: boolean | MemoryFabricConsolidationOptions;
  readonly linker?: boolean | { readonly enabled?: boolean; readonly topK?: number };
  readonly evolution?: boolean | { readonly enabled?: boolean; readonly maxPatches?: number };
  readonly passive?: boolean;
  /**
   * The exchange archive: one verbatim note per completed user turn (user text plus the assistant
   * reply), written in the background after the reply is stored. Off by default. The scope is the
   * project only when the project scope is active and a root was declared; otherwise the user scope,
   * then the agent scope (plan 188.9 Task 1c).
   */
  readonly exchanges?: boolean | MemoryFabricExchangesConfig;
  /** The cited lesson notebook: the opt-in nudge and the lesson archive rule (plan 209 Task 4). */
  readonly lessons?: MemoryFabricLessonsConfig;
  /** The note lifecycle: verification by use across sessions. */
  readonly lifecycle?: MemoryFabricLifecycleConfig;
  /** The ontology tier's write-path knobs (plan 207). Nothing here turns the tier on: concepts do. */
  readonly ontology?: MemoryFabricOntologyConfig;
  /** Opt-in recall variants (plan 210 Task 3.1); unset, recall is unchanged. */
  readonly recall?: MemoryFabricRecallConfig;
  /**
   * Session consolidation. `false` or absent (the default) makes no
   * model call; an object enables the opt-in extractor pass and configures acceptance.
   */
  readonly promote?: false | MemoryFabricPromoteConfig;
  /** Opt-in read-time current-state table; one model call per explicit `memory.recall`. */
  readonly state?: boolean | MemoryFabricStateConfig;
  /**
   * Opt-in decision-model gates. Absent keeps every incumbent path and makes no decision call. The
   * model must declare the `decisions` capability; only already-scoped text is sent.
   */
  readonly decisions?: false | MemoryFabricDecisionsConfig;
  readonly workerLimits?: MemoryWorkerLimitOptions;
}

/** {@link MemoryFabricConfig["store"]} with paths resolved and the string defaults expanded. */
export type ResolvedMemoryFabricStore =
  | "memory"
  | { readonly markdown: { readonly dir: string } }
  | { readonly sqlite: { readonly path: string } }
  | { readonly postgres: MemoryFabricPostgresStoreConfig };

/** {@link MemoryFabricConfig} with every default applied, so `setup` reads one shape. */
/** Recall variants under audit (plan 210 Task 3.1). Each is off by default and measured once before it can ship. */
export interface MemoryFabricRecallConfig {
  /**
   * Which older group members the read-time grouping labels "superseded by" a newer one. `all` (default) marks every
   * older member; `keyed-only` marks only members joined by a key or an explicit `supersedes` edge, so conversation
   * exchanges that merely share subject terms are not labelled as replaced.
   */
  readonly supersessionHint?: import("./recall.js").SupersessionHintMode;
  /**
   * Expand the lexical query with the informal and formal forms of its words ("girlfriend" also asks for "gf"), from a
   * small fixed English table: no model call, no embeddings. Default `false`; a query with no table term is unchanged.
   */
  readonly expansion?: boolean;
  /**
   * Adds `gather` to the `memory.recall` tool: one call returns the whole matching history (up to the 32-hit recall
   * window), oldest first, in a larger snippet budget, instead of a five-hit relevance page. For list and multi-hop
   * questions. Default `false`: the tool schema and results are unchanged.
   */
  readonly gather?: boolean;
}

export interface MemoryFabricOntologyConfig {
  /**
   * Matched tokens of one subject name (slug, title or alias) that bind a new note to that subject, when exactly
   * one subject qualifies; a whole multi-token name always qualifies. Default 2, in [1,8].
   */
  readonly bindThreshold?: number;
  /**
   * Added to a concept hit's score after fusion and the scope prior, so a matching concept ranks above its own
   * evidence but not above a better-matching note. Default 0.1, in [0,0.5].
   */
  readonly conceptPrior?: number;
  /** Claims one concept hit shows in `memory.recall`, chosen by term overlap with the query. Default 8, in [1,32]. */
  readonly maxClaimsRendered?: number;
}

export interface ResolvedMemoryFabricConfig {
  /** The preset this config expanded, with its revision; absent when none was named. */
  readonly preset?: { readonly name: MemoryFabricPresetName; readonly revision: number; readonly overridden: readonly string[] };
  readonly enabled: boolean;
  readonly retrieval: "lexical" | "hybrid";
  readonly semantic: boolean;
  readonly inject: false | MemoryFabricInjectConfig;
  readonly directory: false | ResolvedFabricDirectoryOptions;
  readonly rules: false | ResolvedFabricRulesOptions;
  readonly cues: false | ResolvedFabricCuesOptions;
  /** The team store, when configured and its directory exists on this checkout. */
  readonly team: false | ResolvedFabricTeamOptions;
  readonly scopes: {
    readonly tenantId: string;
    /** One explicit thread id per memory instance; the session id is provenance, not a scope. */
    readonly threadId: string;
    /** Enabled levels, narrowest first. Never empty. */
    readonly active: readonly ResolvedFabricScope[];
    /** Additive priors after RRF; `path` only arms on a touched-path glob match. */
    readonly priors: ScopePriors;
    /** The project details, when the project scope is active. */
    readonly project?: {
      readonly resourceId: string;
      readonly source: "remote" | "path";
      readonly roots: readonly string[];
      /** Absolute workspace root `applies_to` globs and touched paths are relative to. */
      readonly root: string;
    };
  };
  /** Why a scope level was disabled, for one `status.note("warn")` at setup. */
  readonly scopeWarning?: string;
  readonly store: ResolvedMemoryFabricStore;
  readonly tools: MemoryFabricToolsConfig;
  readonly scoped?: MemoryFabricScopedConfig;
  readonly workingMemoryTemplate?: string;
  readonly limits?: MemoryFabricConfig["limits"];
  readonly consolidate?: MemoryFabricConfig["consolidate"];
  readonly linker?: MemoryFabricConfig["linker"];
  readonly evolution?: MemoryFabricConfig["evolution"];
  readonly passive?: boolean;
  /** The exchange archive, with its write scope resolved from the raw config. */
  readonly exchanges: ResolvedFabricExchangesOptions;
  readonly lessons: ResolvedFabricLessonsOptions;
  readonly lifecycle: ResolvedLifecycleConfig;
  readonly ontology: { readonly bindThreshold: number; readonly conceptPrior: number; readonly maxClaimsRendered: number };
  readonly recall: {
    readonly supersessionHint: import("./recall.js").SupersessionHintMode;
    readonly expansion: boolean;
    readonly gather: boolean;
  };
  readonly promote: ResolvedPromoteConfig;
  /** Opt-in read-time state table; `false` keeps the read path model-free. */
  readonly state: false | ResolvedStateConfig;
  /** Opt-in decision gates; `false` keeps every incumbent path. */
  readonly decisions: false | ResolvedDecisionsConfig;
  readonly workerLimits?: MemoryWorkerLimitOptions;
}

const DEFAULT_TENANT = "prism";
const DEFAULT_THREAD = "default";

const secretString: JsonSchema = {
  type: "string",
  minLength: 1,
  maxLength: 4096,
  pattern: "^(env|keyring):",
  "x-prism-secret": true,
};

const flagOrObject = (properties: Readonly<Record<string, JsonSchema>>): JsonSchema => ({
  anyOf: [{ type: "boolean" }, { type: "object", additionalProperties: false, properties }],
});

/** The config schema. A literal secret fails validation; the `x-prism-secret` marker is enforced by the loader. */
const fabricConfigSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    preset: { enum: ["conversational", "coding"] },
    enabled: { type: "boolean", default: true },
    retrieval: { enum: ["lexical", "hybrid"], default: "lexical" },
    inject: {
      anyOf: [
        { const: false },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            minSimilarity: { type: "number", minimum: -1, maximum: 1, default: 0.2 },
            minScore: { type: "number", minimum: 0, maximum: 1, default: 0.2 },
            fullTextScore: { type: "number", minimum: 0, maximum: 1, default: 0.35 },
            cardExcerpt: { enum: ["head", "query"], default: "head" },
            topK: { type: "integer", minimum: 1, maximum: HARD_TOP_K_CAP, default: 12 },
            budgetTokens: { type: "integer", minimum: 1, default: 4000 },
            query: { enum: ["task", "user"] },
            kinds: {
              type: "array",
              minItems: 1,
              items: { enum: ["fact", "file", "procedure", "episode", "working", "decision", "exchange"] },
            },
          },
        },
      ],
    },
    semantic: { type: "boolean", default: true },
    directory: flagOrObject({
      maxTopics: { type: "integer", minimum: 1, maximum: HARD_DIRECTORY_TOPICS },
      maxFiles: { type: "integer", minimum: 1, maximum: HARD_DIRECTORY_FILES },
      maxTokens: { type: "integer", minimum: 1, maximum: HARD_DIRECTORY_TOKENS },
      stopWords: { type: "boolean", default: false },
    }),
    rules: flagOrObject({
      capture: { enum: ["off", "confirm"] },
      maxTokens: { type: "integer", minimum: 1, maximum: HARD_RULES_TOKENS },
      scopes: { type: "array", minItems: 1, maxItems: 2, items: { enum: ["user", "project"] } },
      kinds: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: { enum: ["fact", "preference", "procedure", "decision"] },
      },
    }),
    cues: flagOrObject({
      budgetTokens: { type: "integer", minimum: 1, maximum: HARD_CUE_TOKENS },
      maxPerTurn: { type: "integer", minimum: 1, maximum: HARD_CUES_PER_TURN },
    }),
    team: flagOrObject({
      dir: { type: "string", minLength: 1, maxLength: 4096 },
      write: { enum: ["ask", "off"] },
    }),
    scopes: {
      type: "object",
      additionalProperties: false,
      properties: {
        tenantId: { type: "string", minLength: 1, maxLength: 256 },
        priors: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "number", minimum: 0, maximum: 0.5 },
            project: { type: "number", minimum: 0, maximum: 0.5 },
            team: { type: "number", minimum: 0, maximum: 0.5 },
            agent: { type: "number", minimum: 0, maximum: 0.5 },
            user: { type: "number", minimum: 0, maximum: 0.5 },
          },
        },
        user: { type: "boolean", default: true },
        agent: { type: "boolean", default: true },
        project: {
          anyOf: [
            { const: false },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                root: { type: "string", minLength: 1, maxLength: 4096 },
                id: { type: "string", minLength: 1, maxLength: 64 },
              },
            },
          ],
        },
      },
    },
    store: {
      oneOf: [
        { const: "memory" },
        { const: "markdown" },
        {
          type: "object",
          additionalProperties: false,
          required: ["markdown"],
          properties: {
            markdown: {
              type: "object",
              additionalProperties: false,
              properties: { dir: { type: "string", minLength: 1, maxLength: 4096 } },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["sqlite"],
          properties: {
            sqlite: {
              type: "object",
              additionalProperties: false,
              required: ["path"],
              properties: { path: { type: "string", minLength: 1, maxLength: 4096 } },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["postgres"],
          properties: {
            postgres: {
              type: "object",
              additionalProperties: false,
              properties: {
                connection: secretString,
                schema: { type: "string", minLength: 1, maxLength: 128 },
                table: { type: "string", minLength: 1, maxLength: 128 },
              },
            },
          },
        },
      ],
    },
    tools: {
      type: "object",
      additionalProperties: false,
      properties: {
        root: { type: "string", minLength: 1, maxLength: 4096 },
        maxFileBytes: { type: "integer", minimum: 1, maximum: 1_048_576 },
      },
    },
    scoped: {
      type: "object",
      additionalProperties: false,
      required: ["scopeRoot"],
      properties: {
        scopeRoot: { type: "string", minLength: 1, maxLength: 4096 },
        policy: {
          type: "object",
          additionalProperties: false,
          properties: {
            promotion: {
              type: "object",
              additionalProperties: false,
              properties: { reuseThreshold: { type: "integer", minimum: 1 } },
            },
            decay: {
              type: "object",
              additionalProperties: false,
              properties: {},
            },
            activation: {
              type: "object",
              additionalProperties: false,
              properties: {
                topK: { type: "integer", minimum: 1 },
                minSimilarity: { type: "number", minimum: 0, maximum: 1 },
              },
            },
            facts: {
              type: "object",
              additionalProperties: false,
              properties: {
                block: { type: "string", minLength: 1, maxLength: 128 },
                maxChars: { type: "integer", minimum: 1 },
              },
            },
            approval: {
              type: "object",
              additionalProperties: false,
              properties: { default: { enum: ["off", "staged"] } },
            },
          },
        },
      },
    },
    workingMemoryTemplate: { type: "string", minLength: 1, maxLength: 16_384 },
    limits: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxEntryTextChars: { type: "integer", minimum: 1 },
        maxWorkingMemoryBytes: { type: "integer", minimum: 1 },
        maxVectorDimensions: { type: "integer", minimum: 1 },
        rebuildBatchSize: { type: "integer", minimum: 1 },
        rebuildMs: { type: "integer", minimum: 1 },
      },
    },
    consolidate: flagOrObject({
      threshold: { type: "number", minimum: 0, maximum: 1 },
      decider: { const: "model" },
      model: { type: "string", minLength: 1, maxLength: 4096 },
    }),
    linker: flagOrObject({
      enabled: { type: "boolean" },
      topK: { type: "integer", minimum: 1, maximum: 32 },
    }),
    evolution: flagOrObject({
      enabled: { type: "boolean" },
      maxPatches: { type: "integer", minimum: 1, maximum: 32 },
    }),
    passive: { type: "boolean" },
    exchanges: flagOrObject({
      enabled: { type: "boolean" },
      steps: { type: "boolean" },
      maxSteps: { type: "integer", minimum: 1, maximum: MAX_EXCHANGE_STEPS },
    }),
    lessons: {
      type: "object",
      additionalProperties: false,
      properties: {
        nudge: { type: "boolean" },
        minTurnsBetweenNudges: { type: "integer", minimum: 1, maximum: MAX_LESSON_NUDGE_TURNS },
        archiveAfterSessions: { type: "integer", minimum: 1, maximum: MAX_LESSON_ARCHIVE_SESSIONS },
      },
    },
    ontology: {
      type: "object",
      additionalProperties: false,
      properties: {
        bindThreshold: { type: "integer", minimum: 1, maximum: MAX_BIND_THRESHOLD },
        conceptPrior: { type: "number", minimum: 0, maximum: MAX_CONCEPT_PRIOR },
        maxClaimsRendered: { type: "integer", minimum: 1, maximum: MAX_CLAIMS_RENDERED_LIMIT },
      },
    },
    recall: {
      type: "object",
      additionalProperties: false,
      properties: {
        supersessionHint: { enum: ["all", "keyed-only"], default: "all" },
        expansion: { type: "boolean", default: false },
        gather: { type: "boolean", default: false },
      },
    },
    lifecycle: memoryFabricLifecycleSchema,
    promote: memoryFabricPromoteSchema,
    state: {
      anyOf: [
        { type: "boolean" },
        {
          type: "object",
          additionalProperties: false,
          properties: { model: { type: "string", minLength: 1, maxLength: 4096 } },
        },
      ],
    },
    decisions: {
      anyOf: [
        { const: false },
        {
          type: "object",
          additionalProperties: false,
          required: ["model"],
          properties: {
            model: { type: "string", minLength: 1, maxLength: 4096 },
            points: { type: "array", minItems: 1, maxItems: DECISION_POINTS.length, items: { enum: [...DECISION_POINTS] } },
          },
        },
      ],
    },
    workerLimits: { type: "object", additionalProperties: true },
  },
};

/**
 * Config fields whose value is a tuning default: ranking, scoring, budgets, caps, thresholds and
 * weights. Their value may change in a minor version. Every other field is `contract` — its shape
 * and meaning are frozen at API level 1 (README `## Compatibility`).
 */
const TUNING_CONFIG_FIELDS: ReadonlySet<string> = new Set([
  "inject.minSimilarity",
  "inject.minScore",
  "inject.fullTextScore",
  "inject.cardExcerpt",
  "inject.topK",
  "inject.budgetTokens",
  "directory.maxTopics",
  "directory.maxFiles",
  "directory.maxTokens",
  "directory.stopWords",
  "recall.supersessionHint",
  "recall.expansion",
  "recall.gather",
  "ontology.bindThreshold",
  "ontology.conceptPrior",
  "ontology.maxClaimsRendered",
  "rules.maxTokens",
  "exchanges.maxSteps",
  "lessons.minTurnsBetweenNudges",
  "lessons.archiveAfterSessions",
  "cues.budgetTokens",
  "cues.maxPerTurn",
  "scopes.priors",
  "scopes.priors.path",
  "scopes.priors.project",
  "scopes.priors.team",
  "scopes.priors.agent",
  "scopes.priors.user",
  "tools.maxFileBytes",
  "scoped.policy.promotion.reuseThreshold",
  "scoped.policy.activation.topK",
  "scoped.policy.activation.minSimilarity",
  "scoped.policy.facts.maxChars",
  "limits.maxEntryTextChars",
  "limits.maxWorkingMemoryBytes",
  "limits.maxVectorDimensions",
  "limits.rebuildBatchSize",
  "limits.rebuildMs",
  "consolidate.threshold",
  "linker.topK",
  "evolution.maxPatches",
  "lifecycle.verifyAfterSessions",
  "lifecycle.decay.episode",
  "lifecycle.decay.fact",
  "lifecycle.decay.preference",
  "lifecycle.decay.procedure",
  "lifecycle.decay.exchange",
  "lifecycle.storageWeights.explicit",
  "lifecycle.storageWeights.sessions",
  "lifecycle.storageWeights.helpful",
  "lifecycle.storageWeights.harmful",
  "lifecycle.storageWeights.outcome",
  "lifecycle.recall.retrieval",
  "lifecycle.recall.storage",
  "lifecycle.archive.retrievalBelow",
  "lifecycle.archive.storageBelow",
  "lifecycle.archive.graceSessions",
  "lifecycle.capacity.user.notes",
  "lifecycle.capacity.user.tokens",
  "lifecycle.capacity.agent.notes",
  "lifecycle.capacity.agent.tokens",
  "lifecycle.capacity.project.notes",
  "lifecycle.capacity.project.tokens",
  "lifecycle.exchangeCapacity.hotTokens",
  "lifecycle.merge.duplicateDice",
  "lifecycle.merge.episodes.minCluster",
  "lifecycle.widen.minProjects",
  "lifecycle.widen.minSiblings",
  "lifecycle.widen.contradictionsToSupersede",
  "promote.minScore",
  "promote.weights",
  "promote.weights.explicit",
  "promote.weights.correction",
  "promote.weights.outcome",
  "promote.weights.recurrence",
  "promote.weights.generality",
  "promote.weights.ephemerality",
  "promote.weights.derivability",
  "promote.weights.duplicate",
  "promote.maxCandidates",
  "promote.minTurnsBetween",
  "promote.maxOutputTokens",
  "workerLimits",
]);

/** Tag every field with its stability tier; `validateJsonSchema` ignores the extension keyword. */
function withStability(schema: JsonSchema, tuning: ReadonlySet<string>, path = ""): JsonSchema {
  const properties = schema.properties;
  const tagged: JsonSchema = properties
    ? {
        ...schema,
        properties: Object.fromEntries(
          Object.entries(properties).map(([key, child]) => {
            const childPath = path ? `${path}.${key}` : key;
            return [
              key,
              { ...withStability(child, tuning, childPath), "x-prism-stability": tuning.has(childPath) ? "tuning" : "contract" },
            ];
          }),
        ),
      }
    : schema;
  if (schema.anyOf) return { ...tagged, anyOf: schema.anyOf.map((branch) => withStability(branch, tuning, path)) };
  if (schema.oneOf) return { ...tagged, oneOf: schema.oneOf.map((branch) => withStability(branch, tuning, path)) };
  return tagged;
}

/** The config schema. A literal secret fails validation; the `x-prism-secret` marker is enforced by the loader. */
export const memoryFabricConfigSchema: JsonSchema = withStability(fabricConfigSchema, TUNING_CONFIG_FIELDS);

/**
 * The presets, frozen. `conversational` is exactly the 188.10 Task 9 `x-tools` arm: verbatim exchanges,
 * passive delivery of exchanges only, no consolidation. Top-level keys only; see {@link expandPreset}.
 */
const PRESETS: Readonly<Record<MemoryFabricPresetName, Readonly<MemoryFabricConfig>>> = Object.freeze({
  conversational: Object.freeze({
    exchanges: Object.freeze({}),
    inject: Object.freeze({ query: "task", kinds: Object.freeze(["exchange"] as const) }),
    semantic: true,
    promote: false,
  }),
  // Conversational history plus standing coding rules: confirmed capture, decisions first in the rules block, path rules as cues.
  coding: Object.freeze({
    exchanges: Object.freeze({}),
    inject: Object.freeze({ query: "task", kinds: Object.freeze(["exchange"] as const) }),
    semantic: true,
    promote: false,
    rules: Object.freeze({ kinds: Object.freeze(["decision", "preference", "procedure"] as const), capture: "confirm" as const }),
    cues: Object.freeze({ budgetTokens: 300, maxPerTurn: 3 }),
  }),
});

const PRESET_REVISIONS: Readonly<Record<MemoryFabricPresetName, number>> = {
  conversational: CONVERSATIONAL_PRESET_REVISION,
  coding: CODING_PRESET_REVISION,
};

/** The preset's own fields, cloned so a caller may mutate them (the bench ablations do). */
export function presetFields(name: MemoryFabricPresetName): MemoryFabricConfig {
  return structuredClone(PRESETS[name]);
}

/**
 * Replace every top-level preset field the host did not give. A field given explicitly wins whole:
 * `inject` is not deep-merged. Returns the merged config and the preset fields the host changed.
 */
function expandPreset(config: MemoryFabricConfig): {
  config: MemoryFabricConfig;
  preset?: NonNullable<ResolvedMemoryFabricConfig["preset"]>;
} {
  if (config.preset === undefined) return { config };
  const name = config.preset;
  if (!Object.hasOwn(PRESETS, name)) throw new MemoryValidationError(`preset must be one of ${Object.keys(PRESETS).join(", ")}`);
  const fields = presetFields(name);
  // The loader applies schema defaults before this runs, so a given value equal to the preset's is not an override.
  const given = config as Record<string, unknown>;
  const overridden = Object.entries(fields)
    .filter(([key, value]) => given[key] !== undefined && JSON.stringify(given[key]) !== JSON.stringify(value))
    .map(([key]) => key);
  return {
    config: { ...fields, ...config },
    preset: { name, revision: PRESET_REVISIONS[name], overridden },
  };
}

function resolveInject(input: false | MemoryFabricInjectConfig | undefined): false | MemoryFabricInjectConfig {
  if (input === undefined || input === false) return false;
  if (input.cardExcerpt !== undefined && input.cardExcerpt !== "head" && input.cardExcerpt !== "query")
    throw new MemoryValidationError('inject.cardExcerpt must be "head" or "query"');
  return input;
}

function resolveGather(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  throw new MemoryValidationError("recall.gather must be a boolean");
}

function resolveExpansion(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  throw new MemoryValidationError("recall.expansion must be a boolean");
}

function resolveSupersessionHint(value: unknown): import("./recall.js").SupersessionHintMode {
  if (value === undefined) return "all";
  if (value === "all" || value === "keyed-only") return value;
  throw new MemoryValidationError('recall.supersessionHint must be "all" or "keyed-only"');
}

export function resolveMemoryFabricConfig(config: MemoryFabricConfig = {}): ResolvedMemoryFabricConfig {
  const expanded = expandPreset(config);
  return resolveExpandedConfig(expanded.config, expanded.preset);
}

function resolveExpandedConfig(config: MemoryFabricConfig, preset: ResolvedMemoryFabricConfig["preset"]): ResolvedMemoryFabricConfig {
  const input = config.store ?? (config.tools?.root ? "markdown" : "memory");
  const insideRoot = (value: string, label: string): string => {
    if (!config.tools?.root) throw new MemoryValidationError(`${label} requires tools.root`);
    const root = resolve(config.tools.root);
    const resolved = resolve(root, value);
    const rel = relative(root, resolved);
    if (!rel || rel === ".." || rel.startsWith("../") || isAbsolute(rel))
      throw new MemoryValidationError(`${label} must stay inside tools.root`);
    return resolved;
  };
  let store: ResolvedMemoryFabricStore;
  if (input === "memory") store = "memory";
  else if (input === "markdown") store = { markdown: { dir: insideRoot("notes", "store.markdown.dir") } };
  else if ("markdown" in input) store = { markdown: { dir: insideRoot(input.markdown.dir ?? "notes", "store.markdown.dir") } };
  else if ("sqlite" in input) store = { sqlite: { path: insideRoot(input.sqlite.path, "store.sqlite.path") } };
  else store = input;
  const resolvedScopes = resolveScopes(config);
  const exchanges = resolveExchangesConfig(config, resolvedScopes.scopes.active);
  const lessons = resolveLessonsConfig(config.lessons, exchanges);
  const lifecycle = resolveLifecycleConfig(config.lifecycle);
  return {
    ...(preset === undefined ? {} : { preset }),
    enabled: config.enabled !== false,
    retrieval: config.retrieval ?? "lexical",
    semantic: config.semantic !== false,
    inject: resolveInject(config.inject),
    directory: resolveFabricDirectoryOptions(config.directory, config.semantic !== false || Boolean(config.tools?.root)),
    // The rules block is on by default: it is the always-present tier, and it costs nothing after the first
    // cached turn. A store without `scanMetadata` turns it off at setup instead.
    rules: resolveFabricRulesOptions(config.rules, true),
    // Path cues are on by default: no model call, and a turn with no new touched path does no work.
    cues: resolveFabricCuesOptions(config.cues, true),
    // The team store is opt-in per checkout: its directory is a repository artefact, not a config default.
    team: resolveFabricTeamOptions(config.team, resolvedScopes.scopes.project?.root),
    scopes: resolvedScopes.scopes,
    ...(resolvedScopes.warning === undefined ? {} : { scopeWarning: resolvedScopes.warning }),
    store,
    tools: config.tools ?? {},
    ...(config.scoped === undefined ? {} : { scoped: config.scoped }),
    ...(config.workingMemoryTemplate === undefined ? {} : { workingMemoryTemplate: config.workingMemoryTemplate }),
    ...(config.limits === undefined ? {} : { limits: config.limits }),
    ...(config.consolidate === undefined ? {} : { consolidate: config.consolidate }),
    ...(config.linker === undefined ? {} : { linker: config.linker }),
    ...(config.evolution === undefined ? {} : { evolution: config.evolution }),
    ...(config.passive === undefined ? {} : { passive: config.passive }),
    exchanges,
    lessons,
    lifecycle: { ...lifecycle, archive: { ...lifecycle.archive, lessonSessions: lessons.archiveAfterSessions } },
    ontology: {
      bindThreshold: resolveBindThreshold(config.ontology?.bindThreshold),
      conceptPrior: resolveConceptPrior(config.ontology?.conceptPrior),
      maxClaimsRendered: resolveMaxClaimsRendered(config.ontology?.maxClaimsRendered),
    },
    recall: {
      supersessionHint: resolveSupersessionHint(config.recall?.supersessionHint),
      expansion: resolveExpansion(config.recall?.expansion),
      gather: resolveGather(config.recall?.gather),
    },
    promote: resolvePromoteConfig(config.promote),
    state: resolveStateConfig(config.state),
    decisions: resolveDecisionsConfig(config.decisions),
    ...(config.workerLimits === undefined ? {} : { workerLimits: config.workerLimits }),
  };
}

/** The lesson knobs. A nudge cites the turn's exchange, so it needs the exchange archive. */
function resolveLessonsConfig(
  input: MemoryFabricLessonsConfig | undefined,
  exchanges: ResolvedFabricExchangesOptions,
): ResolvedFabricLessonsOptions {
  const nudge = input?.nudge === true;
  if (nudge && !exchanges.enabled) throw new MemoryValidationError("lessons.nudge requires the exchange archive (exchanges)");
  const minTurnsBetweenNudges = input?.minTurnsBetweenNudges ?? DEFAULT_LESSON_NUDGE_TURNS;
  if (!Number.isSafeInteger(minTurnsBetweenNudges) || minTurnsBetweenNudges < 1 || minTurnsBetweenNudges > MAX_LESSON_NUDGE_TURNS)
    throw new MemoryValidationError(`lessons.minTurnsBetweenNudges must be an integer in [1,${MAX_LESSON_NUDGE_TURNS}]`);
  const archiveAfterSessions = input?.archiveAfterSessions ?? DEFAULT_LESSON_ARCHIVE_SESSIONS;
  if (!Number.isSafeInteger(archiveAfterSessions) || archiveAfterSessions < 1 || archiveAfterSessions > MAX_LESSON_ARCHIVE_SESSIONS)
    throw new MemoryValidationError(`lessons.archiveAfterSessions must be an integer in [1,${MAX_LESSON_ARCHIVE_SESSIONS}]`);
  return { nudge, minTurnsBetweenNudges, archiveAfterSessions };
}

/**
 * The exchange archive's write scope (plan 188.9 Task 1c): `project` only when the project scope is
 * active *and* a root was declared (`scopes.project.root` or `tools.root`) — otherwise a conversational
 * host with no declared root would file history under whatever directory the process started in. Then
 * `user`, then `agent`, then the cwd-derived project, which is the only active scope left.
 */
function resolveExchangesConfig(config: MemoryFabricConfig, active: readonly ResolvedFabricScope[]): ResolvedFabricExchangesOptions {
  const input = config.exchanges;
  const enabled = input === true || (typeof input === "object" && input.enabled !== false);
  const declaredRoot = config.scopes?.project !== false && (config.scopes?.project?.root !== undefined || config.tools?.root !== undefined);
  const activeLevels = new Set(active.map((scope) => scope.level));
  const scope =
    declaredRoot && activeLevels.has("project")
      ? "project"
      : activeLevels.has("user")
        ? "user"
        : activeLevels.has("agent")
          ? "agent"
          : "project";
  const steps =
    typeof input === "object" && input.steps === true ? { maxSteps: input.maxSteps ?? DEFAULT_EXCHANGE_STEPS } : (false as const);
  return { enabled, scope, steps };
}

/**
 * Resolve the enabled levels. An invalid `project.id` or an unresolvable root disables the project
 * scope with a warning; enabling no level at all is a config error.
 */
function resolveScopes(config: MemoryFabricConfig): { scopes: ResolvedMemoryFabricConfig["scopes"]; warning?: string } {
  const tenantId = config.scopes?.tenantId ?? DEFAULT_TENANT;
  const priors = resolveScopePriors(config.scopes?.priors);
  const configuredRoot = resolve(config.scopes?.project === false ? process.cwd() : (config.scopes?.project?.root ?? process.cwd()));
  const user = config.scopes?.user !== false;
  const agent = config.scopes?.agent !== false;
  const projectConfig = config.scopes?.project;
  let project: ResolvedMemoryFabricConfig["scopes"]["project"];
  let scopeWarning: string | undefined;
  if (projectConfig !== false) {
    const id = projectConfig?.id;
    if (id !== undefined) {
      if (!PROJECT_ID.test(id)) {
        scopeWarning = `memory-fabric: scopes.project.id ${JSON.stringify(id)} is not <slug>--<id8>; project scope disabled`;
      } else {
        const split = id.indexOf("--");
        project = {
          resourceId: projectResourceId({ slug: id.slice(0, split), id8: id.slice(split + 2) }),
          source: "path",
          roots: [],
          root: configuredRoot,
        };
      }
    } else {
      try {
        const identity = resolveProjectIdentity(configuredRoot);
        project = { resourceId: projectResourceId(identity), source: identity.source, roots: identity.roots, root: configuredRoot };
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unresolvable";
        scopeWarning = `memory-fabric: ${reason}; project scope disabled`;
      }
    }
  }
  const active: ResolvedFabricScope[] = [];
  if (project !== undefined) active.push({ level: "project", resourceId: project.resourceId });
  if (agent) active.push({ level: "agent", resourceId: "agent" });
  if (user) active.push({ level: "user", resourceId: "user" });
  if (active.length === 0) {
    throw new MemoryValidationError("scopes must enable at least one of user, agent, or project");
  }
  return {
    scopes: {
      tenantId,
      threadId: DEFAULT_THREAD,
      priors,
      active,
      ...(project === undefined ? {} : { project }),
    },
    ...(scopeWarning === undefined ? {} : { warning: scopeWarning }),
  };
}
