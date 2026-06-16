import type { ContributionRegistries } from "./contributions.js";
import type { Middleware, MiddlewareHookName, MiddlewareRegistry } from "./middleware.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface ErrorInfo {
  readonly name?: string;
  readonly message: string;
  readonly code?: string;
  readonly cause?: unknown;
}

export type ContentBlock =
  | TextContent
  | ImageContent
  | ThinkingContent
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
}

export interface ThinkingContent {
  readonly type: "thinking";
  readonly text: string;
  readonly signature?: string;
}

export interface ToolCallContent {
  readonly type: "tool_call";
  readonly id: string;
  readonly name: string;
  readonly arguments: JsonObject;
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
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface Usage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cost?: number;
  readonly currency?: string;
}

export interface ProviderRequest {
  readonly model: ModelConfig;
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolDefinition[];
  readonly context?: readonly ContextBlock[];
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

export interface RunOptions {
  readonly signal?: AbortSignal;
  readonly model?: ModelConfig;
  readonly maxToolRounds?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AgentDefinition {
  readonly name: string;
  readonly description?: string;
  create(config?: AgentConfig): Promise<Agent> | Agent;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AgentConfig {
  readonly id?: string;
  readonly name?: string;
  readonly instructions?: string;
  readonly model: ModelConfig;
  readonly provider?: AIProvider;
  readonly tools?: ToolRegistry | readonly ToolDefinition[];
  readonly context?: readonly ContextProvider[];
  readonly skills?: SkillRegistry | readonly Skill[];
  readonly extensions?: readonly Extension[];
  readonly store?: SessionStore;
  readonly settings?: SettingsProvider;
  readonly credentials?: CredentialResolver;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Agent {
  readonly config: AgentConfig;
  createSession(config?: AgentSessionConfig): AgentSession;
}

export interface AgentSessionConfig {
  readonly id?: string;
  readonly agent?: Agent;
  readonly store?: SessionStore;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AgentSession {
  readonly id: string;
  run(input: string | Message | readonly Message[], options?: RunOptions): Promise<void>;
  prompt(input: string, options?: RunOptions): Promise<void>;
  subscribe(): AsyncIterable<AgentEvent>;
  abort(reason?: unknown): void;
}

export type AgentEvent =
  | { readonly type: "agent_started"; readonly sessionId: string; readonly runId: string }
  | { readonly type: "agent_finished"; readonly sessionId: string; readonly runId: string; readonly usage?: Usage }
  | { readonly type: "turn_started"; readonly sessionId: string; readonly runId: string; readonly turn: number }
  | { readonly type: "turn_finished"; readonly sessionId: string; readonly runId: string; readonly turn: number }
  | { readonly type: "message_started"; readonly sessionId: string; readonly runId: string; readonly message: Message }
  | { readonly type: "message_delta"; readonly sessionId: string; readonly runId: string; readonly content: ContentBlock }
  | { readonly type: "message_finished"; readonly sessionId: string; readonly runId: string; readonly message: Message }
  | { readonly type: "tool_execution_started"; readonly sessionId: string; readonly runId: string; readonly call: ToolCallContent }
  | { readonly type: "tool_execution_progress"; readonly sessionId: string; readonly runId: string; readonly toolCallId: string; readonly name: string; readonly progress?: unknown; readonly metadata?: Readonly<Record<string, unknown>> }
  | { readonly type: "tool_execution_finished"; readonly sessionId: string; readonly runId: string; readonly result: ToolResult }
  | { readonly type: "tool_execution_error"; readonly sessionId: string; readonly runId: string; readonly call: ToolCallContent; readonly error: ErrorInfo }
  | { readonly type: "tool_execution_blocked"; readonly sessionId: string; readonly runId: string; readonly toolCallId: string; readonly name: string; readonly reason: string; readonly error: ErrorInfo }
  | { readonly type: "queue_updated"; readonly sessionId: string; readonly runId: string; readonly size: number }
  | { readonly type: "compaction_started"; readonly sessionId: string; readonly runId?: string }
  | { readonly type: "compaction_finished"; readonly sessionId: string; readonly runId?: string; readonly summary: string }
  | { readonly type: "retry_scheduled"; readonly sessionId: string; readonly runId: string; readonly attempt: number; readonly delayMs: number; readonly error: ErrorInfo }
  | { readonly type: "error"; readonly sessionId?: string; readonly runId?: string; readonly error: ErrorInfo };

export interface ToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly parameters?: JsonObject;
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

export interface InputBuilder {
  readonly name: string;
  build(input: string | Message | readonly Message[], context?: InputBuildContext): Promise<readonly Message[]> | readonly Message[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface InputBuildContext {
  readonly sessionId?: string;
  readonly runId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
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
  list(): readonly Skill[];
}

export type ExtensionLifecycleEventName =
  | "resource_discovery"
  | "session_start"
  | "session_shutdown"
  | "before_agent_start"
  | "turn"
  | "context"
  | "provider_request"
  | "provider_response"
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
  registerStoreFactory(factory: StoreFactory): void;
  registerResourceLoader(key: string, loader: ResourceLoader): void;
  registerSettingsProvider(key: string, provider: SettingsProvider): void;
  registerCredentialResolver(key: string, resolver: CredentialResolver): void;
}

export interface SessionEntry {
  readonly id: string;
  readonly parentId?: string;
  readonly sessionId: string;
  readonly timestamp: string;
  readonly kind: "message" | "event" | "summary" | "metadata";
  readonly message?: Message;
  readonly event?: AgentEvent;
  readonly data?: unknown;
}

export interface SessionStore {
  append(entry: SessionEntry): Promise<void>;
  list(sessionId: string): Promise<readonly SessionEntry[]>;
  get?(id: string): Promise<SessionEntry | undefined>;
}

export interface StoreFactory {
  readonly name: string;
  create(config?: JsonObject): Promise<SessionStore> | SessionStore;
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
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface CompactionResult {
  readonly summary: string;
  readonly entries?: readonly SessionEntry[];
  readonly metadata?: Readonly<Record<string, unknown>>;
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
