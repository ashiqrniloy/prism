import type { AIProvider, ContentBlock, JsonObject, Message, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { type CredentialValueSource, trimTrailingSlashes } from "@arnilo/prism";
import { applyOpenAIChatStructuredOutput } from "@arnilo/prism/providers/openai";
import { buildOpenAIChatBody, createOpenAICompatibleProvider, openAIChatEvents } from "@arnilo/prism/providers/openai-compatible";
import { canonicalizeDeepSeekTools } from "./cache.js";
import { deepseekReasoningEffort, deepseekReplayThinking, deepseekThinking } from "./thinking.js";

export const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com";

export interface DeepSeekProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

export function createDeepSeekProvider(options: DeepSeekProviderOptions = {}): AIProvider {
  return createOpenAICompatibleProvider({
    id: options.id ?? "deepseek",
    baseUrl: trimTrailingSlashes(options.baseUrl ?? DEEPSEEK_DEFAULT_BASE_URL),
    apiKey: options.apiKey,
    fetch: options.fetch,
    doneUsage: true,
    requestFailedPrefix: "DeepSeek request failed",
    serializeMessage: (message, request) => toDeepSeekMessage(message, request),
    transformBody: (body, request) => deepseekTransform(body, request),
  });
}

export function deepseekBody(request: ProviderRequest): JsonObject {
  return buildOpenAIChatBody(request, {
    serializeMessage: (message, req) => toDeepSeekMessage(message, req),
    transformBody: (body, req) => deepseekTransform(body, req),
  });
}

export function deepseekEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
  return openAIChatEvents(body, { signal, doneUsage: true });
}

export function toDeepSeekMessage(message: Message, request: ProviderRequest): JsonObject {
  const index = request.messages.indexOf(message);
  const replay = deepseekReplayThinking(request, index < 0 ? request.messages.length : index);
  const thinkingParts = message.content.filter((part): part is Extract<ContentBlock, { type: "thinking" }> => part.type === "thinking");
  const reasoningContent = replay && thinkingParts.length > 0 ? thinkingParts.map((part) => part.text).join("\n") : undefined;

  if (message.role === "tool") {
    const result = message.content.find((part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result");
    return {
      role: "tool",
      tool_call_id: result?.toolCallId ?? "",
      content: result ? JSON.stringify(result.result ?? result.error ?? null) : "",
    };
  }

  if (message.role === "assistant") {
    const toolCalls = message.content.filter((part): part is Extract<ContentBlock, { type: "tool_call" }> => part.type === "tool_call");
    const textParts = message.content.filter((part): part is Extract<ContentBlock, { type: "text" }> => part.type === "text");
    if (toolCalls.length > 0) {
      return clean({
        role: "assistant",
        content: textParts.map((part) => part.text).join("\n") || null,
        tool_calls: toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
        reasoning_content: reasoningContent,
      });
    }
  }

  const content: JsonObject[] = [];
  for (const part of message.content) {
    if (part.type === "text") {
      content.push({ type: "text", text: part.text });
    } else if (part.type === "thinking") {
    } else if (part.type === "image" || part.type === "audio" || part.type === "file" || part.type === "document") {
      throw new Error(`DeepSeek Chat Completions does not support ${part.type} content blocks`);
    } else if (part.type === "tool_call") {
      throw new Error("DeepSeek assistant tool_call blocks must be the only content on the message");
    } else if (part.type === "tool_result") {
      throw new Error("DeepSeek tool_result blocks must appear in role=tool messages");
    }
  }

  if (content.length === 1 && content[0]!.type === "text") {
    return clean({ role: message.role, content: content[0]!.text, reasoning_content: reasoningContent });
  }
  return clean({ role: message.role, content, reasoning_content: reasoningContent });
}

function deepseekTransform(body: JsonObject, request: ProviderRequest): JsonObject {
  const { maxTokens, ...rest } = body as Record<string, unknown>;
  const thinking = deepseekThinking(request);
  const transformed: Record<string, unknown> = {
    ...rest,
    max_tokens: maxTokens ?? request.model.limits?.maxOutputTokens,
    tools: canonicalizeDeepSeekTools(rest.tools),
    ...stripDeepSeekManagedCompat(request.options?.compat),
    ...request.options?.extra,
    thinking,
    reasoning_effort: deepseekReasoningEffort(request),
  };
  if (thinking.type === "enabled") {
    delete transformed.temperature;
    delete transformed.top_p;
    delete transformed.presence_penalty;
    delete transformed.frequency_penalty;
  }
  applyOpenAIChatStructuredOutput(transformed, request.options?.structuredOutput);
  return clean(transformed);
}

function stripDeepSeekManagedCompat(compat: JsonObject | undefined): JsonObject {
  if (!compat) return {};
  const { thinking: _thinking, reasoning_effort: _effort, reasoningEffort: _effortCamel, ...rest } = compat as Record<string, unknown>;
  return rest as JsonObject;
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}
