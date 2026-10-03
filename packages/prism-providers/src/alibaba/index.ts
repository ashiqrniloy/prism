import { type CredentialValueSource, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import { vendorPackage } from "../shared/package.js";
import { type AlibabaProviderOptions, createAlibabaProvider } from "./provider.js";

export interface AlibabaProviderPackageOptions extends AlibabaProviderOptions {
  readonly apiKey?: CredentialValueSource;
  /**
   * Models to register. DashScope catalogs vary by region/workspace/plan, so nothing
   * is hard-coded here — hosts discover models via `listAlibabaModels()` and pass them
   * (or register models themselves). Omit to register the provider with no models.
   */
  readonly models?: readonly ModelConfig[];
}

export function alibabaPackage(options: AlibabaProviderPackageOptions = {}): PackageInstance {
  const providerId = options.id ?? "alibaba";
  return vendorPackage(
    "@arnilo/prism-providers.alibaba",
    "Alibaba Cloud (Model Studio / DashScope, incl. Coding Plan) provider package for Prism.",
    () => [
      createAlibabaProvider({
        id: providerId,
        apiKey: options.apiKey,
        fetch: options.fetch,
        baseUrl: options.baseUrl,
        preset: options.preset,
      }),
    ],
  );
}

export {
  ALIBABA_MAX_CACHE_BREAKPOINTS,
  alibabaCacheEnabled,
  applyAlibabaCacheControl,
  withAlibabaCacheMarker,
} from "./cache.js";
export {
  ALIBABA_EMBEDDING_BATCH_SIZE,
  ALIBABA_EMBEDDING_DEFAULT_DIMENSIONS,
  type AlibabaEmbedder,
  type AlibabaEmbedderOptions,
  type AlibabaEmbeddingsProviderOptions,
  createAlibabaEmbedder,
  createAlibabaEmbeddingsProvider,
} from "./embeddings.js";
export {
  ALIBABA_IMAGE_MAX_BYTES,
  ALIBABA_IMAGE_MAX_COUNT,
  type AlibabaImageGenerationOptions,
  createAlibabaImageGenerationProvider,
} from "./images.js";
export {
  type AlibabaBasePreset,
  type AlibabaModelConfig,
  type AlibabaModelEntry,
  alibabaBaseUrl,
  alibabaIsThinkingOnly,
  alibabaThinkingFamily,
  alibabaThinkingLevels,
  DEFAULT_ALIBABA_BASE_URL,
  defineAlibabaModel,
  type ListAlibabaModelsOptions,
  listAlibabaModels,
  mapAlibabaModel,
} from "./models.js";
export {
  type AlibabaProviderOptions,
  alibabaBody,
  alibabaEnableThinking,
  alibabaEvents,
  createAlibabaProvider,
  serializeAlibabaMessage,
} from "./provider.js";
export {
  ALIBABA_VIDEO_MAX_DURATION_SECONDS,
  ALIBABA_VIDEO_PROMPT_MAX_CHARS,
  type AlibabaVideoGenerationOptions,
  createAlibabaVideoGenerationProvider,
} from "./video.js";
