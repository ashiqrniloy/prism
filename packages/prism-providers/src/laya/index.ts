import { type CredentialValueSource, defineProviderPackage, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { layaModels } from "./models.js";
import { createLayaProvider } from "./provider.js";

export interface LayaProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly id?: string;
  readonly models?: readonly ModelConfig[];
}

export function createLayaProviderPackage(options: LayaProviderPackageOptions = {}): ProviderPackage {
  const providerId = options.id ?? "laya";
  return defineProviderPackage({
    name: "@arnilo/prism-providers/laya",
    description: "Laya provider package for Prism.",
    docs: { links: ["docs/providers/laya.md"] },
    setup(api) {
      api.registerProvider(createLayaProvider(options));
      for (const model of options.models ?? layaModels) api.registerModel({ ...model, provider: providerId });
      api.registerAuthMethod({ kind: "api_key", provider: providerId, credentialName: "apiKey" });
    },
  });
}

export {
  DEFAULT_LAYA_BASE_URL,
  defineLayaModel,
  LAYA_API_KEY_ENV,
  type LayaModelConfig,
  layaBaseUrl,
  layaModels,
} from "./models.js";
export { createLayaProvider, type LayaProviderOptions } from "./provider.js";
