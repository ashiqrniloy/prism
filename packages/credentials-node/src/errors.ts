export class CredentialStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CredentialStoreError";
    this.code = code;
  }
}

export class CredentialDecryptError extends CredentialStoreError {
  constructor(message = "Failed to decrypt credential store; wrong passphrase or tampered file") {
    super("credential_decrypt_failed", message);
    this.name = "CredentialDecryptError";
  }
}

export class WeakKdfParametersError extends CredentialStoreError {
  constructor(message = "scrypt work factor is below the documented minimum") {
    super("weak_kdf_parameters", message);
    this.name = "WeakKdfParametersError";
  }
}

export class CredentialStoreLockedError extends CredentialStoreError {
  constructor(message = "Credential store is locked or access was denied") {
    super("credential_store_locked", message);
    this.name = "CredentialStoreLockedError";
  }
}

export class CredentialStoreUnavailableError extends CredentialStoreError {
  constructor(message = "System keychain backend is unavailable") {
    super("credential_store_unavailable", message);
    this.name = "CredentialStoreUnavailableError";
  }
}

export class CredentialStoreTimeoutError extends CredentialStoreError {
  constructor(message = "Credential store operation timed out") {
    super("credential_store_timeout", message);
    this.name = "CredentialStoreTimeoutError";
  }
}

export function isCredentialStoreError(error: unknown): error is CredentialStoreError {
  return error instanceof CredentialStoreError;
}

export function isCredentialDecryptError(error: unknown): error is CredentialDecryptError {
  return error instanceof CredentialDecryptError;
}

export function isCredentialStoreUnavailableError(error: unknown): error is CredentialStoreUnavailableError {
  return error instanceof CredentialStoreUnavailableError;
}
