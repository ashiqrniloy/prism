import type { AIProvider, JsonObject, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { type CredentialValueSource, trimTrailingSlashes } from "@arnilo/prism";
import { applyOpenAIChatStructuredOutput } from "@arnilo/prism/providers/openai";
import { buildOpenAIChatBody, createOpenAICompatibleProvider, openAIChatEvents } from "@arnilo/prism/providers/openai-compatible";
import { CLINEPASS_DEFAULT_BASE_URL } from "./models.js";
import { clinePassReasoningEffort } from "./thinking.js";

export { CLINEPASS_DEFAULT_BASE_URL };

export interface ClinePassProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

export function createClinePassProvider(options: ClinePassProviderOptions = {}): AIProvider {
  return createOpenAICompatibleProvider({
    id: options.id ?? "clinepass",
    baseUrl: trimTrailingSlashes(options.baseUrl ?? CLINEPASS_DEFAULT_BASE_URL),
    apiKey: options.apiKey,
    fetch: options.fetch,
    doneUsage: true,
    requestFailedPrefix: "ClinePass request failed",
    transformBody: (body, request) => clinePassTransform(body, request),
  });
}

export function clinePassBody(request: ProviderRequest): JsonObject {
  return buildOpenAIChatBody(request, {
    transformBody: (body, req) => clinePassTransform(body, req),
  });
}

export function clinePassEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
  return openAIChatEvents(body, { signal, doneUsage: true });
}

function clinePassTransform(body: JsonObject, request: ProviderRequest): JsonObject {
  const { maxTokens, max_tokens: _maxTokens, cache_control: _cacheControl, ...rest } = body as Record<string, unknown>;
  const transformed: Record<string, unknown> = {
    ...rest,
    stream: true,
    max_completion_tokens: maxTokens ?? request.model.limits?.maxOutputTokens,
    ...request.options?.extra,
    reasoning_effort: clinePassReasoningEffort(request),
  };
  applyOpenAIChatStructuredOutput(transformed, request.options?.structuredOutput);
  return clean(transformed);
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}
