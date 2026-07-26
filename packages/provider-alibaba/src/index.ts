import { defineProviderPackage, type CredentialValueSource, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { createAlibabaProvider, type AlibabaProviderOptions } from "./provider.js";

export interface AlibabaProviderPackageOptions extends AlibabaProviderOptions {
  readonly apiKey?: CredentialValueSource;
  /**
   * Models to register. DashScope catalogs vary by region/workspace/plan, so nothing
   * is hard-coded here — hosts discover models via `listAlibabaModels()` and pass them
   * (or register models themselves). Omit to register the provider with no models.
   */
  readonly models?: readonly ModelConfig[];
}

export function createAlibabaProviderPackage(options: AlibabaProviderPackageOptions = {}): ProviderPackage {
  const providerId = options.id ?? "alibaba";
  return defineProviderPackage({
    name: "@arnilo/prism-provider-alibaba",
    description: "Alibaba Cloud (Model Studio / DashScope, incl. Coding Plan) provider package for Prism.",
    docs: { links: ["docs/providers/alibaba.md"] },
    setup(api) {
      api.registerProvider(createAlibabaProvider({
        id: providerId,
        apiKey: options.apiKey,
        fetch: options.fetch,
        baseUrl: options.baseUrl,
        preset: options.preset,
      }));
      for (const model of options.models ?? []) {
        api.registerModel({ ...model, provider: providerId });
      }
      api.registerAuthMethod({ kind: "api_key", provider: providerId, credentialName: "apiKey" });
    },
  });
}

export {
  alibabaBaseUrl,
  defineAlibabaModel,
  DEFAULT_ALIBABA_BASE_URL,
  listAlibabaModels,
  mapAlibabaModel,
  type AlibabaBasePreset,
  type AlibabaModelConfig,
  type AlibabaModelEntry,
  type ListAlibabaModelsOptions,
} from "./models.js";
export {
  alibabaBody,
  alibabaEnableThinking,
  alibabaEvents,
  createAlibabaProvider,
  serializeAlibabaMessage,
  type AlibabaProviderOptions,
} from "./provider.js";
export {
  alibabaCacheEnabled,
  ALIBABA_MAX_CACHE_BREAKPOINTS,
  applyAlibabaCacheControl,
  withAlibabaCacheMarker,
} from "./cache.js";
