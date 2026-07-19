import { createCipheriv, createDecipheriv, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { EncryptedCredentialStoreLimits, EncryptedEnvelope, ScryptParameters } from "./types.js";
import {
  DEFAULT_SCRYPT_KEY_LENGTH,
  DEFAULT_SCRYPT_N,
  DEFAULT_SCRYPT_P,
  DEFAULT_SCRYPT_R,
  ENVELOPE_VERSION,
  MIN_SCRYPT_N,
} from "./types.js";
import { CredentialDecryptError, WeakKdfParametersError } from "./errors.js";
import {
  assertScryptWorkBounds,
  HARD_MAX_SCRYPT_MEMORY_BYTES,
  resolveEncryptedCredentialStoreLimits,
  validateCredentialLimit,
  type ResolvedEncryptedCredentialStoreLimits,
} from "./limits.js";

const SALT_BYTES = 16;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export function resolveScryptParameters(
  partial?: Partial<ScryptParameters>,
  maxMemoryBytes = resolveEncryptedCredentialStoreLimits().maxScryptMemoryBytes,
): ScryptParameters {
  const params: ScryptParameters = {
    N: partial?.N ?? DEFAULT_SCRYPT_N,
    r: partial?.r ?? DEFAULT_SCRYPT_R,
    p: partial?.p ?? DEFAULT_SCRYPT_P,
    keyLength: partial?.keyLength ?? DEFAULT_SCRYPT_KEY_LENGTH,
  };
  assertScryptParameters(params, maxMemoryBytes);
  return params;
}

export function assertScryptParameters(
  params: ScryptParameters,
  maxMemoryBytes = resolveEncryptedCredentialStoreLimits().maxScryptMemoryBytes,
): void {
  if (!Number.isSafeInteger(params.N) || params.N < MIN_SCRYPT_N) {
    throw new WeakKdfParametersError(`scrypt N must be an integer >= ${MIN_SCRYPT_N}`);
  }
  if (!Number.isSafeInteger(params.r) || params.r < 1) {
    throw new WeakKdfParametersError("scrypt r must be a positive integer");
  }
  if (!Number.isSafeInteger(params.p) || params.p < 1) {
    throw new WeakKdfParametersError("scrypt p must be a positive integer");
  }
  if (params.keyLength !== DEFAULT_SCRYPT_KEY_LENGTH) {
    throw new WeakKdfParametersError(`scrypt keyLength must be exactly ${DEFAULT_SCRYPT_KEY_LENGTH}`);
  }
  const memoryLimit = validateCredentialLimit(
    "maxScryptMemoryBytes",
    maxMemoryBytes,
    HARD_MAX_SCRYPT_MEMORY_BYTES,
  );
  assertScryptWorkBounds(params.N, params.r, params.p, memoryLimit);
}

export async function deriveKey(
  passphrase: string,
  salt: Buffer,
  params: ScryptParameters,
  maxMemoryBytes: number,
): Promise<Buffer> {
  assertScryptParameters(params, maxMemoryBytes);
  return new Promise((resolve, reject) => {
    scrypt(
      passphrase,
      salt,
      params.keyLength,
      { N: params.N, r: params.r, p: params.p, maxmem: maxMemoryBytes },
      (error, key) => error ? reject(error) : resolve(key),
    );
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function decodeBase64(value: unknown, name: string, maxBytes: number, exactBytes?: number): Buffer {
  if (typeof value !== "string" || value.length > Math.ceil(maxBytes / 3) * 4 || value.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new CredentialDecryptError(`Invalid ${name}`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length > maxBytes || (exactBytes !== undefined && decoded.length !== exactBytes) || decoded.toString("base64") !== value) {
    throw new CredentialDecryptError(`Invalid ${name}`);
  }
  return decoded;
}

export function parseEncryptedEnvelope(
  value: unknown,
  limits: ResolvedEncryptedCredentialStoreLimits = resolveEncryptedCredentialStoreLimits(),
): EncryptedEnvelope {
  if (!isObject(value) || !hasExactKeys(value, ["version", "kdf", "cipher", "ciphertext"]) ||
      value.version !== ENVELOPE_VERSION || !isObject(value.kdf) || !isObject(value.cipher) ||
      !hasExactKeys(value.kdf, ["algorithm", "N", "r", "p", "salt", "keyLength"]) ||
      !hasExactKeys(value.cipher, ["algorithm", "iv"]) || value.kdf.algorithm !== "scrypt" ||
      value.cipher.algorithm !== "aes-256-gcm") {
    throw new CredentialDecryptError("Invalid encrypted credential envelope");
  }
  const params: ScryptParameters = {
    N: value.kdf.N as number,
    r: value.kdf.r as number,
    p: value.kdf.p as number,
    keyLength: value.kdf.keyLength as number,
  };
  assertScryptParameters(params, limits.maxScryptMemoryBytes);
  decodeBase64(value.kdf.salt, "scrypt salt", SALT_BYTES, SALT_BYTES);
  decodeBase64(value.cipher.iv, "cipher IV", IV_BYTES, IV_BYTES);
  const ciphertext = decodeBase64(value.ciphertext, "ciphertext", limits.maxVaultBytes + AUTH_TAG_BYTES);
  if (ciphertext.length < AUTH_TAG_BYTES) throw new CredentialDecryptError("Ciphertext is too short");
  return value as unknown as EncryptedEnvelope;
}

export async function encryptBytes(
  plaintext: Buffer,
  passphrase: string,
  scryptOptions?: Partial<ScryptParameters>,
  limitOptions?: EncryptedCredentialStoreLimits,
): Promise<EncryptedEnvelope> {
  const limits = resolveEncryptedCredentialStoreLimits(limitOptions);
  if (plaintext.length > limits.maxVaultBytes) throw new RangeError(`Plaintext exceeds ${limits.maxVaultBytes} byte limit`);
  const params = resolveScryptParameters(scryptOptions, limits.maxScryptMemoryBytes);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(passphrase, salt, params, limits.maxScryptMemoryBytes);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const ciphertext = Buffer.concat([encrypted, cipher.getAuthTag()]);
    return {
      version: ENVELOPE_VERSION,
      kdf: { algorithm: "scrypt", N: params.N, r: params.r, p: params.p, salt: salt.toString("base64"), keyLength: params.keyLength },
      cipher: { algorithm: "aes-256-gcm", iv: iv.toString("base64") },
      ciphertext: ciphertext.toString("base64"),
    };
  } finally {
    key.fill(0);
  }
}

export async function decryptBytes(
  input: EncryptedEnvelope,
  passphrase: string,
  limitOptions?: EncryptedCredentialStoreLimits,
): Promise<Buffer> {
  const limits = resolveEncryptedCredentialStoreLimits(limitOptions);
  const envelope = parseEncryptedEnvelope(input, limits);
  const params: ScryptParameters = { N: envelope.kdf.N, r: envelope.kdf.r, p: envelope.kdf.p, keyLength: envelope.kdf.keyLength };
  const salt = decodeBase64(envelope.kdf.salt, "scrypt salt", SALT_BYTES, SALT_BYTES);
  const iv = decodeBase64(envelope.cipher.iv, "cipher IV", IV_BYTES, IV_BYTES);
  const ciphertext = decodeBase64(envelope.ciphertext, "ciphertext", limits.maxVaultBytes + AUTH_TAG_BYTES);
  if (ciphertext.length < AUTH_TAG_BYTES) throw new CredentialDecryptError("Ciphertext is too short");
  const encrypted = ciphertext.subarray(0, -AUTH_TAG_BYTES);
  const authTag = ciphertext.subarray(-AUTH_TAG_BYTES);
  const key = await deriveKey(passphrase, salt, params, limits.maxScryptMemoryBytes);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    if (plaintext.length > limits.maxVaultBytes) {
      plaintext.fill(0);
      throw new CredentialDecryptError("Credential vault exceeds byte limit");
    }
    return plaintext;
  } catch (error) {
    if (error instanceof CredentialDecryptError) throw error;
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
