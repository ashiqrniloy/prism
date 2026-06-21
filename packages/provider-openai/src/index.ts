import { defineProviderPackage, type CredentialValueSource, type ProviderPackage } from "prism";
import { createOpenAICodexProvider, type OpenAICodexProviderOptions } from "./codex.js";
import { openAICodexModels, openAIModels } from "./models.js";
import { createOpenAICodexOAuthProvider, openAICodexOAuthProvider } from "./oauth.js";
import { createOpenAIResponsesProvider, type OpenAIResponsesProviderOptions } from "./responses.js";

export interface OpenAIProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly codexAccessToken?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly codexBaseUrl?: string;
}

export function createOpenAIProviderPackage(options: OpenAIProviderPackageOptions = {}): ProviderPackage {
  return defineProviderPackage({
    name: "@prism/provider-openai",
    description: "OpenAI provider package for Prism.",
    docs: { links: ["docs/providers/openai.md"] },
    setup(api) {
      api.registerProvider(createOpenAIResponsesProvider({ apiKey: options.apiKey, baseUrl: options.baseUrl, fetch: options.fetch }));
      api.registerProvider(createOpenAICodexProvider({ accessToken: options.codexAccessToken, baseUrl: options.codexBaseUrl, fetch: options.fetch }));
      for (const model of openAIModels) api.registerModel(model);
      for (const model of openAICodexModels) api.registerModel(model);
      api.registerAuthMethod({ kind: "api_key", provider: "openai", credentialName: "apiKey" });
      api.registerAuthMethod({ kind: "oauth", provider: "openai-codex", oauth: openAICodexOAuthProvider });
    },
  });
}

export { createOpenAIResponsesProvider, type OpenAIResponsesProviderOptions } from "./responses.js";
export { createOpenAICodexProvider, type OpenAICodexProviderOptions } from "./codex.js";
export { openAIModels, openAICodexModels } from "./models.js";
export { createOpenAICodexOAuthProvider, openAICodexOAuthProvider, type OpenAICodexOAuthOptions, createPkceVerifier, computeS256Challenge } from "./oauth.js";
