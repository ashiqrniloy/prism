import type { AgentInput } from "./input.js";
import type { ContributionRegistries } from "./contributions.js";
import type { Middleware, MiddlewareHookName, MiddlewareRegistry } from "./middleware.js";
import type { SecretRedactor } from "./redaction.js";
import type { PermissionPolicy, TrustPolicy } from "./security.js";
import type { ManifestContributionDeclaration } from "./manifests.js";
import type { ToolValidator } from "./tools.js";
import type { AudioContent, DocumentContent, FileContent } from "./content.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface ErrorInfo {
  readonly name?: string;
  readonly message: string;
  readonly code?: string | number;
  readonly cause?: unknown;
}

export type { AudioContent, DocumentContent, FileContent } from "./content.js";

export type ContentBlock =
  | TextContent
  | ImageContent
  | AudioContent
  | FileContent
  | DocumentContent
  | ThinkingContent
  | ToolCallDeltaContent
  | ToolCallContent
  | ToolResultContent;

export interface TextContent {
  readonly type: "text";
  readonly text: string;
}

export interface ImageContent {
  readonly type: "image";
  readonly mimeType?: string;
  readonly data?: string;
  readonly url?: string;
  readonly resourceUri?: string;
  readonly name?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ThinkingContent {
  readonly type: "thinking";
  readonly text: string;
  readonly signature?: string;
}

export interface ToolCallDeltaContent {
  readonly type: "tool_call_delta";
  readonly index: number;
  readonly id?: string;
  readonly name?: string;
  readonly argumentsText?: string;
}

export interface ToolCallContent {
  readonly type: "tool_call";
  readonly id: string;
  readonly name: string;
  readonly arguments: JsonObject;
  /** Set when streamed arguments failed JSON parse; dispatch blocks without execute(). */
  readonly argumentsError?: ErrorInfo;
}

export interface ToolResultContent {
  readonly type: "tool_result";
  readonly toolCallId: string;
  readonly name: string;
  readonly result?: unknown;
  readonly error?: ErrorInfo;
}

export interface Message {
  readonly id?: string;
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: readonly ContentBlock[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ModelConfig {
  readonly provider: string;
  readonly model: string;
  readonly displayName?: string;
  readonly capabilities?: ModelCapabilities;
  readonly limits?: ModelLimits;
  readonly cost?: ModelCost;
  readonly cache?: ModelCacheCapabilities;
  readonly compat?: JsonObject;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ModelCapabilities {
  /** Known values include `text`, `image`, `audio`, `file`, and `document`. */
  readonly input?: readonly string[];
  readonly output?: readonly string[];
  readonly reasoning?: boolean;
  readonly tools?: boolean;
  readonly streaming?: boolean;
  /** Native JSON-schema structured output support for this model. */
  readonly structuredOutput?: boolean | "json_schema";
}

export interface ModelLimits {
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
}

export interface ModelCost {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly currency?: string;
  readonly unit?: string;
}

export interface Usage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly cost?: number;
  readonly currency?: string;
}

export interface RunLimits {
  readonly maxTurns?: number;
  readonly maxProviderAttempts?: number;
  readonly maxToolRounds?: number;
  readonly maxToolCalls?: number;
  readonly maxWallTimeMs?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly maxTotalTokens?: number;
  readonly maxCost?: { readonly amount: number; readonly currency: string };
}

export type RunLimitName = keyof Required<RunLimits>;

export interface RunLimitCounters {
  readonly turns: number;
  readonly providerAttempts: number;
  readonly toolRounds: number;
  readonly toolCalls: number;
  readonly wallTimeMs: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cost: number;
}

export interface RunLimitBreach {
  readonly limit: RunLimitName;
  readonly maximum: number;
  readonly observed: number;
  readonly currency?: string;
}

export type GuardrailStage = "input" | "output" | "tool_input" | "tool_output";
export type GuardrailAction = "allow" | "block" | "tripwire" | "interrupt";

export type GuardrailValue<S extends GuardrailStage> =
  S extends "input" ? readonly Message[] :
  S extends "output" ? ProviderTurnResult :
  S extends "tool_input" ? ToolCallContent :
  ToolResult;

export interface GuardrailContext<S extends GuardrailStage> {
  readonly stage: S;
  readonly value: GuardrailValue<S>;
  readonly sessionId: string;
  readonly runId: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}

export interface GuardrailDecision {
  readonly action: GuardrailAction;
  readonly reason?: string;
  /** Public data only; Prism JSON-normalizes, bounds, and redacts it before emission. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Guardrail<S extends GuardrailStage = GuardrailStage> {
  readonly name: string;
  readonly stage: S;
  /** Host-authored stable identity for durable definitions; unused by ordinary runs. */
  readonly revision?: string;
  evaluate(context: GuardrailContext<S>): GuardrailDecision | Promise<GuardrailDecision>;
}

export interface GuardrailRecord {
  readonly guardrail: string;
  readonly stage: GuardrailStage;
  readonly action: GuardrailAction;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Guardrails {
  readonly input?: readonly Guardrail<"input">[];
  readonly output?: readonly Guardrail<"output">[];
  readonly toolInput?: readonly Guardrail<"tool_input">[];
  readonly toolOutput?: readonly Guardrail<"tool_output">[];
  /** Defaults to sequential; at most 16 stage evaluations run at once. */
  readonly maxConcurrency?: number;
}

export type CacheRetention = "none" | "short" | "long";
export type PromptCacheKind = "implicit" | "openai_key" | "cache_control" | "provider_specific" | "none";

export interface ModelCacheCapabilities {
  readonly kind?: PromptCacheKind;
  readonly maxKeyLength?: number;
  readonly maxBreakpoints?: number;
  readonly minCacheableTokens?: number;
  readonly longRetention?: boolean;
}

export type PromptCacheMode = "auto" | "on" | "off";
export type PromptCacheBreakpointLocation = "system_prompt" | "tools" | "stable_context" | "last_stable_message" | "last_user_message" | "message_id";
export type PromptCacheBreakpointTtl = "short" | "long";

export interface PromptCacheBreakpoint {
  readonly location: PromptCacheBreakpointLocation;
  readonly messageId?: string;
  readonly ttl?: PromptCacheBreakpointTtl;
}

export interface PromptCacheHints {
  readonly mode?: PromptCacheMode;
  readonly key?: string;
  readonly retention?: CacheRetention;
  readonly breakpoints?: readonly PromptCacheBreakpoint[];
}

export interface StructuredOutputOptions {
  readonly name: string;
  readonly schema: JsonObject;
  readonly strict?: boolean;
}

export interface ProviderRequestOptions {
  readonly sessionId?: string;
  readonly cacheRetention?: CacheRetention;
  readonly cacheKey?: string;
  readonly cache?: PromptCacheHints;
  readonly headers?: Readonly<Record<string, string>>;
  /** @deprecated Provider-level timeout is inert in first-party providers; pass an AbortSignal/RunOptions.signal instead. */
  readonly timeoutMs?: number;
  /** @deprecated Provider-level retry is inert in first-party providers; use AgentConfig.retry/RunOptions.retry instead. */
  readonly maxRetries?: number;
  /** @deprecated Provider-level retry is inert in first-party providers; use AgentConfig.retry/RunOptions.retry instead. */
  readonly maxRetryDelayMs?: number;
  readonly compat?: JsonObject;
  readonly extra?: JsonObject;
  /** Provider-neutral JSON-schema structured output request. Requires model `capabilities.structuredOutput`. */
  readonly structuredOutput?: StructuredOutputOptions;
}

export interface ProviderRequest {
  readonly model: ModelConfig;
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolDefinition[];
  readonly context?: readonly ContextBlock[];
  readonly options?: ProviderRequestOptions;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export type ProviderEvent =
  | { readonly type: "message_start"; readonly messageId?: string }
  | { readonly type: "content_delta"; readonly content: ContentBlock }
  | { readonly type: "tool_call_delta"; readonly index: number; readonly id?: string; readonly name?: string; readonly argumentsText?: string }
  | { readonly type: "tool_call"; readonly call: ToolCallContent }
  | { readonly type: "usage"; readonly usage: Usage }
  | { readonly type: "done"; readonly usage?: Usage }
  | { readonly type: "error"; readonly error: ErrorInfo };

export interface AIProvider {
  readonly id: string;
  generate(request: ProviderRequest): AsyncIterable<ProviderEvent>;
}

export type ProviderResolver = (model: ModelConfig) => AIProvider | undefined;

export type InputAssemblyLayout = "legacy" | "cache_aware";

export interface RunOptions {
  readonly signal?: AbortSignal;
  readonly model?: ModelConfig;
  readonly providerSource?: ProviderResolver;
  /** @deprecated Use `limits.maxToolRounds`. */
  readonly maxToolRounds?: number;
  /** Run-scoped ceilings. When an agent config also sets limits, these can only narrow it. */
  readonly limits?: RunLimits;
  readonly providerOptions?: ProviderRequestOptions;
  readonly providerRequestPolicies?: ProviderRequestPolicy | readonly ProviderRequestPolicy[];
  readonly systemPrompt?: SystemPromptConfig;
  readonly compaction?: false | CompactionOptions;
  readonly retry?: false | RetryOptions;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly redactor?: SecretRedactor;
  readonly runLedger?: RunLedger;
  readonly ownership?: OwnershipScope;
  readonly idempotencyKey?: string;
  readonly validate?: ToolValidator;
  readonly activeSkills?: readonly string[];
  readonly skills?: readonly Skill[];
  readonly instructionInjectors?: readonly InstructionInjector[];
  readonly inputLayout?: InputAssemblyLayout;
  readonly loop?: AgentLoopStrategy | AgentLoopOptions;
  /** Appended to agent-level guardrails for this run. */
  readonly guardrails?: Guardrails;
  /** Opt-in durable interruption/checkpointing. */
  readonly runState?: AgentRunStateOptions;
}

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
  readonly inputBuilder?: InputBuilder;
  readonly promptBuilder?: PromptBuilder;
  readonly middleware?: MiddlewareRegistry;
  readonly resourceLoader?: ResourceLoader;
  readonly store?: SessionStore;
  readonly permission?: PermissionPolicy;
  /** Optional trust check for tool and resource targets. */
  readonly trust?: TrustPolicy;
  readonly providerOptions?: ProviderRequestOptions;
  readonly providerRequestPolicies?: ProviderRequestPolicy | readonly ProviderRequestPolicy[];
  readonly systemPrompt?: SystemPromptConfig;
  readonly redactor?: SecretRedactor;
  readonly runLedger?: RunLedger;
  readonly ownership?: OwnershipScope;
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
  /** Opt-in durable interruption/checkpointing default for this agent. */
  readonly runState?: AgentRunStateOptions;
  /** Internal marker set by createSecureAgent(); makes security defaults immutable per run. */
  readonly secure?: true;
}

/** Opt-in fail-closed composition over the normal explicit AgentConfig API. */
export interface SecureAgentOptions extends Omit<AgentConfig, "tools" | "validator" | "redactor" | "permission" | "trust" | "ownership" | "limits" | "runState" | "secure"> {
  readonly id: string;
  readonly tools: readonly ToolDefinition[];
  readonly toolArgumentValidator: import("./tools.js").ToolArgumentValidator;
  readonly redactor: SecretRedactor;
  readonly permission: PermissionPolicy;
  readonly trust: TrustPolicy;
  readonly ownership: OwnershipScope;
  readonly limits: RunLimits;
  readonly definitionRevision: string;
  readonly runState: Omit<AgentRunStateOptions, "definitionRevision" | "interruptBeforeTool">;
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
}

export interface AgentSessionForkOptions {
  readonly leafId?: string;
}

export interface AgentSessionCloneOptions {
  readonly id?: string;
  readonly leafId?: string;
}

export type SubscriberOverflowPolicy = "close" | "drop_oldest" | "drop_newest";

export interface SubscribeOptions {
  /** Maximum queued events for a subscriber that is not actively awaiting `next()`. Defaults to 1024. */
  readonly maxQueuedEvents?: number;
  /** What to do when `maxQueuedEvents` is reached. Defaults to `close`. */
  readonly overflow?: SubscriberOverflowPolicy;
}

export type AgentRunStatus = "succeeded" | "failed" | "aborted" | "suspended" | "denied";

export type AgentRunInterruptionKind = "input_guardrail" | "tool_approval";

/** Redacted safe-boundary descriptor; never contains tool arguments. */
export interface AgentRunInterruption {
  readonly kind: AgentRunInterruptionKind;
  readonly reason: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
}

export interface AgentRunStateOptions {
  readonly checkpoints: CheckpointStore;
  /** Host-authored immutable revision required for durable runs. */
  readonly definitionRevision: string;
  /** Suspend every tool call before its side effect. */
  readonly interruptBeforeTool?: boolean;
  readonly maxStateBytes?: number;
  readonly fencingToken?: number;
}

/** Versioned, redacted checkpoint payload. Treat as opaque except status/version/interruption. */
export interface AgentRunState {
  readonly schemaVersion: 1;
  readonly agentId: string;
  readonly definitionRevision: string;
  readonly fingerprint: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly leafId?: string;
  readonly model: ModelConfig;
  readonly status: AgentRunStatus | "running";
  readonly interruption?: AgentRunInterruption;
  readonly version?: number;
}

export interface AgentRunResume {
  readonly decision: "approve" | "deny";
  readonly expectedVersion: number;
}

export interface AgentRunResumeOptions {
  readonly checkpoints: CheckpointStore;
  /** Current host-authored revision; must exactly match the checkpoint. */
  readonly definitionRevision: string;
  readonly ownership?: OwnershipScope;
  readonly fencingToken?: number;
}

export interface AgentRunRef {
  readonly runId: string;
  readonly sessionId?: string;
}

export interface AgentRunStatusResult {
  readonly state: AgentRunState;
  readonly version: number;
}

export class AgentRunStateError extends Error {
  readonly code = "ERR_PRISM_AGENT_RUN_STATE";
  constructor(message: string) { super(message); this.name = "AgentRunStateError"; }
}

/** Terminal result of `session.run()` / `session.prompt()`. Failed and aborted runs throw {@link AgentRunError} with this shape attached. */
export interface AgentRunResult {
  readonly sessionId: string;
  readonly runId: string;
  readonly status: AgentRunStatus;
  /** Branch leaf after the run settles. */
  readonly leafId?: string;
  /** Concatenated text blocks from the final assistant message, or `""` when none. */
  readonly text: string;
  /** Content blocks from the final assistant message, or `[]` when none. */
  readonly content: readonly ContentBlock[];
  /** Final assistant message when the run produced one. */
  readonly message?: Message;
  /** Aggregate usage across provider turns (`run_total` scope). */
  readonly usage?: Usage;
  /** Present when the run hit a configured resource ceiling. */
  readonly limit?: RunLimitBreach;
  /** Present when `status` is `"failed"` or when a failed attempt still produced partial output. */
  readonly error?: ErrorInfo;
  /** String form of the abort reason when `status` is `"aborted"`. */
  readonly abortReason?: string;
  /** Present for durable suspended/terminal runs. Payload is redacted and bounded. */
  readonly runState?: AgentRunState;
  /** Present only while awaiting an operator decision. */
  readonly interruption?: AgentRunInterruption;
}

export class AgentRunError extends Error {
  readonly result: AgentRunResult;

  constructor(result: AgentRunResult, options?: { readonly cause?: unknown }) {
    super(result.error?.message ?? (result.status === "aborted" ? "Agent run aborted" : "Agent run failed"), options);
    this.name = "AgentRunError";
    this.result = result;
  }
}

export interface AgentSession {
  readonly id: string;
  /** Current branch leaf entry id; advances on every append/run and is re-pointed by `checkout`.
   *  Undefined until the first entry lands (a fresh session with no history). */
  readonly leafId: string | undefined;
  run(input: string | Message | readonly Message[], options?: RunOptions): Promise<AgentRunResult>;
  prompt(input: string, options?: RunOptions): Promise<AgentRunResult>;
  /** Subscribe first, then start exactly one run and yield only that run's events until it terminates. */
  stream(input: string | Message | readonly Message[], options?: RunOptions & SubscribeOptions): AsyncIterable<AgentEvent>;
  compact(options?: CompactionOptions): Promise<CompactionResult>;
  subscribe(options?: SubscribeOptions): AsyncIterable<AgentEvent>;
  abort(reason?: unknown): void;
  entries(): Promise<readonly SessionEntry[]>;
  checkout(leafId?: string): Promise<void>;
  fork(options?: AgentSessionForkOptions): AgentSession;
  clone(options?: AgentSessionCloneOptions): Promise<AgentSession>;
}

export interface ProviderTurnMetadata {
  readonly providerId: string;
  readonly model: ModelConfig;
  readonly requestId?: string;
  readonly latencyMs?: number;
  readonly attempt?: number;
  readonly httpStatus?: number;
  readonly rateLimitRemaining?: number;
  readonly rateLimitResetMs?: number;
}

export interface ToolExecutionMetadata {
  readonly durationMs: number;
  readonly status: ToolCallStatus;
}

export type AgentEvent =
  | { readonly type: "agent_started"; readonly sessionId: string; readonly runId: string }
  | { readonly type: "agent_finished"; readonly sessionId: string; readonly runId: string; readonly usage?: Usage }
  | { readonly type: "agent_suspended"; readonly sessionId: string; readonly runId: string; readonly interruption: AgentRunInterruption; readonly version: number }
  | { readonly type: "agent_resumed"; readonly sessionId: string; readonly runId: string; readonly version: number }
  | { readonly type: "agent_denied"; readonly sessionId: string; readonly runId: string; readonly interruption: AgentRunInterruption; readonly version: number }
  | { readonly type: "turn_started"; readonly sessionId: string; readonly runId: string; readonly turn: number }
  | { readonly type: "turn_finished"; readonly sessionId: string; readonly runId: string; readonly turn: number }
  | { readonly type: "provider_turn_started"; readonly sessionId: string; readonly runId: string; readonly turn: number; readonly metadata: ProviderTurnMetadata }
  | { readonly type: "provider_turn_finished"; readonly sessionId: string; readonly runId: string; readonly turn: number; readonly metadata: ProviderTurnMetadata; readonly usage?: Usage; readonly error?: ErrorInfo }
  | { readonly type: "message_started"; readonly sessionId: string; readonly runId: string; readonly message: Message }
  | { readonly type: "message_delta"; readonly sessionId: string; readonly runId: string; readonly content: ContentBlock }
  | { readonly type: "message_finished"; readonly sessionId: string; readonly runId: string; readonly message: Message }
  | { readonly type: "tool_execution_started"; readonly sessionId: string; readonly runId: string; readonly call: ToolCallContent }
  | { readonly type: "tool_execution_progress"; readonly sessionId: string; readonly runId: string; readonly toolCallId: string; readonly name: string; readonly progress?: unknown; readonly metadata?: Readonly<Record<string, unknown>> }
  | { readonly type: "tool_execution_finished"; readonly sessionId: string; readonly runId: string; readonly result: ToolResult; readonly metadata: ToolExecutionMetadata }
  | { readonly type: "tool_execution_error"; readonly sessionId: string; readonly runId: string; readonly call: ToolCallContent; readonly error: ErrorInfo; readonly metadata: ToolExecutionMetadata }
  | { readonly type: "tool_execution_blocked"; readonly sessionId: string; readonly runId: string; readonly toolCallId: string; readonly name: string; readonly reason: string; readonly error: ErrorInfo; readonly metadata: ToolExecutionMetadata }
  | { readonly type: "guardrail_decision"; readonly sessionId: string; readonly runId: string; readonly toolCallId?: string; readonly toolName?: string; readonly record: GuardrailRecord }
  | { readonly type: "run_limit_exceeded"; readonly sessionId: string; readonly runId: string; readonly breach: RunLimitBreach }
  | { readonly type: "queue_updated"; readonly sessionId: string; readonly runId: string; readonly size: number }
  | { readonly type: "event_subscriber_overflow"; readonly sessionId: string; readonly runId?: string; readonly droppedEvents: number; readonly maxQueuedEvents: number; readonly overflow: SubscriberOverflowPolicy }
  | { readonly type: "compaction_started"; readonly sessionId: string; readonly runId?: string }
  | { readonly type: "compaction_finished"; readonly sessionId: string; readonly runId?: string; readonly summary: string }
  | { readonly type: "retry_scheduled"; readonly sessionId: string; readonly runId: string; readonly attempt: number; readonly delayMs: number; readonly error: ErrorInfo }
  | { readonly type: "error"; readonly sessionId?: string; readonly runId?: string; readonly error: ErrorInfo }
  | { readonly type: "artifact_validation_started"; readonly sessionId: string; readonly runId: string; readonly turn: number; readonly attempt: number }
  | { readonly type: "artifact_validation_finished"; readonly sessionId: string; readonly runId: string; readonly turn: number; readonly attempt: number; readonly result: ArtifactValidation }
  | { readonly type: "artifact_revision_started"; readonly sessionId: string; readonly runId: string; readonly turn: number; readonly attempt: number; readonly failure: ArtifactValidation }
  | { readonly type: "artifact_finished"; readonly sessionId: string; readonly runId: string; readonly turn: number; readonly attempt: number; readonly result: ArtifactValidation }
  | { readonly type: "artifact_failed"; readonly sessionId: string; readonly runId: string; readonly turn: number; readonly attempt: number; readonly result: ArtifactValidation };

export interface ToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly parameters?: JsonObject;
  /** Force any provider turn containing this tool to dispatch sequentially. */
  readonly exclusive?: boolean;
  execute(args: JsonObject, context: ToolExecutionContext): Promise<ToolResult> | ToolResult;
}

export interface ToolRegistry {
  register(tool: ToolDefinition): void;
  get(name: string): ToolDefinition | undefined;
  resolve(name: string): ToolDefinition;
  list(): readonly ToolDefinition[];
}

export interface ToolExecutionContext {
  readonly sessionId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly signal?: AbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
  progress?(progress?: unknown, metadata?: Readonly<Record<string, unknown>>): void | Promise<void>;
}

export interface ToolResult {
  readonly toolCallId: string;
  readonly name: string;
  readonly content?: readonly ContentBlock[];
  readonly value?: unknown;
  readonly error?: ErrorInfo;
  readonly metadata?: Readonly<Record<string, unknown>>;
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
  readonly context?: readonly ContextBlock[];
  readonly skills?: readonly Skill[];
  readonly tools?: readonly ToolDefinition[];
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
export type ContributionFileKind = "skill" | "tool" | "context" | "instructions";

/** Inert envelope emitted by the host/CLI discovery scanner. Carries the
 *  realized {@link Skill} for skill kinds and a manifest-referenced
 *  {@link ManifestContributionDeclaration} for other kinds; the host owns
 *  any executable behavior. Contains no code, no credential. */
export interface DiscoveredContribution {
  readonly kind: ContributionFileKind;
  readonly name: string;
  readonly origin: "global" | "workspace";
  readonly path: string;
  /** Present when `kind === "skill"`. */
  readonly skill?: Skill;
  /** Present for non-skill kinds. */
  readonly declaration?: ManifestContributionDeclaration;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ExtensionLifecycleEventName =
  | "resource_discovery"
  | "session_start"
  | "session_shutdown"
  | "before_agent_start"
  | "turn"
  | "context"
  | "provider_request"
  | "tool_call"
  | "tool_result"
  | "compaction"
  | "retry";

export interface ExtensionEvent {
  readonly type: ExtensionLifecycleEventName | "extension_error" | string;
  readonly payload?: unknown;
  readonly extension?: string;
  readonly error?: ErrorInfo;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Extension {
  readonly name: string;
  setup(api: ExtensionAPI): void | Promise<void>;
}

export interface ProviderPackage {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly docs?: ProviderPackageDocs;
  setup(api: ProviderPackageAPI): void | Promise<void>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ProviderPackageDocs {
  readonly description?: string;
  readonly links?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ProviderPackageAPI extends ExtensionAPI {}

export type AuthMethod = ApiKeyAuthMethod | OAuthAuthMethod | CustomAuthMethod;

export interface ApiKeyAuthMethod {
  readonly kind: "api_key";
  readonly provider: string;
  readonly name?: string;
  readonly credentialName?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface OAuthAuthMethod {
  readonly kind: "oauth";
  readonly provider: string;
  readonly name?: string;
  readonly oauth?: OAuthProvider;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface OAuthLoginCallbacks {
  onAuth?(url: string): void | Promise<void>;
  onDeviceCode?(code: { readonly userCode: string; readonly verificationUri: string; readonly expiresAt?: string }): void | Promise<void>;
  onPrompt?(message: string): string | undefined | Promise<string | undefined>;
  onSelect?(prompt: { readonly message: string; readonly choices: readonly string[] }): string | undefined | Promise<string | undefined>;
  /** Aborts OAuth login flows and device-code polling when signaled. */
  readonly signal?: AbortSignal;
}

export interface OAuthCredentials {
  readonly access?: string;
  readonly refresh?: string;
  readonly expires?: string | number;
  readonly accountId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface OAuthProvider {
  readonly id: string;
  login(callbacks?: OAuthLoginCallbacks): Promise<OAuthCredentials> | OAuthCredentials;
  refresh?(credentials: OAuthCredentials): Promise<OAuthCredentials> | OAuthCredentials;
  getCredential?(credentials: OAuthCredentials): Promise<Credential | undefined> | Credential | undefined;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CustomAuthMethod {
  readonly kind: "custom" | string;
  readonly provider: string;
  readonly name?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ProviderRequestPolicy {
  readonly name: string;
  apply(context: ProviderRequestPolicyContext): Promise<ProviderRequest | ProviderRequestPolicyResult> | ProviderRequest | ProviderRequestPolicyResult;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ProviderRequestPolicyContext {
  readonly request: ProviderRequest;
  readonly sessionId?: string;
  readonly runId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface ProviderRequestPolicyResult {
  readonly request: ProviderRequest;
  readonly secrets?: readonly (string | undefined)[];
}

export type SystemPromptMode = "append" | "prepend" | "replace" | "disable";
export type SystemPromptSource = "package" | "app" | "user" | "run" | string;

export interface SystemPromptContribution {
  readonly id: string;
  readonly source?: SystemPromptSource;
  readonly mode?: SystemPromptMode;
  readonly text: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type SystemPromptConfig = false | SystemPromptContribution | readonly SystemPromptContribution[];

export interface ExtensionAPI {
  readonly registries: ContributionRegistries;
  readonly middleware: MiddlewareRegistry;
  on(type: ExtensionLifecycleEventName | string, handler: (event: ExtensionEvent) => void | Promise<void>): () => void;
  emit(event: ExtensionEvent): Promise<void>;
  use<T>(hook: MiddlewareHookName | string, middleware: Middleware<T>): () => void;
  registerProvider(provider: AIProvider): void;
  registerModel(model: ModelConfig): void;
  registerTool(tool: ToolDefinition): void;
  registerContextProvider(provider: ContextProvider): void;
  registerSkill(skill: Skill): void;
  registerCommand(command: CommandDefinition): void;
  registerAgent(agent: AgentDefinition): void;
  registerInputBuilder(builder: InputBuilder): void;
  registerPromptBuilder(builder: PromptBuilder): void;
  registerCompactionStrategy(strategy: CompactionStrategy): void;
  registerRetryPolicy(policy: RetryPolicy): void;
  registerStoreFactory(factory: StoreFactory): void;
  registerResourceLoader(key: string, loader: ResourceLoader): void;
  registerSettingsProvider(key: string, provider: SettingsProvider): void;
  registerCredentialResolver(key: string, resolver: CredentialResolver): void;
  registerProviderPackage(providerPackage: ProviderPackage): void;
  registerAuthMethod(method: AuthMethod): void;
  registerProviderRequestPolicy(policy: ProviderRequestPolicy): void;
  registerSystemPromptContribution(contribution: SystemPromptContribution): void;
  registerInstructionInjector(injector: InstructionInjector): void;
}

export type SessionEntryKind =
  | "message"
  | "event"
  | "summary"
  | "metadata"
  | "model_change"
  | "label"
  | "custom"
  | "compaction";

export const SESSION_ENTRY_KINDS: readonly SessionEntryKind[] = [
  "message",
  "event",
  "summary",
  "metadata",
  "model_change",
  "label",
  "custom",
  "compaction",
];

const SESSION_ENTRY_KIND_SET: ReadonlySet<SessionEntryKind> = new Set(SESSION_ENTRY_KINDS);

export const SESSION_ENTRY_SCHEMA_VERSION = 1;

export function isSessionEntryKind(value: unknown): value is SessionEntryKind {
  return typeof value === "string" && SESSION_ENTRY_KIND_SET.has(value as SessionEntryKind);
}

export interface SessionEntry {
  readonly id: string;
  readonly parentId?: string;
  readonly sessionId: string;
  readonly timestamp: string;
  readonly kind: SessionEntryKind;
  readonly schemaVersion?: 1;
  readonly runId?: string;
  readonly message?: Message;
  readonly event?: AgentEvent;
  readonly model?: ModelConfig;
  readonly previousModel?: ModelConfig;
  readonly label?: string;
  readonly summary?: string;
  readonly data?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SessionStore {
  append(entry: SessionEntry, options?: SessionAppendOptions): Promise<void>;
  list(sessionId: string): Promise<readonly SessionEntry[]>;
  get?(id: string): Promise<SessionEntry | undefined>;
  /** DB-friendly branch read: return one branch's ancestor chain as a page so adapters
   *  avoid `list(sessionId)` (full-session scan) + in-memory rebuild. Optional — the
   *  built-in memory/JSONL stores omit it and the runtime falls back to `list()`. */
  readBranchPath?(query: SessionBranchRead): Promise<PersistencePage<SessionEntry>>;
}

/** Query for a single branch's ancestor chain (DB-friendly: one recursive/ancestor query
 *  instead of a full-session scan). Honored by `SessionStore.readBranchPath` and the pure
 *  branch helpers' reader overload. `leafId` is optional (omit for the latest leaf). */
export interface SessionBranchRead {
  readonly sessionId: string;
  readonly leafId?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

/** Database-neutral callable returning one branch's ancestor chain as a page. Implementations
 *  issue a single recursive CTE / ancestor walk; the pure helpers follow `nextCursor` to
 *  completion. Returns redacted `SessionEntry` values only (stores already persist redacted
 *  entries; the runtime redacts before append). */
export type BranchReader = (query: SessionBranchRead) => Promise<PersistencePage<SessionEntry>>;

/**
 * Options for `SessionStore.append`. Stores that honor them reject dangling
 * `expectedParentId` values and deduplicate exact retries by `idempotencyKey` +
 * parent. Production stores may add stricter branch-tip CAS and report
 * `currentLeafId` in `SessionAppendConflictError`. `idempotencyKey` is an opaque
 * host string; stores redact it like metadata when persisted. Carries no
 * credentials, credential resolvers, provider instances, or unredacted secrets.
 */
export interface SessionAppendOptions {
  /** Parent entry the new entry should attach to. Must exist when provided. */
  readonly expectedParentId?: string;
  /** Opaque host idempotency key; exact retries for one parent deduplicate. */
  readonly idempotencyKey?: string;
}

/**
 * Durable pointer to a branch tip. One session may own many handles (one per
 * leaf). `BranchRecord.leafEntryId` is the persistence-side equivalent.
 */
export interface SessionBranchHandle {
  readonly sessionId: string;
  readonly leafId: string;
}

/** Stable error code carried by `SessionAppendConflictError`. */
export const SESSION_APPEND_CONFLICT_CODE = "session_append_conflict" as const;

/** Conflict details carried by `SessionAppendConflictError`. Carries no secrets. */
export interface SessionAppendConflict {
  readonly code: typeof SESSION_APPEND_CONFLICT_CODE;
  readonly expectedParentId?: string;
  readonly currentLeafId?: string;
  readonly idempotencyDuplicate?: boolean;
}

/**
 * Thrown when `SessionStore.append` rejects an entry under `SessionAppendOptions`
 * (dangling/stale `expectedParentId`, stricter adapter CAS failure, or duplicate
 * idempotency key for the same parent). Recognize via the stable `code` and
 * `isSessionAppendConflict`, not message text.
 */
export class SessionAppendConflictError extends Error {
  readonly code = SESSION_APPEND_CONFLICT_CODE;
  constructor(readonly conflict: SessionAppendConflict) {
    const detail = conflict.idempotencyDuplicate
      ? `idempotency key already used`
      : conflict.currentLeafId !== undefined
        ? `expected parent ${conflict.expectedParentId ?? "<none>"} does not match current leaf ${conflict.currentLeafId}`
        : `expected parent ${conflict.expectedParentId ?? "<none>"} is unavailable`;
    super(`session append conflict: ${detail}`);
    this.name = "SessionAppendConflictError";
  }
}

/** Type guard keyed off the stable `code` (works across bundles; not message text). */
export function isSessionAppendConflict(error: unknown): error is SessionAppendConflictError {
  return error instanceof Error && (error as { code?: unknown }).code === SESSION_APPEND_CONFLICT_CODE;
}

export interface StoreFactory {
  readonly name: string;
  create(config?: JsonObject): Promise<SessionStore> | SessionStore;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Ownership scope identifiers. Hosts may use these for multi-tenant isolation. */
export interface OwnershipScope {
  readonly tenantId?: string;
  readonly accountId?: string;
  readonly userId?: string;
}

/** Cursor-paginated result page. */
export interface PersistencePage<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
  readonly total?: number;
}

/** Common query controls for cursor-based pagination. */
export interface PersistenceQuery {
  readonly cursor?: string;
  readonly limit?: number;
  readonly order?: "asc" | "desc";
}

/** Generic versioned checkpoint key. Namespaces prevent consumer collisions. */
export interface CheckpointKey extends OwnershipScope {
  readonly namespace: string;
  readonly key: string;
  readonly signal?: AbortSignal;
}

/** Input for an optimistic checkpoint write. Versions must strictly increase. */
export interface CheckpointSaveInput extends CheckpointKey {
  readonly version: number;
  /** Exact current version required before update; use 0 for create-only. */
  readonly expectedVersion?: number;
  /** Monotonic lease fence. Lower or absent worker fences cannot replace a fenced record. */
  readonly fencingToken?: number;
  readonly value: unknown;
  readonly category?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Durable generic checkpoint record. */
export interface CheckpointRecord extends OwnershipScope {
  readonly namespace: string;
  readonly key: string;
  readonly version: number;
  readonly fencingToken?: number;
  readonly value: unknown;
  readonly category?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Bounded checkpoint query. */
export interface CheckpointQuery extends PersistenceQuery, OwnershipScope {
  readonly namespace?: string;
  readonly keyPrefix?: string;
  readonly category?: string | readonly string[];
  readonly signal?: AbortSignal;
}

/** Generic versioned checkpoint capability for persistence adapters. */
export interface CheckpointStore {
  saveCheckpoint(input: CheckpointSaveInput): Promise<CheckpointRecord>;
  loadCheckpoint(input: CheckpointKey): Promise<CheckpointRecord | null>;
  listCheckpoints(query?: CheckpointQuery): Promise<PersistencePage<CheckpointRecord>>;
  deleteCheckpoint(input: CheckpointKey): Promise<boolean>;
}

/** Generic lease key. Ownership fields are part of the trust boundary. */
export interface LeaseKey extends OwnershipScope {
  readonly namespace: string;
  readonly key: string;
  readonly signal?: AbortSignal;
}

export interface LeaseAcquireInput extends LeaseKey {
  readonly ownerId: string;
  readonly ttlMs: number;
}

export interface LeaseClaimInput extends LeaseKey {
  readonly ownerId: string;
  readonly token: string;
  readonly ttlMs?: number;
}

export interface LeaseRecord extends OwnershipScope {
  readonly namespace: string;
  readonly key: string;
  readonly ownerId: string;
  readonly token: string;
  readonly fencingToken: number;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly updatedAt: string;
}

/** Atomic distributed lease capability. Expired rows retain fencing counters. */
export interface LeaseStore {
  tryAcquireLease(input: LeaseAcquireInput): Promise<LeaseRecord | null>;
  renewLease(input: LeaseClaimInput & { readonly ttlMs: number }): Promise<LeaseRecord | null>;
  releaseLease(input: LeaseClaimInput): Promise<boolean>;
  getLease(input: LeaseKey): Promise<LeaseRecord | null>;
}

/** Stored session record. Does not include provider objects or credentials. */
export interface SessionRecord extends OwnershipScope {
  readonly id: string;
  readonly parentSessionId?: string;
  readonly agentDefinitionId?: string;
  readonly agentDefinitionVersion?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt?: string;
  readonly retentionPolicyId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Stored branch handle / leaf pointer. The leaf is the current entry id for the branch. */
export interface BranchRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly name?: string;
  readonly rootEntryId?: string;
  readonly parentBranchId?: string;
  /** Durable leaf entry id for this branch (the persistence-side branch tip). */
  readonly leafEntryId?: string;
  readonly createdAt: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type RunStatus = "queued" | "running" | "suspended" | "denied" | "succeeded" | "failed" | "aborted";

/** Stored run record. */
export interface RunRecord extends OwnershipScope {
  readonly id: string;
  readonly sessionId: string;
  readonly branchId?: string;
  readonly agentDefinitionId?: string;
  readonly agentDefinitionVersion?: string;
  readonly model?: ModelConfig;
  readonly provider?: string;
  readonly idempotencyKey?: string;
  readonly status?: RunStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly abortReason?: string;
  readonly error?: ErrorInfo;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type AgentEventType = AgentEvent["type"];

/** Stored agent event ledger row. The `event` payload should be redacted before storage when secrets are present. */
export interface AgentEventRecord extends OwnershipScope {
  readonly id: string;
  readonly sessionId: string;
  readonly runId?: string;
  readonly entryId?: string;
  readonly type: AgentEventType;
  readonly timestamp: string;
  readonly event: AgentEvent;
  readonly redacted: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ToolCallStatus = "started" | "finished" | "error" | "blocked";

/** Stored tool-call row. The `result` payload should be redacted before storage when secrets are present. */
export interface ToolCallRecord extends OwnershipScope {
  readonly id: string;
  readonly sessionId: string;
  readonly runId?: string;
  readonly entryId?: string;
  readonly toolCallId: string;
  readonly name: string;
  readonly arguments: JsonObject;
  readonly result?: ToolResult;
  readonly status?: ToolCallStatus;
  readonly reason?: string;
  readonly progress?: unknown;
  readonly progressMetadata?: Readonly<Record<string, unknown>>;
  readonly progressAt?: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly redacted: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type UsageScope = "provider_turn" | "run_total";

/** Stored usage row. `scope` prevents provider-turn and aggregate totals from being summed together. */
export interface UsageRecord extends OwnershipScope {
  readonly id: string;
  readonly sessionId: string;
  readonly runId?: string;
  readonly entryId?: string;
  readonly scope: UsageScope;
  readonly turn?: number;
  readonly attempt?: number;
  readonly usage: Usage;
  readonly recordedAt: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Host-implemented write-side ledger for runs, events, tool calls, and usage. */
export interface RunLedger {
  appendRun(record: RunRecord): Promise<void> | void;
  appendEvent(record: AgentEventRecord): Promise<void> | void;
  appendToolCall(record: ToolCallRecord): Promise<void> | void;
  appendUsage(record: UsageRecord): Promise<void> | void;
}

/** Union of records that may be handed to a {@link RunLedger}. */
export type RunLedgerRecord = RunRecord | AgentEventRecord | ToolCallRecord | UsageRecord;

export type RunLedgerDurability = "write_through" | "flush_on_terminal" | "buffered";

export interface RunLedgerFlushResult {
  readonly accepted: number;
  readonly flushed: number;
  readonly buffered: number;
}

/** Optional durability seam implemented by bounded ledger adapters. */
export interface FlushableRunLedger extends RunLedger {
  readonly durability: RunLedgerDurability;
  flush(): Promise<RunLedgerFlushResult>;
  status(): RunLedgerFlushResult;
  dispose(options?: { readonly flush?: boolean }): Promise<void>;
}

/** Immutable human feedback linked to an existing owned run/trace and optional evaluations. */
export interface RunFeedbackRecord extends OwnershipScope {
  readonly id: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly traceId?: string;
  readonly rating?: number;
  readonly comment?: string;
  readonly tags: readonly string[];
  readonly scorerIds: readonly string[];
  readonly evaluationIds: readonly string[];
  readonly createdAt: string;
  readonly createdBy?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AppendRunFeedbackInput extends OwnershipScope {
  readonly id: string;
  readonly runId: string;
  readonly sessionId?: string;
  readonly traceId?: string;
  readonly rating?: number;
  readonly comment?: string;
  readonly tags?: readonly string[];
  readonly scorerIds?: readonly string[];
  readonly evaluationIds?: readonly string[];
  readonly createdAt?: string;
  readonly createdBy?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

/** Cursor-paginated, ownership-scoped feedback query. */
export interface RunFeedbackQuery extends PersistenceQuery, OwnershipScope {
  readonly runId?: string;
  readonly sessionId?: string;
  readonly traceId?: string;
  readonly rating?: number;
  readonly scorerId?: string;
  readonly evaluationId?: string;
  readonly tag?: string;
  readonly fromCreatedAt?: string;
  readonly toCreatedAt?: string;
  readonly signal?: AbortSignal;
}

export interface DeleteRunFeedbackInput extends OwnershipScope {
  readonly id: string;
  readonly signal?: AbortSignal;
}

/** Feedback storage seam. Records are append-only; correction uses a new record and deletion is explicit. */
export interface RunFeedbackStore {
  append(input: AppendRunFeedbackInput): Promise<RunFeedbackRecord>;
  query(query: RunFeedbackQuery): Promise<PersistencePage<RunFeedbackRecord>>;
  delete(input: DeleteRunFeedbackInput): Promise<boolean>;
}

/** Stored agent definition version. Does not include provider credentials/resolvers/provider instances. */
export interface AgentDefinitionRecord extends OwnershipScope {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly source?: string;
  readonly agentDefinition: AgentDefinition;
  readonly createdAt: string;
  readonly createdBy?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Stored retention policy. */
export interface RetentionPolicy extends OwnershipScope {
  readonly id: string;
  readonly name?: string;
  readonly maxAgeDays?: number;
  readonly maxEntriesPerSession?: number;
  readonly maxTotalBytes?: number;
  readonly archiveStore?: string;
  readonly appliedKinds?: readonly SessionEntryKind[];
  readonly createdAt: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Stored migration record. */
export interface MigrationRecord {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly appliedAt: string;
  readonly appliedBy?: string;
  readonly checksum?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Query for sessions. */
export interface SessionQuery extends PersistenceQuery, OwnershipScope {
  readonly parentSessionId?: string;
  readonly agentDefinitionId?: string;
  readonly agentDefinitionVersion?: string;
  readonly retentionPolicyId?: string;
  readonly fromCreatedAt?: string;
  readonly toCreatedAt?: string;
  readonly fromUpdatedAt?: string;
  readonly toUpdatedAt?: string;
  readonly hasExpired?: boolean;
}

/** Query for session entries. */
export interface SessionEntryQuery extends PersistenceQuery, OwnershipScope {
  readonly sessionId?: string;
  readonly runId?: string;
  readonly parentId?: string;
  /** Filter to entries on the branch ending at this leaf id. */
  readonly leafId?: string;
  readonly kind?: SessionEntryKind | readonly SessionEntryKind[];
  readonly fromTimestamp?: string;
  readonly toTimestamp?: string;
}

/** Query for branch handles/leaves. */
export interface BranchQuery extends PersistenceQuery {
  readonly sessionId?: string;
  readonly name?: string;
  readonly parentBranchId?: string;
  readonly hasLeaf?: boolean;
}

/** Query for runs. */
export interface RunQuery extends PersistenceQuery, OwnershipScope {
  readonly sessionId?: string;
  readonly branchId?: string;
  readonly agentDefinitionId?: string;
  readonly agentDefinitionVersion?: string;
  readonly status?: RunStatus | readonly RunStatus[];
  readonly fromStartedAt?: string;
  readonly toStartedAt?: string;
  readonly fromFinishedAt?: string;
  readonly toFinishedAt?: string;
  readonly isFinished?: boolean;
}

/** Query for agent event ledger rows. */
export interface AgentEventQuery extends PersistenceQuery, OwnershipScope {
  readonly sessionId?: string;
  readonly runId?: string;
  readonly entryId?: string;
  readonly type?: AgentEventType | readonly AgentEventType[];
  readonly fromTimestamp?: string;
  readonly toTimestamp?: string;
  readonly redacted?: boolean;
}

/** Query for tool-call rows. */
export interface ToolCallQuery extends PersistenceQuery, OwnershipScope {
  readonly sessionId?: string;
  readonly runId?: string;
  readonly entryId?: string;
  readonly name?: string;
  readonly status?: ToolCallStatus | readonly ToolCallStatus[];
  readonly fromStartedAt?: string;
  readonly toStartedAt?: string;
  readonly fromFinishedAt?: string;
  readonly toFinishedAt?: string;
  readonly redacted?: boolean;
}

/** Query for usage rows. */
export interface UsageQuery extends PersistenceQuery, OwnershipScope {
  readonly sessionId?: string;
  readonly runId?: string;
  readonly entryId?: string;
  readonly scope?: UsageScope;
  readonly turn?: number;
  readonly attempt?: number;
  readonly fromRecordedAt?: string;
  readonly toRecordedAt?: string;
}

/** Query for agent definition versions. */
export interface AgentDefinitionQuery extends PersistenceQuery, OwnershipScope {
  readonly name?: string;
  readonly version?: string;
  readonly source?: string;
  readonly fromCreatedAt?: string;
  readonly toCreatedAt?: string;
}

/** Query for retention policies. */
export interface RetentionPolicyQuery extends PersistenceQuery, OwnershipScope {
  readonly name?: string;
  readonly archiveStore?: string;
}

/** Query for migration records. */
export interface MigrationQuery extends PersistenceQuery {
  readonly name?: string;
  readonly version?: string;
  readonly fromAppliedAt?: string;
  readonly toAppliedAt?: string;
}

/**
 * Production database-neutral persistence store contract.
 * Hosts implement this interface to provide durable, paginated storage
 * for sessions, entries, runs, events, tool calls, usage, agent definitions,
 * and migrations, with optional generic checkpoint and atomic lease capabilities. No SQL client, ORM, host file storage, or network dependency is
 * required by the contract.
 */
export interface ProductionPersistenceStore {
  readonly name?: string;
  /** Optional generic write capability for resumable consumers such as workflows. */
  readonly checkpoints?: CheckpointStore;
  /** Optional atomic distributed lease capability for coordinators and workers. */
  readonly leases?: LeaseStore;
  /** Optional immutable run/trace feedback storage capability. */
  readonly feedback?: RunFeedbackStore;
  querySessions(query: SessionQuery): Promise<PersistencePage<SessionRecord>>;
  queryBranches(query: BranchQuery): Promise<PersistencePage<BranchRecord>>;
  queryEntries(query: SessionEntryQuery): Promise<PersistencePage<SessionEntry>>;
  queryRuns(query: RunQuery): Promise<PersistencePage<RunRecord>>;
  queryEvents(query: AgentEventQuery): Promise<PersistencePage<AgentEventRecord>>;
  queryToolCalls(query: ToolCallQuery): Promise<PersistencePage<ToolCallRecord>>;
  queryUsage(query: UsageQuery): Promise<PersistencePage<UsageRecord>>;
  queryAgentDefinitions(query: AgentDefinitionQuery): Promise<PersistencePage<AgentDefinitionRecord>>;
  queryRetentionPolicies(query: RetentionPolicyQuery): Promise<PersistencePage<RetentionPolicy>>;
  queryMigrations(query: MigrationQuery): Promise<PersistencePage<MigrationRecord>>;
  /** DB-friendly branch read (mirrors `SessionStore.readBranchPath`): one ancestor-chain
   *  query instead of `queryEntries({ sessionId })` + in-memory walk. Optional. */
  readBranchPath?(query: SessionBranchRead): Promise<PersistencePage<SessionEntry>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CompactionStrategy {
  readonly name: string;
  compact(context: CompactionContext): Promise<CompactionResult> | CompactionResult;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CompactionContext {
  readonly sessionId: string;
  readonly entries: readonly SessionEntry[];
  readonly keepRecentEntries?: number;
  readonly trigger?: "manual" | "auto" | string;
  readonly secrets?: readonly (string | undefined)[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface CompactionResult {
  readonly summary: string;
  readonly entries?: readonly SessionEntry[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CompactionOptions {
  readonly strategy?: CompactionStrategy;
  readonly thresholdEntries?: number;
  readonly keepRecentEntries?: number;
  readonly maxSummaryChars?: number;
  readonly secrets?: readonly (string | undefined)[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface CompactionMiddlewarePayload {
  readonly context: CompactionContext;
  readonly result: CompactionResult;
}

export interface CompactionEntryData {
  readonly throughEntryId?: string;
  readonly keepEntryIds?: readonly string[];
  readonly strategy?: string;
  readonly trigger?: "manual" | "auto" | string;
}

export interface RetryPolicy {
  readonly name: string;
  decide(context: RetryContext): Promise<RetryDecision> | RetryDecision;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RetryContext {
  readonly sessionId: string;
  readonly runId: string;
  readonly attempt: number;
  readonly error: ErrorInfo;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface RetryDecision {
  readonly retry: boolean;
  readonly delayMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RetryOptions {
  readonly policy?: RetryPolicy;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly secrets?: readonly (string | undefined)[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RetryMiddlewarePayload {
  readonly context: RetryContext;
  readonly decision: RetryDecision;
}

export interface Resource {
  readonly uri: string;
  readonly mediaType?: string;
  readonly text?: string;
  readonly data?: Uint8Array;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ResourceLoader {
  load(uri: string, context?: ResourceLoadContext): Promise<Resource>;
  list?(context?: ResourceLoadContext): Promise<readonly Resource[]>;
}

export interface ResourceLoadContext {
  readonly signal?: AbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly permission?: PermissionPolicy;
  readonly trust?: TrustPolicy;
}

export interface SettingsProvider {
  get<T = unknown>(key: string): Promise<T | undefined> | T | undefined;
}

export interface CredentialRequest {
  readonly name: string;
  readonly provider?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Credential {
  readonly type: "bearer" | "api_key" | "basic" | "custom";
  readonly value: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CredentialResolver {
  resolve(request: CredentialRequest): Promise<Credential | undefined> | Credential | undefined;
}

export interface CredentialResolverSource {
  readonly name: string;
  readonly resolver: CredentialResolver;
}

export interface OAuthCredentialStore {
  set(provider: string, credentials: OAuthCredentials): void | Promise<void>;
}

// ponytail: AgentLoopStrategy orchestrates shared runtime primitives via
// LoopContext; it never re-implements provider calls, retry, abort, store, or
// events. Single-shot is the default; loops are opt-in. T is host-defined,
// Prism never instantiates it. No domain control-flow vocabulary (boundary
// guard); artifact types are generic over host T.

export interface ProviderTurnResult {
  readonly content: readonly ContentBlock[];
  readonly calls: readonly ToolCallContent[];
  readonly messageId?: string;
  readonly started: boolean;
  readonly usage?: Usage;
}

export interface LoopContext {
  readonly sessionId: string;
  readonly runId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
  readonly history: Message[];
  readonly input: AgentInput;
  readonly inputMessages: readonly Message[];
  readonly maxToolRounds: number;
  /** Maximum independent tool calls dispatched concurrently per provider turn. Default `1`. */
  readonly toolConcurrency: number;
  assemble(nextInput: AgentInput, toolResults?: readonly ToolResult[], turn?: number): Promise<ProviderRequest>;
  /** Charges a complete tool round before any call in it can start. */
  chargeToolRound?(calls: readonly ToolCallContent[]): void;
  generate(request: ProviderRequest): Promise<ProviderTurnResult>;
  dispatchToolCall(call: ToolCallContent): Promise<ToolResult>;
  isToolCallExclusive?(call: ToolCallContent): boolean;
  appendMessage(message: Message): Promise<void>;
  emit(event: AgentEvent): void;
}

export interface AgentLoopStrategy {
  readonly name: string;
  run(ctx: LoopContext): Promise<Usage | undefined>;
}

export type AgentLoopOptions =
  | {
      readonly strategy: "single-shot";
      /** Independent tool calls per turn run concurrently up to this limit. Default `1` (sequential). */
      readonly toolConcurrency?: number;
    }
  | {
      readonly strategy: "generate-validate-revise";
      readonly validator: ArtifactValidator<unknown>;
      readonly parser?: ArtifactParser<unknown>;
      readonly repairer?: ArtifactRepairer<unknown>;
      readonly maxRevisions?: number;
      /** Dispatch provider tool calls in artifact turns. Default `"disabled"`; `"bounded"` uses RunOptions.maxToolRounds sequentially. */
      readonly toolCalls?: "disabled" | "bounded";
      /** Native provider JSON-schema output. Ignored when `structuredOutputMode` is `artifact-loop`. */
      readonly structuredOutput?: StructuredOutputOptions;
      /** `native` maps schema to capable providers; `artifact-loop` keeps repair turns only. */
      readonly structuredOutputMode?: "native" | "artifact-loop";
    };

export interface ArtifactValidation {
  readonly ok: boolean;
  readonly errors?: readonly { readonly path?: string; readonly message: string }[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ArtifactContext {
  readonly sessionId: string;
  readonly runId: string;
  readonly turn: number;
  readonly signal: AbortSignal;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ArtifactParseResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: string;
}

export type ArtifactParser<T> = (
  text: string,
  ctx: ArtifactContext,
) => ArtifactParseResult<T> | Promise<ArtifactParseResult<T>>;

export type ArtifactValidator<T> = (
  value: T,
  ctx: ArtifactContext,
) => ArtifactValidation | Promise<ArtifactValidation>;

export type ArtifactRepairer<T> = (
  value: T | undefined,
  failure: ArtifactValidation,
  ctx: ArtifactContext,
) => AgentInput | Promise<AgentInput>;
