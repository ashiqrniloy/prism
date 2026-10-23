/**
 * Laya provider: a decision model behind the standard ModelProvider seam.
 */
import type { CredentialValueSource, ModelProvider } from "@arnilo/prism";
import { createSystemOneDecisionProvider } from "@arnilo/prism/provider-kit";
import { LAYA_DEFAULT_BASE_URL, layaModels } from "./models.js";

export interface LayaProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  /** Endpoint path; defaults to `/v1/systemone`. Must start with `/`. */
  readonly path?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Retries after the first attempt; forwarded to the shared System One client (default 2). */
  readonly maxRetries?: number;
  readonly warn?: (message: string) => void;
}

export function createLayaProvider(options: LayaProviderOptions = {}): ModelProvider {
  return createSystemOneDecisionProvider({
    id: options.id ?? "laya",
    label: "Laya",
    baseUrl: options.baseUrl ?? LAYA_DEFAULT_BASE_URL,
    path: options.path,
    models: layaModels,
    apiKey: options.apiKey,
    fetch: options.fetch,
    maxRetries: options.maxRetries,
    warn: options.warn,
  });
}
