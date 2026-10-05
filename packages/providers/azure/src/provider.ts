import type { ModelProvider, CredentialValueSource } from "@arnilo/prism";
import { providerError, resolveCredentialValue as resolveOnce, trimTrailingSlashes } from "@arnilo/prism";
import { createOpenAICompatibleProvider } from "@arnilo/prism/provider-kit";
import { openAICompatThinkingExtra } from "@arnilo/prism/provider-kit";

/** Default Azure OpenAI API version (hosts may override; package never rewrites endpoint host). */
export const AZURE_OPENAI_DEFAULT_API_VERSION = "2024-10-21";

export type AzureAuthStyle = "bearer" | "api-key";

export interface AzureOpenAIProviderOptions {
  readonly id?: string;
  /**
   * Azure OpenAI / Foundry resource endpoint. Preserved exactly (custom subdomain,
   * private endpoint, or VNet FQDN). Trailing slash stripped only.
   */
  readonly endpoint: string;
  /** Deployment name. Defaults to `request.model.model` when omitted. */
  readonly deployment?: string;
  readonly apiVersion?: string;
  /**
   * Host late-bound workload credential (Entra Managed Identity / token provider)
   * or Azure resource key. Never embed static secrets in fixtures.
   */
  readonly credential?: CredentialValueSource;
  /** `bearer` for Entra access tokens (default); `api-key` for Azure resource keys. */
  readonly authStyle?: AzureAuthStyle;
  readonly fetch?: typeof fetch;
}

/** Validate and normalize an Azure endpoint: non-empty, absolute, https; trailing slash stripped. */
export function requireAzureEndpoint(endpoint: string | undefined): string {
  if (typeof endpoint !== "string" || !endpoint.trim()) {
    throw new Error("Azure OpenAI endpoint is required");
  }
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") throw new Error("Azure OpenAI endpoint must be https");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Azure")) throw error;
    throw new Error("Azure OpenAI endpoint must be an absolute https URL");
  }
  return trimTrailingSlashes(endpoint);
}

/** Build deployment chat-completions URL without rewriting the endpoint host. */
export function azureChatCompletionsUrl(input: {
  readonly endpoint: string;
  readonly deployment: string;
  readonly apiVersion?: string;
}): string {
  const endpoint = requireAzureEndpoint(input.endpoint);
  if (!input.deployment.trim()) throw new Error("Azure OpenAI deployment is required");
  const apiVersion = input.apiVersion ?? AZURE_OPENAI_DEFAULT_API_VERSION;
  const url = new URL(`${endpoint}/openai/deployments/${encodeURIComponent(input.deployment)}/chat/completions`);
  url.searchParams.set("api-version", apiVersion);
  return url.toString();
}

export function createAzureOpenAIProvider(options: AzureOpenAIProviderOptions): ModelProvider {
  const endpoint = requireAzureEndpoint(options.endpoint);
  const id = options.id ?? "azure";
  const authStyle = options.authStyle ?? "bearer";
  const apiVersion = options.apiVersion ?? AZURE_OPENAI_DEFAULT_API_VERSION;
  const chatCompletionsUrl = (request: { readonly model: { readonly model: string } }): string =>
    azureChatCompletionsUrl({
      endpoint,
      deployment: options.deployment ?? request.model.model,
      apiVersion,
    });
  return {
    id,
    async *generate(request) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
      // Resolve the credential exactly once per request and hand the resolved
      // token to the inner provider: a rotating CredentialValueSource must
      // not be consumed twice (wrapper check + inner auth header) because the
      // two reads can yield different tokens.
      const token = await resolveOnce(options.credential, { provider: id, name: "credential" });
      if (!token?.trim()) {
        yield providerError(new Error("Azure OpenAI credential missing"), []);
        return;
      }
      const inner = createOpenAICompatibleProvider({
        id,
        baseUrl: endpoint,
        apiKey: token,
        authStyle,
        fetch: options.fetch,
        chatCompletionsUrl,
        buildBodyExtra: openAICompatThinkingExtra,
      });
      yield* inner.generate(request);
    },
  };
}