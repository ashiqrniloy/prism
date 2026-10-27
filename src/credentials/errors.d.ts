/**
 * The credential-ref error, kept in its own leaf module: `models/builtin.ts` throws it and
 * `provider-kit/provider-package.ts` throws it from a shared ref source, so a shared leaf keeps
 * the provider seam off the built-in provider module (plan 152 follow-up: no kernel-internal cycle).
 */
/** A `ModelSpec.credential` ref no slot could resolve. The message names the ref, never a value. */
export declare class CredentialUnavailableError extends Error {
    readonly ref: string;
    readonly code = "credential_unavailable";
    constructor(ref: string);
}
/**
 * A write through `credentials.store`/`delete` named a ref that cannot be written. `env:` is never
 * writable: the environment belongs to the host, not the package. The code matches the one the
 * keyring throws for a scheme it cannot write, so one refusal has one spelling.
 */
export declare class CredentialRefNotWritableError extends Error {
    readonly ref: string;
    readonly code = "credential_ref_unsupported";
    constructor(ref: string);
}
/** `credentials.store`/`delete` ran against a credentials slot that declares no write support. */
export declare class CredentialStoreUnavailableError extends Error {
    readonly ref: string;
    readonly code = "credential_store_unavailable";
    constructor(ref: string);
}
