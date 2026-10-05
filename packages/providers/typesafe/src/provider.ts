/**
 * TypeSafe Jev provider: a decision model behind the standard `ModelProvider` seam.
 *
 * Jev never generates text. A request is only meaningful with
 * `options.structuredOutput`: the JSON schema compiles to System One questions, the
 * messages become the state, one `POST /v1/systemone` round trip returns typed answers, and
 * the rendered schema-valid JSON arrives as a single text delta. Tools are rejected up front.
 */
import type { ModelProvider, CredentialValueSource } from "@arnilo/prism";
import { trimTrailingSlashes } from "@arnilo/prism";
import { createSystemOneDecisionProvider } from "@arnilo/prism/provider-kit";
import { TYPESAFE_DEFAULT_BASE_URL } from "./models.js";

export interface TypeSafeProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Retries after the first attempt; forwarded to the shared System One client (default 2). */
  readonly maxRetries?: number;
}

export function createTypeSafeProvider(options: TypeSafeProviderOptions = {}): ModelProvider {
  return createSystemOneDecisionProvider({
    id: options.id ?? "typesafe",
    label: "TypeSafe Jev",
    baseUrl: trimTrailingSlashes(options.baseUrl ?? TYPESAFE_DEFAULT_BASE_URL),
    apiKey: options.apiKey,
    fetch: options.fetch,
    maxRetries: options.maxRetries,
  });
}
