import type { AIProvider, CredentialValueSource } from "prism";
import { createOpenAIResponsesProvider, type OpenAIResponsesProviderOptions } from "./responses.js";

export interface OpenAICodexProviderOptions extends Omit<OpenAIResponsesProviderOptions, "id" | "apiKey"> {
  readonly id?: string;
  readonly accessToken?: CredentialValueSource;
}

export function createOpenAICodexProvider(options: OpenAICodexProviderOptions = {}): AIProvider {
  return createOpenAIResponsesProvider({
    id: options.id ?? "openai-codex",
    baseUrl: options.baseUrl ?? "https://api.openai.com/v1",
    apiKey: options.accessToken,
    fetch: options.fetch,
  });
}
