/** Contracts-core agent family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */

import type {
  AgentEvent,
  InputAssemblyLayout,
  RunLedger,
  ToolCapabilityKind,
  ToolDefinition,
  ToolEffectStore,
  ToolRegistry,
} from "../contracts-protocol.js";
import type { Session } from "../contracts-run-state.js";
import type { HookRegistrar } from "../hooks/types.js";
import type { HostPort } from "../host/types.js";
import type { SecretRedactor } from "../redaction.js";
import type { PermissionPolicy, TrustPolicy } from "../security.js";
import type { SlotAssignments } from "../slots/types.js";
import type { ToolValidator } from "../tools.js";
import type { CompactionOptions, RetryOptions } from "./compaction.js";
import type { ContentBlock, JsonObject, ModelConfig, ModelRef, ModelSpec } from "./content.js";
import type { OwnershipScope, PersistencePage } from "./persistence.js";
import type { ModelProvider, ProviderRequestOptions } from "./provider.js";
import type { ResourceLoader } from "./resources.js";
import type { RunLimits, SessionLimits } from "./run-limits.js";
import type { SessionActor, SessionListQuery, SessionParentLink, SessionSearchHit, SessionSearchQuery, SessionSummary } from "./session.js";
import type { SystemPromptConfig } from "./system-prompt.js";

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
}

/** Host registries a definition resolver used to receive. All fields are optional; the host
 *  controls scope by which tools, skills, and provider source it passes. */
export interface AgentDefinitionResolutionContext {
  readonly tools?: ToolRegistry | readonly ToolDefinition[];
  readonly skillsRegistry?: SkillRegistry;
  readonly overrides?: Partial<AgentConfig>;
}

export interface AgentConfig {
  readonly id?: string;
  readonly name?: string;
  readonly instructions?: string;
  /**
   * Required unless the `loop` slot's strategy declares `usesModel: false` (an external-agent driver);
   * otherwise `createAgent` fails with `model_required`. Never falls back to a default provider.
   */
  readonly model?: ModelRef;
  readonly tools?: {
    readonly add?: readonly ToolDefinition[];
    /**
     * Built-in check of every tool call's arguments against the tool's `parameters` before it runs
     * (default `"schema"`): a violation blocks the call with `reason: "invalid_arguments"`. `"off"`
     * restores the 0.14.0 behavior. `validator` still runs after the check.
     */
    readonly validation?: "schema" | "off";
    /**
     * How many calls of one model turn run at once (integer 1–16, default 4; `1` is serial). A round
     * with an `exclusive` tool, a tool with no `effects`, or an unknown tool name stays serial. Results
     * are appended in call order. `RunOptions.tools.concurrency` can only lower it.
     */
    readonly concurrency?: number;
  };
  readonly skills?: {
    readonly dirs?: readonly string[];
    readonly add?: readonly Skill[];
    /** Progressive: catalog (name+description) unless loaded; eager: full instructions every turn. Default progressive. */
    readonly disclosure?: import("../skill-disclosure.js").SkillsDisclosure;
    /** Progressive catalog bounds: listed skills (default 64) and description bytes (default 512). */
    readonly catalog?: import("../skill-disclosure.js").SkillCatalogOptions;
  };
  /** Opt-in: tools hidden by a `RunOptions.tools` scoping stay callable by name (default off). */
  readonly allowHiddenToolCalls?: true;
  /**
   * Missing-usage handling (plan 091 T2, plan 103 T5): `"fallback"` (default) records a labeled
   * estimate when a provider turn reports no usage; `"off"` leaves usage absent — never zero;
   * `"strict"` refuses a usage-less turn instead, failing the run with `code: "usage_missing"`
   * (`name: "UsageMissingError"`) so a host whose cost gates cannot tolerate approximations never
   * runs on an estimate. A refusal is a harness decision, not a provider failure, so it carries no
   * `failureClass` and is never retried. Estimates are marked `Usage.estimated` and never priced.
   */
  readonly usageEstimation?: "fallback" | "off" | "strict";
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
  /**
   * When the kernel writes durable run state to the branch. `"suspension"` (default) writes it only when a run
   * suspends for an approval. `"turn"` also appends one `run_checkpoint` entry per completed tool round, so
   * `session.continue()` restores the run id, limit counters, wall deadline and loop state (plan 231 Task 3).
   */
  readonly durability?: "suspension" | "turn";
  readonly ownership?: OwnershipScope;
  /** Opaque optional host principal. Packages own verification and enforcement. */
  readonly principal?: import("./principal.js").Principal;
  readonly idempotencyKey?: string;
  readonly compaction?: false | CompactionOptions;
  readonly retry?: false | RetryOptions;
  /** Agent-wide policy limits (`RunOptions.limits` narrows them); each byte axis stays at or below `ceilings`. */
  readonly limits?: RunLimits;
  /** Default session-wide limits for every session opened on this agent (`SessionOptions.limits` narrows by `min`). */
  readonly sessionLimits?: SessionLimits;
  /**
   * Process-safety ceilings (plan 239 Task 4). Host-only: `createAgent` reads them once, and no run option,
   * package, manifest, tool or model can set or raise one. Each is a positive safe integer; `null` is rejected.
   * Omitted keys keep the shipped defaults. See {@link AgentCeilings}.
   */
  readonly ceilings?: AgentCeilings;
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
}

/**
 * Plan 159 Task 7: `createSecureAgent`/`SecureAgentOptions` are gone. The guarantees it enforced at
 * build time live in `@arnilo/prism-extensions/governance` as `governance({ require: { principal, ownership } })`
 * plus the kernel's fail-closed defaults.
 */
export interface AgentDisable {
  readonly tools?: readonly string[];
  readonly hooks?: readonly string[];
  readonly commands?: readonly string[];
  readonly skills?: readonly string[];
  readonly packages?: readonly string[];
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
  /** The skill's `requiresTools`, listed even while a request hides the skill. */
  readonly requiresTools?: readonly string[];
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
export type ResolvedAgentConfig = Omit<AgentConfig, "model"> & { readonly model?: ModelSpec };

export const AGENT_DISPOSED_CODE = "ERR_PRISM_AGENT_DISPOSED";

/**
 * Raised by `agent.session()` and `agent.commands.run()` once `dispose()` has started (plan 177 Task 5).
 * A live run is aborted with the lowercase code `agent_disposed` instead, which is also the code a tool
 * round gets when a loop keeps dispatching after that abort.
 */
export class AgentDisposedError extends Error {
  readonly code = AGENT_DISPOSED_CODE;
  constructor(message = "Agent has been disposed") {
    super(message);
    this.name = "AgentDisposedError";
  }
}

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
   * Re-assembles this agent in place: re-reads `skills.dirs`, re-runs every package's `setup` (so a
   * package can re-discover its own skill directories), and re-compiles `AgentConfig.hooks` and package
   * hooks on a fresh bus, then swaps in the new runtime. Open sessions keep their conversation and see
   * the new skills and hooks on their next run; `tool`, `skill`, and `command` views reflect the swap.
   * One reload runs at a time. A failure leaves the committed runtime untouched. Rejects with
   * `AgentDisposedError` once `dispose()` has started.
   */
  reload(): Promise<void>;
  /**
   * Agent-scoped events across every session until `dispose()`: `package.status`, `background.*`, and
   * `session.opened` / `session.closed`. Redacted with the agent's redactor. A slow consumer follows
   * `SubscribeOptions.overflow` and never blocks a run.
   */
  subscribe(options?: SubscribeOptions): AsyncIterable<AgentEvent>;
  /**
   * Aborts every active run, closes every open session (settling background tasks within the existing
   * bound), then disposes loaded packages in reverse load order and removes every hook and slot
   * registration they made. A throwing `onDispose` is reported as a `hook.error` and does not stop the
   * rest. After it starts, `session()` and `commands.run()` throw `AgentDisposedError`, and an active run
   * ends as an abort whose code is `agent_disposed`. Idempotent; a second call awaits the first.
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
  /**
   * Links a newly created session to a parent session, agent, run, or delegation. Persisted once in
   * the session's first entry and read by `SessionIndex` filters; ignored when the session already exists.
   */
  readonly parent?: SessionParentLink;
  /** Who drives the session. Persisted with `parent`; never derived. Ignored when the session already exists. */
  readonly actor?: SessionActor;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /**
   * Narrows the agent's declared `ownership` for this session (plan 177 Task 4): it may add fields the
   * agent left undefined or repeat them, but a field that changes the agent's value throws
   * `OwnershipScopeError` (`ERR_PRISM_OWNERSHIP_WIDEN`). A run on the session may narrow it further by the
   * same rule. The effective scope stamps every entry the session writes and is checked against the
   * branch on open and before every run.
   */
  readonly ownership?: OwnershipScope;
  /**
   * TTL of the in-memory `session.snapshot()` branch cache in milliseconds.
   * Default `DEFAULT_SNAPSHOT_CACHE_TTL_MS`; `0` disables the cache (every snapshot read
   * rebuilds from the store); at most `HARD_MAX_SNAPSHOT_CACHE_TTL_MS`. The session's own appends
   * at the cached tip extend the cache; checkout, fork, resume, a compaction entry or an append
   * conflict drop it. Once the TTL expires, one `store.get` of the tip revalidates it (a store
   * without `get` rebuilds), so the TTL bounds how long an external delete can go unseen.
   */
  readonly snapshotCacheTtlMs?: number;
  /** Session-wide budget across runs (`maxCost`, `maxTotalTokens`, `maxRuns`, `deadline`); narrows `AgentConfig.sessionLimits` by `min`. */
  readonly limits?: SessionLimits;
}

export type AgentSessionConfig = SessionOptions;

/**
 * Host-only process-safety ceilings (plan 239 Task 4). A ceiling bounds what any policy layer may ask for,
 * so a bug or an untrusted input cannot exhaust the process. Only the host raises or lowers one, at
 * `createAgent`. Each defaults to the shipped value named in brackets.
 */
export interface AgentCeilings {
  /** Upper bound for `limits.maxRequestBytes` [`HARD_RUN_LIMITS.maxRequestBytes`, 64 MiB]. */
  readonly maxRequestBytes?: number;
  /** Upper bound for `limits.maxResponseBytes` [`HARD_RUN_LIMITS.maxResponseBytes`, 64 MiB]. */
  readonly maxResponseBytes?: number;
  /** Upper bound for `limits.maxRunStateBytes`, and the bound on loading a stored run state [`HARD_MAX_AGENT_RUN_STATE_BYTES`, 1 MiB]. */
  readonly runStateBytes?: number;
  /** Pending decisions one run may suspend on, and the size of one decision batch [`HARD_MAX_PENDING_DECISIONS`, 128]. */
  readonly pendingDecisions?: number;
  /** Sticky decisions one run may hold [`DEFAULT_MAX_STICKY_DECISIONS`, 64]. */
  readonly stickyDecisions?: number;
  /** Steer messages queued on one session [`DEFAULT_MAX_PENDING_STEERS`, 8]. */
  readonly pendingSteers?: number;
  /** UTF-8 bytes of queued steer messages on one session [`DEFAULT_MAX_PENDING_STEER_BYTES`, 64 KiB]. */
  readonly pendingSteerBytes?: number;
  /** Upper bound for `SessionOptions.snapshotCacheTtlMs` [`HARD_MAX_SNAPSHOT_CACHE_TTL_MS`, 30 s]. */
  readonly snapshotCacheTtlMs?: number;
  /** Bytes of one skill's instructions, from any source; packages read it as `prism.ceilings` [`HARD_MAX_SKILL_INSTRUCTION_BYTES`, 256 KiB]. */
  readonly skillInstructionBytes?: number;
  /** Bytes of one package state value or one external-state entry [`MAX_STATE_VALUE_BYTES`, 64 KiB]. */
  readonly stateValueBytes?: number;
  /** Entries one `prism.state.log(key)` holds per branch [`MAX_STATE_LOG_ENTRIES`, 10,000]. */
  readonly stateLogEntries?: number;
  /** Entries one external-state key holds per branch [`MAX_EXTERNAL_STATE_ENTRIES`, 10,000]. */
  readonly externalStateEntries?: number;
  /** Bytes one external-state key holds per branch [`MAX_EXTERNAL_STATE_BYTES`, 8 MiB]. */
  readonly externalStateBytes?: number;
  /** Pages a branch read follows before it fails with `SessionBranchReadLimitError` [`DEFAULT_MAX_BRANCH_PAGES`, 64]. */
  readonly branchReadPages?: number;
  /** Upper bound for `tools.concurrency` [`MAX_TOOL_CONCURRENCY`, 16]. */
  readonly toolConcurrency?: number;
}

/** Every ceiling resolved: the host's value, or the shipped default. */
export type ResolvedAgentCeilings = { readonly [K in keyof AgentCeilings]-?: number };

/** Default `session.snapshot()` branch-cache TTL (milliseconds). */
export const DEFAULT_SNAPSHOT_CACHE_TTL_MS = 1_000;
/** Upper bound for `SessionOptions.snapshotCacheTtlMs` (milliseconds). */
export const HARD_MAX_SNAPSHOT_CACHE_TTL_MS = 30_000;

export interface SessionForkOptions {
  /** Entry id to fork at: the new session holds the branch that ends there. Defaults to the current leaf. */
  readonly at?: string;
}

/**
 * What a subscriber does when `maxQueuedEvents` is reached. `coalesce` (default, plan 228 Task 3) merges a
 * lagging subscriber's adjacent text/thinking `message.delta` events (≤ 16 KiB of text per merged delta) and
 * keeps only the newest queued `tool.progress` per call, then fails the iterator with
 * `SubscriberOverflowError` like `close` once the bound is reached by events that cannot be merged.
 */
export type SubscriberOverflowPolicy = "coalesce" | "close" | "drop_oldest" | "drop_newest";

export interface SubscribeOptions {
  /**
   * Plan 104 T5: `true` keeps this subscriber open across runs of the same session; it is then
   * closed only by the host (`subscription.close()` / `session.closeSubscribers()`) or by an
   * overflow under the `coalesce` (default) or `close` policy. Default `false` (closed at run end).
   */
  readonly acrossRuns?: boolean;
  /** Maximum queued events for a subscriber that is not actively awaiting `next()`. Defaults to 4096; no hard cap. */
  readonly maxQueuedEvents?: number;
  /** What to do when `maxQueuedEvents` is reached. Defaults to `coalesce`. */
  readonly overflow?: SubscriberOverflowPolicy;
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
  /**
   * Tools that must all be in a request's advertised tools for this skill to be listed, rendered or loaded.
   * Unlike `toolNames`, a missing tool hides the skill for that request and never fails the run, and it
   * grants no tool. Frontmatter: `metadata.prism-requires-tools`, a space-separated list.
   */
  readonly requiresTools?: readonly string[];
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
