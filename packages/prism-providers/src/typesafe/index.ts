import { type CredentialValueSource, defineProviderPackage, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { typeSafeModels } from "./models.js";
import { createTypeSafeProvider } from "./provider.js";

export interface TypeSafeProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly id?: string;
  readonly models?: readonly ModelConfig[];
}

export function createTypeSafeProviderPackage(options: TypeSafeProviderPackageOptions = {}): ProviderPackage {
  const providerId = options.id ?? "typesafe";
  return defineProviderPackage({
    name: "@arnilo/prism-providers/typesafe",
    description: "TypeSafe Jev provider package for Prism.",
    docs: { links: ["docs/providers/typesafe.md"] },
    setup(api) {
      api.registerProvider(createTypeSafeProvider(options));
      for (const model of options.models ?? typeSafeModels) api.registerModel({ ...model, provider: providerId });
      api.registerAuthMethod({ kind: "api_key", provider: providerId, credentialName: "apiKey" });
    },
  });
}

export {
  defineTypeSafeModel,
  TYPESAFE_API_KEY_ENV,
  TYPESAFE_DEFAULT_BASE_URL,
  type TypeSafeModelConfig,
  typeSafeModels,
} from "./models.js";
export { createTypeSafeProvider, type TypeSafeProviderOptions } from "./provider.js";
