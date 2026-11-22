/**
 * A2A 1.0 JSON-RPC codec: wire types, request validation, part ↔ content mapping, and the Prism
 * decisions extension. No I/O and no agent access; `serve.ts` (and the client in Task 3) share it.
 */
import type { ApprovalOutcome, ContentBlock, Decision, JsonObject, JsonValue, Message, PendingDecision } from "@arnilo/prism";
import { A2AError } from "./errors.js";

export const A2A_PROTOCOL_VERSION = "1.0";
export const A2A_CARD_PATH = "/.well-known/agent-card.json";
/** Extension URI a message lists in `extensions` when one of its `data` parts carries `{ decisions }`. */
export const PRISM_DECISIONS_EXTENSION = "https://prism.arnilo.dev/a2a/extensions/decisions/v1";

export type A2ATaskState =
  | "TASK_STATE_SUBMITTED"
  | "TASK_STATE_WORKING"
  | "TASK_STATE_INPUT_REQUIRED"
  | "TASK_STATE_AUTH_REQUIRED"
  | "TASK_STATE_COMPLETED"
  | "TASK_STATE_FAILED"
  | "TASK_STATE_CANCELED"
  | "TASK_STATE_REJECTED";

export type A2ARole = "ROLE_USER" | "ROLE_AGENT";

/** Exactly one of `text`, `raw`, `url`, `data`. */
export interface A2APart {
  readonly text?: string;
  readonly raw?: string;
  readonly url?: string;
  readonly data?: JsonValue;
  readonly mediaType?: string;
  readonly filename?: string;
  readonly metadata?: JsonObject;
}

export interface A2AMessage {
  readonly messageId: string;
  readonly role: A2ARole;
  readonly parts: readonly A2APart[];
  readonly contextId?: string;
  readonly taskId?: string;
  readonly extensions?: readonly string[];
  readonly referenceTaskIds?: readonly string[];
  readonly metadata?: JsonObject;
}

export interface A2ATaskStatus {
  readonly state: A2ATaskState;
  readonly message?: A2AMessage;
  readonly timestamp: string;
}

export interface A2AArtifact {
  readonly artifactId: string;
  readonly name?: string;
  readonly parts: readonly A2APart[];
}

export interface A2ATask {
  readonly id: string;
  readonly contextId: string;
  readonly status: A2ATaskStatus;
  readonly artifacts?: readonly A2AArtifact[];
  readonly history?: readonly A2AMessage[];
}

export interface A2ATaskStatusUpdateEvent {
  readonly taskId: string;
  readonly contextId: string;
  readonly status: A2ATaskStatus;
}

export interface A2ATaskArtifactUpdateEvent {
  readonly taskId: string;
  readonly contextId: string;
  readonly artifact: A2AArtifact;
  readonly append?: boolean;
  readonly lastChunk?: boolean;
}

/** One `SendStreamingMessage` / `SubscribeToTask` SSE frame result: exactly one member. */
export type A2AStreamResponse =
  | { readonly task: A2ATask }
  | { readonly message: A2AMessage }
  | { readonly statusUpdate: A2ATaskStatusUpdateEvent }
  | { readonly artifactUpdate: A2ATaskArtifactUpdateEvent };

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface SendMessageParams {
  readonly message: A2AMessage;
  readonly returnImmediately: boolean;
  readonly historyLength?: number;
}

export const TERMINAL_STATES: ReadonlySet<A2ATaskState> = new Set([
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_REJECTED",
]);

export const INTERRUPTED_STATES: ReadonlySet<A2ATaskState> = new Set(["TASK_STATE_INPUT_REQUIRED", "TASK_STATE_AUTH_REQUIRED"]);

const ID_PATTERN = /^[A-Za-z0-9._:~-]{1,128}$/;
const TASK_ID_PATTERN = /^[A-Za-z0-9._:~-]{1,1024}$/;
const OUTCOMES: ReadonlySet<string> = new Set(["allow_once", "allow_for_run", "reject_once", "reject_for_run"]);
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_DECISIONS = 128;
const MAX_DECISION_REASON_BYTES = 2 * 1024;

function invalidParams(message: string): A2AError {
  return new A2AError("invalidParams", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A protocol id (`contextId`, `taskId`, `messageId`): bounded and limited to URL-safe characters. */
export function isA2AId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function isA2ATaskId(value: unknown): value is string {
  return typeof value === "string" && TASK_ID_PATTERN.test(value);
}

/** Validates a JSON-RPC 2.0 request envelope. Notifications (no `id`) and batches are refused. */
export function parseJsonRpcRequest(value: unknown): JsonRpcRequest {
  if (!isRecord(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string" || value.method.length === 0) {
    throw new A2AError("invalidRequest", "Invalid JSON-RPC request");
  }
  const id = value.id;
  if (!((typeof id === "string" && id.length <= 256) || (typeof id === "number" && Number.isSafeInteger(id)))) {
    throw new A2AError("invalidRequest", "JSON-RPC request id must be a string or an integer");
  }
  const params = value.params ?? {};
  if (!isRecord(params)) throw invalidParams("params must be an object");
  return { id, method: value.method, params };
}

/** Parses `SendMessageRequest` params. A push-notification config is refused with `-32003`. */
export function parseSendMessageParams(params: Readonly<Record<string, unknown>>, maxParts: number): SendMessageParams {
  const configuration = params.configuration ?? {};
  if (!isRecord(configuration)) throw invalidParams("configuration must be an object");
  if (configuration.taskPushNotificationConfig !== undefined || configuration.pushNotificationConfig !== undefined) {
    throw new A2AError("pushNotificationNotSupported", "Push notifications are not supported");
  }
  if (configuration.returnImmediately !== undefined && typeof configuration.returnImmediately !== "boolean") {
    throw invalidParams("configuration.returnImmediately must be a boolean");
  }
  const historyLength = parseHistoryLength(configuration.historyLength);
  return {
    message: parseA2AMessage(params.message, maxParts, "ROLE_USER"),
    returnImmediately: configuration.returnImmediately === true,
    ...(historyLength === undefined ? {} : { historyLength }),
  };
}

/** `GetTask` / `CancelTask` / `SubscribeToTask` params: `{ id, historyLength? }`. */
export function parseTaskIdParams(params: Readonly<Record<string, unknown>>): { readonly id: string; readonly historyLength?: number } {
  if (!isA2ATaskId(params.id)) throw invalidParams("id must be a task id");
  const historyLength = parseHistoryLength(params.historyLength);
  return { id: params.id, ...(historyLength === undefined ? {} : { historyLength }) };
}

function parseHistoryLength(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw invalidParams("historyLength must be a non-negative integer");
  return value;
}

function parseRole(value: unknown): A2ARole {
  if (value === "ROLE_USER" || value === "user") return "ROLE_USER";
  if (value === "ROLE_AGENT" || value === "agent") return "ROLE_AGENT";
  throw invalidParams("message.role is invalid");
}

/** Validates one `Message`. `expectRole` pins the sender (a server accepts only `ROLE_USER`). */
export function parseA2AMessage(value: unknown, maxParts: number, expectRole?: A2ARole): A2AMessage {
  if (!isRecord(value)) throw invalidParams("message is required");
  if (!isA2AId(value.messageId)) throw invalidParams("message.messageId is invalid");
  const role = parseRole(value.role);
  if (expectRole !== undefined && role !== expectRole) throw invalidParams("message.role is invalid");
  if (!Array.isArray(value.parts) || value.parts.length === 0 || value.parts.length > maxParts) {
    throw invalidParams("message.parts must be a non-empty bounded array");
  }
  if (value.contextId !== undefined && !isA2AId(value.contextId)) throw invalidParams("message.contextId is invalid");
  if (value.taskId !== undefined && !isA2ATaskId(value.taskId)) throw invalidParams("message.taskId is invalid");
  const extensions = value.extensions;
  if (
    extensions !== undefined &&
    (!Array.isArray(extensions) || extensions.length > 32 || extensions.some((uri) => typeof uri !== "string" || uri.length > 512))
  ) {
    throw invalidParams("message.extensions is invalid");
  }
  return {
    messageId: value.messageId,
    role,
    parts: value.parts.map(parseA2APart),
    ...(typeof value.contextId === "string" ? { contextId: value.contextId } : {}),
    ...(typeof value.taskId === "string" ? { taskId: value.taskId } : {}),
    ...(extensions ? { extensions: extensions as string[] } : {}),
  };
}

/** Validates one `Part`: exactly one of `text`, `raw` (base64), `url`, `data`. */
export function parseA2APart(value: unknown): A2APart {
  if (!isRecord(value)) throw invalidParams("part must be an object");
  const present = (["text", "raw", "url", "data"] as const).filter((key) => value[key] !== undefined);
  if (present.length !== 1) throw invalidParams("part must hold exactly one of text, raw, url, data");
  const mediaType = value.mediaType;
  if (mediaType !== undefined && (typeof mediaType !== "string" || mediaType.length > 255))
    throw invalidParams("part.mediaType is invalid");
  const filename = value.filename;
  if (filename !== undefined && (typeof filename !== "string" || filename.length > 255)) throw invalidParams("part.filename is invalid");
  const common = {
    ...(typeof mediaType === "string" ? { mediaType } : {}),
    ...(typeof filename === "string" ? { filename } : {}),
  };
  if (value.text !== undefined) {
    if (typeof value.text !== "string" || Buffer.byteLength(value.text) > MAX_TEXT_BYTES) throw invalidParams("part.text is invalid");
    return { text: value.text, ...common };
  }
  if (value.raw !== undefined) {
    if (typeof value.raw !== "string" || value.raw.length === 0 || value.raw.length % 4 !== 0 || !BASE64.test(value.raw)) {
      throw invalidParams("part.raw must be base64");
    }
    return { raw: value.raw, ...common };
  }
  if (value.url !== undefined) {
    if (typeof value.url !== "string") throw invalidParams("part.url is invalid");
    return { url: value.url, ...common };
  }
  return { data: value.data as JsonValue, ...common };
}

/** The decisions a message carries through {@link PRISM_DECISIONS_EXTENSION}, or `undefined` when it carries none. */
/** `maxDecisions` is the agent's `ceilings.pendingDecisions` (default 128), so a raised ceiling can still be answered. */
export function readDecisions(
  message: A2AMessage,
  allowModifiedArguments: boolean,
  maxDecisions = MAX_DECISIONS,
): readonly Decision[] | undefined {
  if (!message.extensions?.includes(PRISM_DECISIONS_EXTENSION)) return undefined;
  const parts = message.parts.filter((part) => isRecord(part.data) && "decisions" in part.data);
  if (parts.length === 0) return undefined;
  if (parts.length > 1) throw invalidParams("Only one decisions part is allowed");
  const raw = (parts[0]?.data as Record<string, unknown> | undefined)?.decisions;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > maxDecisions)
    throw invalidParams("decisions must be a non-empty bounded array");
  return raw.map((entry): Decision => {
    if (!isRecord(entry)) throw invalidParams("decision must be an object");
    for (const key of Object.keys(entry)) {
      if (!["approvalId", "outcome", "reason", "elicitation", "modifiedArguments"].includes(key))
        throw invalidParams(`decision.${key} is not allowed`);
    }
    if (typeof entry.approvalId !== "string" || entry.approvalId.length === 0 || entry.approvalId.length > 512) {
      throw invalidParams("decision.approvalId is invalid");
    }
    if (typeof entry.outcome !== "string" || !OUTCOMES.has(entry.outcome)) throw invalidParams("decision.outcome is invalid");
    if (entry.reason !== undefined && (typeof entry.reason !== "string" || Buffer.byteLength(entry.reason) > MAX_DECISION_REASON_BYTES)) {
      throw invalidParams("decision.reason is invalid");
    }
    if (entry.elicitation !== undefined && !isRecord(entry.elicitation)) throw invalidParams("decision.elicitation must be an object");
    if (entry.modifiedArguments !== undefined) {
      if (!allowModifiedArguments) throw invalidParams("decision.modifiedArguments is not allowed");
      if (!isRecord(entry.modifiedArguments)) throw invalidParams("decision.modifiedArguments must be an object");
    }
    return {
      approvalId: entry.approvalId,
      outcome: entry.outcome as ApprovalOutcome,
      ...(typeof entry.reason === "string" ? { reason: entry.reason } : {}),
      ...(isRecord(entry.elicitation) ? { elicitation: entry.elicitation as JsonObject } : {}),
      ...(isRecord(entry.modifiedArguments) ? { modifiedArguments: entry.modifiedArguments as JsonObject } : {}),
    };
  });
}

/** Builds the `data` part a client sends to answer `TASK_STATE_INPUT_REQUIRED`. */
export function decisionsMessage(messageId: string, taskId: string, contextId: string, decisions: readonly Decision[]): A2AMessage {
  return {
    messageId,
    role: "ROLE_USER",
    taskId,
    contextId,
    extensions: [PRISM_DECISIONS_EXTENSION],
    parts: [{ data: { decisions: decisions as unknown as JsonValue }, mediaType: "application/json" }],
  };
}

/**
 * Maps inbound parts to a user `Message` within the model's declared input kinds. A `url` part is never
 * fetched and, like a kind the model does not declare, fails with `-32005`.
 */
export function partsToMessage(parts: readonly A2APart[], declaredInput: readonly string[] | undefined): Message {
  const declared = new Set(declaredInput ?? ["text"]);
  const content: ContentBlock[] = [];
  for (const part of parts) {
    if (part.text !== undefined) {
      content.push({ type: "text", text: part.text });
      continue;
    }
    if (part.url !== undefined) throw new A2AError("contentTypeNotSupported", "URL parts are not supported");
    if (part.data !== undefined) {
      content.push({ type: "text", text: canonicalJson(part.data) });
      continue;
    }
    const mediaType = (part.mediaType ?? "application/octet-stream").toLowerCase();
    const name = part.filename;
    const kind = mediaKind(mediaType);
    if (kind === "image" && declared.has("image")) {
      content.push({ type: "image", mimeType: mediaType, data: part.raw as string, ...(name ? { name } : {}) });
    } else if (kind === "audio" && declared.has("audio")) {
      content.push({ type: "audio", mediaType, data: part.raw as string, ...(name ? { name } : {}) });
    } else if (kind === "document" && declared.has("document")) {
      content.push({ type: "document", mediaType, data: part.raw as string, ...(name ? { name } : {}) });
    } else if (kind !== "image" && kind !== "audio" && declared.has("file")) {
      content.push({ type: "file", mediaType, data: part.raw as string, ...(name ? { name } : {}) });
    } else {
      throw new A2AError("contentTypeNotSupported", "The agent does not accept this media type");
    }
  }
  return { role: "user", content };
}

function mediaKind(mediaType: string): "image" | "audio" | "document" | "file" {
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("audio/")) return "audio";
  if (mediaType === "application/pdf" || mediaType.startsWith("text/")) return "document";
  return "file";
}

/** Text parts of a stored message, for `GetTask` history. Tool and system messages are not history. */
export function messageToA2A(message: Message, index: number, contextId: string, taskId: string): A2AMessage | undefined {
  if (message.role !== "user" && message.role !== "assistant") return undefined;
  const parts: A2APart[] = [];
  for (const block of message.content) if (block.type === "text" && block.text.length > 0) parts.push({ text: block.text });
  if (parts.length === 0) return undefined;
  return {
    messageId: message.id ?? `history-${index}`,
    role: message.role === "user" ? "ROLE_USER" : "ROLE_AGENT",
    contextId,
    taskId,
    parts,
  };
}

/** One `data` item per pending decision: approval id, kind, tool name, and the (already redacted) reason. */
export function pendingParts(pending: readonly PendingDecision[]): A2APart[] {
  return pending.map((decision) => ({
    mediaType: "application/json",
    data: {
      approvalId: decision.approvalId,
      kind: decision.kind,
      ...(decision.scope.toolName ? { toolName: decision.scope.toolName } : {}),
      reason: decision.reason,
      ...(decision.elicitationSchema ? { elicitationSchema: decision.elicitationSchema } : {}),
    },
  }));
}

const TASK_STATES: ReadonlySet<string> = new Set([
  "TASK_STATE_SUBMITTED",
  "TASK_STATE_WORKING",
  "TASK_STATE_INPUT_REQUIRED",
  "TASK_STATE_AUTH_REQUIRED",
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_REJECTED",
]);
const MAX_ARTIFACTS = 64;

function badResponse(message: string): A2AError {
  return new A2AError("invalidAgentResponse", message);
}

/** Re-labels a validation failure of a peer's payload as `-32006` InvalidAgentResponse. */
function asPeer<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof A2AError && error.errorName === "invalidParams") throw badResponse(`Invalid agent response: ${error.message}`);
    throw error;
  }
}

function parseStatus(value: unknown, maxParts: number): A2ATaskStatus {
  if (!isRecord(value) || typeof value.state !== "string" || !TASK_STATES.has(value.state))
    throw badResponse("Invalid agent response: task status");
  return {
    state: value.state as A2ATaskState,
    ...(value.message === undefined || value.message === null
      ? {}
      : { message: asPeer(() => parseA2AMessage(value.message, maxParts, "ROLE_AGENT")) }),
    timestamp: typeof value.timestamp === "string" ? value.timestamp : "",
  };
}

function parseArtifact(value: unknown, maxParts: number): A2AArtifact {
  if (!isRecord(value) || typeof value.artifactId !== "string" || value.artifactId.length > 256)
    throw badResponse("Invalid agent response: artifact");
  if (!Array.isArray(value.parts) || value.parts.length > maxParts) throw badResponse("Invalid agent response: artifact parts");
  return {
    artifactId: value.artifactId,
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    parts: asPeer(() => (value.parts as unknown[]).map(parseA2APart)),
  };
}

/** Validates a peer's `Task` (`GetTask` result, or the `task` member of a send or stream response). History is dropped. */
export function parseA2ATask(value: unknown, maxParts: number): A2ATask {
  if (!isRecord(value) || !isA2ATaskId(value.id) || !isA2AId(value.contextId)) throw badResponse("Invalid agent response: task");
  const artifacts = value.artifacts;
  if (artifacts !== undefined && (!Array.isArray(artifacts) || artifacts.length > MAX_ARTIFACTS))
    throw badResponse("Invalid agent response: artifacts");
  return {
    id: value.id,
    contextId: value.contextId,
    status: parseStatus(value.status, maxParts),
    ...(Array.isArray(artifacts) ? { artifacts: artifacts.map((artifact) => parseArtifact(artifact, maxParts)) } : {}),
  };
}

/** Validates one `SendMessage` result or stream frame: exactly one of `task`, `message`, `statusUpdate`, `artifactUpdate`. */
export function parseA2AStreamResponse(value: unknown, maxParts: number): A2AStreamResponse {
  if (!isRecord(value)) throw badResponse("Invalid agent response");
  const present = (["task", "message", "statusUpdate", "artifactUpdate"] as const).filter((key) => value[key] !== undefined);
  if (present.length !== 1) throw badResponse("Invalid agent response: expected one of task, message, statusUpdate, artifactUpdate");
  if (value.task !== undefined) return { task: parseA2ATask(value.task, maxParts) };
  if (value.message !== undefined) return { message: asPeer(() => parseA2AMessage(value.message, maxParts, "ROLE_AGENT")) };
  const update = (value.statusUpdate ?? value.artifactUpdate) as unknown;
  if (!isRecord(update) || !isA2ATaskId(update.taskId) || !isA2AId(update.contextId)) throw badResponse("Invalid agent response: update");
  if (value.statusUpdate !== undefined) {
    return { statusUpdate: { taskId: update.taskId, contextId: update.contextId, status: parseStatus(update.status, maxParts) } };
  }
  return {
    artifactUpdate: {
      taskId: update.taskId,
      contextId: update.contextId,
      artifact: parseArtifact(update.artifact, maxParts),
      ...(typeof update.append === "boolean" ? { append: update.append } : {}),
      ...(typeof update.lastChunk === "boolean" ? { lastChunk: update.lastChunk } : {}),
    },
  };
}

/**
 * The pending decisions a `TASK_STATE_INPUT_REQUIRED` status message lists (the `data` items {@link pendingParts}
 * writes). Items that do not have that shape are skipped.
 */
export function readPendingParts(message: A2AMessage | undefined): PendingDecision[] {
  const out: PendingDecision[] = [];
  for (const part of message?.parts ?? []) {
    const data = part.data;
    if (!isRecord(data) || typeof data.approvalId !== "string" || data.approvalId.length === 0 || data.approvalId.length > 512) continue;
    if (data.kind !== "tool_approval" && data.kind !== "elicitation") continue;
    out.push({
      approvalId: data.approvalId,
      kind: data.kind,
      scope: typeof data.toolName === "string" ? { toolName: data.toolName } : {},
      reason: typeof data.reason === "string" ? data.reason.slice(0, MAX_DECISION_REASON_BYTES) : "",
      ...(isRecord(data.elicitationSchema) ? { elicitationSchema: data.elicitationSchema as JsonObject } : {}),
    });
    if (out.length >= MAX_DECISIONS) break;
  }
  return out;
}

/** Text of `text` parts, and canonical JSON of `data` parts, joined. */
export function partsText(parts: readonly A2APart[]): string {
  return parts.map((part) => (part.text !== undefined ? part.text : part.data !== undefined ? canonicalJson(part.data) : "")).join("");
}

export function jsonRpcResult(id: JsonRpcId | null, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

export function jsonRpcError(id: JsonRpcId | null, error: A2AError): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code: error.code, message: error.message } });
}

/** RFC 8785 (JCS) canonical JSON: sorted keys by UTF-16 code unit, ECMAScript number and string forms. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidParams("Non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw invalidParams("Value is not JSON");
}

/** Server-issued task id. It names the context and the run, so a suspended task can be found again after a restart. */
export function encodeTaskId(contextId: string, runId: string): string {
  return `${Buffer.from(contextId).toString("base64url")}.${Buffer.from(runId).toString("base64url")}`;
}

export function decodeTaskId(taskId: string): { readonly contextId: string; readonly runId: string } | undefined {
  const [context, run, extra] = taskId.split(".");
  if (!context || !run || extra !== undefined) return undefined;
  const contextId = Buffer.from(context, "base64url").toString();
  const runId = Buffer.from(run, "base64url").toString();
  if (!isA2AId(contextId) || runId.length === 0 || runId.length > 256 || encodeTaskId(contextId, runId) !== taskId) return undefined;
  return { contextId, runId };
}
