import { type CredentialValueSource, defineProviderPackage, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
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
      api.registerProvider(
        createGoogleGenerateContentProvider({
          id: providerId,
          apiKey: options.apiKey,
          fetch: options.fetch,
          baseUrl: options.baseUrl,
          userAgent: options.userAgent,
        }),
      );
      for (const model of options.models ?? googleModels) {
        api.registerModel({ ...model, provider: providerId });
      }
      api.registerAuthMethod({ kind: "api_key", provider: providerId, credentialName: "apiKey" });
    },
  });
}

export {
  googleGenerateContentBody,
  googleGenerateContentEvents,
} from "./generate-content.js";
export {
  defineGoogleModel,
  GOOGLE_DEFAULT_BASE_URL,
  type GoogleModelConfig,
  type GoogleModelEntry,
  googleModels,
  type ListGoogleModelsOptions,
  listGoogleModels,
  mapGoogleModel,
  stripModelsPrefix,
} from "./models.js";
export {
  createGoogleGenerateContentProvider,
  type GoogleGenerateContentProviderOptions,
  googleOwnedHeaders,
} from "./provider.js";
export {
  googlePreserveThinking,
  googleThinkingConfig,
  stripGoogleOwnedCompat,
} from "./thinking.js";
