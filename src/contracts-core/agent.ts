/** Contracts-core agent family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */

import type {
  AgentEvent,
  InputAssemblyLayout,
  RunLedger,
  RunOptions,
  ToolCapabilityKind,
  ToolDefinition,
  ToolEffectStore,
  ToolRegistry,
} from "../contracts-protocol.js";
import type { RunResult, AgentRunStateOptions, Session } from "../contracts-run-state.js";
import type { HostPort } from "../host/types.js";
import type { HookRegistrar } from "../hooks/types.js";
import type { SecretRedactor } from "../redaction.js";
import type { PermissionPolicy, TrustPolicy } from "../security.js";
import type { SlotAssignments } from "../slots/types.js";
import type { ToolValidator } from "../tools.js";
import type { CompactionOptions, RetryOptions } from "./compaction.js";
import type { ContentBlock, ErrorInfo, JsonObject, Message, ModelConfig, ModelRef, ModelSpec } from "./content.js";
import type { SystemPromptConfig } from "./system-prompt.js";
import type { GuardrailPackRef } from "./guardrail-packs.js";
import type { OwnershipScope, PersistencePage } from "./persistence.js";
import type { ModelProvider, ProviderRequestOptions, ProviderResolver } from "./provider.js";
import type { ResourceLoader } from "./resources.js";
import type { RunLimits } from "./run-limits.js";
import type { SessionListQuery, SessionSearchHit, SessionSearchQuery, SessionStore, SessionSummary } from "./session.js";

export interface AgentDefinition {
  readonly name: string;
  readonly description?: string;
  /** Direct model config, or a `provider/model` string. */
  readonly model?: ModelRef;
  /** Tool names to activate from the tool list in scope. */
  readonly tools?: readonly string[];
  /** Skill names resolved through `resolveActiveSkills()`; `toolNames` enforcement applies. */
  readonly skills?: readonly string[];
  readonly systemPrompt?: SystemPromptConfig;
  readonly instructions?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Optional escape hatch. When present, overrides declarative resolution. */
  create?(config?: AgentConfig): Promise<Agent> | Agent;
  /** Opt-in attention compiler for the agent this definition resolves to (plan 074 C1). */
  readonly attentionCompiler?: import("./attention.js").AttentionCompilerSetting;
}

/** Input to {@link resolveAgentDefinition}. All fields are optional; the host
 *  controls scope by which tools, skills, and provider source it passes. */
export interface AgentDefinitionResolutionContext {
  readonly tools?: ToolRegistry | readonly ToolDefinition[];
  readonly skillsRegistry?: SkillRegistry;
  /** Migration-only: omitted `tools`/`skills` activate every in-scope tool/skill. Defaults to fail-closed. */
  readonly activateAllCapabilities?: true;
  readonly overrides?: Partial<AgentConfig>;
}

export interface AgentConfig {
  readonly id?: string;
  readonly name?: string;
  readonly instructions?: string;
  readonly model: ModelRef;
  readonly tools?: { readonly add?: readonly ToolDefinition[] };
  readonly skills?: {
    readonly dirs?: readonly string[];
    readonly add?: readonly Skill[];
    /** Progressive: catalog (name+description) unless loaded; eager: full instructions every turn. Default progressive. */
    readonly disclosure?: import("../skill-disclosure.js").SkillsDisclosure;
  };
  /** Tools disclosure: "all" (default) sends every active tool schema; "search" sends top-k + the generated `search_tools` tool. */
  readonly toolsDisclosure?: import("../tool-search.js").ToolsDisclosure;
  readonly toolsSearch?: import("../tool-search.js").ToolsSearchOptions;
  /** Opt-in projection-only fold for aged large tool results in provider view; store untouched. */
  readonly toolResultFold?: import("../tool-result-fold.js").ToolResultFoldOptions;
  /** Opt-in: tools hidden by a `RunOptions.tools` scoping stay callable by name (default off). */
  readonly allowHiddenToolCalls?: true;
  /** Opt-in attention compiler (plan 074): `true` for defaults, an object to tune ratios/depth.
   *  Omitted keeps today's request bytes; per-run options may only relax this setting. */
  readonly attentionCompiler?: import("./attention.js").AttentionCompilerSetting;
  /**
   * Missing-usage handling (plan 091 T2, plan 103 T5): `"fallback"` (default) records a labeled
   * estimate when a provider turn reports no usage; `"off"` leaves usage absent — never zero;
   * `"strict"` refuses a usage-less turn instead, failing the run with `code: "usage_missing"`
   * (`name: "UsageMissingError"`) so a host whose cost gates cannot tolerate approximations never
   * runs on an estimate. A refusal is a harness decision, not a provider failure, so it carries no
   * `failureClass` and is never retried. Estimates are marked `Usage.estimated` and never priced.
   */
  readonly usageEstimation?: "fallback" | "off" | "strict";
  /**
   * Session-turn context budget (plan 103 T6): forwarded to every `assembleProviderInput`
   * call this agent's sessions make, so a session gets the same eviction, `tokenEstimator`,
   * and `reportOmissions` semantics as a direct assembler caller. Mutually exclusive with
   * `attentionCompiler` (rejected at assembly). With `usageEstimation: "fallback"`, the
   * missing-usage estimate prefers this budget's own measurement: the request's
   * `ContextBudgetReport.keptTokens` when `reportOmissions` is on, else the `tokenEstimator`
   * projection — see [Runs and usage](../../docs/runs-and-usage.md).
   */
  readonly contextBudget?: import("../context-budget.js").ContextBudget;
  readonly resourceLoader?: ResourceLoader;
  /** Optional trust check for tool and resource targets. */
  readonly trust?: TrustPolicy;
  readonly providerOptions?: ProviderRequestOptions;
  /** Portable thinking intent. Snapped per model; run value overrides. */
  readonly thinkingLevel?: string;
  readonly systemPrompt?: SystemPromptConfig;
  readonly redactor?: SecretRedactor;
  readonly runLedger?: RunLedger;
  /** Optional host-supplied pricing adapter: turn usage without a provider-reported cost is priced through it; absent or stale quotes degrade to usage-only. */
  readonly costCatalog?: import("./content.js").CostCatalog;
  /** Optional durable recovery store. */
  readonly effectStore?: ToolEffectStore;
  readonly ownership?: OwnershipScope;
  /** Opaque optional host principal. Packages own verification and enforcement. */
  readonly principal?: import("../identity.js").Principal;
  readonly idempotencyKey?: string;
  readonly compaction?: false | CompactionOptions;
  readonly retry?: false | RetryOptions;
  /** Agent-wide ceilings; per-run limits may only narrow these values. */
  readonly limits?: RunLimits;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly validator?: ToolValidator;
  readonly inputLayout?: InputAssemblyLayout;
  /** Host hook registrar, called exactly once by `createAgent` under the `host` owner (roadmap §2.4). */
  readonly hooks?: (hooks: HookRegistrar) => void;
  /** Direct slot assignments; a direct implementation always wins over a provided slot. */
  readonly slots?: SlotAssignments;
  /**
   * Packages to load, in order, before the agent is built (roadmap §2.6): definitions (defaults) or
   * instances (`coding({ root })`). A listed package is an active package. `hooks` loads after them.
   */
  readonly packages?: readonly import("../packages/api.js").PackageInput[];
  /** Config per package name, layered over each package's defaults and instance config. Unknown names fail closed. */
  readonly packageConfig?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /**
   * Removes contributions by id after every package has run `setup`, so a package cannot re-add one:
   * tool and skill names (package or host), command names, and hook registration ids
   * (`<package>:<hook>[#id]`). An id nothing carries fails the load with `unknown_disable_id`.
   */
  readonly disable?: AgentDisable;
  /** Host capabilities (UI, …). A host without `ui` answers every request `unavailable`. */
  readonly host?: HostPort;
  /** Opt-in durable interruption/checkpointing default for this agent. */
  readonly runState?: AgentRunStateOptions;
  /** Internal marker set by createSecureAgent(); makes security defaults immutable per run. */
  readonly secure?: true;
}

/** Opt-in fail-closed composition over the normal explicit AgentConfig API. */
export interface SecureAgentOptions
  extends Omit<AgentConfig, "tools" | "validator" | "redactor" | "trust" | "ownership" | "principal" | "limits" | "runState" | "secure"> {
  readonly id: string;
  readonly tools: readonly ToolDefinition[];
  readonly toolArgumentValidator: import("../tools.js").ToolArgumentValidator;
  readonly redactor: SecretRedactor;
  readonly trust: TrustPolicy;
  readonly ownership: OwnershipScope;
  /** Optional host-verified identity; when set must match `ownership`. */
  readonly identity?: import("../identity.js").AgentIdentity;
  readonly limits: RunLimits;
  readonly definitionRevision: string;
  readonly runState: Omit<AgentRunStateOptions, "definitionRevision">;
  /** Optional host composition readiness assertions evaluated on creation. */
  readonly composition?: import("../host-composition.js").HostCompositionOptions;
}

export interface AgentDisable {
  readonly tools?: readonly string[];
  readonly hooks?: readonly string[];
  readonly commands?: readonly string[];
  readonly skills?: readonly string[];
}

export interface AgentCommandRunOptions {
  /** The session the command acts on. It reaches `run` as the owning package's `SessionContext`. */
  readonly session?: Session;
}

/** The commands loaded packages registered (roadmap §2.3). */
export interface AgentCommands {
  list(): readonly import("../packages/api.js").PackageCommandInfo[];
  /** Validates `args` against the command's schema, then runs it. An unknown name throws `PackageLoadError` `unknown_command`. */
  run(name: string, args?: JsonObject, options?: AgentCommandRunOptions): Promise<unknown>;
}

/** One tool the agent exposes, as `agent.tools` lists it. */
export interface ToolInfo {
  readonly name: string;
  readonly description: string;
  /** What the tool can touch; a classifier-typed effect lists every kind. */
  readonly effects: readonly ToolCapabilityKind[];
  /** The registering package, or `host`. */
  readonly package: string;
}

/** One skill the agent exposes, as `agent.skills` lists it. */
export interface SkillInfo {
  readonly name: string;
  readonly description: string;
  /** The registering package, or `host`. */
  readonly package: string;
}

/**
 * `agent.sessions` (roadmap §2.3): list, get, delete and search over the resolved `store` slot's declared
 * capabilities. Every call applies the agent's `ownership` scope, so a session another scope owns is never
 * listed, returned, or deleted. A store without the capability a call needs fails closed with
 * `UnsupportedStoreCapabilityError`; nothing falls back to scanning every session.
 */
export interface SessionIndex {
  /** Needs `SessionStore.listSessions`. Pages through the store's cursor and never loads entries. */
  list(query?: SessionListQuery): Promise<PersistencePage<SessionSummary>>;
  /** The summary of one session, or `undefined` when it is absent or outside the agent's scope. */
  get(id: string): Promise<SessionSummary | undefined>;
  /** Needs `SessionStore.deleteSession`. Rejects with `SessionNotFoundError` when absent or outside the scope. */
  delete(id: string): Promise<void>;
  /** Needs `SessionStore.searchSessions` (the memory and JSONL stores implement it as a capped linear scan). */
  search(query?: SessionSearchQuery): Promise<PersistencePage<SessionSearchHit>>;
}

/** The provider and model a reference resolves to. */
export interface ResolvedModel {
  readonly provider: ModelProvider;
  readonly model: ModelConfig;
}

/**
 * `agent.models` (roadmap §2.3). Phase 5 replaces the reference with `ModelRef` and adds provider-side
 * discovery; the member names stay.
 */
export interface ModelIndex {
  /**
   * The models the registered providers declare through `ModelProvider.models()`, plus the configured model
   * when no provider declared it. Only the public fields: `parameters`, `compat` and `metadata` can hold
   * endpoints or headers, so they are dropped, and the agent's redactor masks the rest.
   */
  list(): Promise<readonly ModelConfig[]>;
  /** The provider and model for `ref`. Rejects with `Unknown provider: <id>` when none is registered. */
  resolve(ref: ModelRef): ResolvedModel;
}

/** `AgentConfig` after `createAgent` parsed `model` into a `ModelSpec`. */
export type ResolvedAgentConfig = Omit<AgentConfig, "model"> & { readonly model: ModelSpec };

export interface Agent {
  /** `AgentConfig.id`, then `name`, else an id generated for this agent. */
  readonly id: string;
  readonly config: ResolvedAgentConfig;
  readonly commands: AgentCommands;
  /** Tools after `disable`: the host's plus every package's. Frozen; empty after `dispose()`. */
  readonly tools: readonly ToolInfo[];
  /** Skills after `disable`: the host's plus every package's. Frozen; empty after `dispose()`. */
  readonly skills: readonly SkillInfo[];
  readonly sessions: SessionIndex;
  readonly models: ModelIndex;
  session(options?: SessionOptions): Promise<Session>;
  /**
   * Agent-scoped events across every session until `dispose()`: `package.status`, `background.*`, and
   * `session.opened` / `session.closed`. Redacted with the agent's redactor. A slow consumer follows
   * `SubscribeOptions.overflow` and never blocks a run.
   */
  subscribe(options?: SubscribeOptions): AsyncIterable<AgentEvent>;
  /**
   * Disposes loaded packages in reverse load order and removes every hook and slot registration they
   * made. A throwing `onDispose` is reported as a `hook.error` and does not stop the rest. Idempotent.
   */
  dispose(): Promise<void>;
  /**
   * What loaded: packages (versions, capabilities, config sources, status), tools, skills, commands,
   * hooks in execution order, slot owners, `disable` ids, and status notes. A deep-frozen JSON snapshot
   * built without I/O. Secret config fields show their ref, and the agent's redactor masks the rest.
   */
  inspect(): import("../agent/inspect.js").AgentInspection;
}

export interface SessionOptions {
  /** Resumes this session through the store slot. An unknown or foreign id rejects with `SessionNotFoundError` unless `create` is set. */
  readonly id?: string;
  /**
   * With `id`: open a new session under that id when the store holds none, and resume it when it does
   * (a host that owns the id, such as an AG-UI thread). The ownership scope still applies to a
   * non-empty branch, so another scope's session is `SessionNotFoundError` either way. Ignored without `id`.
   */
  readonly create?: boolean;
  readonly leafId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /**
   * Restrictive-only guardrail packs compiled once per session onto the existing tool interception
   * seams (plan 092). Built-in ids are versioned; an input object with `rules` is an inline pack.
   * Compiled rules can only deny or tripwire — they never grant permissions.
   */
  readonly guardrailPacks?: readonly GuardrailPackRef[];
  /**
   * TTL of the in-memory `session.snapshot()` branch cache in milliseconds.
   * Default `DEFAULT_SNAPSHOT_CACHE_TTL_MS`; `0` disables the cache (every snapshot read
   * rebuilds from the store); at most `HARD_MAX_SNAPSHOT_CACHE_TTL_MS`. The cache is always
   * invalidated by a new leaf or a mutation, so the TTL only bounds staleness-free reuse.
   */
  readonly snapshotCacheTtlMs?: number;
}

export type AgentSessionConfig = SessionOptions;

/** Default `session.snapshot()` branch-cache TTL (milliseconds). */
export const DEFAULT_SNAPSHOT_CACHE_TTL_MS = 1_000;
/** Upper bound for `SessionOptions.snapshotCacheTtlMs` (milliseconds). */
export const HARD_MAX_SNAPSHOT_CACHE_TTL_MS = 30_000;

export interface SessionForkOptions {
  /** Entry id to fork at: the new session holds the branch that ends there. Defaults to the current leaf. */
  readonly at?: string;
}

export type SubscriberOverflowPolicy = "close" | "drop_oldest" | "drop_newest";

export interface SubscribeOptions {
  /**
   * Plan 104 T5: `true` keeps this subscriber open across runs of the same session; it is then
   * closed only by the host (`subscription.close()` / `session.closeSubscribers()`) or by an
   * overflow under the default `close` policy. Default `false` (closed at run end).
   */
  readonly acrossRuns?: boolean;
  /** Maximum queued events for a subscriber that is not actively awaiting `next()`. Defaults to 1024. */
  readonly maxQueuedEvents?: number;
  /** What to do when `maxQueuedEvents` is reached. Defaults to `close`. */
  readonly overflow?: SubscriberOverflowPolicy;
}

export interface CommandDefinition {
  readonly name: string;
  readonly description?: string;
  readonly parameters?: JsonObject;
  execute(args: JsonObject, context: CommandExecutionContext): Promise<CommandResult> | CommandResult;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CommandExecutionContext {
  readonly sessionId?: string;
  readonly runId?: string;
  readonly signal?: AbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Host-injected driver capabilities (host-opt-in; never package-supplied).
   *  Absent in hosts that don't supply them — commands stay inert data there. */
  readonly drivers?: CommandDrivers;
}

/** Minimal run reference returned by {@link CommandDrivers.startWorkflow}. */
export interface CommandWorkflowRun {
  readonly runId: string;
  readonly status: string;
}

/** Host-injected capabilities a contributed command may act through when the
 *  host opts in. Drivers are supplied by the host at context construction
 *  (e.g. the RPC session factory), never by packages; core only types and
 *  forwards them. `metadata.trust` labeling is unaffected. */
export interface CommandDrivers {
  /** Start a session run. */
  startRun(input: string, options?: RunOptions): Promise<RunResult> | RunResult;
  /** Start a run on a host-understood orchestration definition. Returns at
   *  minimum the run id and status; richer host shapes pass through as-is. */
  startWorkflow(definition: object, input: unknown, options?: Readonly<Record<string, unknown>>): Promise<CommandWorkflowRun>;
  /** Steer an active run with additional input. */
  steer(runId: string, input: string): Promise<void> | void;
}

export interface CommandResult {
  readonly name: string;
  readonly content?: readonly ContentBlock[];
  readonly value?: unknown;
  readonly error?: ErrorInfo;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ContextBlock {
  readonly id?: string;
  readonly title?: string;
  readonly content: string | readonly ContentBlock[];
  readonly priority?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface InputBuildContext {
  readonly inputLayout?: InputAssemblyLayout;
  readonly sessionId?: string;
  readonly runId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
  readonly permission?: PermissionPolicy;
  readonly trust?: TrustPolicy;
}

export interface Skill {
  readonly name: string;
  readonly description?: string;
  readonly instructions?: string;
  /** Absolute path to the source `SKILL.md` when loaded from disk. */
  readonly path?: string;
  readonly toolNames?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SkillRegistry {
  register(skill: Skill): void;
  get(name: string): Skill | undefined;
  resolve(name: string): Skill;
  list(): readonly Skill[];
  /** Removes a skill by name. Optional for host-supplied registries; returns whether it existed. */
  unregister?(name: string): boolean;
}

/** Directory-name spelling for discovered contribution kinds. */
