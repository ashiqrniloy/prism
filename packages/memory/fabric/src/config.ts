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
  HARD_DIRECTORY_FILES,
  HARD_DIRECTORY_TOKENS,
  HARD_DIRECTORY_TOPICS,
  type MemoryFabricDirectoryConfig,
  type ResolvedFabricDirectoryOptions,
  resolveFabricDirectoryOptions,
} from "./directory.js";
import {
  HARD_CORE_TOKENS,
  type MemoryFabricCoreConfig,
  type ResolvedFabricCoreOptions,
  resolveFabricCoreOptions,
} from "./delivery/core.js";
import {
  HARD_CUES_PER_TURN,
  HARD_CUE_TOKENS,
  type MemoryFabricCuesConfig,
  type ResolvedFabricCuesOptions,
  resolveFabricCuesOptions,
} from "./delivery/cues.js";

export type { MemoryFabricCoreConfig, MemoryFabricCuesConfig, MemoryFabricTeamConfig, ResolvedFabricCoreOptions, ResolvedFabricCuesOptions, ResolvedFabricTeamOptions };
import { type MemoryFabricTeamConfig, type ResolvedFabricTeamOptions, resolveFabricTeamOptions } from "./delivery/team.js";
import {
  type ArchiveConfig,
  DEFAULT_ARCHIVE_CONFIG,
  DEFAULT_CAPACITY,
  DEFAULT_DECAY,
  DEFAULT_DUPLICATE_DICE,
  DEFAULT_EPISODE_MIN_CLUSTER,
  DEFAULT_STORAGE_WEIGHTS,
  DEFAULT_STRENGTH_WEIGHTS,
  DEFAULT_VERIFY_AFTER_SESSIONS,
  HARD_VERIFY_AFTER_SESSIONS,
  MAX_ARCHIVE_BELOW,
  MAX_EPISODE_CLUSTER,
  MAX_FABRIC_CAPACITY_NOTES,
  MAX_FABRIC_CAPACITY_TOKENS,
  MAX_GRACE_SESSIONS,
  MAX_STORAGE_WEIGHT,
  MAX_STRENGTH_WEIGHT,
  MIN_DUPLICATE_DICE,
  MAX_DUPLICATE_DICE,
  type CapacityLimits,
  type MemoryNoteDecay,
  DEFAULT_WIDEN_CONFIG,
  MAX_WIDEN_CONTRADICTIONS,
  MAX_WIDEN_PROJECTS,
  MAX_WIDEN_SIBLINGS,
  MIN_WIDEN_CONTRADICTIONS,
  MIN_WIDEN_PROJECTS,
  MIN_WIDEN_SIBLINGS,
  type StorageWeights,
  type StrengthWeights,
} from "./lifecycle/index.js";
import type { MemoryNoteKind } from "./types.js";
import { type MemoryFabricPromoteConfig, memoryFabricPromoteSchema, type ResolvedPromoteConfig, resolvePromoteConfig } from "./promote.js";
import { projectResourceId, resolveProjectIdentity } from "./scope/identity.js";
import { resolveScopePriors, type ScopePriors } from "./scope/recall.js";
import type { FabricScopeLevel, MemoryFabricConsolidationOptions } from "./types.js";

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
  readonly minSimilarity?: number;
  readonly topK?: number;
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
  readonly merge: ResolvedMergeConfig;
  readonly widen: ResolvedWidenConfig;
}

const DECAY_KINDS = ["episode", "fact", "preference", "procedure"] as const;
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
    merge: {
      type: "object",
      additionalProperties: false,
      properties: {
        duplicateDice: { type: "number", minimum: MIN_DUPLICATE_DICE, maximum: MAX_DUPLICATE_DICE },
        episodes: { type: "object", additionalProperties: false, properties: { minCluster: { type: "integer" }, model: { type: "string" } } },
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
  const decay: Record<MemoryNoteKind, number> = { ...DEFAULT_DECAY };
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
    retrieval: bounded("lifecycle.recall.retrieval", value?.recall?.retrieval ?? DEFAULT_STRENGTH_WEIGHTS.retrieval, 0, MAX_STRENGTH_WEIGHT),
    storage: bounded("lifecycle.recall.storage", value?.recall?.storage ?? DEFAULT_STRENGTH_WEIGHTS.storage, 0, MAX_STRENGTH_WEIGHT),
  };
  const archive = {
    retrievalBelow: bounded("lifecycle.archive.retrievalBelow", value?.archive?.retrievalBelow ?? DEFAULT_ARCHIVE_CONFIG.retrievalBelow, -MAX_ARCHIVE_BELOW, 0),
    storageBelow: bounded("lifecycle.archive.storageBelow", value?.archive?.storageBelow ?? DEFAULT_ARCHIVE_CONFIG.storageBelow, 0, MAX_ARCHIVE_BELOW),
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
  const merge = resolveMergeConfig(value?.merge);
  const widen = resolveWidenConfig(value?.widen);
  return {
    verifyAfterSessions,
    decay,
    storageWeights,
    recall,
    archive,
    capacity: capacity as unknown as Readonly<Record<"user" | "agent" | "project", CapacityLimits>>,
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
    minProjects: integer("lifecycle.widen.minProjects", value?.minProjects, MIN_WIDEN_PROJECTS, MAX_WIDEN_PROJECTS, DEFAULT_WIDEN_CONFIG.minProjects),
    minSiblings: integer("lifecycle.widen.minSiblings", value?.minSiblings, MIN_WIDEN_SIBLINGS, MAX_WIDEN_SIBLINGS, DEFAULT_WIDEN_CONFIG.minSiblings),
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

/** Validated `packageConfig` for `@arnilo/prism-memory-fabric`. */
export interface MemoryFabricConfig {
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
   * The pinned core: a small top-S slice of long-term memory in the prompt prefix, stable between
   * rebuilds. Default on; `false` computes and shows nothing.
   */
  readonly core?: false | MemoryFabricCoreConfig;
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
  /** The note lifecycle: verification by use across sessions. */
  readonly lifecycle?: MemoryFabricLifecycleConfig;
  /**
   * Session consolidation. `false` or absent (the default) makes no
   * model call; an object enables the opt-in extractor pass and configures acceptance.
   */
  readonly promote?: false | MemoryFabricPromoteConfig;
  readonly workerLimits?: MemoryWorkerLimitOptions;
}

/** {@link MemoryFabricConfig["store"]} with paths resolved and the string defaults expanded. */
export type ResolvedMemoryFabricStore =
  | "memory"
  | { readonly markdown: { readonly dir: string } }
  | { readonly sqlite: { readonly path: string } }
  | { readonly postgres: MemoryFabricPostgresStoreConfig };

/** {@link MemoryFabricConfig} with every default applied, so `setup` reads one shape. */
export interface ResolvedMemoryFabricConfig {
  readonly enabled: boolean;
  readonly retrieval: "lexical" | "hybrid";
  readonly semantic: boolean;
  readonly inject: false | MemoryFabricInjectConfig;
  readonly directory: false | ResolvedFabricDirectoryOptions;
  readonly core: false | ResolvedFabricCoreOptions;
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
  readonly lifecycle: ResolvedLifecycleConfig;
  readonly promote: ResolvedPromoteConfig;
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
export const memoryFabricConfigSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean", default: true },
    retrieval: { enum: ["lexical", "hybrid"], default: "lexical" },
    inject: {
      anyOf: [
        { const: false },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            minSimilarity: { type: "number", minimum: -1, maximum: 1 },
            topK: { type: "integer", minimum: 1, maximum: HARD_TOP_K_CAP },
            budgetTokens: { type: "integer", minimum: 1 },
            query: { enum: ["task", "user"] },
            kinds: { type: "array", minItems: 1, items: { enum: ["fact", "file", "procedure", "episode", "working"] } },
          },
        },
      ],
    },
    semantic: { type: "boolean", default: true },
    directory: flagOrObject({
      maxTopics: { type: "integer", minimum: 1, maximum: HARD_DIRECTORY_TOPICS },
      maxFiles: { type: "integer", minimum: 1, maximum: HARD_DIRECTORY_FILES },
      maxTokens: { type: "integer", minimum: 1, maximum: HARD_DIRECTORY_TOKENS },
    }),
    core: flagOrObject({
      maxTokens: { type: "integer", minimum: 1, maximum: HARD_CORE_TOKENS },
      scopes: { type: "array", minItems: 1, maxItems: 2, items: { enum: ["user", "project"] } },
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
              properties: {
              },
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
    lifecycle: memoryFabricLifecycleSchema,
    promote: memoryFabricPromoteSchema,
    workerLimits: { type: "object", additionalProperties: true },
  },
};

export function resolveMemoryFabricConfig(config: MemoryFabricConfig = {}): ResolvedMemoryFabricConfig {
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
  return {
    enabled: config.enabled !== false,
    retrieval: config.retrieval ?? "lexical",
    semantic: config.semantic !== false,
    inject: config.inject ?? false,
    directory: resolveFabricDirectoryOptions(config.directory, config.semantic !== false || Boolean(config.tools?.root)),
    // The core is on by default: it is the always-present tier, and it costs nothing after the first
    // cached turn. A store without `scanMetadata` turns it off at setup instead.
    core: resolveFabricCoreOptions(config.core, true),
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
    lifecycle: resolveLifecycleConfig(config.lifecycle),
    promote: resolvePromoteConfig(config.promote),
    ...(config.workerLimits === undefined ? {} : { workerLimits: config.workerLimits }),
  };
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
