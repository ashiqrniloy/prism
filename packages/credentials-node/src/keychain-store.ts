import { AsyncEntry } from "@napi-rs/keyring";
import type { Credential, CredentialRequest, OAuthCredentials } from "@arnilo/prism";
import type { CredentialRecord } from "@arnilo/prism";
import type { KeychainCredentialStoreOptions } from "./types.js";
import { DEFAULT_KEYCHAIN_TIMEOUT_MS } from "./types.js";
import {
  CredentialStoreLockedError,
  CredentialStoreTimeoutError,
  CredentialStoreUnavailableError,
} from "./errors.js";
import {
  DEFAULT_MAX_KEYCHAIN_PAYLOAD_BYTES,
  HARD_KEYCHAIN_TIMEOUT_MS,
  HARD_MAX_KEYCHAIN_PAYLOAD_BYTES,
  validateCredentialLimit,
} from "./limits.js";
import {
  credentialKey,
  keychainAccountName,
  oauthKey,
  parseVault,
  serializeVault,
  upsertCredentialEntry,
  deleteCredentialEntry,
  upsertOAuthEntry,
  deleteOAuthEntry,
  getCredentialEntry,
  getOAuthEntry,
  createEmptyVault,
} from "./vault.js";
import type { StoredCredentialStore } from "./encrypted-store.js";

function mapKeychainError(error: unknown): never {
  if (error instanceof CredentialStoreTimeoutError) throw error;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("denied") || message.includes("locked") || message.includes("permission")) {
    throw new CredentialStoreLockedError();
  }
  throw new CredentialStoreUnavailableError();
}

/** Run one native async keychain operation with a main-loop timer and cancellation signal. */
// ponytail: AsyncEntry already isolates native work; use a child process only if a backend ignores abort and exhausts libuv workers.
export async function runKeychainOperation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new CredentialStoreTimeoutError());
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (timedOut) throw new CredentialStoreTimeoutError();
    return mapKeychainError(error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface KeychainCredentialStore extends StoredCredentialStore {
  readonly service: string;
  readonly namespace?: string;
}

export function createKeychainCredentialStore(options: KeychainCredentialStoreOptions): KeychainCredentialStore {
  const timeoutMs = validateCredentialLimit(
    "timeoutMs",
    options.timeoutMs ?? DEFAULT_KEYCHAIN_TIMEOUT_MS,
    HARD_KEYCHAIN_TIMEOUT_MS,
  );
  const maxPayloadBytes = validateCredentialLimit(
    "maxPayloadBytes",
    options.maxPayloadBytes ?? DEFAULT_MAX_KEYCHAIN_PAYLOAD_BYTES,
    HARD_MAX_KEYCHAIN_PAYLOAD_BYTES,
  );
  const accountForKey = (key: string) => keychainAccountName(options.namespace, key);

  const readVaultForKey = async (key: string) => {
    const payload = await runKeychainOperation(
      (signal) => new AsyncEntry(options.service, accountForKey(key)).getSecret(signal),
      timeoutMs,
    );
    if (!payload) return undefined;
    // Linux Secret Service returns number[] here despite AsyncEntry declaring Uint8Array.
    const payloadLength = payload.byteLength ?? payload.length;
    if (!Number.isSafeInteger(payloadLength)) throw new CredentialStoreUnavailableError();
    if (payloadLength > maxPayloadBytes) throw new RangeError(`Keychain payload exceeds ${maxPayloadBytes} byte limit`);
    const bytes = Buffer.from(payload);
    try {
      return parseVault(bytes, maxPayloadBytes);
    } finally {
      bytes.fill(0);
    }
  };

  const writeVaultForKey = async (key: string, vaultBytes: Buffer) => {
    try {
      await runKeychainOperation(
        (signal) => new AsyncEntry(options.service, accountForKey(key)).setSecret(vaultBytes, signal),
        timeoutMs,
      );
    } finally {
      vaultBytes.fill(0);
    }
  };

  const deleteKey = async (key: string) => {
    await runKeychainOperation(
      (signal) => new AsyncEntry(options.service, accountForKey(key)).deleteCredential(signal),
      timeoutMs,
    );
  };

  const store: KeychainCredentialStore = {
    service: options.service,
    namespace: options.namespace,
    async resolve(request) {
      const vault = await readVaultForKey(credentialKey(request.name, request.provider));
      return vault ? getCredentialEntry(vault, request.name, request.provider) : undefined;
    },
    async get(request) {
      return store.resolve(request);
    },
    async set(record) {
      const key = credentialKey(record.name, record.provider);
      const existing = (await readVaultForKey(key)) ?? createEmptyVault();
      await writeVaultForKey(key, serializeVault(upsertCredentialEntry(existing, record), maxPayloadBytes));
    },
    async delete(request) {
      const key = credentialKey(request.name, request.provider);
      const existing = await readVaultForKey(key);
      if (!existing) return false;
      const result = deleteCredentialEntry(existing, request.name, request.provider);
      if (!result.deleted) return false;
      if (Object.keys(result.vault.entries).length === 0) await deleteKey(key);
      else await writeVaultForKey(key, serializeVault(result.vault, maxPayloadBytes));
      return true;
    },
    async setOAuth(provider, credentials, accountId) {
      const key = oauthKey(provider, accountId);
      const existing = (await readVaultForKey(key)) ?? createEmptyVault();
      await writeVaultForKey(key, serializeVault(upsertOAuthEntry(existing, provider, credentials, accountId), maxPayloadBytes));
    },
    async getOAuth(provider, accountId) {
      const vault = await readVaultForKey(oauthKey(provider, accountId));
      return vault ? getOAuthEntry(vault, provider, accountId) : undefined;
    },
    async deleteOAuth(provider, accountId) {
      const key = oauthKey(provider, accountId);
      const existing = await readVaultForKey(key);
      if (!existing) return false;
      const result = deleteOAuthEntry(existing, provider, accountId);
      if (!result.deleted) return false;
      if (Object.keys(result.vault.entries).length === 0) await deleteKey(key);
      else await writeVaultForKey(key, serializeVault(result.vault, maxPayloadBytes));
      return true;
    },
    async list() {
      throw new CredentialStoreUnavailableError("Keychain store does not support list(); use explicit get/delete per credential");
    },
    async listOAuth() {
      throw new CredentialStoreUnavailableError("Keychain store does not support listOAuth(); use explicit get/delete per OAuth account");
    },
  };

  return store;
}
