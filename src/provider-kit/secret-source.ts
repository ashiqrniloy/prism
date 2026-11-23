/**
 * Kernel-internal (not exported from `provider-kit`): where a source built by `refSource` / `optionalRefSource`
 * keeps its request-aware variant. The routed provider calls it with the request it is serving, so the credentials
 * slot learns the call's session and principal (`CredentialContext`). A hand-written `SecretSource` has none and
 * is called as before.
 */
export const SECRET_SOURCE_FOR_REQUEST: unique symbol = Symbol("prism.secretSource.forRequest");
