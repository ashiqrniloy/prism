import type { JsonSchema } from "@arnilo/prism";
import type { MemoryWorkerLimitOptions } from "@arnilo/prism-memory-observational";
import { type MemoryFabricCoreConfig, type ResolvedFabricCoreOptions } from "./delivery/core.js";
import { type MemoryFabricCuesConfig, type ResolvedFabricCuesOptions } from "./delivery/cues.js";
import { type MemoryFabricDirectoryConfig, type ResolvedFabricDirectoryOptions } from "./directory.js";
export type { MemoryFabricCoreConfig, MemoryFabricCuesConfig, MemoryFabricTeamConfig, ResolvedFabricCoreOptions, ResolvedFabricCuesOptions, ResolvedFabricTeamOptions, };
import { type MemoryFabricTeamConfig, type ResolvedFabricTeamOptions } from "./delivery/team.js";
import { type ArchiveConfig, type CapacityLimits, type MemoryNoteDecay, type StorageWeights, type StrengthWeights } from "./lifecycle/index.js";
import { type MemoryFabricPromoteConfig, type ResolvedPromoteConfig } from "./promote.js";
import { type ScopePriors } from "./scope/recall.js";
import type { FabricScopeLevel, MemoryFabricConsolidationOptions, MemoryNoteKind } from "./types.js";
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
        readonly promotion?: {
            readonly reuseThreshold?: number;
        };
        readonly activation?: {
            readonly topK?: number;
            readonly minSimilarity?: number;
        };
        readonly facts?: {
            readonly block?: string;
            readonly maxChars?: number;
        };
        readonly approval?: {
            readonly default?: "off" | "staged";
        };
    };
}
export interface MemoryFabricInjectConfig {
    /**
     * Relevance floor for a passively injected hit. Default `0.2`, chosen with the other two defaults
     * by the plan 188.9 Task 5 rule (cheapest cell at the evidence-sized cost whose per-ability
     * answer visibility does not fall below the 600/3/0.35 control).
     */
    readonly minSimilarity?: number;
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
    readonly recall?: {
        readonly retrieval?: number;
        readonly storage?: number;
    };
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
    readonly capacity?: Partial<Record<"user" | "agent" | "project", {
        readonly notes?: number;
        readonly tokens?: number;
    }>>;
    /**
     * Merging: duplicate folds always, episode clusters only when `episodes` is set (off until plan
     * 188.6 fits the rules) — one model call per cluster.
     */
    readonly merge?: {
        readonly duplicateDice?: number;
        readonly episodes?: false | {
            readonly minCluster?: number;
            readonly model?: string;
        };
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
    readonly episodes?: {
        readonly minCluster: number;
        readonly model?: string;
    };
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
export declare const memoryFabricLifecycleSchema: JsonSchema;
export declare function resolveLifecycleConfig(value: MemoryFabricLifecycleConfig | undefined): ResolvedLifecycleConfig;
/** The exchange archive knobs (plan 188.9 Task 7). */
export interface MemoryFabricExchangesConfig {
    /** `false` keeps the archive off; absent in an object means on. Default off. */
    readonly enabled?: boolean;
}
/** {@link MemoryFabricExchangesConfig} with the write scope the archive resolved. */
export interface ResolvedFabricExchangesOptions {
    readonly enabled: boolean;
    /** The scope an exchange is written to; never `path`. */
    readonly scope: "user" | "agent" | "project";
}
/** The preset names. A later name is additive; each one is a written contract (README `## Conversational preset`). */
export type MemoryFabricPresetName = "conversational";
/**
 * Bumped when a preset's contents change inside its contract (ranking, budgets, delivery, read path).
 * `memory:status` and the setup status note report it, so a measurement is attributable to a revision.
 */
export declare const CONVERSATIONAL_PRESET_REVISION = 1;
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
    readonly store?: "memory" | "markdown" | {
        readonly markdown: MemoryFabricMarkdownStoreConfig;
    } | {
        readonly sqlite: {
            readonly path: string;
        };
    } | {
        readonly postgres: MemoryFabricPostgresStoreConfig;
    };
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
    readonly linker?: boolean | {
        readonly enabled?: boolean;
        readonly topK?: number;
    };
    readonly evolution?: boolean | {
        readonly enabled?: boolean;
        readonly maxPatches?: number;
    };
    readonly passive?: boolean;
    /**
     * The exchange archive: one verbatim note per completed user turn (user text plus the assistant
     * reply), written in the background after the reply is stored. Off by default. The scope is the
     * project only when the project scope is active and a root was declared; otherwise the user scope,
     * then the agent scope (plan 188.9 Task 1c).
     */
    readonly exchanges?: boolean | MemoryFabricExchangesConfig;
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
export type ResolvedMemoryFabricStore = "memory" | {
    readonly markdown: {
        readonly dir: string;
    };
} | {
    readonly sqlite: {
        readonly path: string;
    };
} | {
    readonly postgres: MemoryFabricPostgresStoreConfig;
};
/** {@link MemoryFabricConfig} with every default applied, so `setup` reads one shape. */
export interface ResolvedMemoryFabricConfig {
    /** The preset this config expanded, with its revision; absent when none was named. */
    readonly preset?: {
        readonly name: MemoryFabricPresetName;
        readonly revision: number;
        readonly overridden: readonly string[];
    };
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
    /** The exchange archive, with its write scope resolved from the raw config. */
    readonly exchanges: ResolvedFabricExchangesOptions;
    readonly lifecycle: ResolvedLifecycleConfig;
    readonly promote: ResolvedPromoteConfig;
    readonly workerLimits?: MemoryWorkerLimitOptions;
}
/** The config schema. A literal secret fails validation; the `x-prism-secret` marker is enforced by the loader. */
export declare const memoryFabricConfigSchema: JsonSchema;
/** The preset's own fields, cloned so a caller may mutate them (the bench ablations do). */
export declare function presetFields(name: MemoryFabricPresetName): MemoryFabricConfig;
export declare function resolveMemoryFabricConfig(config?: MemoryFabricConfig): ResolvedMemoryFabricConfig;
