export const ENVELOPE_VERSION = 1 as const;
export const VAULT_VERSION = 1 as const;

export const DEFAULT_SCRYPT_N = 32768;
export const DEFAULT_SCRYPT_R = 8;
export const DEFAULT_SCRYPT_P = 1;
export const DEFAULT_SCRYPT_KEY_LENGTH = 32;
export const MIN_SCRYPT_N = 16384;

export const DEFAULT_FILE_MODE = 0o600;
export const DEFAULT_KEYCHAIN_TIMEOUT_MS = 5000;

export interface EncryptedCredentialStoreLimits {
  readonly maxFileBytes?: number;
  readonly maxVaultBytes?: number;
  readonly maxScryptMemoryBytes?: number;
}

export interface ScryptParameters {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly keyLength: number;
}

export interface EncryptedEnvelope {
  readonly version: typeof ENVELOPE_VERSION;
  readonly kdf: {
    readonly algorithm: "scrypt";
    readonly N: number;
    readonly r: number;
    readonly p: number;
    readonly salt: string;
    readonly keyLength: number;
  };
  readonly cipher: {
    readonly algorithm: "aes-256-gcm";
    readonly iv: string;
  };
  readonly ciphertext: string;
}

export interface VaultOAuthEntry {
  readonly kind: "oauth";
  readonly provider: string;
  readonly accountId?: string;
  readonly credentials: import("@arnilo/prism").OAuthCredentials;
  readonly updatedAt: string;
}

export interface VaultCredentialEntry {
  readonly kind: "credential";
  readonly name: string;
  readonly provider?: string;
  readonly credential: import("@arnilo/prism").Credential;
  readonly updatedAt: string;
}

export type VaultEntry = VaultOAuthEntry | VaultCredentialEntry;

export interface CredentialVault {
  readonly version: typeof VAULT_VERSION;
  readonly entries: Record<string, VaultEntry>;
}

export interface EncryptedCredentialStoreOptions {
  readonly path: string;
  readonly getPassphrase: () => string | Promise<string>;
  readonly scrypt?: Partial<ScryptParameters>;
  readonly fileMode?: number;
  readonly limits?: EncryptedCredentialStoreLimits;
}

export interface KeychainCredentialStoreOptions {
  readonly service: string;
  readonly namespace?: string;
  readonly timeoutMs?: number;
  readonly maxPayloadBytes?: number;
}

export interface RotateEncryptedCredentialStoreOptions {
  readonly path: string;
  readonly getCurrentPassphrase: () => string | Promise<string>;
  readonly getNewPassphrase: () => string | Promise<string>;
  readonly scrypt?: Partial<ScryptParameters>;
  readonly fileMode?: number;
  readonly limits?: EncryptedCredentialStoreLimits;
}
