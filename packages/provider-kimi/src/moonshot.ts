import type {
  AIProvider,
  ContentBlock,
  CredentialValueSource,
  JsonObject,
  Message,
  ModelCapabilities,
  ProviderEvent,
  ProviderRequest,
} from "@arnilo/prism";
import { trimTrailingSlashes } from "@arnilo/prism";
import { applyOpenAIChatStructuredOutput } from "@arnilo/prism/providers/openai";
import { buildOpenAIChatBody, createOpenAICompatibleProvider, openAIChatEvents } from "@arnilo/prism/providers/openai-compatible";
import { kimiPreserveThinking, kimiReasoningEffort, kimiThinking, stripKimiThinkingCompat } from "./thinking.js";

export interface MoonshotProviderOptions {
  readonly id?: string;
  /** Defaults to Open Platform `https://api.moonshot.ai/v1`. */
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

/**
 * Moonshot / Kimi Open Platform Chat Completions provider (`POST /chat/completions`).
 * Official base: `https://api.moonshot.ai/v1` (or `api.moonshot.cn/v1`).
 * Distinct from Kimi For Coding Anthropic `/messages` (`createKimiCodingProvider`).
 * @see https://platform.kimi.ai/docs/api/overview
 */
export function createMoonshotProvider(options: MoonshotProviderOptions = {}): AIProvider {
  return createOpenAICompatibleProvider({
    id: options.id ?? "moonshot",
    baseUrl: trimTrailingSlashes(options.baseUrl ?? "https://api.moonshot.ai/v1"),
    apiKey: options.apiKey,
    fetch: options.fetch,
    strictCompletion: true,
    requestFailedPrefix: "Moonshot request failed",
    serializeMessage: (message, request) =>
      serializeMoonshotMessage(message, request.model.capabilities ?? {}, kimiPreserveThinking(request)),
    transformBody: (body, request) => moonshotTransform(body, request),
  });
}

export function moonshotBody(request: ProviderRequest): JsonObject {
  return buildOpenAIChatBody(request, {
    serializeMessage: (message, req) => serializeMoonshotMessage(message, req.model.capabilities ?? {}, kimiPreserveThinking(req)),
    transformBody: (body, req) => moonshotTransform(body, req),
  });
}

function moonshotTransform(body: JsonObject, request: ProviderRequest): JsonObject {
  const { maxTokens, ...rest } = body as Record<string, unknown>;
  const transformed: Record<string, unknown> = {
    // Resolved thinking fields first: model `parameters` may override them (legacy order).
    thinking: kimiThinking(request),
    reasoning_effort: kimiReasoningEffort(request),
    ...rest,
    max_tokens: maxTokens ?? request.model.limits?.maxOutputTokens,
    ...stripKimiThinkingCompat(request.options?.compat as JsonObject | undefined),
    ...request.options?.extra,
  };
  applyOpenAIChatStructuredOutput(transformed, request.options?.structuredOutput);
  return clean(transformed);
}

export function moonshotEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
  return openAIChatEvents(body, { signal, strictCompletion: true });
}

/**
 * Open Platform message serialization. When `preserveThinking`, historical thinking
 * blocks become top-level `reasoning_content` (official Preserved Thinking contract).
 * Anthropic `cache_control` is never emitted on this route.
 */
export function serializeMoonshotMessage(message: Message, capabilities: ModelCapabilities = {}, preserveThinking = false): JsonObject {
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
    const textParts = message.content.filter((part) => part.type === "text");
    const thinkingParts = message.content.filter((part) => part.type === "thinking");
    const text = textParts.map((part) => part.text).join("\n");
    const reasoning = thinkingParts.map((part) => part.text).join("\n");
    const base: Record<string, unknown> = {
      role: "assistant",
      content: text || (toolCalls.length > 0 ? null : ""),
    };
    if (preserveThinking && reasoning) base.reasoning_content = reasoning;
    if (toolCalls.length > 0) {
      base.tool_calls = toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      }));
    }
    return base as JsonObject;
  }

  // user / system — fold thinking into text (should not normally appear)
  const content: JsonObject[] = [];
  for (const part of message.content) {
    if (part.type === "text" || part.type === "thinking") {
      content.push({ type: "text", text: part.text });
    } else if (part.type === "image") {
      if (!capabilities.input?.includes("image")) {
        throw new Error(`Moonshot ${message.role} message includes image but model does not declare image input capability`);
      }
      const url = part.url ?? (part.data ? `data:${part.mimeType ?? "image/png"};base64,${part.data}` : undefined);
      if (!url) throw new Error("Moonshot image block missing url or data");
      content.push({ type: "image_url", image_url: { url } });
    } else if (part.type === "audio" || part.type === "file" || part.type === "document") {
      throw new Error(`Moonshot Chat Completions does not support ${part.type} content blocks`);
    } else if (part.type === "tool_call" || part.type === "tool_result") {
      throw new Error(`Moonshot ${part.type} blocks must use assistant/tool roles`);
    }
  }
  if (content.length === 1 && content[0]!.type === "text") {
    return { role: message.role, content: content[0]!.text };
  }
  return { role: message.role, content };
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && !(Array.isArray(item) && item.length === 0)),
  ) as JsonObject;
}
