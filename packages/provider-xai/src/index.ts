import { type CredentialValueSource, defineProviderPackage, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { xaiModels } from "./models.js";
import { createXaiOAuthProvider, type XaiOAuthOptions } from "./oauth.js";
import { createXaiProvider } from "./provider.js";

export interface XaiProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly id?: string;
  readonly models?: readonly ModelConfig[];
  readonly oauth?: XaiOAuthOptions;
}

export function createXaiProviderPackage(options: XaiProviderPackageOptions = {}): ProviderPackage {
  const providerId = options.id ?? "xai";
  return defineProviderPackage({
    name: "@arnilo/prism-provider-xai",
    description: "xAI (Grok) provider package for Prism.",
    docs: { links: ["docs/providers/xai.md"] },
    setup(api) {
      api.registerProvider(createXaiProvider(options));
      for (const model of options.models ?? xaiModels) api.registerModel({ ...model, provider: providerId });
      api.registerAuthMethod({ kind: "api_key", provider: providerId, credentialName: "apiKey" });
      api.registerAuthMethod({
        kind: "oauth",
        provider: providerId,
        oauth: createXaiOAuthProvider({ fetch: options.fetch, ...options.oauth }),
      });
    },
  });
}

export { xaiCacheEnabled, XAI_CONV_ID_MAX_LENGTH, xGrokConvId } from "./cache.js";
export {
  defineXaiModel,
  type ListXaiModelsOptions,
  listXaiModels,
  mapXaiModel,
  type XaiModelConfig,
  type XaiModelEntry,
  XAI_DEFAULT_BASE_URL,
  xaiModels,
} from "./models.js";
export {
  createXaiOAuthProvider,
  parseXaiTokenCredentials,
  type XaiOAuthOptions,
  XAI_DEFAULT_CLIENT_ID,
  XAI_DEFAULT_DEVICE_CODE_URL,
  XAI_DEFAULT_REFERRER,
  XAI_DEFAULT_REVOKE_URL,
  XAI_DEFAULT_SCOPE,
  XAI_DEFAULT_TOKEN_URL,
  XAI_REFRESH_SKEW_MS,
} from "./oauth.js";
export { createXaiProvider, type XaiProviderOptions, toXaiMessage, xaiBody, xaiEvents } from "./provider.js";
export { xaiReplayThinking } from "./thinking.js";
