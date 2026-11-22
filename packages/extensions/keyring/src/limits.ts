import { WeakKdfParametersError } from "./errors.js";
import type { EncryptedCredentialStoreLimits } from "./types.js";

export const DEFAULT_MAX_ENVELOPE_FILE_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_VAULT_BYTES = 3 * 1024 * 1024;
export const DEFAULT_MAX_SCRYPT_MEMORY_BYTES = 256 * 1024 * 1024;
export const DEFAULT_MAX_KEYCHAIN_PAYLOAD_BYTES = 3 * 1024 * 1024;
/** A host-KMS wrap or unwrap call's timeout; `HostKmsCryptoOptions.timeoutMs`. */
export const DEFAULT_KMS_TIMEOUT_MS = 60_000;

export interface ResolvedEncryptedCredentialStoreLimits {
  readonly maxFileBytes: number;
  readonly maxVaultBytes: number;
  readonly maxScryptMemoryBytes: number;
}

/** A host-set credential-store limit: a positive safe integer. The host's value is the cap (plan 239 Task 5). */
export function validateCredentialLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

export function resolveEncryptedCredentialStoreLimits(limits?: EncryptedCredentialStoreLimits): ResolvedEncryptedCredentialStoreLimits {
  return {
    maxFileBytes: validateCredentialLimit("limits.maxFileBytes", limits?.maxFileBytes ?? DEFAULT_MAX_ENVELOPE_FILE_BYTES),
    maxVaultBytes: validateCredentialLimit("limits.maxVaultBytes", limits?.maxVaultBytes ?? DEFAULT_MAX_VAULT_BYTES),
    maxScryptMemoryBytes: validateCredentialLimit(
      "limits.maxScryptMemoryBytes",
      limits?.maxScryptMemoryBytes ?? DEFAULT_MAX_SCRYPT_MEMORY_BYTES,
    ),
  };
}

export function assertScryptWorkBounds(N: number, r: number, p: number, maxMemoryBytes: number): void {
  if (N > 262_144) throw new WeakKdfParametersError("scrypt N must be <= 262144");
  if (r > 32) throw new WeakKdfParametersError("scrypt r must be <= 32");
  if (p > 16) throw new WeakKdfParametersError("scrypt p must be <= 16");
  if ((N & (N - 1)) !== 0) throw new WeakKdfParametersError("scrypt N must be a power of two");
  if (N * r * p > 2_097_152) throw new WeakKdfParametersError("scrypt work exceeds the supported limit");
  if (128 * N * r > maxMemoryBytes) throw new WeakKdfParametersError("scrypt memory exceeds the configured limit");
}
