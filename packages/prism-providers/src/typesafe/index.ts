import { type CredentialValueSource, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import { vendorPackage } from "../shared/package.js";
import { createTypeSafeProvider } from "./provider.js";

export interface TypeSafeProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly id?: string;
  readonly models?: readonly ModelConfig[];
}

export function typesafePackage(options: TypeSafeProviderPackageOptions = {}): PackageInstance {
  return vendorPackage("@arnilo/prism-providers.typesafe", "TypeSafe Jev provider package for Prism.", () => [
    createTypeSafeProvider(options),
  ]);
}

export * from "../decisions/index.js";
export {
  defineTypeSafeModel,
  TYPESAFE_API_KEY_ENV,
  TYPESAFE_DEFAULT_BASE_URL,
  type TypeSafeModelConfig,
  typeSafeModels,
} from "./models.js";
export { createTypeSafeProvider, type TypeSafeProviderOptions } from "./provider.js";
