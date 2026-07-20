import type { AgentRunResult, AgentSession, OwnershipScope, SecretRedactor } from "@arnilo/prism";

export const A2A_PROTOCOL_VERSION = "1.0";
export interface A2AAgentInterface { readonly url: string; readonly protocolBinding: "JSONRPC"; readonly protocolVersion: "1.0" }
export interface A2AAgentSkill { readonly id: string; readonly name: string; readonly description: string; readonly tags: readonly string[]; readonly examples?: readonly string[]; readonly inputModes?: readonly string[]; readonly outputModes?: readonly string[] }
export interface A2AAgentCardSignature { readonly protected: string; readonly signature: string; readonly header?: Readonly<Record<string, unknown>> }
export interface A2AAgentCard {
  readonly name: string; readonly description: string; readonly supportedInterfaces: readonly A2AAgentInterface[]; readonly version: string;
  readonly capabilities: { readonly streaming: boolean; readonly pushNotifications?: boolean; readonly extendedAgentCard?: boolean };
  readonly defaultInputModes: readonly string[]; readonly defaultOutputModes: readonly string[]; readonly skills: readonly A2AAgentSkill[];
  readonly securitySchemes?: Readonly<Record<string, unknown>>; readonly security?: readonly Readonly<Record<string, readonly string[]>>[]; readonly signatures?: readonly A2AAgentCardSignature[];
}

interface A2APartBase { readonly mediaType?: string; readonly filename?: string; readonly metadata?: Readonly<Record<string, unknown>> }
export type A2APart =
  | (A2APartBase & { readonly text: string; readonly raw?: never; readonly url?: never; readonly data?: never })
  | (A2APartBase & { readonly raw: string; readonly text?: never; readonly url?: never; readonly data?: never })
  | (A2APartBase & { readonly url: string; readonly text?: never; readonly raw?: never; readonly data?: never })
  | (A2APartBase & { readonly data: unknown; readonly text?: never; readonly raw?: never; readonly url?: never });
export type A2ATextPart = Extract<A2APart, { readonly text: string }>;
export interface A2AMessage { readonly role: "user" | "agent" | "ROLE_USER" | "ROLE_AGENT"; readonly parts: readonly A2APart[]; readonly messageId: string; readonly contextId?: string; readonly taskId?: string; readonly metadata?: Readonly<Record<string, unknown>> }
export interface A2AArtifact { readonly artifactId: string; readonly parts: readonly A2APart[]; readonly name?: string; readonly description?: string; readonly metadata?: Readonly<Record<string, unknown>> }
export type A2ATaskState = "TASK_STATE_SUBMITTED" | "TASK_STATE_WORKING" | "TASK_STATE_COMPLETED" | "TASK_STATE_FAILED" | "TASK_STATE_CANCELED" | "TASK_STATE_INPUT_REQUIRED" | "TASK_STATE_REJECTED" | "TASK_STATE_AUTH_REQUIRED";
export interface A2ATask { readonly id: string; readonly contextId: string; readonly status: { readonly state: A2ATaskState; readonly timestamp: string; readonly message?: A2AMessage }; readonly artifacts?: readonly A2AArtifact[]; readonly history?: readonly A2AMessage[]; readonly metadata?: Readonly<Record<string, unknown>> }
export type A2ATaskEvent =
  | { readonly eventId: string; readonly task: A2ATask }
  | { readonly eventId: string; readonly statusUpdate: { readonly taskId: string; readonly contextId: string; readonly status: A2ATask["status"] } }
  | { readonly eventId: string; readonly artifactUpdate: { readonly taskId: string; readonly contextId: string; readonly artifact: A2AArtifact; readonly append?: boolean; readonly lastChunk?: boolean } };

export type A2ARequestId = string | number | null;
export interface A2AJsonRpcRequest { readonly jsonrpc: "2.0"; readonly id: A2ARequestId; readonly method: string; readonly params?: Readonly<Record<string, unknown>> }
export interface A2AJsonRpcResponse { readonly jsonrpc: "2.0"; readonly id: A2ARequestId; readonly result?: unknown; readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown } }
export interface A2AAuthorization { readonly ownership: OwnershipScope; readonly metadata?: Readonly<Record<string, unknown>> }
export type A2AAuthorizer = (input: { readonly request: Request; readonly method: string; readonly signal: AbortSignal }) => false | A2AAuthorization | Promise<false | A2AAuthorization>;
export interface A2AAgentExposure { readonly sessionFactory: (authorization: A2AAuthorization) => AgentSession | Promise<AgentSession> }

export interface A2ATaskPage { readonly tasks: readonly A2ATask[]; readonly nextPageToken?: string; readonly totalSize?: number }
export interface A2ATaskLifecycle {
  start(input: { readonly message: A2AMessage; readonly authorization: A2AAuthorization; readonly signal: AbortSignal; readonly returnImmediately?: boolean }): Promise<A2ATask>;
  get(input: { readonly id: string; readonly historyLength: number; readonly authorization: A2AAuthorization; readonly signal: AbortSignal }): Promise<A2ATask | undefined>;
  list(input: { readonly pageSize: number; readonly pageToken?: string; readonly contextId?: string; readonly authorization: A2AAuthorization; readonly signal: AbortSignal }): Promise<A2ATaskPage>;
  cancel(input: { readonly id: string; readonly authorization: A2AAuthorization; readonly signal: AbortSignal }): Promise<A2ATask | undefined>;
  subscribe(input: { readonly id: string; readonly afterEventId?: string; readonly authorization: A2AAuthorization; readonly signal: AbortSignal }): AsyncIterable<A2ATaskEvent>;
}
export interface A2APushConfig { readonly id: string; readonly taskId: string; readonly url: string; readonly token?: string; readonly authentication?: { readonly scheme: string; readonly credentials?: string } }
export interface A2APushProvider {
  create(input: { readonly config: A2APushConfig; readonly authorization: A2AAuthorization; readonly signal: AbortSignal }): Promise<A2APushConfig>;
  get(input: { readonly taskId: string; readonly id: string; readonly authorization: A2AAuthorization; readonly signal: AbortSignal }): Promise<A2APushConfig | undefined>;
  list(input: { readonly taskId: string; readonly pageSize: number; readonly pageToken?: string; readonly authorization: A2AAuthorization; readonly signal: AbortSignal }): Promise<{ readonly configs: readonly A2APushConfig[]; readonly nextPageToken?: string }>;
  delete(input: { readonly taskId: string; readonly id: string; readonly authorization: A2AAuthorization; readonly signal: AbortSignal }): Promise<boolean>;
}
export interface A2APartPolicy { readonly allowRaw?: boolean; readonly allowUrl?: boolean; readonly allowData?: boolean; readonly validateUrl?: (url: URL) => void | Promise<void> }
export interface A2ALimits {
  readonly maxRequestBytes?: number; readonly maxResponseBytes?: number; readonly maxEventBytes?: number; readonly maxStreamBytes?: number; readonly maxStreamEvents?: number; readonly maxConcurrentRequests?: number; readonly timeoutMs?: number; readonly maxCardBytes?: number;
  readonly maxIdBytes?: number; readonly maxParts?: number; readonly maxPartBytes?: number; readonly maxRawBytes?: number; readonly maxDataBytes?: number; readonly maxArtifacts?: number; readonly maxHistory?: number; readonly maxPageSize?: number; readonly maxCursorBytes?: number; readonly maxReplayEvents?: number; readonly maxPushConfigs?: number;
}
export interface CreateA2AHandlerOptions { readonly card: A2AAgentCard; readonly exposure: A2AAgentExposure; readonly authorize: A2AAuthorizer; readonly tasks?: A2ATaskLifecycle; readonly push?: A2APushProvider; readonly parts?: A2APartPolicy; readonly endpointPath?: string; readonly redactor?: SecretRedactor; readonly limits?: A2ALimits }
export interface A2AClientOptions { readonly endpoint: string; readonly allowedOrigins: readonly string[]; readonly fetch?: typeof globalThis.fetch; readonly authorize?: (input: { readonly endpoint: string; readonly signal: AbortSignal }) => HeadersInit | Promise<HeadersInit>; readonly verifyCard?: (card: A2AAgentCard) => void | Promise<void>; readonly cardUrl?: string; readonly limits?: A2ALimits; readonly redactor?: SecretRedactor; readonly parts?: A2APartPolicy }
export interface A2AClient {
  getCard(options?: { readonly signal?: AbortSignal }): Promise<A2AAgentCard>;
  send(input: string, options?: { readonly signal?: AbortSignal }): Promise<AgentRunResult>;
  sendMessage(message: A2AMessage, options?: { readonly signal?: AbortSignal; readonly returnImmediately?: boolean }): Promise<A2ATask>;
  stream(input: string, options?: { readonly signal?: AbortSignal }): AsyncIterable<string>;
  getTask(id: string, options?: { readonly signal?: AbortSignal; readonly historyLength?: number }): Promise<A2ATask>;
  listTasks(options?: { readonly signal?: AbortSignal; readonly pageSize?: number; readonly pageToken?: string; readonly contextId?: string }): Promise<A2ATaskPage>;
  cancelTask(id: string, options?: { readonly signal?: AbortSignal }): Promise<A2ATask>;
  subscribeToTask(id: string, options?: { readonly signal?: AbortSignal; readonly afterEventId?: string }): AsyncIterable<A2ATaskEvent>;
  createPushConfig(config: A2APushConfig, options?: { readonly signal?: AbortSignal }): Promise<A2APushConfig>;
  getPushConfig(taskId: string, id: string, options?: { readonly signal?: AbortSignal }): Promise<A2APushConfig>;
  listPushConfigs(taskId: string, options?: { readonly signal?: AbortSignal; readonly pageSize?: number; readonly pageToken?: string }): Promise<{ readonly configs: readonly A2APushConfig[]; readonly nextPageToken?: string }>;
  deletePushConfig(taskId: string, id: string, options?: { readonly signal?: AbortSignal }): Promise<void>;
}
