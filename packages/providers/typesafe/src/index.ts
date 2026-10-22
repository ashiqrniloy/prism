/**
 * @arnilo/prism-provider-typesafe — TypeSafe Jev provider package for Prism.
 */
import type { PackageInstance } from "@arnilo/prism";
import {
  systemOneProviderPackage,
  type SystemOneProviderConfig,
  type SystemOneProviderPackageOptions,
} from "@arnilo/prism/provider-kit";
import {
  TYPESAFE_API_KEY_ENV,
  TYPESAFE_DEFAULT_API_KEY_REF,
  TYPESAFE_DEFAULT_BASE_URL,
  typeSafeModels,
} from "./models.js";
import { createTypeSafeProvider } from "./provider.js";

export type TypeSafeProviderConfig = SystemOneProviderConfig;
export type TypeSafeProviderPackageOptions = SystemOneProviderPackageOptions;

const pkg = systemOneProviderPackage({
  name: "@arnilo/prism-provider-typesafe",
  providerId: "typesafe",
  label: "TypeSafe Jev",
  defaultBaseUrl: TYPESAFE_DEFAULT_BASE_URL,
  defaultKeyRef: TYPESAFE_DEFAULT_API_KEY_REF,
  keyRequired: true,
  models: typeSafeModels,
  createProvider: createTypeSafeProvider,
});

export default pkg.definition;

export function typesafe(options?: TypeSafeProviderPackageOptions & TypeSafeProviderConfig): PackageInstance {
  return pkg.package(options);
}

export {
  defineTypeSafeModel,
  type TypeSafeModelConfig,
  typeSafeModels,
  TYPESAFE_API_KEY_ENV,
  TYPESAFE_DEFAULT_API_KEY_REF,
  TYPESAFE_DEFAULT_BASE_URL,
} from "./models.js";
export { createTypeSafeProvider, type TypeSafeProviderOptions } from "./provider.js";
