import type {
  AgentIdentity,
  Guardrails,
  OwnershipScope,
  PermissionPolicy,
  RunLimits,
  SecretRedactor,
  ToolDefinition,
  ToolEffectStore,
  ToolRegistry,
  ToolValidator,
} from "@arnilo/prism";
import type { ProcessSessions } from "@arnilo/prism-coding-tools/agent";
import type { PrismMcpAuthorizer } from "@arnilo/prism-mcp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// --- Constants ---
export const DEFAULT_ANTIGRAVITY_MCP_SERVER_NAME = "prism";
export const DEFAULT_ANTIGRAVITY_MCP_SERVER_VERSION = "0.3.0";
export const DEFAULT_MCP_HTTP_HOSTNAME = "127.0.0.1";
export const DEFAULT_MCP_HTTP_PORT = 0;
export const MAX_WORKSPACE_CONFIG_BYTES = 64 * 1024;
export const MAX_RUN_TOKEN_BYTES = 512;
export const DEFAULT_CALL_TIMEOUT_MS = 60_000;
export const MAX_CONCURRENT_CALLS = 16;
export const DEFAULT_AGY_COMMAND = "agy";
export const MAX_CONVERSATION_ID_BYTES = 512;

// --- Error Classes ---

export class AntigravityMcpError extends Error {
  readonly code = "ERR_PRISM_ANTIGRAVITY_MCP";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AntigravityMcpError";
  }
}

export class AntigravityWorkspaceConfigError extends Error {
  readonly code = "ERR_PRISM_ANTIGRAVITY_WORKSPACE_CONFIG";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AntigravityWorkspaceConfigError";
  }
}

export class AntigravityAuthorizationError extends Error {
  readonly code = "ERR_PRISM_ANTIGRAVITY_AUTHORIZATION";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AntigravityAuthorizationError";
  }
}

export class AntigravityAuthenticationError extends Error {
  readonly code = "ERR_PRISM_ANTIGRAVITY_AUTH_REQUIRED";
  constructor(
    message = "Antigravity authentication required: run interactive 'agy' once to authenticate with your Google account. Prism never handles or copies Antigravity credentials.",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AntigravityAuthenticationError";
  }
}

export class AntigravityQuotaExhaustedError extends Error {
  readonly code = "ERR_PRISM_ANTIGRAVITY_QUOTA_EXHAUSTED";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AntigravityQuotaExhaustedError";
  }
}

export class AntigravityConversationError extends Error {
  readonly code = "ERR_PRISM_ANTIGRAVITY_CONVERSATION_MISMATCH";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AntigravityConversationError";
  }
}

export class AntigravityRunnerError extends Error {
  readonly code: string;
  readonly exitCode?: number | null;
  readonly stderr?: string;
  constructor(message: string, options?: { code?: string; exitCode?: number | null; stderr?: string; cause?: unknown }) {
    super(message, options);
    this.name = "AntigravityRunnerError";
    this.code = options?.code ?? "ERR_PRISM_ANTIGRAVITY_RUNNER";
    this.exitCode = options?.exitCode;
    this.stderr = options?.stderr;
  }
}

export class AntigravityStreamError extends Error {
  readonly code = "ERR_PRISM_ANTIGRAVITY_STREAM";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AntigravityStreamError";
  }
}

// --- Context & Config Types ---

export interface AntigravityRunContext {
  readonly sessionId: string;
  readonly runId: string;
  readonly identity?: AgentIdentity;
  readonly ownership?: OwnershipScope;
  readonly signal?: AbortSignal;
  readonly runToken?: string;
}

export interface AntigravityMcpServerConfigEntry {
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Record<string, string>;
  readonly cwd?: string;
  readonly serverUrl?: string;
  readonly headers?: Record<string, string>;
  readonly disabled?: boolean;
  readonly disabledTools?: readonly string[];
}

export interface AntigravityWorkspaceMcpConfig {
  readonly mcpServers: Record<string, AntigravityMcpServerConfigEntry>;
}

export interface AntigravityWorkspaceSettings {
  readonly permissions?: {
    readonly allow?: readonly string[];
    readonly deny?: readonly string[];
  };
}

export interface EphemeralWorkspaceConfigOptions {
  readonly workspace: string;
  readonly serverName?: string;
  readonly mcpConfig: AntigravityMcpServerConfigEntry;
  readonly allowedMcpTools?: readonly string[];
  readonly disabledTools?: readonly string[];
  readonly toolPolicy?: AntigravityToolPolicy;
  readonly permissions?: {
    readonly allow?: readonly string[];
    readonly deny?: readonly string[];
  };
}

export interface EphemeralWorkspaceConfigHandle {
  readonly workspace: string;
  readonly agentsDir: string;
  readonly mcpConfigFile: string;
  readonly settingsFile: string;
  readonly serverName: string;
  readonly restored: boolean;
  restore(): Promise<void>;
  [Symbol.asyncDispose]?(): Promise<void>;
}

export interface CreateAntigravityMcpExposureOptions {
  readonly tools?: readonly ToolDefinition[] | ToolRegistry;
  readonly toolSelection?: readonly string[] | ((toolName: string) => boolean);
  readonly runContext: AntigravityRunContext;
  readonly authorize?: PrismMcpAuthorizer;
  readonly guardrails?: Guardrails;
  readonly limits?: RunLimits;
  readonly redactor?: SecretRedactor;
  readonly effectStore?: ToolEffectStore;
  readonly validate?: ToolValidator;
  readonly permission?: PermissionPolicy;
  readonly serverName?: string;
  readonly serverVersion?: string;
  readonly maxResultBytes?: number;
  readonly maxConcurrentCalls?: number;
  readonly callTimeoutMs?: number;
  readonly disabledTools?: readonly string[];
}

export interface AntigravityMcpExposure {
  readonly server: McpServer;
  readonly createServer: () => McpServer;
  readonly exposedTools: readonly ToolDefinition[];
  readonly runToken: string;
  readonly runContext: AntigravityRunContext;
  readonly serverName: string;
  readonly serverVersion: string;
  readonly disabledTools: readonly string[];
  close(): Promise<void>;
}

export interface AntigravityMcpHttpServerOptions {
  readonly hostname?: string;
  readonly port?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxConcurrentRequests?: number;
  readonly requestTimeoutMs?: number;
}

export interface AntigravityMcpHttpServerHandle {
  readonly serverUrl: string;
  readonly port: number;
  readonly hostname: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly exposure: AntigravityMcpExposure;
  close(): Promise<void>;
}

// --- NDJSON & Stream Records ---

export interface AntigravityTokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly thinkingTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly totalTokens?: number;
}

export interface InitRecord {
  readonly type: "init";
  readonly cwd?: string;
  readonly tools?: readonly string[];
  readonly permission_mode?: string;
  readonly [key: string]: unknown;
}

export interface StepUpdateRecord {
  readonly type: "step_update";
  readonly conversation_id?: string;
  readonly step_index?: number;
  readonly state?: "ACTIVE" | "DONE" | "ERROR" | string;
  readonly step_type?: string;
  readonly tool_info?: {
    readonly name?: string;
    readonly parameters?: unknown;
    readonly output?: unknown;
    readonly error?: unknown;
  };
  readonly subagent_info?: {
    readonly type?: string;
    readonly role?: string;
    readonly conversation_id?: string;
    readonly log_uri?: string;
    readonly workspace_uri?: string;
    readonly state?: string;
  };
  readonly checkpoint_info?: unknown;
  readonly text_delta?: string;
  readonly duration_ms?: number;
  readonly duration_seconds?: number;
  readonly usage?: AntigravityTokenUsage;
  readonly [key: string]: unknown;
}

export interface ResultRecord {
  readonly type: "result";
  readonly status: "SUCCESS" | "ERROR" | "CANCELLED" | string;
  readonly conversation_id: string;
  readonly response?: string;
  readonly error?: unknown;
  readonly usage?: AntigravityTokenUsage;
  readonly duration_ms?: number;
  readonly duration_seconds?: number;
  readonly turn_count?: number;
  readonly [key: string]: unknown;
}

export type AntigravityStreamRecord = InitRecord | StepUpdateRecord | ResultRecord;

// --- Runner Limits & Options ---

export interface AntigravityRunnerLimits {
  readonly maxLifetimeMs?: number;
  readonly maxOutputBytes?: number;
  readonly maxOutputChunkBytes?: number;
  readonly maxLineBytes?: number;
  readonly maxEvents?: number;
  readonly maxSteps?: number;
  readonly maxToolCalls?: number;
  readonly maxSubagents?: number;
  readonly maxStderrBytes?: number;
}

export interface ResolvedAntigravityRunnerLimits {
  readonly maxLifetimeMs: number;
  readonly maxOutputBytes: number;
  readonly maxOutputChunkBytes: number;
  readonly maxLineBytes: number;
  readonly maxEvents: number;
  readonly maxSteps: number;
  readonly maxToolCalls: number;
  readonly maxSubagents: number;
  readonly maxStderrBytes: number;
}

export interface AntigravityRunnerOptions {
  readonly command?: string;
  readonly prompt: string;
  readonly cwd: string;
  readonly model?: string;
  readonly effort?: "low" | "medium" | "high" | string;
  readonly agent?: string;
  readonly conversationId?: string;
  readonly addDir?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  readonly limits?: AntigravityRunnerLimits;
  readonly toolPolicy?: AntigravityToolPolicy;
  readonly processSessions?: ProcessSessions;
  readonly onRecord?: (record: AntigravityStreamRecord) => void | Promise<void>;
  readonly redactor?: SecretRedactor;
}

export interface AntigravityRunResult {
  readonly conversationId: string;
  readonly response: string;
  readonly status: "SUCCESS" | "ERROR" | "CANCELLED" | string;
  readonly events: readonly AntigravityStreamRecord[];
  readonly init: InitRecord;
  readonly steps: readonly StepUpdateRecord[];
  readonly result: ResultRecord;
  readonly usage?: AntigravityTokenUsage;
  readonly durationMs?: number;
  readonly stderr: string;
}

// --- Conversation Store Types ---

export interface AntigravityConversationBinding {
  readonly sessionId: string;
  readonly branchId?: string;
  readonly conversationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AntigravityConversationStore {
  get(sessionId: string, branchId?: string): string | undefined;
  set(sessionId: string, conversationId: string, branchId?: string): void;
  clear(sessionId: string, branchId?: string): void;
  has(sessionId: string, branchId?: string): boolean;
  entries(): readonly AntigravityConversationBinding[];
}

// --- Tool Policy Types ---

export type AntigravityToolPolicyName = "prism-mutators" | "prism-only";

export interface AntigravityCustomToolPolicy {
  readonly allowBuiltins?: readonly string[];
  readonly denyBuiltins?: readonly string[];
}

export type AntigravityToolPolicy = AntigravityToolPolicyName | AntigravityCustomToolPolicy;

export interface ResolvedAntigravityToolPolicy {
  readonly kind: "prism-mutators" | "prism-only" | "custom";
  readonly allowedBuiltins: readonly string[];
  readonly deniedBuiltins: readonly string[];
  readonly preferPrismMutators: boolean;
  readonly permissions: {
    readonly allow: readonly string[];
    readonly deny: readonly string[];
  };
}

// --- Agent File & Prompt Types ---

export interface AgentSkillInput {
  readonly name: string;
  readonly description?: string;
  readonly instructions: string;
}

export interface AgentContextBlockInput {
  readonly title?: string;
  readonly content: string;
}

export interface BuildCustomAgentInstructionsOptions {
  readonly systemPrompt?: string;
  readonly taskInstructions?: string;
  readonly skills?: readonly AgentSkillInput[];
  readonly context?: readonly (string | AgentContextBlockInput)[];
  readonly toolPolicy?: ResolvedAntigravityToolPolicy;
  readonly serverName?: string;
  readonly exposedMcpTools?: readonly string[];
}

export interface BuildCustomAgentMarkdownOptions extends BuildCustomAgentInstructionsOptions {
  readonly agentName?: string;
  readonly description?: string;
  readonly mainAgent?: boolean;
  readonly inheritMcp?: boolean;
}

export interface EphemeralAgentFileOptions extends BuildCustomAgentMarkdownOptions {
  readonly workspace: string;
  readonly markdownContent?: string;
}

export interface EphemeralAgentFileHandle {
  readonly workspace: string;
  readonly agentName: string;
  readonly agentDir: string;
  readonly agentFile: string;
  readonly restored: boolean;
  restore(): Promise<void>;
  [Symbol.asyncDispose]?(): Promise<void>;
}
