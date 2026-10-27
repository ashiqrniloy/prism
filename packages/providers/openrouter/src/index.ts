import { type JsonSchema, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import {
  baseUrlProperty,
  defineProviderPackage,
  modelsProperty,
  providerPackageInstance,
  refSource,
  secretRefProperty,
} from "@arnilo/prism/provider-kit";
import { createOpenRouterProvider, type OpenRouterRouting } from "./provider.js";
import { listOpenRouterModels } from "./models.js";

export const OPENROUTER_DEFAULT_API_KEY_REF = "env:OPENROUTER_API_KEY";
export interface OpenRouterProviderConfig {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly models?: readonly ModelConfig[];
  readonly appUrl?: string;
  readonly appTitle?: string;
  readonly routing?: OpenRouterRouting;
}
export interface OpenRouterProviderPackageOptions {
  readonly id?: string;
  readonly fetch?: typeof fetch;
}
const strings: JsonSchema = { type: "array", items: { type: "string", minLength: 1 } };
const price: JsonSchema = { type: "number", minimum: 0 };
const configSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    apiKey: secretRefProperty(OPENROUTER_DEFAULT_API_KEY_REF),
    baseUrl: baseUrlProperty("OpenRouter API base; defaults to https://openrouter.ai/api/v1."),
    models: modelsProperty("Static catalog; otherwise each models() call fetches /models."),
    appUrl: { type: "string", pattern: "^https://[^/\\s]+", description: "HTTPS application URL sent as HTTP-Referer." },
    appTitle: { type: "string", maxLength: 100, pattern: "^[^\\r\\n]*$" },
    routing: {
      type: "object",
      additionalProperties: false,
      properties: {
        order: strings,
        only: strings,
        ignore: strings,
        quantizations: strings,
        allow_fallbacks: { type: "boolean" },
        require_parameters: { type: "boolean" },
        zdr: { type: "boolean" },
        data_collection: { type: "string", enum: ["allow", "deny"] },
        sort: { type: "string", enum: ["price", "throughput", "latency"] },
        max_price: {
          type: "object",
          additionalProperties: false,
          properties: { prompt: price, completion: price, request: price, image: price },
        },
      },
    },
  },
};
function definitionFor(options: OpenRouterProviderPackageOptions) {
  return defineProviderPackage<OpenRouterProviderConfig>({
    name: "@arnilo/prism-provider-openrouter",
    description: "OpenRouter provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      if (prism.config.appUrl !== undefined) {
        const url = new URL(prism.config.appUrl);
        if (url.protocol !== "https:" || url.username || url.password)
          throw new Error("OpenRouter appUrl must be an HTTPS URL without credentials");
      }
      const id = options.id ?? "openrouter";
      const ref = prism.config.apiKey ?? OPENROUTER_DEFAULT_API_KEY_REF;
      const resolve = (target: string) => prism.credentials.resolve(target);
      const apiKey = refSource(resolve, ref);
      if ((await resolve(ref)) === undefined) prism.status.note("warn", `openrouter: no API key at ${ref}`);
      const provider = createOpenRouterProvider({ ...prism.config, apiKey, id, fetch: options.fetch });
      prism.providers.register({
        ...provider,
        async models() {
          return prism.config.models ?? listOpenRouterModels({ provider: id, baseUrl: prism.config.baseUrl, apiKey, fetch: options.fetch });
        },
      });
    },
  });
}
const definition = definitionFor({});
export default definition;
export function openrouter(options: OpenRouterProviderPackageOptions & OpenRouterProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch"], options);
}
export {
  createOpenRouterProvider,
  mapOpenRouterHttpError,
  mapOpenRouterUsage,
  openrouterSession,
  type OpenRouterProviderOptions,
  type OpenRouterRouting,
} from "./provider.js";
export {
  listOpenRouterModels,
  mapOpenRouterModel,
  openRouterModels,
  OPENROUTER_DEFAULT_BASE_URL,
  type ListOpenRouterModelsOptions,
  type OpenRouterModelEntry,
} from "./models.js";
