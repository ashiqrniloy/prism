import type { ModelProvider, Secret } from "../contracts.js";
import { CredentialUnavailableError } from "../credentials/errors.js";
export { CredentialUnavailableError };
/** The id of the provider the kernel ships. It is registered first and reserved: a package cannot take it. */
export declare const BUILTIN_PROVIDER_ID = "openai-compatible";
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
export declare function createBuiltinProvider(options: BuiltinProviderOptions): ModelProvider;
