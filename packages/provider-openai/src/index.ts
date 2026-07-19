import { defineProviderPackage, type CredentialValueSource, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
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
  /** Host override for registered OpenAI Responses models (defaults to featured `openAIModels`). */
  readonly models?: readonly ModelConfig[];
  /** Host override for registered Codex models (defaults to featured `openAICodexModels`). */
  readonly codexModels?: readonly ModelConfig[];
}

export function createOpenAIProviderPackage(options: OpenAIProviderPackageOptions = {}): ProviderPackage {
  return defineProviderPackage({
    name: "@arnilo/prism-provider-openai",
    description: "OpenAI provider package for Prism.",
    docs: { links: ["docs/providers/openai.md"] },
    setup(api) {
      api.registerProvider(createOpenAIResponsesProvider({ apiKey: options.apiKey, baseUrl: options.baseUrl, fetch: options.fetch }));
      api.registerProvider(createOpenAICodexProvider({ accessToken: options.codexAccessToken, baseUrl: options.codexBaseUrl, fetch: options.fetch }));
      for (const model of options.models ?? openAIModels) api.registerModel(model);
      for (const model of options.codexModels ?? openAICodexModels) api.registerModel(model);
      api.registerAuthMethod({ kind: "api_key", provider: "openai", credentialName: "apiKey" });
      api.registerAuthMethod({ kind: "oauth", provider: "openai-codex", oauth: openAICodexOAuthProvider });
    },
  });
}

export { createOpenAIResponsesProvider, resolveOpenAIReasoning, type OpenAIResponsesProviderOptions } from "./responses.js";
export { createOpenAICodexProvider, type OpenAICodexProviderOptions } from "./codex.js";
export {
  defineOpenAIModel,
  listOpenAIModels,
  mapOpenAIModel,
  openAIModels,
  openAICodexModels,
  type ListOpenAIModelsOptions,
  type OpenAIModelConfig,
  type OpenAIModelEntry,
} from "./models.js";
export { createOpenAICodexOAuthProvider, openAICodexOAuthProvider, type OpenAICodexOAuthOptions, createPkceVerifier, computeS256Challenge } from "./oauth.js";
export { OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH, promptCacheKey, promptCacheRetention } from "./cache.js";
