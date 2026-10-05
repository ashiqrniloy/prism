import type { ModelProvider, ModelSpec, Secret } from "../contracts.js";
import { CredentialUnavailableError } from "../credentials/errors.js";
import { createOpenAICompatibleProvider } from "../provider-kit/openai-compatible.js";
import { trimTrailingSlashes } from "../trim-trailing-slashes.js";
import { ModelRefError } from "./ref.js";

// Re-exported here because the root barrel has always published it from this module (plan 152
// follow-up moved the declaration to the leaf `credentials/errors.ts`).
export { CredentialUnavailableError };

/** The id of the provider the kernel ships. It is registered first and reserved: a package cannot take it. */
export const BUILTIN_PROVIDER_ID = "openai-compatible";

export interface BuiltinProviderOptions {
  /** Resolves a ref through the `credentials` slot. Called on every request, never at construction. */
  readonly resolveCredential: (ref: string) => Promise<Secret | undefined> | Secret | undefined;
  readonly fetch?: typeof fetch;
}

/**
 * The kernel's one provider (roadmap §2.1): any OpenAI-compatible Chat Completions endpoint. It is built
 * once per agent and reads `baseUrl` and `credential` from each request's `ModelSpec`, so a run can point
 * it at another endpoint without a second instance.
 */
export function createBuiltinProvider(options: BuiltinProviderOptions): ModelProvider {
  const inner = createOpenAICompatibleProvider({
    id: BUILTIN_PROVIDER_ID,
    baseUrl: "",
    fetch: options.fetch,
    chatCompletionsUrl: (request) => `${trimTrailingSlashes((request.model as ModelSpec).baseUrl as string)}/chat/completions`,
    async resolveApiKey(request) {
      const ref = (request.model as ModelSpec).credential;
      if (ref === undefined) return undefined;
      const credential = await options.resolveCredential(ref);
      if (!credential?.value) throw new CredentialUnavailableError(ref);
      return credential.value;
    },
  });
  return {
    id: BUILTIN_PROVIDER_ID,
    async *generate(request) {
      if (typeof request.model.baseUrl !== "string" || request.model.baseUrl.length === 0) {
        throw new ModelRefError(`Provider ${BUILTIN_PROVIDER_ID} needs a baseUrl on the model reference`);
      }
      yield* inner.generate(request);
    },
  };
}
