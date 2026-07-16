import type { AgentRunResult, AgentSession, OwnershipScope, SecretRedactor } from "@arnilo/prism";

export const A2A_PROTOCOL_VERSION = "1.0";

export interface A2AAgentInterface {
  readonly url: string;
  readonly protocolBinding: "JSONRPC";
  readonly protocolVersion: "1.0";
}

export interface A2AAgentSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly examples?: readonly string[];
  readonly inputModes?: readonly string[];
  readonly outputModes?: readonly string[];
}

export interface A2AAgentCardSignature {
  readonly protected: string;
  readonly signature: string;
  readonly header?: Readonly<Record<string, unknown>>;
}

export interface A2AAgentCard {
  readonly name: string;
  readonly description: string;
  readonly supportedInterfaces: readonly A2AAgentInterface[];
  readonly version: string;
  readonly capabilities: { readonly streaming: boolean; readonly pushNotifications?: boolean; readonly extendedAgentCard?: boolean };
  readonly defaultInputModes: readonly string[];
  readonly defaultOutputModes: readonly string[];
  readonly skills: readonly A2AAgentSkill[];
  readonly securitySchemes?: Readonly<Record<string, unknown>>;
  readonly security?: readonly Readonly<Record<string, readonly string[]>>[];
  readonly signatures?: readonly A2AAgentCardSignature[];
}

export interface A2ATextPart { readonly text: string; readonly metadata?: Readonly<Record<string, unknown>> }
export interface A2AMessage {
  readonly role: "user" | "agent" | "ROLE_USER" | "ROLE_AGENT";
  readonly parts: readonly A2ATextPart[];
  readonly messageId: string;
  readonly contextId?: string;
  readonly taskId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type A2ATaskState = "TASK_STATE_SUBMITTED" | "TASK_STATE_WORKING" | "TASK_STATE_COMPLETED" | "TASK_STATE_FAILED" | "TASK_STATE_CANCELED";
export interface A2ATask {
  readonly id: string;
  readonly contextId: string;
  readonly status: { readonly state: A2ATaskState; readonly timestamp: string; readonly message?: A2AMessage };
  readonly artifacts?: readonly { readonly artifactId: string; readonly parts: readonly A2ATextPart[] }[];
}

export type A2ARequestId = string | number | null;
export interface A2AJsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: A2ARequestId;
  readonly method: "SendMessage" | "SendStreamingMessage" | "GetExtendedAgentCard" | string;
  readonly params?: Readonly<Record<string, unknown>>;
}
export interface A2AJsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: A2ARequestId;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

export interface A2AAuthorization {
  readonly ownership: OwnershipScope;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
export type A2AAuthorizer = (input: { readonly request: Request; readonly method: string; readonly signal: AbortSignal }) => false | A2AAuthorization | Promise<false | A2AAuthorization>;
export interface A2AAgentExposure {
  readonly sessionFactory: (authorization: A2AAuthorization) => AgentSession | Promise<AgentSession>;
}

export interface A2ALimits {
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxEventBytes?: number;
  readonly maxStreamBytes?: number;
  readonly maxStreamEvents?: number;
  readonly maxConcurrentRequests?: number;
  readonly timeoutMs?: number;
  readonly maxCardBytes?: number;
}

export interface CreateA2AHandlerOptions {
  readonly card: A2AAgentCard;
  readonly exposure: A2AAgentExposure;
  readonly authorize: A2AAuthorizer;
  readonly endpointPath?: string;
  readonly redactor?: SecretRedactor;
  readonly limits?: A2ALimits;
}

export interface A2AClientOptions {
  readonly endpoint: string;
  readonly allowedOrigins: readonly string[];
  readonly fetch?: typeof globalThis.fetch;
  readonly authorize?: (input: { readonly endpoint: string; readonly signal: AbortSignal }) => HeadersInit | Promise<HeadersInit>;
  readonly verifyCard?: (card: A2AAgentCard) => void | Promise<void>;
  readonly cardUrl?: string;
  readonly limits?: A2ALimits;
  readonly redactor?: SecretRedactor;
}

export interface A2AClient {
  getCard(options?: { readonly signal?: AbortSignal }): Promise<A2AAgentCard>;
  send(input: string, options?: { readonly signal?: AbortSignal }): Promise<AgentRunResult>;
  stream(input: string, options?: { readonly signal?: AbortSignal }): AsyncIterable<string>;
}
