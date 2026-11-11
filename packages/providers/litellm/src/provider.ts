import type { JsonObject, ModelProvider, ProviderEvent, ProviderRequest, Usage } from "@arnilo/prism";
import {
  createRoutedProvider,
  mapOpenAIChatUsage,
  providerHttpError,
  readRetryAfterMs,
  type RoutedProviderRoute,
  type SecretSource,
} from "@arnilo/prism/provider-kit";
import { LITELLM_CALL_ID_HEADER, type LiteLLMTelemetry, liteLLMUsageMetadata, readLiteLLMHeaders } from "./headers.js";
import { LITELLM_DEFAULT_BASE_URL } from "./models.js";

/** `request.metadata` key carrying the minted call id from the `generate` wrapper to the route header. */
export const LITELLM_CALL_ID_METADATA = "litellmCallId";

export interface LiteLLMProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: SecretSource;
  readonly fetch?: typeof fetch;
}

/**
 * Chat usage is the OpenAI shape. LiteLLM passes through the backend's own fields, so a
 * Messages-family backend reports the Anthropic cache fields at the top level of `usage`.
 */
export function mapLiteLLMUsage(raw: unknown, chunk?: JsonObject): Usage | undefined {
  const base = mapOpenAIChatUsage(raw);
  if (!base) return undefined;
  const wire = (raw ?? {}) as JsonObject;
  const details = (chunk ?? {}) as JsonObject;
  const cacheRead = typeof wire.cache_read_input_tokens === "number" ? wire.cache_read_input_tokens : undefined;
  const cacheWrite = typeof wire.cache_creation_input_tokens === "number" ? wire.cache_creation_input_tokens : undefined;
  // A backend that reports only the Anthropic top-level fields still counts them as cache, not fresh
  // input; the guard keeps the shared invariant cacheRead + cacheWrite <= input.
  const budget = (base.inputTokens ?? 0) - (base.cacheReadTokens ?? 0) - (base.cacheWriteTokens ?? 0);
  const read = base.cacheReadTokens ?? (cacheRead !== undefined && cacheRead <= budget ? cacheRead : undefined);
  const write = base.cacheWriteTokens ?? (cacheWrite !== undefined && cacheWrite <= budget - (read ?? 0) ? cacheWrite : undefined);
  const usage: Usage = {
    ...base,
    ...(read !== undefined ? { cacheReadTokens: read } : {}),
    ...(write !== undefined ? { cacheWriteTokens: write } : {}),
  };
  const reasoning = (details.completion_tokens_details as JsonObject | undefined)?.reasoning_tokens;
  return typeof reasoning === "number" && reasoning > 0
    ? { ...usage, metadata: { ...(usage.metadata ?? {}), litellm: { reasoningTokens: reasoning } } }
    : usage;
}

/** Body fields Prism never forwards: LiteLLM accepts them, the backends behind it mostly do not. */
function stripCacheParams(body: JsonObject): JsonObject {
  const { prompt_cache_key: _key, prompt_cache_retention: _retention, ...rest } = body;
  return rest;
}

/**
 * LiteLLM's error surface, mapped to the classes the kernel already understands (plan 214 Task 1b
 * recorded every status and body). Always through `providerHttpError` so the class comes from
 * `classifyProviderFailure`.
 */
export function litellmHttpError(response: Response, bodyText: string, secrets: readonly (string | undefined)[]): Error {
  let hint = "";
  if (response.status === 401) hint = "Check the LITELLM_API_KEY ref; the proxy rejected the key or has no master key. ";
  if (response.status === 400 && /invalid model name/i.test(bodyText))
    hint = "The model group is not configured in the proxy; see /model/info for the groups it serves. ";
  if (response.status === 422 && /budget/i.test(bodyText)) hint = "The LiteLLM key's budget is spent. ";
  if (response.status === 403) hint = "The proxy key may not use this model group, or the backend plan does not include it. ";
  if (response.status === 429) hint = "The proxy is out of deployments or the key hit its rate limit. ";
  // The proxy relays the backend's phrase verbatim. `context window limit` is the Workers AI wording
  // (Task 1b measured it on a 413); normalizing it here lets the shared classifier see an overflow
  // without a provider-kit change.
  // The proxy prints key fingerprints (`sk-...c0de`), including on a 429; they never reach a caller.
  const redacted = bodyText
    .replace(/\b(sk|pk|ak)-[A-Za-z0-9._*-]{3,}/g, "$1-[redacted]")
    .replace(/(Key Hash \(Token\)\s*=)\s*[A-Za-z0-9]+/gi, "$1[redacted]");
  const normalized = /context window limit/i.test(redacted)
    ? redacted.replace(/context window limit/gi, "maximum context length")
    : redacted;
  return providerHttpError(
    "LiteLLM",
    { status: response.status, code: response.status, retryAfterMs: readRetryAfterMs(response.headers) },
    hint + normalized,
    secrets,
  );
}

function callIdOf(request: ProviderRequest): string | undefined {
  const value = request.metadata?.[LITELLM_CALL_ID_METADATA];
  return typeof value === "string" && value ? value : undefined;
}

/**
 * One Chat route, plus the opt-in Anthropic-marker route. No body carries `cache_control` unless the
 * model says `compat.cacheControl: "anthropic-blocks"`; cache parity per backend is post-0.13.0.
 */
function chatRoute(cacheBlocks: boolean): RoutedProviderRoute<"openai-chat"> {
  return {
    format: "openai-chat",
    path: "/chat/completions",
    auth: "bearer",
    // Provider-owned: a caller cannot supply or override this header.
    headers: (request): Record<string, string> => {
      const callId = callIdOf(request);
      return callId ? { [LITELLM_CALL_ID_HEADER]: callId } : {};
    },
    mapUsage: mapLiteLLMUsage,
    mapHttpError: litellmHttpError,
    codec: {
      reasoningReplay: "reasoning_content",
      imageInput: "capability-gated",
      ...(cacheBlocks ? ({ cacheControl: "anthropic-blocks", cacheControlOnTools: true } as const) : {}),
      transformBody: stripCacheParams,
    },
  };
}

/**
 * The header seam (plan 214 Task 1 (a)): the shared route reads no response headers, so the provider
 * wraps `fetch` and keeps the `x-litellm-*` values keyed by the call id it minted for that request.
 * One map entry per in-flight call; `generate` deletes it in `finally`.
 */
export function createLiteLLMProvider(options: LiteLLMProviderOptions = {}): ModelProvider {
  const telemetry = new Map<string, LiteLLMTelemetry>();
  const fetchImpl = options.fetch ?? fetch;
  const observingFetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const callId = new Headers(init?.headers).get(LITELLM_CALL_ID_HEADER) ?? undefined;
    const response = await fetchImpl(input, init);
    if (callId) telemetry.set(callId, readLiteLLMHeaders(response.headers, callId));
    return response;
  }) as typeof fetch;

  const provider = createRoutedProvider({
    id: options.id ?? "litellm",
    baseUrl: options.baseUrl ?? LITELLM_DEFAULT_BASE_URL,
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
    fetch: observingFetch,
    routeFor: (request) => (request.model.compat?.cacheControl === "anthropic-blocks" ? "blocks" : "chat"),
    routes: { chat: chatRoute(false), blocks: chatRoute(true) },
  });

  const withTelemetry = (usage: Usage, callId: string): Usage => {
    const found = telemetry.get(callId);
    if (!found) return usage;
    return {
      ...usage,
      // The header is the proxy's own accounting. `0` is a real cost and is kept; absent means the
      // kernel prices from the catalog (streams carry no total cost header, measured in Task 1b).
      ...(usage.cost === undefined && found.responseCost !== undefined ? { cost: found.responseCost, currency: "USD" } : {}),
      metadata: {
        ...(usage.metadata ?? {}),
        litellm: {
          ...((usage.metadata?.litellm as JsonObject | undefined) ?? {}),
          ...(liteLLMUsageMetadata(found) as unknown as JsonObject),
        },
      },
    };
  };

  return {
    ...provider,
    async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      const callId = crypto.randomUUID();
      const tagged: ProviderRequest = {
        ...request,
        metadata: { ...(request.metadata ?? {}), [LITELLM_CALL_ID_METADATA]: callId },
      };
      try {
        for await (const event of provider.generate(tagged)) {
          if (event.type === "usage") {
            yield { type: "usage", usage: withTelemetry(event.usage, callId) };
          } else if (event.type === "done") {
            yield event.usage ? { ...event, usage: withTelemetry(event.usage, callId) } : event;
          } else if (event.type === "error") {
            // The id is the only handle a failed call leaves: the proxy writes its spend row under it.
            yield { type: "error", error: { ...event.error, message: `${event.error.message} (litellm call id ${callId})` } };
          } else {
            yield event;
          }
        }
      } finally {
        telemetry.delete(callId);
      }
    },
  };
}
