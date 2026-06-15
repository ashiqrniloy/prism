import type {
  ContentBlock,
  ErrorInfo,
  JsonObject,
  ProviderEvent,
  ToolCallContent,
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
