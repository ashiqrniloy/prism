/**
 * Liquid providers: the hosted d1 decision models and a local d1-3B, behind the standard ModelProvider seam.
 */
import type { CredentialValueSource, ModelProvider } from "@arnilo/prism";
import { createSystemOneDecisionProvider } from "@arnilo/prism/provider-kit";
import { LIQUID_DEFAULT_BASE_URL, LIQUID_DEFAULT_PATH, LIQUID_LOCAL_BASE_URL, liquidLocalModels, liquidModels } from "./models.js";

export interface LiquidProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  /** Endpoint path; defaults to `/decisions/v1/systemone` (hosted) or `/v1/systemone` (local). Must start with `/`. */
  readonly path?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Retries after the first attempt; forwarded to the shared System One client (default 2). */
  readonly maxRetries?: number;
  readonly warn?: (message: string) => void;
}

export function createLiquidProvider(options: LiquidProviderOptions = {}): ModelProvider {
  return createSystemOneDecisionProvider({
    id: options.id ?? "liquid",
    label: "Liquid",
    baseUrl: options.baseUrl ?? LIQUID_DEFAULT_BASE_URL,
    path: options.path ?? LIQUID_DEFAULT_PATH,
    models: liquidModels,
    apiKey: options.apiKey,
    fetch: options.fetch,
    maxRetries: options.maxRetries,
    warn: options.warn,
  });
}

/** `llama-server` serves the same System One wire at `/v1/systemone`, with an optional Bearer key. */
export function createLiquidLocalProvider(options: LiquidProviderOptions = {}): ModelProvider {
  return createSystemOneDecisionProvider({
    id: options.id ?? "liquid-local",
    label: "Liquid local",
    baseUrl: options.baseUrl ?? LIQUID_LOCAL_BASE_URL,
    path: options.path,
    models: liquidLocalModels,
    apiKey: options.apiKey,
    fetch: options.fetch,
    maxRetries: options.maxRetries,
    warn: options.warn,
  });
}
