import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import {
  DEFAULT_MAX_VAULT_BYTES,
  HARD_MAX_ENVELOPE_FILE_BYTES,
  HARD_KEYCHAIN_TIMEOUT_MS,
  resolveEncryptedCredentialStoreLimits,
} from "./limits.js";
import { CredentialDecryptError, CredentialStoreTimeoutError } from "./errors.js";

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const DEK_BYTES = 32;
export const KMS_ENVELOPE_VERSION = 1 as const;

/** Host KMS / HSM wrap-unwrap seam. Never log key material. */
export interface HostKms {
  wrapKey(plaintextDek: Uint8Array, signal?: AbortSignal): Promise<Uint8Array>;
  unwrapKey(wrappedDek: Uint8Array, signal?: AbortSignal): Promise<Uint8Array>;
}

export interface KmsEnvelope {
  readonly version: typeof KMS_ENVELOPE_VERSION;
  readonly algorithm: "aes-256-gcm";
  readonly iv: string;
  readonly tag: string;
  readonly wrappedDek: string;
  readonly ciphertext: string;
}

export interface HostKmsCryptoOptions {
  readonly maxPlaintextBytes?: number;
  /** Hard cap 60s (Phase 8 freeze). Default 60s. */
  readonly timeoutMs?: number;
}

/** Encrypt with a random DEK; host KMS wraps the DEK. Reuses envelope size caps. */
export async function encryptWithHostKms(
  plaintext: Uint8Array,
  kms: HostKms,
  options: HostKmsCryptoOptions = {},
): Promise<KmsEnvelope> {
  const maxPlaintext = options.maxPlaintextBytes ?? DEFAULT_MAX_VAULT_BYTES;
  const fileCap = resolveEncryptedCredentialStoreLimits().maxFileBytes;
  if (!Number.isSafeInteger(maxPlaintext) || maxPlaintext < 1 || maxPlaintext > HARD_MAX_ENVELOPE_FILE_BYTES) {
    throw new RangeError(`maxPlaintextBytes must be 1..${HARD_MAX_ENVELOPE_FILE_BYTES}`);
  }
  if (plaintext.byteLength > maxPlaintext) throw new RangeError(`Plaintext exceeds ${maxPlaintext} byte limit`);
  const dek = randomBytes(DEK_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", dek, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  const wrappedDek = await withTimeout(kms.wrapKey(dek, undefined), options.timeoutMs);
  zero(dek);
  const envelope: KmsEnvelope = {
    version: KMS_ENVELOPE_VERSION,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    wrappedDek: Buffer.from(wrappedDek).toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  if (Buffer.byteLength(JSON.stringify(envelope), "utf8") > fileCap) {
    throw new RangeError(`KMS envelope exceeds ${fileCap} byte limit`);
  }
  return envelope;
}

export async function decryptWithHostKms(
  envelope: KmsEnvelope,
  kms: HostKms,
  options: HostKmsCryptoOptions = {},
): Promise<Buffer> {
  if (envelope.version !== KMS_ENVELOPE_VERSION || envelope.algorithm !== "aes-256-gcm") {
    throw new CredentialDecryptError("Unsupported KMS envelope");
  }
  const maxPlaintext = options.maxPlaintextBytes ?? DEFAULT_MAX_VAULT_BYTES;
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const wrappedDek = Buffer.from(envelope.wrappedDek, "base64");
  if (iv.byteLength !== IV_BYTES || tag.byteLength !== AUTH_TAG_BYTES) {
    throw new CredentialDecryptError("Malformed KMS envelope");
  }
  let dek: Buffer | undefined;
  try {
    dek = Buffer.from(await withTimeout(kms.unwrapKey(wrappedDek, undefined), options.timeoutMs));
    if (dek.byteLength !== DEK_BYTES) throw new CredentialDecryptError("Invalid unwrapped DEK length");
    const decipher = createDecipheriv("aes-256-gcm", dek, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (plaintext.byteLength > maxPlaintext) throw new CredentialDecryptError("Plaintext exceeds limit");
    return plaintext;
  } catch (error) {
    if (error instanceof CredentialDecryptError || error instanceof CredentialStoreTimeoutError || error instanceof RangeError) throw error;
    throw new CredentialDecryptError("KMS envelope decrypt failed");
  } finally {
    if (dek) zero(dek);
  }
}

/** In-memory KMS mock for tests / single-process hosts (not production HSM). */
export function createMemoryHostKms(seed = "prism-test-kms"): HostKms {
  const master = Buffer.from(seed.padEnd(32, "0").slice(0, 32));
  return {
    async wrapKey(plaintextDek) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", master, iv);
      const body = Buffer.concat([cipher.update(Buffer.from(plaintextDek)), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, body]);
    },
    async unwrapKey(wrappedDek) {
      const buf = Buffer.from(wrappedDek);
      if (buf.byteLength < IV_BYTES + AUTH_TAG_BYTES + DEK_BYTES) throw new CredentialDecryptError("wrapped DEK too short");
      const iv = buf.subarray(0, IV_BYTES);
      const tag = buf.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
      const body = buf.subarray(IV_BYTES + AUTH_TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", master, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]);
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = HARD_KEYCHAIN_TIMEOUT_MS): Promise<T> {
  const ms = timeoutMs ?? HARD_KEYCHAIN_TIMEOUT_MS;
  if (!Number.isSafeInteger(ms) || ms < 1 || ms > HARD_KEYCHAIN_TIMEOUT_MS) {
    throw new RangeError(`timeoutMs must be 1..${HARD_KEYCHAIN_TIMEOUT_MS}`);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new CredentialStoreTimeoutError("Host KMS timed out")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function zero(buf: Buffer): void {
  buf.fill(0);
}

/** timing-safe compare helper for hosts verifying wrapped key lengths. */
export function kmsBuffersEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
