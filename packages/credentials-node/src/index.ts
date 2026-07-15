export {
  createEncryptedCredentialStore,
  openEncryptedCredentialStore,
  rotateEncryptedCredentialStorePassphrase,
} from "./encrypted-store.js";
export type { EncryptedCredentialStore, StoredCredentialStore } from "./encrypted-store.js";

export { createKeychainCredentialStore } from "./keychain-store.js";
export type { KeychainCredentialStore } from "./keychain-store.js";

export { createStoredCredentialResolver, createOAuthCredentialStoreAdapter } from "./resolver.js";
export type { ExtendedOAuthCredentialStore } from "./resolver.js";

export {
  CredentialStoreError,
  CredentialDecryptError,
  WeakKdfParametersError,
  CredentialStoreLockedError,
  CredentialStoreUnavailableError,
  CredentialStoreTimeoutError,
  isCredentialStoreError,
  isCredentialDecryptError,
  isCredentialStoreUnavailableError,
} from "./errors.js";

export {
  ENVELOPE_VERSION,
  VAULT_VERSION,
  DEFAULT_SCRYPT_N,
  DEFAULT_SCRYPT_R,
  DEFAULT_SCRYPT_P,
  DEFAULT_SCRYPT_KEY_LENGTH,
  MIN_SCRYPT_N,
  DEFAULT_FILE_MODE,
  DEFAULT_KEYCHAIN_TIMEOUT_MS,
} from "./types.js";
export type {
  ScryptParameters,
  EncryptedEnvelope,
  EncryptedCredentialStoreOptions,
  KeychainCredentialStoreOptions,
  RotateEncryptedCredentialStoreOptions,
} from "./types.js";

export { encryptBytes, decryptBytes, resolveScryptParameters, assertScryptParameters } from "./envelope.js";
