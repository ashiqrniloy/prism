/**
 * TypeSafe Jev provider: a decision model behind the standard ModelProvider seam.
 */
import type { CredentialValueSource, ModelProvider } from "@arnilo/prism";
import { createSystemOneDecisionProvider } from "@arnilo/prism/provider-kit";
import { TYPESAFE_DEFAULT_BASE_URL } from "./models.js";

export interface TypeSafeProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Retries after the first attempt; forwarded to the shared System One client (default 2). */
  readonly maxRetries?: number;
  readonly warn?: (message: string) => void;
}

export function createTypeSafeProvider(options: TypeSafeProviderOptions = {}): ModelProvider {
  return createSystemOneDecisionProvider({
    id: options.id ?? "typesafe",
    label: "TypeSafe Jev",
    baseUrl: options.baseUrl ?? TYPESAFE_DEFAULT_BASE_URL,
    apiKey: options.apiKey,
    fetch: options.fetch,
    maxRetries: options.maxRetries,
    warn: options.warn,
  });
}
