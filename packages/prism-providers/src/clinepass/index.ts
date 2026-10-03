import { type CredentialValueSource, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import { vendorPackage } from "../shared/package.js";
import { createClinePassProvider } from "./provider.js";

export interface ClinePassProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly id?: string;
  readonly models?: readonly ModelConfig[];
}

export function clinepassPackage(options: ClinePassProviderPackageOptions = {}): PackageInstance {
  return vendorPackage("@arnilo/prism-providers.clinepass", "ClinePass provider package for Prism.", () => [
    createClinePassProvider(options),
  ]);
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
  clinePassDeclaredLevels,
  clinePassReasoningEffort,
  clinePassThinkingLevelMap,
  clinePassThinkingSlot,
} from "./thinking.js";
