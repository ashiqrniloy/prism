import type { AIProvider, JsonObject, Message, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { type CredentialValueSource, trimTrailingSlashes } from "@arnilo/prism";
import { applyOpenAIChatStructuredOutput, serializeOpenAIChatMessage } from "@arnilo/prism/providers/openai";
import { buildOpenAIChatBody, createOpenAICompatibleProvider, openAIChatEvents } from "@arnilo/prism/providers/openai-compatible";
import { xGrokConvId } from "./cache.js";
import { XAI_DEFAULT_BASE_URL } from "./models.js";
import { xaiReplayThinking } from "./thinking.js";

export { XAI_DEFAULT_BASE_URL };

export interface XaiProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

export function createXaiProvider(options: XaiProviderOptions = {}): AIProvider {
  return createOpenAICompatibleProvider({
    id: options.id ?? "xai",
    baseUrl: trimTrailingSlashes(options.baseUrl ?? XAI_DEFAULT_BASE_URL),
    apiKey: options.apiKey,
    fetch: options.fetch,
    doneUsage: true,
    requestFailedPrefix: "xAI request failed",
    serializeMessage: (message, request) => toXaiMessage(message, request),
    extraHeaders: (request) => {
      const convId = xGrokConvId(request);
      const headers: Record<string, string> = {};
      if (convId) headers["x-grok-conv-id"] = convId;
      return headers;
    },
    transformBody: (body, request) => xaiTransform(body, request),
  });
}

export function xaiBody(request: ProviderRequest): JsonObject {
  return buildOpenAIChatBody(request, {
    serializeMessage: (message, req) => toXaiMessage(message, req),
    transformBody: (body, req) => xaiTransform(body, req),
  });
}

export function xaiEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
  return openAIChatEvents(body, { signal, doneUsage: true });
}

export function toXaiMessage(message: Message, request: ProviderRequest): JsonObject {
  if (!xaiReplayThinking(request)) {
    return serializeOpenAIChatMessage(message, request.model.capabilities ?? {});
  }
  const thinking = message.content.filter((part) => part.type === "thinking").map((part) => part.text);
  const reasoningContent = thinking.length > 0 ? thinking.join("\n") : undefined;
  const withoutThinking: Message = {
    ...message,
    content: message.content.filter((part) => part.type !== "thinking"),
  };
  return clean({
    ...serializeOpenAIChatMessage(withoutThinking, request.model.capabilities ?? {}),
    reasoning_content: reasoningContent,
  });
}

function xaiTransform(body: JsonObject, request: ProviderRequest): JsonObject {
  const { maxTokens, ...rest } = body as Record<string, unknown>;
  const transformed: Record<string, unknown> = {
    ...rest,
    max_tokens: maxTokens ?? request.model.limits?.maxOutputTokens,
    ...request.options?.extra,
  };
  applyOpenAIChatStructuredOutput(transformed, request.options?.structuredOutput);
  return clean(transformed);
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}
