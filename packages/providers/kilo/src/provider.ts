import type { JsonObject, ModelProvider, ProviderRequest, Usage } from "@arnilo/prism";
import {
  anthropicAdaptiveThinking,
  anthropicCacheEnabled,
  applyCacheControl,
  type CacheControlledMessage,
  createRoutedProvider,
  mapOpenAIChatUsage,
  normalizeUsage,
  providerHttpError,
  type RoutedProviderRoute,
  readRetryAfterMs,
  resolveReasoningObject,
  sanitizeCacheKey,
  type SecretSource,
} from "@arnilo/prism/provider-kit";
import { KILO_DEFAULT_BASE_URL, routeForKiloModel } from "./models.js";

/** `X-KILOCODE-TASKID` is a session key, not a prompt. The CLI sends it unclamped; Prism caps it. */
export const KILO_TASK_ID_MAX_LENGTH = 128;

export const KILO_TASK_ID_HEADER = "X-KILOCODE-TASKID";
export const KILO_ORGANIZATION_HEADER = "X-KILOCODE-ORGANIZATIONID";
export const KILO_MODE_HEADER = "x-kilocode-mode";

/** The affinity header every wire carries: the sanitized cache key or session id. */
export function kiloSession(request: ProviderRequest): Record<string, string> {
  const session = sanitizeCacheKey(request.options?.cacheKey ?? request.options?.sessionId, KILO_TASK_ID_MAX_LENGTH);
  return session ? { [KILO_TASK_ID_HEADER]: session } : {};
}

/**
 * Messages cache markers at the Kilo CLI's placement (first two system messages plus the
 * last two messages, at most four). The gateway also caches on its own, so this is parity
 * rather than a lever (plan 213 Task 1b).
 */
export function kiloMessagesCache(request: ProviderRequest): readonly CacheControlledMessage[] {
  if (!anthropicCacheEnabled(request)) return request.messages as readonly CacheControlledMessage[];
  const explicit = request.options?.cache?.breakpoints;
  if (explicit && explicit.length > 0) return applyCacheControl(request.messages, explicit, { maxBreakpoints: 4 });
  const messages = request.messages;
  const indices = new Set<number>();
  let systems = 0;
  messages.forEach((message, index) => {
    if (message.role === "system" && systems < 2) {
      indices.add(index);
      systems += 1;
    }
  });
  const tail = messages.length;
  for (const index of [tail - 1, tail - 2]) if (index >= 0) indices.add(index);
  return messages.map((message, index) => {
    if (!indices.has(index) || message.content.length === 0) return message as CacheControlledMessage;
    const content = message.content.map((block, blockIndex) =>
      blockIndex === message.content.length - 1 ? { ...block, cache_control: { type: "ephemeral" as const } } : block,
    );
    return { ...message, content };
  });
}

function kiloCost(usage: Record<string, unknown>): { cost?: number; metadata?: JsonObject } {
  const cost = usage.cost;
  const metadata: Record<string, string | number | boolean> = {};
  if (typeof usage.model === "string") metadata.model = usage.model;
  if (typeof usage.provider === "string") metadata.provider = usage.provider;
  if (typeof usage.is_byok === "boolean") metadata.isByok = usage.is_byok;
  return {
    ...(typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? { cost } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata: { kilo: metadata as JsonObject } } : {}),
  };
}

/** Chat usage: OpenAI shape plus Kilo's `cost` (USD, a number) and routing metadata. */
export function mapKiloChatUsage(raw: unknown, chunk?: JsonObject): Usage | undefined {
  const base = mapOpenAIChatUsage(raw);
  if (!base) return undefined;
  const extra = kiloCost({ ...(raw as Record<string, unknown>), ...(chunk ?? {}) });
  return {
    ...base,
    ...(extra.cost !== undefined ? { cost: extra.cost, currency: "USD" } : {}),
    ...((extra.metadata ?? base.metadata) ? { metadata: { ...(base.metadata ?? {}), ...(extra.metadata ?? {}) } } : {}),
  };
}

/** Responses usage: `input_tokens` is inclusive; `cost` appended by the gateway. */
export function mapKiloResponsesUsage(raw: unknown): Usage | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const wire = raw as Record<string, unknown>;
  const details = wire.input_tokens_details as { cached_tokens?: number } | undefined;
  const outputDetails = wire.output_tokens_details as { reasoning_tokens?: number } | undefined;
  const metadata: Record<string, number> = {};
  if (typeof outputDetails?.reasoning_tokens === "number" && outputDetails.reasoning_tokens > 0)
    metadata.reasoningTokens = outputDetails.reasoning_tokens;
  return normalizeUsage({
    inputTokens: wire.input_tokens as number | undefined,
    outputTokens: wire.output_tokens as number | undefined,
    totalTokens: wire.total_tokens as number | undefined,
    cacheReadTokens: details?.cached_tokens,
    inputTokensInclusive: true,
    ...(typeof wire.cost === "number" && Number.isFinite(wire.cost) && wire.cost >= 0 ? { cost: wire.cost, currency: "USD" } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata: { kilo: metadata as JsonObject } } : {}),
  });
}

/** Messages usage: Anthropic shape (exclusive input) plus `cost` and `is_byok`. */
export function mapKiloMessagesUsage(raw: unknown): Usage | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const wire = raw as Record<string, unknown>;
  const details = wire.output_tokens_details as { thinking_tokens?: number } | undefined;
  const metadata: Record<string, number | boolean> = {};
  if (typeof details?.thinking_tokens === "number" && details.thinking_tokens > 0) metadata.thinkingTokens = details.thinking_tokens;
  if (typeof wire.is_byok === "boolean") metadata.isByok = wire.is_byok;
  return normalizeUsage({
    inputTokens: wire.input_tokens as number | undefined,
    outputTokens: wire.output_tokens as number | undefined,
    cacheReadTokens: typeof wire.cache_read_input_tokens === "number" ? wire.cache_read_input_tokens : undefined,
    cacheWriteTokens: typeof wire.cache_creation_input_tokens === "number" ? wire.cache_creation_input_tokens : undefined,
    inputTokensInclusive: false,
    ...(typeof wire.cost === "number" && Number.isFinite(wire.cost) && wire.cost >= 0 ? { cost: wire.cost, currency: "USD" } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata: { kilo: metadata as JsonObject } } : {}),
  });
}

/** Kilo's error bodies with the vendor hint ahead of the recorded text (plan 213 Task 1b). */
export function kiloHttpError(response: Response, bodyText: string, secrets: readonly (string | undefined)[]): Error {
  let hint = "";
  if (response.status === 401)
    hint = "Check the KILO_API_KEY ref and keyring:kilo login; run the kilo login again. A device token cannot refresh. ";
  if (response.status === 402) hint = "Add Kilo credits; :free models stay reachable without credit. ";
  if (response.status === 403) hint = "The model is not allowed by the organization's policy. ";
  if (response.status === 429) hint = "Kilo's free models are limited to 200 requests per hour. ";
  if (response.status === 400 && /maximum context length|context_length_exceeded/i.test(bodyText) === false)
    hint = "The model is served by a different route; compat.route or routeForKiloModel picks the wire. ";
  // A billing link is shown only when it points at Kilo; anything else in the body is dropped.
  const body =
    response.status === 402
      ? bodyText.replace(/("buyCreditsUrl"\s*:\s*")([^"]*)(")/g, (match, head, url, tail) =>
          /^https:\/\/(?:[A-Za-z0-9-]+\.)*kilo\.ai(?:\/|$)/.test(url) ? match : `${head}[redacted]${tail}`,
        )
      : bodyText;
  const error = providerHttpError(
    "Kilo",
    { status: response.status, code: response.status, retryAfterMs: readRetryAfterMs(response.headers) },
    hint + body,
    secrets,
  );
  if (response.status === 413) {
    // A 413 is a byte-limit refusal, never context overflow, even if the body says "too long".
    Object.defineProperty(error, "failureClass", { value: "permanent", enumerable: true });
  }
  return error;
}

export interface KiloProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: SecretSource;
  /** Resolves the key then the login credential, per request. */
  readonly resolveApiKey?: (request: ProviderRequest) => string | undefined | Promise<string | undefined>;
  readonly organizationId?: string;
  readonly dataCollection?: "allow" | "deny";
  readonly mode?: string;
  readonly fetch?: typeof fetch;
}

/**
 * The Kilo CLI sends no `prompt_cache_key` on Responses; the gateway places its own
 * breakpoints (plan 213 Task 1b). The shared codec would otherwise derive one from the session.
 */
function kiloResponsesBody(body: JsonObject): JsonObject {
  const { prompt_cache_key: _key, ...rest } = body;
  return rest;
}

export const KILO_CHAT_ROUTE: RoutedProviderRoute<"openai-chat"> = {
  format: "openai-chat",
  path: "/chat/completions",
  auth: "bearer",
  affinity: kiloSession,
  codec: {
    reasoningReplay: "reasoning_details",
    reasoningObject: resolveReasoningObject,
    imageInput: "capability-gated",
  },
  mapUsage: mapKiloChatUsage,
};

export const KILO_RESPONSES_ROUTE: RoutedProviderRoute<"openai-responses"> = {
  format: "openai-responses",
  path: "/responses",
  auth: "bearer",
  affinity: kiloSession,
  mapUsage: mapKiloResponsesUsage,
  codec: { store: false, transformBody: kiloResponsesBody },
};

export const KILO_MESSAGES_ROUTE: RoutedProviderRoute<"anthropic-messages"> = {
  format: "anthropic-messages",
  path: "/messages",
  auth: "x-api-key+bearer",
  affinity: kiloSession,
  mapUsage: mapKiloMessagesUsage,
  codec: { applyCacheControl: kiloMessagesCache, thinking: anthropicAdaptiveThinking },
};

export function createKiloProvider(options: KiloProviderOptions = {}): ModelProvider {
  const provider = createRoutedProvider({
    id: options.id ?? "kilo",
    baseUrl: options.baseUrl ?? KILO_DEFAULT_BASE_URL,
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
    ...(options.resolveApiKey !== undefined ? { resolveApiKey: options.resolveApiKey } : {}),
    fetch: options.fetch,
    extraHeaders: (request) => ({
      ...(options.organizationId ? { [KILO_ORGANIZATION_HEADER]: options.organizationId } : {}),
      ...(options.mode && request.model.model.startsWith("kilo-auto/") ? { [KILO_MODE_HEADER]: options.mode } : {}),
    }),
    routeFor: (request) => routeForKiloModel(request.model),
    routes: { chat: KILO_CHAT_ROUTE, responses: KILO_RESPONSES_ROUTE, messages: KILO_MESSAGES_ROUTE },
    mapHttpError: kiloHttpError,
  });
  const dataCollection = options.dataCollection;
  if (!dataCollection) return provider;
  return {
    ...provider,
    generate(request) {
      const extra = { ...(request.options?.extra ?? {}), provider: { data_collection: dataCollection } };
      return provider.generate({ ...request, options: { ...request.options, extra } });
    },
  };
}

export { kiloSession as kiloTaskId };
