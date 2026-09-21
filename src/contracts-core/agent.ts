/** Contracts-core agent family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */

import type { InputAssemblyLayout, RunLedger, RunOptions, ToolDefinition, ToolEffectStore, ToolRegistry } from "../contracts-protocol.js";
import type { AgentRunResult, AgentRunStateOptions, AgentSession } from "../contracts-run-state.js";
import type { ContributionRegistries } from "../contributions.js";
import type { MiddlewareRegistry } from "../middleware.js";
import type { SecretRedactor } from "../redaction.js";
import type { PermissionPolicy, TrustPolicy } from "../security.js";
import type { ToolValidator } from "../tools.js";
import type { CompactionOptions, RetryOptions } from "./compaction.js";
import type { ContentBlock, ErrorInfo, JsonObject, Message, ModelConfig } from "./content.js";
import type { ExtensionAPI, ProviderRequestPolicy, SystemPromptConfig } from "./extensions.js";
import type { GuardrailPackRef } from "./guardrail-packs.js";
import type { AgentLoopOptions, AgentLoopStrategy, LoopContext, StopHook } from "./loop.js";
import type { OwnershipScope } from "./persistence.js";
import type { AIProvider, ProviderRequestOptions, ProviderResolver } from "./provider.js";
import type { ResourceLoader } from "./resources.js";
import type { Guardrails, RunLimits } from "./run-limits.js";
import type { SessionStore } from "./session.js";

export interface AgentDefinition {
  readonly name: string;
  readonly description?: string;
  /** Direct model config, or a model id resolved from `registries.models`. */
  readonly model?: ModelConfig | string;
  /** Tool names to activate from the active tool registry / `registries.tools`. */
  readonly tools?: readonly string[];
  /** Skill names resolved through `resolveActiveSkills()`; `toolNames` enforcement applies. */
  readonly skills?: readonly string[];
  /** Context provider names from `registries.contextProviders`. */
  readonly context?: readonly string[];
  readonly systemPrompt?: SystemPromptConfig;
  readonly instructions?: string;
  readonly loop?: AgentLoopStrategy | AgentLoopOptions;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Optional escape hatch. When present, overrides declarative resolution. */
  create?(config?: AgentConfig): Promise<Agent> | Agent;
  /** Opt-in attention compiler for the agent this definition resolves to (plan 074 C1). */
  readonly attentionCompiler?: import("./attention.js").AttentionCompilerSetting;
}

/** Input to {@link resolveAgentDefinition}. All fields are optional; the host
 *  controls scope by which registries it passes. */
export interface AgentDefinitionResolutionContext {
  readonly registries?: ContributionRegistries;
  readonly providerSource?: ProviderResolver;
  readonly tools?: ToolRegistry | readonly ToolDefinition[];
  readonly skillsRegistry?: SkillRegistry;
  /** Migration-only: omitted `tools`/`skills` activate every in-scope tool/skill. Defaults to fail-closed. */
  readonly activateAllCapabilities?: true;
  readonly overrides?: Partial<AgentConfig>;
}

/** Per-turn tool menu. Called at `loopCtx.assemble` before each provider request. */
export interface ToolNarrowingContext {
  /** 1-based provider turn this assemble precedes. */
  readonly turn: number;
  /** Text of the latest assistant message, when any. */
  readonly lastAssistantText?: string;
  /** Run-grant tool names (R11 snapshot, including generated `search_tools` when disclosure is search). */
  readonly toolIds: readonly string[];
}

/** Host callback: return a subset of `toolIds`. Superset names are clamped; throw fails the turn. */
export type ToolNarrowing = (ctx: ToolNarrowingContext) => readonly string[] | Promise<readonly string[]>;

export interface AgentConfig {
  readonly id?: string;
  readonly name?: string;
  readonly instructions?: string;
  readonly model: ModelConfig;
  readonly provider?: AIProvider;
  readonly providerSource?: ProviderResolver;
  readonly tools?: ToolRegistry | readonly ToolDefinition[];
  readonly context?: readonly ContextProvider[];
  readonly skills?: SkillRegistry | readonly Skill[];
  /** Migration opt-in: activate every registry skill by default when run options do not narrow activation. */
  readonly activateAllSkills?: true;
  /** Progressive: catalog (name+description) unless loaded; eager: full instructions every turn. Default progressive. */
  readonly skillsDisclosure?: import("../skill-disclosure.js").SkillsDisclosure;
  /** Tools disclosure: "all" (default) sends every active tool schema; "search" sends top-k + the generated `search_tools` tool. */
  readonly toolsDisclosure?: import("../tool-search.js").ToolsDisclosure;
  readonly toolsSearch?: import("../tool-search.js").ToolsSearchOptions;
  /** Per-turn restrictive allow-list over the run grant. RunOptions override. */
  readonly toolNarrowing?: ToolNarrowing;
  /** Opt-in: tools hidden this turn stay callable by name (default off). */
  readonly allowHiddenToolCalls?: true;
  /** Opt-in projection-only fold for aged large tool results in provider view; store untouched. */
  readonly toolResultFold?: import("../tool-result-fold.js").ToolResultFoldOptions;
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
  readonly inputBuilder?: InputBuilder;
  readonly promptBuilder?: PromptBuilder;
  readonly middleware?: MiddlewareRegistry;
  readonly resourceLoader?: ResourceLoader;
  readonly store?: SessionStore;
  readonly permission?: PermissionPolicy;
  /** Optional trust check for tool and resource targets. */
  readonly trust?: TrustPolicy;
  readonly providerOptions?: ProviderRequestOptions;
  /** Portable thinking intent. Snapped per model; run value overrides. */
  readonly thinkingLevel?: string;
  readonly providerRequestPolicies?: ProviderRequestPolicy | readonly ProviderRequestPolicy[];
  readonly systemPrompt?: SystemPromptConfig;
  readonly redactor?: SecretRedactor;
  readonly runLedger?: RunLedger;
  /** Optional host-supplied pricing adapter: turn usage without a provider-reported cost is priced through it; absent or stale quotes degrade to usage-only. */
  readonly costCatalog?: import("./content.js").CostCatalog;
  /** Optional durable recovery store. */
  readonly effectStore?: ToolEffectStore;
  readonly ownership?: OwnershipScope;
  /** Host-verified identity default for sessions created from this agent. */
  readonly identity?: import("../identity.js").AgentIdentity;
  readonly idempotencyKey?: string;
  readonly compaction?: false | CompactionOptions;
  readonly retry?: false | RetryOptions;
  /** Agent-wide ceilings; per-run limits may only narrow these values. */
  readonly limits?: RunLimits;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly validator?: ToolValidator;
  readonly instructionInjectors?: readonly InstructionInjector[];
  readonly inputLayout?: InputAssemblyLayout;
  readonly loop?: AgentLoopStrategy | AgentLoopOptions;
  readonly guardrails?: Guardrails;
  /** Run-end stop hooks (plan 106 R1); `RunOptions.stopHooks` appends to this list. */
  readonly stopHooks?: readonly StopHook[];
  /** Opt-in durable interruption/checkpointing default for this agent. */
  readonly runState?: AgentRunStateOptions;
  /** Internal marker set by createSecureAgent(); makes security defaults immutable per run. */
  readonly secure?: true;
}

/** Opt-in fail-closed composition over the normal explicit AgentConfig API. */
export interface SecureAgentOptions
  extends Omit<
    AgentConfig,
    "tools" | "validator" | "redactor" | "permission" | "trust" | "ownership" | "identity" | "limits" | "runState" | "secure"
  > {
  readonly id: string;
  readonly tools: readonly ToolDefinition[];
  readonly toolArgumentValidator: import("../tools.js").ToolArgumentValidator;
  readonly redactor: SecretRedactor;
  readonly permission: PermissionPolicy;
  readonly trust: TrustPolicy;
  readonly ownership: OwnershipScope;
  /** Optional host-verified identity; when set must match `ownership`. */
  readonly identity?: import("../identity.js").AgentIdentity;
  readonly limits: RunLimits;
  readonly definitionRevision: string;
  readonly runState: Omit<AgentRunStateOptions, "definitionRevision" | "interruptBeforeTool">;
  /** Optional host composition readiness assertions evaluated on creation. */
  readonly composition?: import("../host-composition.js").HostCompositionOptions;
}

export interface Agent {
  readonly config: AgentConfig;
  createSession(config?: AgentSessionConfig): AgentSession;
}

export interface AgentSessionConfig {
  readonly id?: string;
  readonly agent?: Agent;
  readonly store?: SessionStore;
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

/** Default `session.snapshot()` branch-cache TTL (milliseconds). */
export const DEFAULT_SNAPSHOT_CACHE_TTL_MS = 1_000;
/** Upper bound for `AgentSessionConfig.snapshotCacheTtlMs` (milliseconds). */
export const HARD_MAX_SNAPSHOT_CACHE_TTL_MS = 30_000;

export interface AgentSessionForkOptions {
  readonly leafId?: string;
}

export interface AgentSessionCloneOptions {
  readonly id?: string;
  readonly leafId?: string;
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
  startRun(input: string, options?: RunOptions): Promise<AgentRunResult> | AgentRunResult;
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

export interface ContextProvider {
  readonly name: string;
  resolve(context: ContextResolutionContext): Promise<readonly ContextBlock[]> | readonly ContextBlock[];
}

export interface ContextResolutionContext {
  readonly sessionId?: string;
  readonly runId?: string;
  readonly messages: readonly Message[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

/** When an {@link InstructionInjector} contributes to the assembled provider input. */
export type InstructionTiming = "first_turn" | "every_turn" | "on_input";

/** Runtime turn scope handed to an {@link InstructionInjector}. Mirrors {@link LoopContext}
 *  scope using already-redacted input/history so predicates cannot recover secrets. */
export interface InstructionContext {
  readonly sessionId: string;
  readonly runId: string;
  readonly turn: number;
  readonly input: readonly Message[];
  readonly history: readonly Message[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}

/** Output of an {@link InstructionInjector}. Only `instructions` and `contextBlocks` are
 *  honored; other fields grant nothing (no tools, skills, or permissions). */
export interface InstructionContribution {
  readonly instructions?: string;
  readonly contextBlocks?: readonly ContextBlock[];
  readonly when: InstructionTiming;
  /** Used only when `when === "on_input"`; absent predicate means apply every turn. */
  readonly predicate?: (ctx: InstructionContext) => boolean;
}

/** Additive instruction/context contribution that a package registers through
 *  {@link ExtensionAPI.registerInstructionInjector} and the host selects on
 *  {@link AgentConfig.instructionInjectors} / {@link RunOptions.instructionInjectors}.
 *  Inert until selected; cannot grant privileges beyond text/context blocks. */
export interface InstructionInjector {
  readonly name: string;
  readonly description?: string;
  apply(ctx: InstructionContext): InstructionContribution;
}

export interface InputBuilder {
  readonly name: string;
  build(input: string | Message | readonly Message[], context?: InputBuildContext): Promise<readonly Message[]> | readonly Message[];
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

export interface PromptBuilder {
  readonly name: string;
  build(request: PromptBuildRequest): Promise<readonly Message[]> | readonly Message[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PromptBuildRequest {
  readonly messages: readonly Message[];
  /** Input layout selected by the host; the default builder uses cache-aware ordering unless legacy is explicit. */
  readonly inputLayout?: InputAssemblyLayout;
  readonly context?: readonly ContextBlock[];
  readonly skills?: readonly Skill[];
  readonly skillsDisclosure?: import("../skill-disclosure.js").SkillsDisclosure;
  readonly loadedSkills?: import("../skill-disclosure.js").LoadedSkillSet;
  /** Loaded skill bodies already appended to `messages` by the session tail allocator; render catalog entries only. */
  readonly tailSkillBodies?: boolean;
  /** Tools disclosure: "all" (default) sends every active tool schema; "search" sends top-k + the generated `search_tools` tool. */
  readonly toolsDisclosure?: import("../tool-search.js").ToolsDisclosure;
  readonly toolsSearch?: import("../tool-search.js").ToolsSearchOptions;
  /** Skills demoted to catalog-only by context budget this turn. */
  readonly demotedSkillBodies?: readonly string[];
  readonly tools?: readonly ToolDefinition[];
  /** Model being prompted; lets builders adapt composition to declared capabilities
   *  (e.g. the default builder omits the `Available tools:` text for tool-capable models). */
  readonly model?: ModelConfig;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface Skill {
  readonly name: string;
  readonly description?: string;
  readonly instructions?: string;
  readonly context?: readonly ContextProvider[];
  readonly toolNames?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SkillRegistry {
  register(skill: Skill): void;
  get(name: string): Skill | undefined;
  resolve(name: string): Skill;
  list(): readonly Skill[];
}

/** Directory-name spelling for discovered contribution kinds. Maps to a
 *  {@link ManifestContributionDeclaration} kind for non-skill kinds:
 *  `context` → `contextProvider`, `instructions` → `systemPromptContribution`. */
