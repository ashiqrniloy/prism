/**
 * Laya provider: self-hosted `laya-serve` behind the same decision-model seam as Jev.
 *
 * Default base URL is plaintext loopback. Any host-supplied endpoint overrides it, including
 * a `laya-serve` on another machine. `model` is advisory — the server Router picks the checkpoint.
 */
import type { AIProvider, CredentialValueSource } from "@arnilo/prism";
import { createSystemOneDecisionProvider } from "../shared/systemone-provider.js";
import { layaBaseUrl } from "./models.js";

export interface LayaProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Retries after the first attempt; forwarded to the shared System One client (default 2). */
  readonly maxRetries?: number;
}

export function createLayaProvider(options: LayaProviderOptions = {}): AIProvider {
  return createSystemOneDecisionProvider({
    id: options.id ?? "laya",
    label: "Laya",
    baseUrl: layaBaseUrl(options),
    apiKey: options.apiKey,
    fetch: options.fetch,
    maxRetries: options.maxRetries,
  });
}
