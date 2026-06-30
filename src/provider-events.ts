import type {
  ContentBlock,
  ErrorInfo,
  JsonObject,
  ProviderEvent,
  ToolCallContent,
  ToolCallDeltaContent,
  Usage,
} from "./contracts.js";
import { errorToErrorInfo } from "./redaction.js";

export function providerTextDelta(text: string): ProviderEvent {
  return { type: "content_delta", content: { type: "text", text } };
}

export function providerThinkingDelta(text: string, signature?: string): ProviderEvent {
  return { type: "content_delta", content: { type: "thinking", text, signature } };
}

export function providerContentDelta(content: ContentBlock): ProviderEvent {
  return { type: "content_delta", content };
}

export function providerToolCall(call: ToolCallContent): ProviderEvent {
  return { type: "tool_call", call };
}

export function providerToolCallDelta(delta: {
  readonly index: number;
  readonly id?: string;
  readonly name?: string;
  readonly argumentsText?: string;
}): ProviderEvent {
  return { type: "tool_call_delta", ...delta };
}

export function providerToolCallDeltaContent(delta: Omit<ToolCallDeltaContent, "type">): ToolCallDeltaContent {
  return { type: "tool_call_delta", ...delta };
}

export function reconstructToolCallDeltas(events: readonly ProviderEvent[]): readonly ToolCallContent[] {
  const partials = new Map<number, { id?: string; name?: string; argumentsText: string }>();
  for (const event of events) {
    if (event.type !== "tool_call_delta") continue;
    const partial = partials.get(event.index) ?? { argumentsText: "" };
    if (event.id !== undefined) partial.id = event.id;
    if (event.name !== undefined) partial.name = event.name;
    if (event.argumentsText !== undefined) partial.argumentsText += event.argumentsText;
    partials.set(event.index, partial);
  }
  return [...partials.entries()].sort(([a], [b]) => a - b).map(([index, partial]) => {
    if (!partial.id || !partial.name) throw new Error(`Incomplete tool call delta at index ${index}`);
    return toolCallContent(partial.id, partial.name, parseToolCallArguments(partial.argumentsText, index));
  });
}

export function providerUsage(usage: Usage): ProviderEvent {
  return { type: "usage", usage };
}

export function providerDone(usage?: Usage): ProviderEvent {
  return { type: "done", usage };
}

export function providerError(error: unknown, secrets: readonly (string | undefined)[] = []): ProviderEvent {
  const info: ErrorInfo = errorToErrorInfo(error, secrets);
  return { type: "error", error: info };
}

export function toolCallContent(id: string, name: string, args: JsonObject = {}): ToolCallContent {
  return { type: "tool_call", id, name, arguments: args };
}

function parseToolCallArguments(text: string, index: number): JsonObject {
  try {
    const value = text ? JSON.parse(text) : {};
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not object");
    return value as JsonObject;
  } catch (error) {
    throw new Error(`Invalid tool call arguments at index ${index}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
