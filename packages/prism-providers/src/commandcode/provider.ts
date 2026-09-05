import type { AIProvider, CredentialValueSource, ProviderRequest } from "@arnilo/prism";
import { providerError, resolveCredentialValue, trimTrailingSlashes } from "@arnilo/prism";
import { readBoundedResponseText } from "@arnilo/prism/providers/transport";
import { type AnthropicMessagesRouteHooks, anthropicMessagesBody, anthropicMessagesEvents } from "../shared/anthropic-messages.js";
import { applyCommandCodeCacheControl } from "./cache.js";
import { classifyCommandCodeError, commandCodeHttpError } from "./errors.js";
import { COMMAND_CODE_DEFAULT_BASE_URL } from "./models.js";
import { commandCodeChatBody, commandCodeChatEvents } from "./openai-chat.js";
import { commandCodePreserveThinking, stripCommandCodeOwnedCompat } from "./thinking.js";

export interface CommandCodeProviderOptions {
  readonly id?: string;
  /** Defaults to official `https://api.commandcode.ai/provider/v1`. */
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /**
   * Enforce zero data retention: adds provider-owned `x-cmd-zdr: 1` header.
   * Requests then route only through ZDR-capable upstreams (a model without
   * one fails with `422 cmd_zdr_no_providers`); may change which upstream
   * serves a request and raise cost.
   * @see https://commandcode.ai/docs/resources/zdr
   */
  readonly zdr?: boolean;
}

const COMMAND_CODE_ANTHROPIC_HOOKS: AnthropicMessagesRouteHooks = {
  applyCacheControl: applyCommandCodeCacheControl,
  preserveThinking: commandCodePreserveThinking,
  stripOwnedCompat: stripCommandCodeOwnedCompat,
};

export function createCommandCodeProvider(options: CommandCodeProviderOptions = {}): AIProvider {
  const id = options.id ?? "commandcode";
  const baseUrl = trimTrailingSlashes(options.baseUrl ?? COMMAND_CODE_DEFAULT_BASE_URL);
  return {
    id,
    async *generate(request) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
      let token: string | undefined;
      const secrets: (string | undefined)[] = [];
      try {
        const route = routeFor(request);
        const body =
          route === "anthropic" ? await anthropicMessagesBody(request, COMMAND_CODE_ANTHROPIC_HOOKS) : commandCodeChatBody(request);
        token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
        secrets.push(token);
        const response = await (options.fetch ?? fetch)(`${baseUrl}${route === "anthropic" ? "/messages" : "/chat/completions"}`, {
          method: "POST",
          headers: {
            ...request.options?.headers,
            "content-type": "application/json",
            // Provider-owned auth, applied after caller headers so callers
            // cannot override credential-bearing headers.
            ...(route === "openai" && token ? { authorization: `Bearer ${token}` } : {}),
            ...(route === "anthropic" && token ? { "x-api-key": token, "anthropic-version": "2023-06-01" } : {}),
            ...(options.zdr ? { "x-cmd-zdr": "1" } : {}),
          },
          body: JSON.stringify(body),
          signal: request.signal,
        });
        if (!response.ok) {
          const bodyText = await readBoundedResponseText(response, { secrets });
          return yield providerError(
            commandCodeHttpError(classifyCommandCodeError({ status: response.status, headers: response.headers }), bodyText, secrets),
            secrets,
          );
        }
        if (!response.body) return yield providerError(new Error("Command Code response had no body"), secrets);
        yield* route === "anthropic"
          ? anthropicMessagesEvents(response.body, request.signal)
          : commandCodeChatEvents(response.body, request.signal);
      } catch (error) {
        yield providerError(error, secrets);
      }
    },
  };
}

function routeFor(request: ProviderRequest): "openai" | "anthropic" {
  return request.model.compat?.route === "anthropic" ? "anthropic" : "openai";
}
