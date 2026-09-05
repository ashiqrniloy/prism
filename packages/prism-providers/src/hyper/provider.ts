import type { AIProvider, CredentialValueSource, ProviderRequest } from "@arnilo/prism";
import { providerError, resolveCredentialValue, trimTrailingSlashes } from "@arnilo/prism";
import { readBoundedResponseText } from "@arnilo/prism/providers/transport";
import { createOpenAIResponsesProvider } from "../openai/responses.js";
import { type AnthropicMessagesRouteHooks, anthropicMessagesBody, anthropicMessagesEvents } from "../shared/anthropic-messages.js";
import { applyHyperAnthropicCacheControl } from "./cache.js";
import { HYPER_DEFAULT_BASE_URL, type HyperRoute } from "./models.js";
import { hyperChatBody, hyperChatEvents } from "./openai-chat.js";
import { classifyHyperError, hyperHttpError } from "./retry.js";
import { hyperPreserveThinking, stripHyperOwnedCompat } from "./thinking.js";

export interface HyperProviderOptions {
  readonly id?: string;
  /** Defaults to official `https://hyper.charm.land/v1`. */
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

const HYPER_ANTHROPIC_HOOKS: AnthropicMessagesRouteHooks = {
  applyCacheControl: applyHyperAnthropicCacheControl,
  preserveThinking: hyperPreserveThinking,
  stripOwnedCompat: stripHyperOwnedCompat,
};

export function createHyperProvider(options: HyperProviderOptions = {}): AIProvider {
  const id = options.id ?? "hyper";
  const baseUrl = trimTrailingSlashes(options.baseUrl ?? HYPER_DEFAULT_BASE_URL);
  // Third route: Codex-style `/v1/responses` OpenAI-standard pass-through,
  // reusing the OpenAI package's Responses machinery wholesale (body, stream,
  // usage, continuation, media) with Hyper's base URL and auth header.
  const responsesProvider = createOpenAIResponsesProvider({
    id,
    baseUrl,
    apiKey: options.apiKey,
    fetch: options.fetch,
    label: "Hyper",
  });
  return {
    id,
    async *generate(request) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
      if (routeFor(request) === "responses") {
        yield* responsesProvider.generate(request);
        return;
      }
      let token: string | undefined;
      const secrets: (string | undefined)[] = [];
      try {
        const route = routeFor(request);
        const body = route === "anthropic" ? await anthropicMessagesBody(request, HYPER_ANTHROPIC_HOOKS) : hyperChatBody(request);
        token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
        secrets.push(token);
        const response = await (options.fetch ?? fetch)(`${baseUrl}${route === "anthropic" ? "/messages" : "/chat/completions"}`, {
          method: "POST",
          headers: {
            ...request.options?.headers,
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            // Provider-owned Anthropic-route auth: `x-api-key` + `anthropic-version`
            // (Claude Code compatibility). Applied last so callers cannot replace
            // credential-bearing headers.
            ...(route === "anthropic" && token ? { "x-api-key": token, "anthropic-version": "2023-06-01" } : {}),
          },
          body: JSON.stringify(body),
          signal: request.signal,
        });
        if (!response.ok) {
          const bodyText = await readBoundedResponseText(response, { secrets });
          return yield providerError(
            hyperHttpError(classifyHyperError({ status: response.status, headers: response.headers }), bodyText, secrets),
            secrets,
          );
        }
        if (!response.body) return yield providerError(new Error("Hyper response had no body"), secrets);
        yield* route === "anthropic"
          ? anthropicMessagesEvents(response.body, request.signal)
          : hyperChatEvents(response.body, request.signal);
      } catch (error) {
        yield providerError(error, secrets);
      }
    },
  };
}

function routeFor(request: ProviderRequest): HyperRoute {
  const route = request.model.compat?.route;
  return route === "anthropic" || route === "responses" ? route : "openai";
}
