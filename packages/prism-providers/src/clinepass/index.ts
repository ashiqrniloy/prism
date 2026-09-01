import { type CredentialValueSource, defineProviderPackage, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { clinePassModels } from "./models.js";
import { createClinePassProvider } from "./provider.js";

export interface ClinePassProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly id?: string;
  readonly models?: readonly ModelConfig[];
}

export function createClinePassProviderPackage(options: ClinePassProviderPackageOptions = {}): ProviderPackage {
  const providerId = options.id ?? "clinepass";
  return defineProviderPackage({
    name: "@arnilo/prism-providers/clinepass",
    description: "ClinePass provider package for Prism.",
    docs: { links: ["docs/providers/clinepass.md"] },
    setup(api) {
      api.registerProvider(createClinePassProvider(options));
      for (const model of options.models ?? clinePassModels) api.registerModel({ ...model, provider: providerId });
      api.registerAuthMethod({ kind: "api_key", provider: providerId, credentialName: "apiKey" });
    },
  });
}

export {
  CLINEPASS_DEFAULT_BASE_URL,
  CLINEPASS_FEATURED_SLUGS,
  type ClinePassModelConfig,
  clinePassModels,
  defineClinePassModel,
} from "./models.js";
export {
  type ClinePassProviderOptions,
  clinePassBody,
  clinePassEvents,
  createClinePassProvider,
} from "./provider.js";
export {
  CLINEPASS_THINKING_MAPS,
  type ClinePassThinkingLevelMap,
  type ClinePassThinkingSlot,
  clinePassReasoningEffort,
  clinePassThinkingLevelMap,
  clinePassThinkingSlot,
} from "./thinking.js";
