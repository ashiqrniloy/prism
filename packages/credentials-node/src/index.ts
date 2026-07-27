export type { EncryptedCredentialStore, StoredCredentialStore } from "./encrypted-store.js";
export {
  createEncryptedCredentialStore,
  openEncryptedCredentialStore,
  rotateEncryptedCredentialStorePassphrase,
} from "./encrypted-store.js";
export { assertScryptParameters, decryptBytes, encryptBytes, resolveScryptParameters } from "./envelope.js";
export {
  CredentialDecryptError,
  CredentialStoreError,
  CredentialStoreLockedError,
  CredentialStoreTimeoutError,
  CredentialStoreUnavailableError,
  isCredentialDecryptError,
  isCredentialStoreError,
  isCredentialStoreUnavailableError,
  WeakKdfParametersError,
} from "./errors.js";
export {
  createGoogleWorkspaceOAuthProvider,
  GOOGLE_WORKSPACE_BASE_SCOPES,
  GOOGLE_WORKSPACE_SCOPE_BUNDLES,
  type GoogleWorkspaceCapability,
  type GoogleWorkspaceOAuthOptions,
  resolveGoogleWorkspaceScopes,
} from "./google-workspace-oauth.js";
export type { KeychainCredentialStore } from "./keychain-store.js";
export { createKeychainCredentialStore } from "./keychain-store.js";
export type { HostKms, HostKmsCryptoOptions, KmsEnvelope } from "./kms.js";
export {
  createMemoryHostKms,
  decryptWithHostKms,
  encryptWithHostKms,
  KMS_ENVELOPE_VERSION,
  kmsBuffersEqual,
} from "./kms.js";
export {
  DEFAULT_MAX_ENVELOPE_FILE_BYTES,
  DEFAULT_MAX_KEYCHAIN_PAYLOAD_BYTES,
  DEFAULT_MAX_SCRYPT_MEMORY_BYTES,
  DEFAULT_MAX_VAULT_BYTES,
  HARD_KEYCHAIN_TIMEOUT_MS,
  HARD_MAX_ENVELOPE_FILE_BYTES,
  HARD_MAX_KEYCHAIN_PAYLOAD_BYTES,
  HARD_MAX_SCRYPT_MEMORY_BYTES,
  HARD_MAX_VAULT_BYTES,
} from "./limits.js";
export {
  createMicrosoft365OAuthProvider,
  MICROSOFT365_BASE_SCOPES,
  MICROSOFT365_SCOPE_BUNDLES,
  type Microsoft365Capability,
  type Microsoft365OAuthOptions,
  resolveMicrosoft365Scopes,
} from "./microsoft365-oauth.js";

export {
  computeOAuth2S256Challenge,
  createOAuth2PkceVerifier,
  createOAuth2Provider,
  type OAuth2ProviderConfig,
} from "./oauth2.js";
export type { ExtendedOAuthCredentialStore } from "./resolver.js";
export { createOAuthCredentialStoreAdapter, createStoredCredentialResolver } from "./resolver.js";
export { resolveWorkloadScopes, type WorkloadScopeAccess, type WorkloadScopeBundle } from "./scopes.js";
export type {
  EncryptedCredentialStoreLimits,
  EncryptedCredentialStoreOptions,
  EncryptedEnvelope,
  KeychainCredentialStoreOptions,
  RotateEncryptedCredentialStoreOptions,
  ScryptParameters,
} from "./types.js";
export {
  DEFAULT_FILE_MODE,
  DEFAULT_KEYCHAIN_TIMEOUT_MS,
  DEFAULT_SCRYPT_KEY_LENGTH,
  DEFAULT_SCRYPT_N,
  DEFAULT_SCRYPT_P,
  DEFAULT_SCRYPT_R,
  ENVELOPE_VERSION,
  MIN_SCRYPT_N,
  VAULT_VERSION,
} from "./types.js";
export { createOAuthWorkTokenProvider, type OAuthWorkTokenOptions, type OAuthWorkTokenProvider } from "./work-token.js";
