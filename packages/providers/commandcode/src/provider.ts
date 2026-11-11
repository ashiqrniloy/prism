import type { JsonObject, ModelProvider, ProviderRequest } from "@arnilo/prism";
import {
  anthropicAdaptiveThinking,
  createRoutedProvider,
  providerHttpError,
  type RoutedProviderRoute,
  readRetryAfterMs,
  sanitizeCacheKey,
  type SecretSource,
} from "@arnilo/prism/provider-kit";
import { COMMAND_CODE_DEFAULT_BASE_URL, type CommandCodeRoute, routeForCommandCodeModel } from "./models.js";

/** `x-client-request-id` / `prompt_cache_key` input cap (a session id, not a prompt). */
export const COMMAND_CODE_SESSION_ID_MAX_LENGTH = 128;

/** Header that asks Command Code to route the request to a zero-data-retention upstream. */
export const COMMAND_CODE_ZDR_HEADER = "x-cmd-zdr";

/**
 * Derives the `x-client-request-id` affinity header from the sanitized cacheKey or sessionId.
 * The Responses wire uses it as its stickiness hint; the header itself is not length-clamped
 * (`prompt_cache_key` is the clamped field — see the route codec).
 */
export function commandCodeSession(request: ProviderRequest): Record<string, string> {
  const session = sanitizeCacheKey(request.options?.cacheKey ?? request.options?.sessionId, COMMAND_CODE_SESSION_ID_MAX_LENGTH);
  return session ? { "x-client-request-id": session } : {};
}

/** The adaptive Messages hook now lives in provider-kit (plan 213 Task 2); this name stays public. */
export function commandCodeThinking(request: ProviderRequest): JsonObject | undefined {
  return anthropicAdaptiveThinking(request);
}

export const COMMAND_CODE_CHAT_ROUTE: RoutedProviderRoute<"openai-chat"> = {
  format: "openai-chat",
  path: "/chat/completions",
  auth: "bearer",
  codec: {
    maxTokensField: "max_tokens",
    // Measured: reasoning arrives as `delta.reasoning` + `reasoning_details[]`; replay the
    // recorded items unchanged so a multi-turn thinking session keeps its trace.
    reasoningReplay: "reasoning_details",
    imageInput: "capability-gated",
  },
};

export const COMMAND_CODE_RESPONSES_ROUTE: RoutedProviderRoute<"openai-responses"> = {
  format: "openai-responses",
  path: "/responses",
  auth: "bearer",
  affinity: commandCodeSession,
  codec: {
    store: false,
    // 64 is the codec default; named so parity runs can cite it.
    promptCacheKeyMax: 64,
  },
};

export const COMMAND_CODE_MESSAGES_ROUTE: RoutedProviderRoute<"anthropic-messages"> = {
  format: "anthropic-messages",
  path: "/messages",
  auth: "x-api-key+bearer",
  codec: { thinking: commandCodeThinking },
};

export interface CommandCodeProviderOptions {
  readonly id?: string;
  /** Defaults to official `https://api.commandcode.ai/provider/v1`. */
  readonly baseUrl?: string;
  readonly apiKey?: SecretSource;
  /** Adds the provider-owned `x-cmd-zdr: 1` header on every route. */
  readonly zdr?: boolean;
  readonly fetch?: typeof fetch;
}

/**
 * Maps a failed Provider API response through the shared classifier, with the vendor's
 * own remediation in front of the recorded body (plan 205 Task 2, error table).
 */
export function commandCodeHttpError(response: Response, bodyText: string, secrets: readonly (string | undefined)[]): Error {
  let hint = "";
  if (response.status === 401) hint = "Check the COMMAND_CODE_API_KEY ref and that the key is active. ";
  if (response.status === 403 && /upgrade_required/i.test(bodyText))
    hint = "This plan has no Provider API access; upgrade the plan or use another provider. ";
  if (response.status === 422 && /cmd_zdr_no_providers/i.test(bodyText))
    hint =
      "The zdr flag requires a zero-data-retention upstream this model does not have: set zdr: false or choose a model that declares one. ";
  if (response.status === 400 && /must be called via|is not supported on this endpoint/i.test(bodyText))
    hint = "The model is served by a different route; compat.route or routeForCommandCodeModel picks the wire. ";
  return providerHttpError(
    "Command Code",
    { status: response.status, code: response.status, retryAfterMs: readRetryAfterMs(response.headers) },
    hint + bodyText,
    secrets,
  );
}

export function createCommandCodeProvider(options: CommandCodeProviderOptions = {}): ModelProvider {
  return createRoutedProvider({
    id: options.id ?? "commandcode",
    baseUrl: options.baseUrl ?? COMMAND_CODE_DEFAULT_BASE_URL,
    apiKey: options.apiKey,
    fetch: options.fetch,
    extraHeaders: () => (options.zdr ? { [COMMAND_CODE_ZDR_HEADER]: "1" } : ({} as Record<string, string>)),
    routeFor: (request) => {
      const route = (request.model.compat?.route as CommandCodeRoute | undefined) ?? routeForCommandCodeModel(request.model.model);
      return route === "openai" && request.model.model === "reflection/beam:free" ? "beam" : route;
    },
    routes: {
      openai: COMMAND_CODE_CHAT_ROUTE,
      beam: { ...COMMAND_CODE_CHAT_ROUTE, codec: { ...COMMAND_CODE_CHAT_ROUTE.codec, reasoningReplay: "reasoning_content" } },
      responses: COMMAND_CODE_RESPONSES_ROUTE,
      anthropic: COMMAND_CODE_MESSAGES_ROUTE,
    },
    mapHttpError: commandCodeHttpError,
  });
}
