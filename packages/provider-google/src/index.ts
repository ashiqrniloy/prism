import { defineProviderPackage, type CredentialValueSource, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { googleModels } from "./models.js";
import { createGoogleGenerateContentProvider } from "./provider.js";

export interface GoogleProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly id?: string;
  readonly userAgent?: string;
  /** Overrides featured `googleModels` registered on setup. */
  readonly models?: readonly ModelConfig[];
}

export function createGoogleProviderPackage(options: GoogleProviderPackageOptions = {}): ProviderPackage {
  const providerId = options.id ?? "google";
  return defineProviderPackage({
    name: "@arnilo/prism-provider-google",
    description: "Google Gemini generateContent provider package for Prism.",
    docs: { links: ["docs/providers/google.md"] },
    setup(api) {
      api.registerProvider(createGoogleGenerateContentProvider({
        id: providerId,
        apiKey: options.apiKey,
        fetch: options.fetch,
        baseUrl: options.baseUrl,
        userAgent: options.userAgent,
      }));
      for (const model of options.models ?? googleModels) {
        api.registerModel({ ...model, provider: providerId });
      }
      api.registerAuthMethod({ kind: "api_key", provider: providerId, credentialName: "apiKey" });
    },
  });
}

export {
  GOOGLE_DEFAULT_BASE_URL,
  googleModels,
  defineGoogleModel,
  listGoogleModels,
  mapGoogleModel,
  stripModelsPrefix,
  type GoogleModelConfig,
  type GoogleModelEntry,
  type ListGoogleModelsOptions,
} from "./models.js";
export {
  googleOwnedHeaders,
  createGoogleGenerateContentProvider,
  type GoogleGenerateContentProviderOptions,
} from "./provider.js";
export {
  googleGenerateContentBody,
  googleGenerateContentEvents,
} from "./generate-content.js";
export {
  googleThinkingConfig,
  googlePreserveThinking,
  stripGoogleOwnedCompat,
} from "./thinking.js";
