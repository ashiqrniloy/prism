import type { AIProvider, CredentialValueSource, ProviderRequest } from "@arnilo/prism";
import { providerError, resolveCredentialValue } from "@arnilo/prism";
import { anthropicMessagesBody, anthropicMessagesEvents } from "./anthropic-messages.js";
import { opencodeHeaders } from "./cache.js";
import { openAIChatBody, openAIChatEvents } from "./openai-chat.js";

export interface OpenCodeGoProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

export function createOpenCodeGoProvider(options: OpenCodeGoProviderOptions = {}): AIProvider {
  const id = options.id ?? "opencode-go";
  const baseUrl = (options.baseUrl ?? "https://api.opencode.ai/v1").replace(/\/$/, "");
  return {
    id,
    async *generate(request) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
      const token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
      const secrets = [token];
      try {
        const route = routeFor(request);
        const response = await (options.fetch ?? fetch)(`${baseUrl}${route === "anthropic" ? "/messages" : "/chat/completions"}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...opencodeHeaders(request.options),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(route === "anthropic" ? anthropicMessagesBody(request) : openAIChatBody(request)),
          signal: request.signal,
        });
        if (!response.ok) return yield providerError(new Error(`OpenCode Go request failed: ${response.status} ${await safeText(response)}`), secrets);
        if (!response.body) return yield providerError(new Error("OpenCode Go response had no body"), secrets);
        yield* route === "anthropic" ? anthropicMessagesEvents(response.body) : openAIChatEvents(response.body);
      } catch (error) {
        yield providerError(error, secrets);
      }
    },
  };
}

function routeFor(request: ProviderRequest): "openai" | "anthropic" {
  return request.model.compat?.route === "anthropic" ? "anthropic" : "openai";
}

async function safeText(response: Response): Promise<string> {
  try { return await response.text(); } catch { return ""; }
}
