/**
 * @arnilo/prism-ai/laya — Laya provider package for Prism.
 */
import type { PackageInstance } from "@arnilo/prism";
import { systemOneProviderPackage, type SystemOneProviderConfig, type SystemOneProviderPackageOptions } from "@arnilo/prism/provider-kit";
import { LAYA_DEFAULT_API_KEY_REF, LAYA_DEFAULT_BASE_URL, layaModels } from "./models.js";
import { createLayaProvider } from "./provider.js";

export type LayaProviderConfig = SystemOneProviderConfig;
export type LayaProviderPackageOptions = SystemOneProviderPackageOptions;

const pkg = systemOneProviderPackage({
  name: "@arnilo/prism-ai/laya",
  providerId: "laya",
  label: "Laya",
  defaultBaseUrl: LAYA_DEFAULT_BASE_URL,
  defaultKeyRef: LAYA_DEFAULT_API_KEY_REF,
  keyRequired: false,
  models: layaModels,
  createProvider: createLayaProvider,
});

export default pkg.definition;

export function laya(options?: LayaProviderPackageOptions & LayaProviderConfig): PackageInstance {
  return pkg.package(options);
}

export {
  defineLayaModel,
  type LayaModelConfig,
  layaModels,
  LAYA_API_KEY_ENV,
  LAYA_DEFAULT_API_KEY_REF,
  LAYA_DEFAULT_BASE_URL,
} from "./models.js";
export { createLayaProvider, type LayaProviderOptions } from "./provider.js";
