import type { CredentialValueSource, JsonObject, ModelProvider, ProviderRequest, Usage } from "@arnilo/prism";
import {
  createRoutedProvider,
  mapOpenAIChatUsage,
  providerHttpError,
  readRetryAfterMs,
  resolveReasoningObject,
  sanitizeCacheKey,
  type RoutedProviderRoute,
} from "@arnilo/prism/provider-kit";
import { OPENROUTER_DEFAULT_BASE_URL } from "./models.js";

export interface OpenRouterRouting {
  readonly order?: readonly string[];
  readonly only?: readonly string[];
  readonly ignore?: readonly string[];
  readonly allow_fallbacks?: boolean;
  readonly require_parameters?: boolean;
  readonly data_collection?: "allow" | "deny";
  readonly zdr?: boolean;
  readonly sort?: "price" | "throughput" | "latency";
  readonly max_price?: { readonly prompt?: number; readonly completion?: number; readonly request?: number; readonly image?: number };
  readonly quantizations?: readonly string[];
}
export interface OpenRouterProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly appUrl?: string;
  readonly appTitle?: string;
  readonly routing?: OpenRouterRouting;
}

export function openrouterSession(request: ProviderRequest): Record<string, string> {
  const key = sanitizeCacheKey(request.options?.cacheKey ?? request.options?.sessionId, 256);
  return key ? { "x-session-id": key } : {};
}

export function mapOpenRouterUsage(raw: unknown, chunk?: JsonObject): Usage | undefined {
  const usage = mapOpenAIChatUsage(raw);
  if (!usage) return undefined;
  const wire = raw as JsonObject;
  const details = wire.completion_tokens_details as JsonObject | undefined;
  const metadata: Record<string, string | number> = {};
  if (typeof chunk?.model === "string") metadata.model = chunk.model;
  if (typeof chunk?.provider === "string") metadata.provider = chunk.provider;
  if (typeof chunk?.id === "string") metadata.generationId = chunk.id;
  if (typeof details?.reasoning_tokens === "number") metadata.reasoningTokens = details.reasoning_tokens;
  return {
    ...usage,
    ...(typeof wire.cost === "number" && Number.isFinite(wire.cost) && wire.cost >= 0 ? { cost: wire.cost, currency: "USD" } : {}),
    metadata: { openrouter: metadata },
  };
}

export function mapOpenRouterHttpError(response: Response, bodyText: string, secrets: readonly (string | undefined)[]): Error {
  let hint = "";
  if (response.status === 401) hint = "Check the OPENROUTER_API_KEY ref and API key permissions. ";
  if (response.status === 402) hint = "Add OpenRouter credits or increase the key budget. ";
  if (/data.policy|privacy|data.collection/i.test(bodyText))
    hint = "Check the account free-model privacy setting and routing.data_collection (or routing.zdr); no endpoint satisfies this policy. ";
  // The shared classifier recognizes quota text; OpenRouter calls it the free daily limit.
  if (response.status === 429 && /daily|per.day/i.test(bodyText)) hint += "Daily quota exhausted. ";
  return providerHttpError(
    "OpenRouter",
    { status: response.status, code: response.status, retryAfterMs: readRetryAfterMs(response.headers) },
    hint + bodyText,
    secrets,
  );
}

export function createOpenRouterProvider(options: OpenRouterProviderOptions = {}): ModelProvider {
  const route = (cache: boolean): RoutedProviderRoute<"openai-chat"> => ({
    format: "openai-chat",
    path: "/chat/completions",
    auth: "bearer",
    affinity: openrouterSession,
    headers: () => ({
      ...(options.appUrl ? { "HTTP-Referer": options.appUrl } : {}),
      ...(options.appTitle ? { "X-OpenRouter-Title": options.appTitle } : {}),
    }),
    mapUsage: mapOpenRouterUsage,
    mapHttpError: mapOpenRouterHttpError,
    codec: {
      reasoningReplay: "reasoning_details",
      preserveThinking: () => true,
      imageInput: "capability-gated",
      ...(cache ? ({ cacheControl: "anthropic-blocks", cacheControlOnTools: true } as const) : {}),
      reasoningEffort: () => undefined,
      thinkingObject: () => undefined,
      reasoningObject: resolveReasoningObject,
      transformBody: (body) => {
        const { prompt_cache_key: _key, prompt_cache_retention: _retention, ...rest } = body;
        return { ...rest, ...(options.routing ? { provider: options.routing as unknown as JsonObject } : {}) };
      },
    },
  });
  const provider = createRoutedProvider({
    id: options.id ?? "openrouter",
    baseUrl: options.baseUrl ?? OPENROUTER_DEFAULT_BASE_URL,
    apiKey: options.apiKey,
    fetch: options.fetch,
    routeFor: (request) => (request.model.compat?.cacheControl === "anthropic-blocks" ? "blocks" : "chat"),
    routes: { chat: route(false), blocks: route(true) },
  });
  return {
    ...provider,
    generate(request) {
      // Attribution describes this configured app, never caller-supplied header values.
      const headers = Object.fromEntries(
        Object.entries(request.options?.headers ?? {}).filter(
          ([name]) => !["http-referer", "x-openrouter-title"].includes(name.toLowerCase()),
        ),
      );
      return provider.generate({ ...request, options: { ...request.options, headers } });
    },
  };
}
