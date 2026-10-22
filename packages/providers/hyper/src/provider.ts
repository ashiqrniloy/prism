import type { CredentialValueSource, JsonObject, ModelProvider, Usage } from "@arnilo/prism";
import {
  createRoutedProvider,
  mapOpenAIChatUsage,
  normalizeUsage,
  parseErrorBody,
  providerHttpError,
  readRetryAfterMs,
  RETRYABLE_STATUSES,
  type RoutedProviderRoute,
} from "@arnilo/prism/provider-kit";
import { HYPER_DEFAULT_BASE_URL, type HyperRoute, routeForHyperModel } from "./models.js";
import { parseHyperUsageCost } from "./telemetry.js";

export interface HyperProviderOptions {
  readonly id?: string;
  /** Defaults to official `https://hyper.charm.land/v1`. */
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

export const HYPER_CHAT_ROUTE: RoutedProviderRoute<"openai-chat"> = {
  format: "openai-chat",
  path: "/chat/completions",
  auth: "bearer",
  codec: {
    reasoningReplay: "reasoning_content",
    maxTokensField: "max_tokens",
  },
};

export const HYPER_MESSAGES_ROUTE: RoutedProviderRoute<"anthropic-messages"> = {
  format: "anthropic-messages",
  path: "/messages",
  auth: "x-api-key+bearer",
};

/**
 * Augments usage reporting with Hyper's monetization metadata and currency fields.
 */
export function withHyperCost(raw: unknown): Usage | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const isAnthropic = "input_tokens" in raw && !("prompt_tokens" in raw);
  const baseUsage = isAnthropic
    ? normalizeUsage({
        inputTokens: (raw as { input_tokens?: number }).input_tokens,
        inputTokensInclusive: false,
        outputTokens: (raw as { output_tokens?: number }).output_tokens,
        cacheReadTokens: (raw as { cache_read_input_tokens?: number }).cache_read_input_tokens,
        cacheWriteTokens: (raw as { cache_creation_input_tokens?: number }).cache_creation_input_tokens,
      })
    : mapOpenAIChatUsage(raw);

  const hyper = parseHyperUsageCost(raw);
  if (!hyper) return baseUsage;

  const hyperMetadata: JsonObject = {
    ...(hyper.usd !== undefined ? { usd: hyper.usd } : {}),
    ...(hyper.hypercredits !== undefined ? { hypercredits: hyper.hypercredits } : {}),
    ...(hyper.remainingHypercredits !== undefined ? { remainingHypercredits: hyper.remainingHypercredits } : {}),
  };

  const metadata: JsonObject = {
    ...(baseUsage?.metadata ?? {}),
    hyper: hyperMetadata,
  };

  return {
    ...(baseUsage ?? {}),
    ...(hyper.usd !== undefined ? { cost: hyper.usd, currency: "USD" } : {}),
    metadata,
  };
}

/**
 * Classifies Hyper HTTP error responses into redacted errors with HTTP status codes.
 * Treats 402 `billing_error` as a permanent, non-retryable error.
 */
function hyperHttpError(response: Response, bodyText: string, secrets: readonly (string | undefined)[]): Error {
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(bodyText);
  } catch {
    parsedBody = undefined;
  }
  const errorBody = parseErrorBody(parsedBody);
  const errorCode = typeof errorBody?.error?.code === "string" ? errorBody.error.code : undefined;
  const retryAfterMs = readRetryAfterMs(response.headers);
  const status = response.status;
  const retryable = RETRYABLE_STATUSES.has(status);

  return providerHttpError(
    "Hyper",
    {
      status,
      code: status,
      errorCode,
      retryAfterMs: retryable ? retryAfterMs : undefined,
    },
    bodyText,
    secrets,
  );
}

export function createHyperProvider(options: HyperProviderOptions = {}): ModelProvider {
  return createRoutedProvider({
    id: options.id ?? "hyper",
    baseUrl: options.baseUrl ?? HYPER_DEFAULT_BASE_URL,
    apiKey: options.apiKey,
    fetch: options.fetch,
    routeFor: (r) => (r.model.compat?.route as HyperRoute | undefined) ?? routeForHyperModel(r.model.model),
    routes: {
      openai: HYPER_CHAT_ROUTE,
      anthropic: HYPER_MESSAGES_ROUTE,
    },
    mapUsage: withHyperCost,
    mapHttpError: hyperHttpError,
  });
}
