import type { AIProvider, CredentialValueSource, JsonObject, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { snapThinkingLevel } from "@arnilo/prism";
import { applyOpenAIChatStructuredOutput } from "@arnilo/prism/providers/openai";
import { buildOpenAIChatBody, createOpenAICompatibleProvider, openAIChatEvents } from "@arnilo/prism/providers/openai-compatible";
import { type OllamaBasePreset, ollamaBaseUrl } from "./models.js";

export interface OllamaProviderOptions {
  readonly id?: string;
  /** Explicit OpenAI-compatible base URL (wins over `preset`). */
  readonly baseUrl?: string;
  /** Named deployment preset; defaults to `cloud`. */
  readonly preset?: OllamaBasePreset;
  /** Ollama Cloud API key; omit for unauthenticated local `ollama serve`. */
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

/**
 * Ollama Chat Completions provider (`POST {base}/chat/completions`, OpenAI-compatible).
 * Works against Ollama Cloud (`https://ollama.com`, Bearer API key) and local
 * `ollama serve` (`http://localhost:11434`, typically unauthenticated).
 *
 * Caching: Ollama reuses its KV/prompt cache automatically; there is no request knob and
 * no cached-token count in usage, so `Usage.cacheReadTokens` is intentionally left
 * undefined (documented ceiling — see docs/providers/ollama.md).
 * @see https://docs.ollama.com/api/openai-compatibility
 */
export function createOllamaProvider(options: OllamaProviderOptions = {}): AIProvider {
  return createOpenAICompatibleProvider({
    id: options.id ?? "ollama",
    baseUrl: ollamaBaseUrl(options),
    apiKey: options.apiKey,
    fetch: options.fetch,
    strictCompletion: true,
    requestFailedPrefix: "Ollama request failed",
    transformBody: (body, request) => ollamaTransform(body, request),
  });
}

export function ollamaBody(request: ProviderRequest): JsonObject {
  return buildOpenAIChatBody(request, { transformBody: (body, req) => ollamaTransform(body, req) });
}

function ollamaTransform(body: JsonObject, request: ProviderRequest): JsonObject {
  const { maxTokens, ...rest } = body as Record<string, unknown>;
  const transformed: Record<string, unknown> = {
    ...rest,
    reasoning_effort: (rest.reasoning_effort as string | undefined) ?? ollamaReasoningEffort(request),
    max_tokens: maxTokens ?? request.model.limits?.maxOutputTokens,
    ...stripOllamaCompat(request.options?.compat as JsonObject | undefined),
    ...request.options?.extra,
  };
  applyOpenAIChatStructuredOutput(transformed, request.options?.structuredOutput);
  return clean(transformed);
}

export function ollamaEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
  return openAIChatEvents(body, { signal, strictCompletion: true });
}

/**
 * Ollama `reasoning_effort` top-level toggle (e.g. gpt-oss). Request
 * `options.compat.reasoning_effort` wins over the model default; snapped to the
 * model's declared set when stamped, passthrough otherwise. The native `think`
 * field (bool|low/medium/high/max) is a disjoint value set and is never emitted
 * by this package — OpenAI-compat endpoint only.
 */
export function ollamaReasoningEffort(request: ProviderRequest): string | undefined {
  const value = request.options?.compat?.reasoning_effort ?? request.model.compat?.reasoning_effort;
  if (typeof value !== "string" || !value.trim()) return undefined;
  return String(snapThinkingLevel(request.model, value.trim().toLowerCase()));
}

/** Strip provider-owned compat keys so the opaque spread cannot leak routing directives. */
function stripOllamaCompat(compat: JsonObject | undefined): JsonObject {
  if (!compat) return {};
  const { reasoning_effort: _effort, thinkingFamily: _family, route: _route, ollama: _meta, ...rest } = compat as Record<string, unknown>;
  return rest as JsonObject;
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && !(Array.isArray(item) && item.length === 0)),
  ) as JsonObject;
}
