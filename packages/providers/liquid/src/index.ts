/**
 * @arnilo/prism-ai/liquid — Liquid provider package for Prism.
 *
 * ```ts
 * import liquid from "@arnilo/prism-ai/liquid";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({ model: "liquid/d1.1", packages: [liquid({ apiKey: "env:LIQUID_API_KEY" })] });
 * ```
 *
 * One vendor package, two providers: hosted `liquid` (d1.1, d1-ultra) and `liquid-local` (d1-3B served
 * by llama.cpp's `llama-server`). They stay separate because the hosted provider requires a key and the
 * local one must work without one.
 */
import type { JsonSchema, PackageInstance } from "@arnilo/prism";
import {
  baseUrlProperty,
  defineProviderPackage,
  optionalRefSource,
  providerPackageInstance,
  refSource,
  secretRefProperty,
} from "@arnilo/prism/provider-kit";
import { LIQUID_DEFAULT_API_KEY_REF, LIQUID_LOCAL_BASE_URL, liquidLocalModels, liquidModels } from "./models.js";
import { createLiquidLocalProvider, createLiquidProvider } from "./provider.js";

export const LIQUID_DEFAULT_LOCAL_API_KEY_REF = "env:LIQUID_LOCAL_API_KEY";

/** The config a host (or a code instance) may set; every secret field is a ref, never a value. */
export interface LiquidProviderConfig {
  /** An `env:`/`keyring:` ref; defaults to `env:LIQUID_API_KEY`. */
  readonly apiKey?: string;
  /** Hosted base; defaults to `https://api.liquid.ai`. */
  readonly baseUrl?: string;
  /** Hosted endpoint path; defaults to `/decisions/v1/systemone` and must start with `/`. */
  readonly path?: string;
  /** Retries after the first attempt; forwarded to the shared System One client (default 2). */
  readonly maxRetries?: number;
  /** Register the hosted provider; `false` is a local-only dev setup. */
  readonly hosted?: boolean;
  /** `llama-server` base; defaults to `http://127.0.0.1:8080`. */
  readonly localBaseUrl?: string;
  /** Optional `env:`/`keyring:` ref for `llama-server --api-key`. Unset sends no Authorization header. */
  readonly localApiKey?: string;
}

/** Factory-only options: not JSON, so they cannot come from a manifest. */
export interface LiquidProviderPackageOptions {
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    apiKey: secretRefProperty(LIQUID_DEFAULT_API_KEY_REF),
    baseUrl: baseUrlProperty("Hosted base; defaults to the vendor default."),
    path: {
      type: "string",
      pattern: "^/",
      description: "Hosted endpoint path; defaults to /decisions/v1/systemone. Must start with `/`.",
    },
    maxRetries: {
      type: "number",
      minimum: 0,
      description: "Retries after the first attempt; forwarded to the shared System One client (default 2).",
    },
    hosted: { type: "boolean", default: true, description: "Register the hosted provider; false for a local-only setup." },
    localBaseUrl: baseUrlProperty("llama-server base; defaults to http://127.0.0.1:8080."),
    localApiKey: secretRefProperty(
      undefined,
      "Optional `env:`/`keyring:` ref for llama-server --api-key. Unset sends no Authorization header.",
    ),
  },
  additionalProperties: false,
};

function definitionFor(options: LiquidProviderPackageOptions) {
  return defineProviderPackage<LiquidProviderConfig>({
    name: "@arnilo/prism-ai/liquid",
    description: "Liquid provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      const resolve = (target: string) => prism.credentials.resolve(target);
      const warn = (message: string) => prism.status.note("warn", message);

      if (prism.config.hosted !== false) {
        const ref = prism.config.apiKey ?? LIQUID_DEFAULT_API_KEY_REF;
        const apiKey = refSource(resolve, ref);
        // Register regardless: a credential problem must not turn into `Unknown provider`.
        if ((await resolve(ref)) === undefined) prism.status.note("warn", `liquid: no API key at ${ref}`);
        prism.providers.register({
          ...createLiquidProvider({
            baseUrl: prism.config.baseUrl,
            path: prism.config.path,
            apiKey,
            fetch: options.fetch,
            maxRetries: prism.config.maxRetries,
            warn,
          }),
          async models() {
            return liquidModels;
          },
        });
      }

      const localRef = prism.config.localApiKey ?? LIQUID_DEFAULT_LOCAL_API_KEY_REF;
      prism.providers.register({
        ...createLiquidLocalProvider({
          baseUrl: prism.config.localBaseUrl ?? LIQUID_LOCAL_BASE_URL,
          apiKey: optionalRefSource(resolve, localRef),
          fetch: options.fetch,
          maxRetries: prism.config.maxRetries,
          warn,
        }),
        async models() {
          return liquidLocalModels;
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `liquid({ ... })`. */
export default definition;

/** Instance with factory-only options; the secret refs and endpoints are validated config. */
export function liquid(options: LiquidProviderPackageOptions & LiquidProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["fetch"], options);
}

export {
  defineLiquidModel,
  LIQUID_API_KEY_ENV,
  LIQUID_DEFAULT_API_KEY_REF,
  LIQUID_DEFAULT_BASE_URL,
  LIQUID_DEFAULT_PATH,
  LIQUID_LOCAL_BASE_URL,
  type LiquidModelConfig,
  liquidLocalModels,
  liquidModels,
} from "./models.js";
export { createLiquidLocalProvider, createLiquidProvider, type LiquidProviderOptions } from "./provider.js";
