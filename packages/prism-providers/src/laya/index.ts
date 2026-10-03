import { type CredentialValueSource, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import { vendorPackage } from "../shared/package.js";
import { createLayaProvider } from "./provider.js";

export interface LayaProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly id?: string;
  readonly models?: readonly ModelConfig[];
}

export function layaPackage(options: LayaProviderPackageOptions = {}): PackageInstance {
  return vendorPackage("@arnilo/prism-providers.laya", "Laya provider package for Prism.", () => [createLayaProvider(options)]);
}

export * from "../decisions/index.js";
export {
  DEFAULT_LAYA_BASE_URL,
  defineLayaModel,
  LAYA_API_KEY_ENV,
  type LayaModelConfig,
  layaBaseUrl,
  layaModels,
} from "./models.js";
export { createLayaProvider, type LayaProviderOptions } from "./provider.js";
