/**
 * The credential-ref error, kept in its own leaf module: `models/builtin.ts` throws it and
 * `provider-kit/provider-package.ts` throws it from a shared ref source, so a shared leaf keeps
 * the provider seam off the built-in provider module (plan 152 follow-up: no kernel-internal cycle).
 */

/** A `ModelSpec.credential` ref no slot could resolve. The message names the ref, never a value. */
export class CredentialUnavailableError extends Error {
  readonly code = "credential_unavailable";
  constructor(readonly ref: string) {
    super(`Credential ${ref} is unavailable: the credentials slot could not resolve it`);
    this.name = "CredentialUnavailableError";
  }
}

/**
 * A write through `credentials.store`/`delete` named a ref that cannot be written. `env:` is never
 * writable: the environment belongs to the host, not the package. The code matches the one the
 * keyring throws for a scheme it cannot write, so one refusal has one spelling.
 */
export class CredentialRefNotWritableError extends Error {
  readonly code = "credential_ref_unsupported";
  constructor(readonly ref: string) {
    super(`Credential ${ref} is not writable: env: refs belong to the host`);
    this.name = "CredentialRefNotWritableError";
  }
}

/** `credentials.store`/`delete` ran against a credentials slot that declares no write support. */
export class CredentialStoreUnavailableError extends Error {
  readonly code = "credential_store_unavailable";
  constructor(readonly ref: string) {
    super(`Credential ${ref} cannot be written: the credentials slot has no store`);
    this.name = "CredentialStoreUnavailableError";
  }
}
