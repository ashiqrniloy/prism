import { type CredentialValueSource, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import { vendorPackage } from "../shared/package.js";
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

export function googlePackage(options: GoogleProviderPackageOptions = {}): PackageInstance {
  const providerId = options.id ?? "google";
  return vendorPackage("@arnilo/prism-providers.google", "Google Gemini generateContent provider package for Prism.", () => [
    createGoogleGenerateContentProvider({
      id: providerId,
      apiKey: options.apiKey,
      fetch: options.fetch,
      baseUrl: options.baseUrl,
      userAgent: options.userAgent,
    }),
  ]);
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
