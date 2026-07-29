import type {
  AIProvider,
  CacheControlledMessage,
  ContentBlock,
  CredentialValueSource,
  JsonObject,
  ModelConfig,
  ProviderEvent,
  ProviderRequest,
} from "@arnilo/prism";
import { rejectProviderMediaBlock } from "@arnilo/prism/providers/media";
import { applyOpenAIChatStructuredOutput } from "@arnilo/prism/providers/openai";
import { buildOpenAIChatBody, createOpenAICompatibleProvider, openAIChatEvents } from "@arnilo/prism/providers/openai-compatible";
import { applyOpenRouterCacheControl, openRouterSessionId, openRouterTopLevelCacheControl, openRouterUsage } from "./cache.js";
import { openRouterPreserveThinking, resolveOpenRouterReasoning, stripOpenRouterOwnedCompat } from "./thinking.js";

export interface OpenRouterProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly appUrl?: string;
  readonly appTitle?: string;
}

export function createOpenRouterProvider(options: OpenRouterProviderOptions = {}): AIProvider {
  return createOpenAICompatibleProvider({
    id: options.id ?? "openrouter",
    baseUrl: (options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
    apiKey: options.apiKey,
    fetch: options.fetch,
    doneUsage: true,
    requestFailedPrefix: "OpenRouter request failed",
    mapUsage: (usage) => openRouterUsage(usage as Parameters<typeof openRouterUsage>[0]),
    mapMessages: (request) => applyOpenRouterCacheControl(request),
    serializeMessage: (message, request) =>
      toOpenRouterMessage(message as CacheControlledMessage, request.model, openRouterPreserveThinking(request)),
    transformBody: (body, request) => openRouterTransform(body, request, openRouterSessionId(request.options)),
    extraHeaders: (request) =>
      cleanHeaders({
        "x-session-id": openRouterSessionId(request.options),
        "http-referer": options.appUrl,
        "x-title": options.appTitle,
      }),
  });
}

export function openRouterBody(request: ProviderRequest, sessionId = openRouterSessionId(request.options)): JsonObject {
  return buildOpenAIChatBody(request, {
    mapMessages: (req) => applyOpenRouterCacheControl(req),
    serializeMessage: (message, req) => toOpenRouterMessage(message as CacheControlledMessage, req.model, openRouterPreserveThinking(req)),
    transformBody: (body, req) => openRouterTransform(body, req, sessionId),
  });
}

function openRouterTransform(body: JsonObject, request: ProviderRequest, sessionId: string | undefined): JsonObject {
  const { maxTokens, ...rest } = body as Record<string, unknown>;
  const routing =
    (request.options?.compat?.openRouterRouting as JsonObject | undefined) ??
    (request.model.compat?.openRouterRouting as JsonObject | undefined);
  const transformed: Record<string, unknown> = {
    // Resolved OpenRouter fields first: model `parameters` may override them (legacy order).
    provider: routing,
    reasoning: resolveOpenRouterReasoning(request.model, request.options),
    session_id: sessionId,
    cache_control: openRouterTopLevelCacheControl(request),
    ...rest,
    // OpenRouter uses only the explicit `maxTokens` parameter; no limits fallback.
    max_tokens: maxTokens,
    ...stripOpenRouterOwnedCompat(request.options?.compat as JsonObject | undefined),
    ...request.options?.extra,
  };
  applyOpenAIChatStructuredOutput(transformed, request.options?.structuredOutput);
  return clean(transformed);
}

export function openRouterEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
  return openAIChatEvents(body, {
    signal,
    doneUsage: true,
    mapUsage: (usage) => openRouterUsage(usage as Parameters<typeof openRouterUsage>[0]),
  });
}

function toOpenRouterMessage(message: CacheControlledMessage, model: ModelConfig, preserveThinking: boolean): JsonObject {
  const capabilities = model.capabilities ?? {};
  if (message.role === "tool") {
    const result = message.content.find((part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result");
    return {
      role: "tool",
      tool_call_id: result?.toolCallId ?? "",
      content: result ? JSON.stringify(result.result ?? result.error ?? null) : "",
    };
  }

  const thinkingText = message.content
    .filter((part): part is Extract<ContentBlock, { type: "thinking" }> => part.type === "thinking")
    .map((part) => part.text)
    .join("\n");
  const reasoningField = preserveThinking && thinkingText ? thinkingText : undefined;

  if (message.role === "assistant") {
    const toolCalls = message.content.filter((part): part is Extract<ContentBlock, { type: "tool_call" }> => part.type === "tool_call");
    const textParts = message.content.filter((part): part is Extract<ContentBlock, { type: "text" }> => part.type === "text");
    if (toolCalls.length > 0) {
      return clean({
        role: "assistant",
        content: textParts.map((part) => part.text).join("\n") || null,
        reasoning: reasoningField,
        tool_calls: toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      });
    }
  }

  const content: JsonObject[] = [];
  for (const part of message.content) {
    if (part.type === "text") {
      content.push(withMarker({ type: "text", text: part.text }, part.cache_control as JsonObject | undefined));
    } else if (part.type === "thinking") {
      // Preserved as top-level `reasoning`; when not preserving, fold into text.
      if (!preserveThinking) {
        content.push(withMarker({ type: "text", text: part.text }, part.cache_control as JsonObject | undefined));
      }
    } else if (part.type === "image") {
      if (!capabilities.input?.includes("image")) {
        throw new Error(`OpenRouter request includes image but model does not declare image input capability`);
      }
      const url = part.url ?? (part.data ? `data:${part.mimeType ?? "image/png"};base64,${part.data}` : undefined);
      if (!url) throw new Error("OpenRouter image block missing url or data");
      content.push(withMarker({ type: "image_url", image_url: { url } }, part.cache_control as JsonObject | undefined));
    } else if (part.type === "audio" || part.type === "file" || part.type === "document") {
      rejectProviderMediaBlock(part, capabilities, model);
    } else if (part.type === "tool_call") {
      throw new Error("OpenRouter assistant tool_call blocks must be the only content on the message");
    } else if (part.type === "tool_result") {
      throw new Error("OpenRouter tool_result blocks must appear in role=tool messages");
    }
  }

  if (content.length === 1 && content[0]!.type === "text" && !(content[0]! as { cache_control?: unknown }).cache_control) {
    return clean({ role: message.role, content: content[0]!.text, reasoning: reasoningField });
  }
  if (content.length === 0 && reasoningField) {
    return clean({ role: message.role, content: null, reasoning: reasoningField });
  }
  return clean({ role: message.role, content, reasoning: reasoningField });
}

function withMarker(item: JsonObject, marker: JsonObject | undefined): JsonObject {
  return marker ? { ...item, cache_control: marker } : item;
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}

function cleanHeaders(value: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Record<string, string>;
}
