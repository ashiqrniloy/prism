import { Entry } from "@napi-rs/keyring";
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
  vaultToCredentialRecords,
  listOAuthEntries,
  createEmptyVault,
} from "./vault.js";
import type { StoredCredentialStore } from "./encrypted-store.js";

function mapKeychainError(error: unknown): never {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("timeout")) {
    throw new CredentialStoreTimeoutError();
  }
  if (message.includes("denied") || message.includes("locked") || message.includes("permission")) {
    throw new CredentialStoreLockedError();
  }
  if (
    message.includes("no secret service") ||
    message.includes("unsupported platform") ||
    message.includes("not found") ||
    message.includes("unavailable")
  ) {
    throw new CredentialStoreUnavailableError();
  }
  throw error instanceof Error ? error : new Error(String(error));
}

async function withTimeout<T>(operation: () => T | Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new CredentialStoreTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function readEntry(entry: Entry): string | undefined {
  try {
    const value = entry.getPassword();
    return value ?? undefined;
  } catch (error) {
    mapKeychainError(error);
  }
}

function writeEntry(entry: Entry, value: string): void {
  try {
    entry.setPassword(value);
  } catch (error) {
    mapKeychainError(error);
  }
}

function deleteEntry(entry: Entry): void {
  try {
    entry.deletePassword();
  } catch (error) {
    mapKeychainError(error);
  }
}

export interface KeychainCredentialStore extends StoredCredentialStore {
  readonly service: string;
  readonly namespace?: string;
}

export function createKeychainCredentialStore(options: KeychainCredentialStoreOptions): KeychainCredentialStore {
  const timeoutMs = options.timeoutMs ?? DEFAULT_KEYCHAIN_TIMEOUT_MS;

  const accountForKey = (key: string) => keychainAccountName(options.namespace, key);
  const entryForKey = (key: string) => new Entry(options.service, accountForKey(key));

  const readVaultForKey = async (key: string) => {
    const payload = await withTimeout(() => readEntry(entryForKey(key)), timeoutMs);
    if (!payload) return undefined;
    return parseVault(Buffer.from(payload, "utf8"));
  };

  const writeVaultForKey = async (key: string, vaultBytes: Buffer) => {
    await withTimeout(() => writeEntry(entryForKey(key), vaultBytes.toString("utf8")), timeoutMs);
  };

  const deleteKey = async (key: string) => {
    await withTimeout(() => deleteEntry(entryForKey(key)), timeoutMs);
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
      const next = upsertCredentialEntry(existing, record);
      await writeVaultForKey(key, serializeVault(next));
    },
    async delete(request) {
      const key = credentialKey(request.name, request.provider);
      const existing = await readVaultForKey(key);
      if (!existing) return false;
      const result = deleteCredentialEntry(existing, request.name, request.provider);
      if (!result.deleted) return false;
      if (Object.keys(result.vault.entries).length === 0) {
        await deleteKey(key);
      } else {
        await writeVaultForKey(key, serializeVault(result.vault));
      }
      return true;
    },
    async setOAuth(provider, credentials, accountId) {
      const key = oauthKey(provider, accountId);
      const existing = (await readVaultForKey(key)) ?? createEmptyVault();
      const next = upsertOAuthEntry(existing, provider, credentials, accountId);
      await writeVaultForKey(key, serializeVault(next));
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
      if (Object.keys(result.vault.entries).length === 0) {
        await deleteKey(key);
      } else {
        await writeVaultForKey(key, serializeVault(result.vault));
      }
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
