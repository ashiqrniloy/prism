import type { CredentialValueSource, ModelProvider, ProviderRequest } from "@arnilo/prism";
import { trimTrailingSlashes } from "@arnilo/prism";
import {
  createRoutedProvider,
  DEFAULT_MAX_BUFFER_BYTES,
  ProviderRequirementError,
  type RoutedProviderRoute,
} from "@arnilo/prism/provider-kit";
import { OLLAMA_CLOUD_DEFAULT_BASE_URL, type OllamaCloudRoute } from "./models.js";
import { ollamaCloudNativeEvents, stripJsonFence } from "./native.js";

/** Native NDJSON route; the default. */
export const OLLAMA_CLOUD_NATIVE_ROUTE = { format: "native", path: "/api/chat" } as const;

/** OpenAI-compatible route used by pi-ollama-cloud. */
export const OLLAMA_CLOUD_CHAT_ROUTE: RoutedProviderRoute<"openai-chat"> = {
  format: "openai-chat",
  path: "/v1/chat/completions",
  auth: "bearer",
  codec: {
    maxTokensField: "max_tokens",
    imageInput: "capability-gated",
    // The cloud does not expose thinking on this route (Task 1), so there is no trace worth replaying.
    reasoningReplay: "drop",
  },
};

export interface OllamaCloudProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  /** Provider-wide default; a model's `compat.route` wins. */
  readonly route?: OllamaCloudRoute;
  readonly fetch?: typeof fetch;
}

/** Chooses the wire per request: per-model `compat.route`, then the package config, then native. */
export function routeForOllamaCloudRequest(request: ProviderRequest, fallback: OllamaCloudRoute = "native"): OllamaCloudRoute {
  const route = request.model.compat?.route;
  return route === "native" || route === "openai" ? route : fallback;
}

export function createOllamaCloudProvider(options: OllamaCloudProviderOptions = {}): ModelProvider {
  const id = options.id ?? "ollama-cloud";
  const baseUrl = trimTrailingSlashes(options.baseUrl ?? OLLAMA_CLOUD_DEFAULT_BASE_URL);
  const route = options.route ?? "native";
  const compat = createRoutedProvider({
    id,
    baseUrl,
    apiKey: options.apiKey,
    fetch: options.fetch,
    routeFor: () => "openai",
    routes: { openai: OLLAMA_CLOUD_CHAT_ROUTE },
  });

  return {
    id,
    async *generate(request: ProviderRequest) {
      const selected = routeForOllamaCloudRequest(request, route);
      if (selected === "native") {
        yield* ollamaCloudNativeEvents(request, { id, baseUrl, apiKey: options.apiKey, fetch: options.fetch });
        return;
      }
      if (selected === "openai") {
        if (request.options?.structuredOutput === undefined) {
          yield* compat.generate(request);
          return;
        }
        // The cloud fences structured JSON on this route too, so hold the text back and strip it
        // once, keeping the streaming contract for every other content type.
        let text = "";
        for await (const event of compat.generate(request)) {
          if (event.type === "content_delta" && event.content.type === "text") {
            text += event.content.text;
            if (new TextEncoder().encode(text).byteLength > DEFAULT_MAX_BUFFER_BYTES)
              throw new Error(`Ollama Cloud structured output exceeded ${DEFAULT_MAX_BUFFER_BYTES} bytes`);
            continue;
          }
          if (text) {
            yield { type: "content_delta", content: { type: "text", text: stripJsonFence(text) } } as const;
            text = "";
          }
          yield event;
        }
        return;
      }
      throw new ProviderRequirementError(`Unknown route '${String(selected)}' for provider '${id}'`, {
        providerId: id,
        requirement: "route",
      });
    },
  };
}
