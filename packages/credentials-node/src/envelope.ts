import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { EncryptedEnvelope, ScryptParameters } from "./types.js";
import {
  DEFAULT_SCRYPT_KEY_LENGTH,
  DEFAULT_SCRYPT_N,
  DEFAULT_SCRYPT_P,
  DEFAULT_SCRYPT_R,
  ENVELOPE_VERSION,
  MIN_SCRYPT_N,
} from "./types.js";
import { CredentialDecryptError, WeakKdfParametersError } from "./errors.js";

export function resolveScryptParameters(partial?: Partial<ScryptParameters>): ScryptParameters {
  const params: ScryptParameters = {
    N: partial?.N ?? DEFAULT_SCRYPT_N,
    r: partial?.r ?? DEFAULT_SCRYPT_R,
    p: partial?.p ?? DEFAULT_SCRYPT_P,
    keyLength: partial?.keyLength ?? DEFAULT_SCRYPT_KEY_LENGTH,
  };
  assertScryptParameters(params);
  return params;
}

export function assertScryptParameters(params: ScryptParameters): void {
  if (!Number.isInteger(params.N) || params.N < MIN_SCRYPT_N) {
    throw new WeakKdfParametersError(`scrypt N must be an integer >= ${MIN_SCRYPT_N}`);
  }
  if (!Number.isInteger(params.r) || params.r < 1) {
    throw new WeakKdfParametersError("scrypt r must be a positive integer");
  }
  if (!Number.isInteger(params.p) || params.p < 1) {
    throw new WeakKdfParametersError("scrypt p must be a positive integer");
  }
  if (!Number.isInteger(params.keyLength) || params.keyLength < 32) {
    throw new WeakKdfParametersError("scrypt keyLength must be >= 32");
  }
}

export function deriveKey(passphrase: string, salt: Buffer, params: ScryptParameters): Buffer {
  return scryptSync(passphrase, salt, params.keyLength, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 256 * 1024 * 1024,
  });
}

export function encryptBytes(plaintext: Buffer, passphrase: string, scrypt?: Partial<ScryptParameters>): EncryptedEnvelope {
  const params = resolveScryptParameters(scrypt);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt, params);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const ciphertext = Buffer.concat([encrypted, authTag]);
    return {
      version: ENVELOPE_VERSION,
      kdf: {
        algorithm: "scrypt",
        N: params.N,
        r: params.r,
        p: params.p,
        salt: salt.toString("base64"),
        keyLength: params.keyLength,
      },
      cipher: {
        algorithm: "aes-256-gcm",
        iv: iv.toString("base64"),
      },
      ciphertext: ciphertext.toString("base64"),
    };
  } finally {
    key.fill(0);
  }
}

export function decryptBytes(envelope: EncryptedEnvelope, passphrase: string): Buffer {
  if (envelope.version !== ENVELOPE_VERSION) {
    throw new CredentialDecryptError(`Unsupported envelope version: ${String(envelope.version)}`);
  }
  if (envelope.kdf.algorithm !== "scrypt" || envelope.cipher.algorithm !== "aes-256-gcm") {
    throw new CredentialDecryptError("Unsupported envelope algorithms");
  }
  const params: ScryptParameters = {
    N: envelope.kdf.N,
    r: envelope.kdf.r,
    p: envelope.kdf.p,
    keyLength: envelope.kdf.keyLength,
  };
  assertScryptParameters(params);
  const salt = Buffer.from(envelope.kdf.salt, "base64");
  const iv = Buffer.from(envelope.cipher.iv, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  if (ciphertext.length < 16) {
    throw new CredentialDecryptError("Ciphertext is too short");
  }
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const encrypted = ciphertext.subarray(0, ciphertext.length - 16);
  const key = deriveKey(passphrase, salt, params);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch {
    throw new CredentialDecryptError();
  } finally {
    key.fill(0);
  }
}

export function secureCompare(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) return false;
  return timingSafeEqual(leftBuf, rightBuf);
}

export function zeroBuffer(buffer: Buffer): void {
  buffer.fill(0);
}
