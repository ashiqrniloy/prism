import type { JsonObject, ModelProvider, ProviderEvent, ProviderRequest, Usage } from "../contracts.js";
import type { SecretSource } from "./provider-package.js";
import { providerError } from "../models/events.js";
import { trimTrailingSlashes } from "../trim-trailing-slashes.js";
import { type AnthropicMessagesRouteHooks, anthropicMessagesBody, anthropicMessagesEvents } from "./codecs/anthropic-messages.js";
import { type OpenAIChatCodecOptions, openAIChatBody, openAIChatEvents } from "./codecs/openai-chat.js";
import { type OpenAIResponsesCodecOptions, openAIResponsesBody, openAIResponsesEvents } from "./codecs/openai-responses.js";
import { ProviderRequirementError } from "./provider-request-policy.js";
import { createToolNameMap } from "./tool-names.js";
import { httpStatusError, readBoundedResponseText } from "./transport.js";

/** Route definition for a multi-route or single-route provider. */
export type RoutedProviderFormat = "openai-chat" | "anthropic-messages" | "openai-responses";

export interface RoutedProviderRoute<TFormat extends RoutedProviderFormat = RoutedProviderFormat> {
  readonly format: TFormat;
  readonly path: string;
  readonly auth?: "bearer" | "x-api-key+bearer" | "api-key" | "none";
  readonly headers?: (request: ProviderRequest) => Record<string, string>;
  readonly affinity?: (request: ProviderRequest) => Record<string, string>;
  readonly codec?: TFormat extends "openai-chat"
    ? OpenAIChatCodecOptions
    : TFormat extends "openai-responses"
      ? OpenAIResponsesCodecOptions
      : AnthropicMessagesRouteHooks;
  readonly mapHttpError?: (response: Response, bodyText: string, secrets: readonly (string | undefined)[]) => Error;
  readonly mapUsage?: (usage: unknown, chunk?: JsonObject) => Usage | undefined;
  /** Custom URL builder overriding `${baseUrl}${path}`. */
  readonly url?: (request: ProviderRequest, baseUrl: string) => string;
}

/** Options for configuring a routed provider. */
export interface RoutedProviderOptions {
  readonly id?: string;
  readonly baseUrl: string;
  readonly apiKey?: SecretSource;
  /** Resolves the credential per request. Takes precedence over `apiKey`. */
  readonly resolveApiKey?: (request: ProviderRequest) => string | undefined | Promise<string | undefined>;
  readonly fetch?: typeof fetch;
  readonly routes: Record<string, RoutedProviderRoute>;
  /** Selects route key for request. Defaults to `request.model.compat.route` falling back to first route. */
  readonly routeFor?: (request: ProviderRequest) => string;
  readonly require?: {
    /** Fail closed before any fetch if `request.options?.sessionId` is missing or empty. */
    readonly sessionId?: boolean;
  };
  readonly extraHeaders?: (request: ProviderRequest) => Record<string, string>;
  readonly requestFailedPrefix?: string;
  readonly mapHttpError?: (response: Response, bodyText: string, secrets: readonly (string | undefined)[]) => Error;
  readonly mapUsage?: (usage: unknown, chunk?: JsonObject) => Usage | undefined;
  readonly secrets?: (request: ProviderRequest) => readonly (string | undefined)[];
}

/** A routed provider that can also show the request body it would send, without a key or a network call. */
export interface RoutedProvider extends ModelProvider {
  /**
   * Serialize `request` with the same route selection and codec `generate` uses, and return the JSON
   * body. No key is resolved and nothing is sent. Prefix-stability conformance (`encode` option)
   * compares these bodies segment by segment.
   */
  encode(request: ProviderRequest): Promise<JsonObject>;
}

/** Pre-flight check asserting that an abort signal is not aborted. */
export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error("aborted");
}

/** Resolves an API key from the per-request resolver, else the `SecretSource`. */
export async function resolveProviderApiKey(
  source: SecretSource | undefined,
  resolveCustom?: (request: ProviderRequest) => string | undefined | Promise<string | undefined>,
  request?: ProviderRequest,
): Promise<string | undefined> {
  if (resolveCustom && request) {
    return resolveCustom(request);
  }
  return source?.();
}

/**
 * Creates a ModelProvider that dispatches across protocol routes (OpenAI Chat,
 * Anthropic Messages, OpenAI Responses) based on model/request configuration.
 */
export function createRoutedProvider(options: RoutedProviderOptions): RoutedProvider {
  const providerId = options.id ?? "routed-provider";
  const baseUrl = trimTrailingSlashes(options.baseUrl);

  /** Route selection shared by `generate` and `encode`. */
  const selectRoute = (request: ProviderRequest): { readonly routeKey: string; readonly route: RoutedProviderRoute } => {
    const routeKeys = Object.keys(options.routes);
    if (routeKeys.length === 0) {
      throw new ProviderRequirementError(`Provider '${providerId}' has no routes configured`, { providerId, requirement: "route" });
    }
    let routeKey: string;
    if (options.routeFor) {
      routeKey = options.routeFor(request);
    } else {
      const compatRoute = request.model.compat?.route;
      routeKey = typeof compatRoute === "string" && compatRoute.trim() ? compatRoute.trim() : routeKeys[0]!;
    }
    const route = options.routes[routeKey];
    if (!route) {
      throw new ProviderRequirementError(`Unknown route '${routeKey}' for provider '${providerId}'`, { providerId, requirement: "route" });
    }
    return { routeKey, route };
  };

  /** Codec body serialization shared by `generate` and `encode`. */
  const serializeBody = async (
    routeKey: string,
    route: RoutedProviderRoute,
    request: ProviderRequest,
    toolNames: ReturnType<typeof createToolNameMap>,
  ): Promise<JsonObject> => {
    if (route.format === "anthropic-messages") {
      return anthropicMessagesBody(request, { ...(route.codec as AnthropicMessagesRouteHooks | undefined), toolNames });
    }
    if (route.format === "openai-chat") {
      return openAIChatBody(request, { ...(route.codec as OpenAIChatCodecOptions | undefined), toolNames });
    }
    if (route.format === "openai-responses") {
      return openAIResponsesBody(request, { ...(route.codec as OpenAIResponsesCodecOptions | undefined), toolNames });
    }
    throw new ProviderRequirementError(`Unsupported route format '${(route as any).format}' for route '${routeKey}'`, {
      providerId,
      requirement: "route",
    });
  };

  return {
    id: providerId,
    async encode(request: ProviderRequest): Promise<JsonObject> {
      const { routeKey, route } = selectRoute(request);
      return serializeBody(routeKey, route, request, createToolNameMap(request.tools));
    },
    async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      // 1. Abort pre-check (synchronous check before any work)
      assertNotAborted(request.signal);

      // 2. Pre-fetch requirement checks (e.g. require.sessionId)
      if (options.require?.sessionId) {
        const sessionId = request.options?.sessionId;
        if (!sessionId || typeof sessionId !== "string" || !sessionId.trim()) {
          throw new ProviderRequirementError(`Provider '${providerId}' requires session correlation (options.sessionId)`, {
            providerId,
            requirement: "sessionId",
          });
        }
      }

      // 3. Route selection
      const { routeKey, route } = selectRoute(request);

      let apiKey: string | undefined;
      const secrets: (string | undefined)[] = [];

      try {
        // 4. Key resolution (resolved once per request)
        apiKey = await resolveProviderApiKey(options.apiKey, options.resolveApiKey, request);
        secrets.push(apiKey);
        if (options.secrets) {
          secrets.push(...options.secrets(request));
        }

        // 5. Codec body serialization. One map serializes the tool list and decodes the reply, so
        // dotted product names (`memory.recall`) become wire-safe without ambiguity.
        const toolNames = createToolNameMap(request.tools);
        const body = await serializeBody(routeKey, route, request, toolNames);

        // 6. Header assembly
        // Caller headers first, then extra/route headers, and provider-owned headers win last.
        const headers: Record<string, string> = {};
        if (request.options?.headers) {
          for (const [key, value] of Object.entries(request.options.headers)) {
            if (typeof value === "string") {
              headers[key] = value;
            }
          }
        }
        const applyOwned = (incoming?: Record<string, string>) => {
          if (!incoming) return;
          for (const [key, value] of Object.entries(incoming)) {
            const lower = key.toLowerCase();
            for (const existing of Object.keys(headers)) {
              if (existing.toLowerCase() === lower) {
                delete headers[existing];
              }
            }
            headers[key] = value;
          }
        };

        if (options.extraHeaders) {
          applyOwned(options.extraHeaders(request));
        }
        if (route.headers) {
          applyOwned(route.headers(request));
        }
        if (route.affinity) {
          applyOwned(route.affinity(request));
        } else if ((route.codec as any)?.affinity) {
          applyOwned((route.codec as any).affinity(request));
        }

        // Strip any casing of provider-owned header names from caller so provider-owned values cannot be shadowed
        for (const key of Object.keys(headers)) {
          const lower = key.toLowerCase();
          if (
            lower === "content-type" ||
            lower === "authorization" ||
            lower === "x-api-key" ||
            lower === "api-key" ||
            lower === "anthropic-version"
          ) {
            delete headers[key];
          }
        }

        // Apply provider-owned auth and content-type headers
        headers["content-type"] = "application/json";
        const auth = route.auth ?? "bearer";
        if (apiKey) {
          if (auth === "bearer") {
            headers.authorization = `Bearer ${apiKey}`;
          } else if (auth === "x-api-key+bearer") {
            headers.authorization = `Bearer ${apiKey}`;
            headers["x-api-key"] = apiKey;
            headers["anthropic-version"] = "2023-06-01";
          } else if (auth === "api-key") {
            headers["api-key"] = apiKey;
          }
        }

        // 7. Determine request URL
        const url = route.url ? route.url(request, baseUrl) : `${baseUrl}${route.path.startsWith("/") ? "" : "/"}${route.path}`;

        // 8. Fetch
        const fetchImpl = options.fetch ?? fetch;
        const response = await fetchImpl(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: request.signal,
        });

        // 9. Handle non-2xx status
        if (!response.ok) {
          const bodyText = await readBoundedResponseText(response, { secrets });
          const error = route.mapHttpError
            ? route.mapHttpError(response, bodyText, secrets)
            : options.mapHttpError
              ? options.mapHttpError(response, bodyText, secrets)
              : httpStatusError(options.requestFailedPrefix ?? `${providerId} request failed`, response, bodyText);
          yield providerError(error, secrets);
          return;
        }

        // 10. Check empty body
        if (!response.body) {
          yield providerError(new Error(`${providerId} response had no body`), secrets);
          return;
        }

        // 11. Stream decoding dispatch
        const mapUsage = route.mapUsage ?? options.mapUsage;
        if (route.format === "anthropic-messages") {
          yield* anthropicMessagesEvents(response.body, {
            signal: request.signal,
            secrets,
            mapUsage,
            toolNames,
          });
        } else if (route.format === "openai-responses") {
          const codec = route.codec as OpenAIResponsesCodecOptions | undefined;
          yield* openAIResponsesEvents(response.body, {
            signal: request.signal,
            provider: providerId,
            strictCompletion: codec?.strictCompletion ?? true,
            mapUsage,
            secrets,
            toolNames,
          });
        } else {
          const codec = route.codec as OpenAIChatCodecOptions | undefined;
          yield* openAIChatEvents(response.body, {
            signal: request.signal,
            strictCompletion: codec?.strictCompletion ?? true,
            doneUsage: codec?.doneUsage,
            mapUsage,
            onComment: codec?.onComment,
            secrets,
            toolNames,
          });
        }
      } catch (error) {
        yield providerError(error, secrets);
      }
    },
  };
}
