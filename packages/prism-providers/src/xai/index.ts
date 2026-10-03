import { type CredentialValueSource, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import { vendorPackage } from "../shared/package.js";
import { type XaiOAuthOptions } from "./oauth.js";
import { createXaiProvider } from "./provider.js";

export interface XaiProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly id?: string;
  readonly models?: readonly ModelConfig[];
  readonly oauth?: XaiOAuthOptions;
}

export function xaiPackage(options: XaiProviderPackageOptions = {}): PackageInstance {
  return vendorPackage("@arnilo/prism-providers.xai", "xAI (Grok) provider package for Prism.", () => [createXaiProvider(options)]);
}

export { XAI_CONV_ID_MAX_LENGTH, xaiCacheEnabled, xGrokConvId } from "./cache.js";
export {
  defineXaiModel,
  type ListXaiModelsOptions,
  listXaiModels,
  mapXaiModel,
  XAI_DEFAULT_BASE_URL,
  XAI_THINKING_LEVELS,
  type XaiModelConfig,
  type XaiModelEntry,
  xaiModels,
  xaiThinkingLevels,
} from "./models.js";
export {
  createXaiOAuthProvider,
  parseXaiTokenCredentials,
  XAI_DEFAULT_CLIENT_ID,
  XAI_DEFAULT_DEVICE_CODE_URL,
  XAI_DEFAULT_REFERRER,
  XAI_DEFAULT_REVOKE_URL,
  XAI_DEFAULT_SCOPE,
  XAI_DEFAULT_TOKEN_URL,
  XAI_REFRESH_SKEW_MS,
  type XaiOAuthOptions,
} from "./oauth.js";
export { createXaiProvider, toXaiMessage, type XaiProviderOptions, xaiBody, xaiEvents } from "./provider.js";
export { xaiReasoningEffort, xaiReplayThinking } from "./thinking.js";
