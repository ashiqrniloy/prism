import {
  type Message as AgUiMessage,
  type Context,
  type ResumeEntry,
  type RunAgentInput,
  RunAgentInputSchema,
  type Tool,
} from "@ag-ui/core";
import { AgUiError } from "./errors.js";
import type { ResolvedAgUiLimits } from "./limits.js";

/** Fully schema-validated, byte-bounded AG-UI request. Values remain untrusted until a host projector accepts them. */
export interface ParsedAgUiInput {
  readonly request: RunAgentInput;
  readonly threadId: string;
  readonly runId: string;
  readonly parentRunId?: string;
  readonly messages: readonly AgUiMessage[];
  readonly tools: readonly Tool[];
  readonly context: readonly Context[];
  readonly state: unknown;
  readonly forwardedProps: unknown;
  readonly resume: readonly ResumeEntry[];
}

/** Parses complete official input without granting client fields runtime authority. */
export function parseAgUiInput(value: unknown, limits: ResolvedAgUiLimits): ParsedAgUiInput {
  const result = RunAgentInputSchema.safeParse(value);
  if (!result.success) throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Invalid AG-UI run input");
  const input = result.data;
  assertId(input.threadId, "threadId");
  assertId(input.runId, "runId");
  if (input.parentRunId !== undefined) assertId(input.parentRunId, "parentRunId");
  if (input.messages.length > limits.maxInputMessages) throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "Too many input messages");
  if (input.tools.length > limits.maxInputTools) throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "Too many frontend tools");
  if (input.context.length > limits.maxInputContexts) throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "Too many input contexts");
  if ((input.resume?.length ?? 0) > limits.maxInputInterrupts) throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "Too many resume entries");

  assertBoundedJson(input.state, limits.maxStateBytes, limits, "state");
  assertBoundedJson(input.forwardedProps, limits.maxStateBytes, limits, "forwardedProps");
  assertBoundedJson(input.messages, limits.maxInputTextBytes, limits, "messages");
  assertBoundedJson(input.tools, limits.maxInputToolBytes, limits, "tools");
  assertBoundedJson(input.context, limits.maxInputContextBytes, limits, "context");
  assertBoundedJson(input.resume ?? [], limits.maxStateBytes, limits, "resume");
  assertMessageIds(input.messages);
  assertToolIds(input.tools);
  assertResumeIds(input.resume ?? []);
  assertMediaBounds(input.messages, limits);

  return {
    request: input,
    threadId: input.threadId,
    runId: input.runId,
    parentRunId: input.parentRunId,
    messages: input.messages,
    tools: input.tools,
    context: input.context,
    state: input.state,
    forwardedProps: input.forwardedProps,
    resume: input.resume ?? [],
  };
}

/** Legacy secure default: only final text user input may reach a Prism session. */
export function defaultAgUiInput(input: ParsedAgUiInput, limits: ResolvedAgUiLimits): string {
  if (input.tools.length !== 0 || !emptyState(input.state)) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Frontend tools and state are not supported without input.project");
  }
  const message = [...input.messages].reverse().find((item) => item.role === "user");
  if (!message) throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "A user message is required");
  const userText = textContent(message.content);
  if (Buffer.byteLength(userText, "utf8") > limits.maxInputTextBytes) {
    throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "User message exceeds maxInputTextBytes");
  }
  return userText;
}

/** Bounded JSON check shared by untrusted input and host output projectors. */
export function assertBoundedJson(
  value: unknown,
  maxBytes: number,
  limits: Pick<ResolvedAgUiLimits, "maxJsonDepth" | "maxJsonProperties" | "maxJsonArrayItems">,
  name: string,
): void {
  let properties = 0;
  const visit = (current: unknown, depth: number): void => {
    if (depth > limits.maxJsonDepth) throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", `${name} exceeds maxJsonDepth`);
    if (current === null || typeof current === "string" || typeof current === "boolean") return;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new AgUiError("ERR_PRISM_AG_UI_INPUT", `${name} must be JSON-serializable`);
      return;
    }
    if (Array.isArray(current)) {
      if (current.length > limits.maxJsonArrayItems) throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", `${name} exceeds maxJsonArrayItems`);
      for (const item of current) visit(item, depth + 1);
      return;
    }
    if (
      !current ||
      typeof current !== "object" ||
      (Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null)
    ) {
      throw new AgUiError("ERR_PRISM_AG_UI_INPUT", `${name} must be JSON-serializable`);
    }
    for (const [key, item] of Object.entries(current)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new AgUiError("ERR_PRISM_AG_UI_INPUT", `${name} contains a forbidden key`);
      }
      properties += 1;
      if (properties > limits.maxJsonProperties) throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", `${name} exceeds maxJsonProperties`);
      visit(item, depth + 1);
    }
  };
  visit(value, 0);
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", `${name} must be JSON-serializable`);
  }
  if (serialized === undefined) throw new AgUiError("ERR_PRISM_AG_UI_INPUT", `${name} must be JSON-serializable`);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", `${name} exceeds byte limit`);
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (
    !Array.isArray(content) ||
    content.some(
      (part) =>
        !part ||
        typeof part !== "object" ||
        (part as { type?: unknown }).type !== "text" ||
        typeof (part as { text?: unknown }).text !== "string",
    )
  ) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Only text user content is supported without input.project");
  }
  return content.map((part) => (part as { text: string }).text).join("");
}

function emptyState(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);
}

function assertMessageIds(messages: readonly AgUiMessage[]): void {
  for (const message of messages) {
    assertId(message.id, "message id");
    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? []) {
        assertId(call.id, "tool call id");
        if (Buffer.byteLength(call.function.name, "utf8") > 512) throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "Tool call name is too long");
      }
    }
    if (message.role === "tool") assertId(message.toolCallId, "tool result id");
  }
}

function assertToolIds(tools: readonly Tool[]): void {
  for (const tool of tools) {
    if (Buffer.byteLength(tool.name, "utf8") > 512 || Buffer.byteLength(tool.description, "utf8") > 8 * 1024) {
      throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "Frontend tool is too large");
    }
  }
}

function assertResumeIds(entries: readonly ResumeEntry[]): void {
  for (const entry of entries) assertId(entry.interruptId, "interruptId");
}

function assertMediaBounds(messages: readonly AgUiMessage[], limits: ResolvedAgUiLimits): void {
  let parts = 0;
  let bytes = 0;
  for (const message of messages) {
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type !== "image" && part.type !== "audio" && part.type !== "video" && part.type !== "document" && part.type !== "binary")
        continue;
      parts += 1;
      if (parts > limits.maxInputMediaParts) throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "Too many input media parts");
      const data = part.type === "binary" ? part.data : part.source.type === "data" ? part.source.value : undefined;
      if (data) bytes += estimateBase64DecodedBytes(data);
      if (bytes > limits.maxInputMediaBytes) throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "Input media exceeds maxInputMediaBytes");
    }
  }
}

function estimateBase64DecodedBytes(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function assertId(value: string, name: string): void {
  if (value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", `${name} is invalid`);
  }
}
