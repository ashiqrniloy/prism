import type { AIProvider, CredentialValueSource, ProviderRequestOptions } from "@arnilo/prism";
import { providerError, resolveCredentialValue } from "@arnilo/prism";
import { readBoundedResponseText } from "@arnilo/prism/providers/transport";
import { googleGenerateContentBody, googleGenerateContentEvents } from "./generate-content.js";
import { GOOGLE_DEFAULT_BASE_URL, stripModelsPrefix } from "./models.js";

export interface GoogleGenerateContentProviderOptions {
  readonly id?: string;
  /** Defaults to `https://generativelanguage.googleapis.com/v1beta`. */
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly userAgent?: string;
}

/**
 * Provider-owned Gemini headers. Applied after caller headers so callers cannot
 * replace `content-type` or `x-goog-api-key`.
 */
export function googleOwnedHeaders(
  token: string | undefined,
  options: ProviderRequestOptions | undefined,
  userAgent?: string,
): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(userAgent ? { "user-agent": userAgent } : {}),
    ...(token ? { "x-goog-api-key": token } : {}),
    ...(options?.sessionId ? { "x-client-request-id": options.sessionId } : {}),
  };
}

export function createGoogleGenerateContentProvider(options: GoogleGenerateContentProviderOptions = {}): AIProvider {
  const id = options.id ?? "google";
  const baseUrl = (options.baseUrl ?? GOOGLE_DEFAULT_BASE_URL).replace(/\/$/, "");
  return {
    id,
    async *generate(request) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
      let token: string | undefined;
      const secrets: (string | undefined)[] = [];
      try {
        const body = await googleGenerateContentBody(request);
        token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
        secrets.push(token);
        const modelId = stripModelsPrefix(request.model.model);
        const url = `${baseUrl}/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`;
        const response = await (options.fetch ?? fetch)(url, {
          method: "POST",
          headers: {
            ...request.options?.headers,
            ...googleOwnedHeaders(token, request.options, options.userAgent),
          },
          body: JSON.stringify(body),
          signal: request.signal,
        });
        if (!response.ok) {
          return yield providerError(
            new Error(`Google request failed: ${response.status} ${await readBoundedResponseText(response, { secrets })}`),
            secrets,
          );
        }
        if (!response.body) return yield providerError(new Error("Google response had no body"), secrets);
        yield* googleGenerateContentEvents(response.body, request.signal);
      } catch (error) {
        yield providerError(error, secrets);
      }
    },
  };
}
