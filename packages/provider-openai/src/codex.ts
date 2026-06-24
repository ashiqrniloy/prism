import type { AIProvider, CredentialValueSource } from "@arnilo/prism";
import { createOpenAIResponsesProvider, type OpenAIResponsesProviderOptions } from "./responses.js";

export interface OpenAICodexProviderOptions extends Omit<OpenAIResponsesProviderOptions, "id" | "apiKey"> {
  readonly id?: string;
  readonly accessToken?: CredentialValueSource;
}

export function createOpenAICodexProvider(options: OpenAICodexProviderOptions = {}): AIProvider {
  // ponytail: Codex subscription Responses endpoint is distinct from the plain
  // API-key base URL; keep them separate so OAuth tokens never silently hit /v1.
  return createOpenAIResponsesProvider({
    id: options.id ?? "openai-codex",
    baseUrl: options.baseUrl ?? "https://chatgpt.com/backend-api/codex",
    apiKey: options.accessToken,
    fetch: options.fetch,
  });
}
