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
