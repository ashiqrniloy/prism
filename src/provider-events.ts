import type {
  ContentBlock,
  ErrorInfo,
  JsonObject,
  ProviderEvent,
  ProviderStopReason,
  ToolCallContent,
  ToolCallDeltaContent,
  Usage,
} from "./contracts.js";
import { classifyProviderFailure, ProviderTransportError, tryParseJsonObjectArguments } from "./providers/transport.js";
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

export function providerContinuationRequired(cursor: string, reason?: string): ProviderEvent {
  return { type: "continuation_required", cursor, reason };
}

export function reconstructToolCallDeltas(events: readonly ProviderEvent[]): readonly ToolCallContent[] {
  const partials = new Map<number, { id?: string; name?: string; argumentsText: string }>();
  for (const event of events) {
    if (event.type !== "tool_call_delta") continue;
    const partial = partials.get(event.index) ?? { argumentsText: "" };
    // Conformant OpenAI-compatible providers repeat identity as null on continuation chunks; coalesce like openai-compatible.js instead of clobbering.
    partial.id = event.id ?? partial.id;
    partial.name = event.name ?? partial.name;
    if (event.argumentsText !== undefined) partial.argumentsText += event.argumentsText;
    partials.set(event.index, partial);
  }
  return [...partials.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, partial]) => {
      if (!partial.id || !partial.name) {
        throw new ProviderTransportError("incomplete_delta", `Incomplete tool call delta at index ${index}`);
      }
      return toolCallFromArgumentsText(partial.id, partial.name, partial.argumentsText);
    });
}

export function providerUsage(usage: Usage): ProviderEvent {
  return { type: "usage", usage };
}

/**
 * One shared native → taxonomy table (plan 087 T1). Every adapter routes its wire reason
 * through `mapProviderStopReason`, so hosts switch on one closed union instead of per-provider
 * strings. Keys are lowercased wire values; `unknown` never appears here — it is the fallback.
 */
const PROVIDER_STOP_REASONS: Readonly<Record<string, ProviderStopReason>> = Object.freeze({
  // OpenAI Chat Completions (`finish_reason`) and generic OpenAI-compatible routes.
  stop: "end_turn",
  length: "max_output_tokens",
  tool_calls: "tool_calls",
  function_call: "tool_calls",
  content_filter: "content_filter",
  // Messages-style `stop_reason` routes and Bedrock Converse (`stopReason`).
  end_turn: "end_turn",
  stop_sequence: "end_turn",
  pause_turn: "end_turn",
  tool_use: "tool_calls",
  max_tokens: "max_output_tokens",
  refusal: "content_filter",
  // Google generateContent (`finishReason`).
  safety: "content_filter",
  recitation: "content_filter",
  blocklist: "content_filter",
  prohibited_content: "content_filter",
  spii: "content_filter",
  image_safety: "content_filter",
  language: "content_filter",
  malformed_function_call: "provider_error",
  unexpected_tool_call: "provider_error",
  // OpenAI Responses (status / `incomplete_details.reason`).
  completed: "end_turn",
  failed: "provider_error",
  cancelled: "abort",
  canceled: "abort",
  // Bedrock Converse guarded routes.
  content_filtered: "content_filter",
  guardrail_intervened: "content_filter",
  malformed_model_output: "provider_error",
  malformed_tool_use: "provider_error",
  // AI SDK unified finish reasons (hyphenated).
  "content-filter": "content_filter",
  "tool-calls": "tool_calls",
  error: "provider_error",
  other: "unknown",
  unknown: "unknown",
  abort: "abort",
  aborted: "abort",
});

/**
 * Map a native provider stop/finish reason onto the closed taxonomy. A missing, non-string, or
 * unmapped value returns `"unknown"` rather than throwing, so a new wire value can never fail a
 * run (plan 087 T1).
 */
export function mapProviderStopReason(native: string | null | undefined): ProviderStopReason {
  if (typeof native !== "string") return "unknown";
  return PROVIDER_STOP_REASONS[native.trim().toLowerCase()] ?? "unknown";
}

export function providerDone(usage?: Usage, stopReason?: ProviderStopReason): ProviderEvent {
  return { type: "done", usage, ...(stopReason === undefined ? {} : { stopReason }) };
}

export function providerError(error: unknown, secrets: readonly (string | undefined)[] = []): Extract<ProviderEvent, { type: "error" }> {
  const info: ErrorInfo = errorToErrorInfo(error, secrets);
  return { type: "error", error: info.failureClass ? info : { ...info, failureClass: classifyProviderFailure(error) } };
}

export function toolCallContent(id: string, name: string, args: JsonObject = {}): ToolCallContent {
  return { type: "tool_call", id, name, arguments: args };
}

/** Build a tool call from streamed arguments text; malformed JSON becomes a blocked call (no throw). */
export function toolCallFromArgumentsText(id: string, name: string, argumentsText: string): ToolCallContent {
  const parsed = tryParseJsonObjectArguments(argumentsText, { toolName: name });
  if (parsed.ok) return toolCallContent(id, name, parsed.value);
  return {
    type: "tool_call",
    id,
    name,
    arguments: {},
    argumentsError: {
      name: parsed.error.name,
      message: parsed.error.message,
      code: parsed.error.code,
    },
  };
}
