import type { AgentEvent, AgentInspection, Decision, HostUiRequest, HostUiResponse, JsonObject, JsonValue, RunResult } from "@arnilo/prism";

export const REMOTE_PROTOCOL = "prism.remote/1";

/** Capabilities this protocol version knows. Unknown ones are dropped at negotiation. */
export const KNOWN_CAPABILITIES = ["hostUi", "hostUi.secret", "agentEvents"] as const;

export type RemoteCapabilityName = (typeof KNOWN_CAPABILITIES)[number];

export type RemoteCapabilities = { readonly [K in RemoteCapabilityName]?: boolean };

/** Client → server requests. */
export const CLIENT_METHODS = [
  "initialize",
  "sessions.open",
  "sessions.list",
  "sessions.resume",
  "sessions.messages",
  "run",
  "steer",
  "abort",
  "commands.list",
  "commands.run",
  "inspect",
  "models.list",
] as const;

/** Server → client notifications. */
export const SERVER_NOTIFICATIONS = ["run.event", "run.settled", "agent.event"] as const;

/** Server → client requests. */
export const SERVER_REQUESTS = ["hostUi.request"] as const;

export type RemoteClientMethod = (typeof CLIENT_METHODS)[number];

/** The `RunOptions` subset a client may send. Anything else is rejected with `invalid_params`. */
export interface RemoteRunOptions {
  readonly metadata?: JsonObject;
  readonly limits?: JsonObject;
  readonly interactive?: boolean;
}

export interface InitializeParams {
  readonly protocol: string;
  readonly capabilities?: RemoteCapabilities;
}

export interface InitializeResult {
  readonly protocol: typeof REMOTE_PROTOCOL;
  readonly endpointId: string;
  readonly capabilities: RemoteCapabilities;
  readonly agent: {
    readonly id: string;
    readonly name: string;
    readonly tools: readonly JsonObject[];
    readonly skills: readonly JsonObject[];
    readonly inspection: AgentInspection;
  };
}

export interface RemoteMethods {
  initialize: { params: InitializeParams; result: InitializeResult };
  /** `parent` accepts only `SessionParentLink` string fields (`sessionId`, `agentId`, `workflowRunId`, `delegationId`) ≤ `MAX_SESSION_LINK_ID_LENGTH`. */
  "sessions.open": { params: { id?: string; create?: boolean; parent?: JsonObject }; result: { sessionId: string; leafId?: string } };
  /** `query` accepts only documented `SessionListQuery` filter and pagination keys; client ownership keys are dropped in favor of the server's scope. */
  "sessions.list": { params: { query?: JsonObject }; result: JsonValue };
  /** `decisions` accepts only `approvalId` (≤ 256), `outcome`, `reason` (≤ 2 KiB), `elicitation` (pending elicitation only), and `modifiedArguments` only when `ServeAgentOptions.allowModifiedArguments: true`. */
  "sessions.resume": { params: { sessionId: string; decisions: readonly Decision[] }; result: { runId: string } };
  "sessions.messages": { params: { sessionId: string }; result: { messages: readonly JsonObject[] } };
  run: { params: { sessionId: string; input: JsonValue; options?: RemoteRunOptions }; result: { runId: string } };
  /** `options` accepts only `{ softInterrupt?: boolean }`. */
  steer: { params: { sessionId: string; input: JsonValue; options?: JsonObject }; result: null };
  abort: { params: { sessionId: string; reason?: string }; result: null };
  "commands.list": { params: Record<string, never>; result: JsonValue };
  "commands.run": { params: { name: string; args?: JsonValue; sessionId?: string }; result: JsonValue };
  inspect: { params: Record<string, never>; result: AgentInspection };
  "models.list": { params: Record<string, never>; result: JsonValue };
}

export interface RemoteNotifications {
  "run.event": { sessionId: string; runId: string; event: AgentEvent };
  "run.settled": { sessionId: string; runId: string; result: RunResult };
  "agent.event": { event: AgentEvent };
}

export interface HostUiRequestParams {
  readonly sessionId?: string;
  readonly approvalId?: string;
  readonly request: HostUiRequest;
}

export type HostUiRequestResult = HostUiResponse;

/** Parses `prism.remote/<major>`. Only major 1 is supported. */
export function isSupportedProtocol(value: unknown): boolean {
  return value === REMOTE_PROTOCOL;
}

/** Keeps only capabilities this protocol knows and the peer set to `true`. */
export function knownCapabilities(value: unknown): RemoteCapabilities {
  const out: Record<string, boolean> = {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) return out;
  for (const name of KNOWN_CAPABILITIES) {
    if ((value as Record<string, unknown>)[name] === true) out[name] = true;
  }
  return out;
}
