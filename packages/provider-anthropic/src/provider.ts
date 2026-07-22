import type { AIProvider, CredentialValueSource, ProviderRequestOptions } from "@arnilo/prism";
import { providerError, resolveCredentialValue } from "@arnilo/prism";
import { readBoundedResponseText } from "@arnilo/prism/providers/transport";
import { anthropicMessagesBody, anthropicMessagesEvents } from "./messages.js";
import { ANTHROPIC_API_VERSION, ANTHROPIC_DEFAULT_BASE_URL } from "./models.js";

export interface AnthropicMessagesProviderOptions {
  readonly id?: string;
  /** Defaults to `https://api.anthropic.com/v1`. */
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly userAgent?: string;
}

/**
 * Provider-owned Anthropic Messages headers. Applied after caller headers so
 * callers cannot replace `content-type`, `x-api-key`, or `anthropic-version`.
 */
export function anthropicOwnedHeaders(
  token: string | undefined,
  options: ProviderRequestOptions | undefined,
  userAgent?: string,
): Record<string, string> {
  return {
    "content-type": "application/json",
    "anthropic-version": ANTHROPIC_API_VERSION,
    ...(userAgent ? { "user-agent": userAgent } : {}),
    ...(token ? { "x-api-key": token } : {}),
    ...(options?.sessionId ? { "x-client-request-id": options.sessionId } : {}),
  };
}

export function createAnthropicMessagesProvider(options: AnthropicMessagesProviderOptions = {}): AIProvider {
  const id = options.id ?? "anthropic";
  const baseUrl = (options.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL).replace(/\/$/, "");
  return {
    id,
    async *generate(request) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
      let token: string | undefined;
      const secrets: (string | undefined)[] = [];
      try {
        const body = await anthropicMessagesBody(request);
        token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
        secrets.push(token);
        const response = await (options.fetch ?? fetch)(`${baseUrl}/messages`, {
          method: "POST",
          headers: {
            ...request.options?.headers,
            ...anthropicOwnedHeaders(token, request.options, options.userAgent),
          },
          body: JSON.stringify(body),
          signal: request.signal,
        });
        if (!response.ok) {
          return yield providerError(
            new Error(`Anthropic request failed: ${response.status} ${await readBoundedResponseText(response, { secrets })}`),
            secrets,
          );
        }
        if (!response.body) return yield providerError(new Error("Anthropic response had no body"), secrets);
        yield* anthropicMessagesEvents(response.body, request.signal);
      } catch (error) {
        yield providerError(error, secrets);
      }
    },
  };
}
