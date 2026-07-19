import type { Credential, CredentialRequest, OAuthCredentials } from "@arnilo/prism";
import type { CredentialRecord } from "@arnilo/prism";
import type {
  EncryptedCredentialStoreOptions,
  EncryptedEnvelope,
  RotateEncryptedCredentialStoreOptions,
} from "./types.js";
import { DEFAULT_FILE_MODE } from "./types.js";
import { CredentialDecryptError, CredentialStoreError, WeakKdfParametersError } from "./errors.js";
import { decryptBytes, encryptBytes, parseEncryptedEnvelope, resolveScryptParameters } from "./envelope.js";
import { atomicWriteFile, assertCredentialFileMode, readFileIfExists } from "./file-io.js";
import { resolveEncryptedCredentialStoreLimits, type ResolvedEncryptedCredentialStoreLimits } from "./limits.js";
import {
  createEmptyVault,
  deleteCredentialEntry,
  deleteOAuthEntry,
  getCredentialEntry,
  getOAuthEntry,
  listOAuthEntries,
  parseVault,
  serializeVault,
  upsertCredentialEntry,
  upsertOAuthEntry,
  vaultToCredentialRecords,
} from "./vault.js";

export interface StoredCredentialStore {
  resolve(request: CredentialRequest): Credential | undefined | Promise<Credential | undefined>;
  set(record: CredentialRecord): void | Promise<void>;
  delete(request: Pick<CredentialRequest, "name" | "provider">): boolean | Promise<boolean>;
  get(request: Pick<CredentialRequest, "name" | "provider">): Credential | undefined | Promise<Credential | undefined>;
  setOAuth(provider: string, credentials: OAuthCredentials, accountId?: string): void | Promise<void>;
  getOAuth(provider: string, accountId?: string): OAuthCredentials | undefined | Promise<OAuthCredentials | undefined>;
  deleteOAuth(provider: string, accountId?: string): boolean | Promise<boolean>;
  list(): CredentialRecord[] | Promise<CredentialRecord[]>;
  listOAuth(): Array<{ provider: string; accountId?: string; credentials: OAuthCredentials }> | Promise<Array<{ provider: string; accountId?: string; credentials: OAuthCredentials }>>;
}

export interface EncryptedCredentialStore extends StoredCredentialStore {
  readonly path: string;
  reload(): void | Promise<void>;
  flush(): void | Promise<void>;
}

async function resolvePassphrase(getPassphrase: () => string | Promise<string>): Promise<string> {
  try {
    const passphrase = await getPassphrase();
    if (typeof passphrase !== "string") throw new Error();
    return passphrase;
  } catch {
    throw new CredentialStoreError("credential_passphrase_failed", "Credential passphrase retrieval failed");
  }
}

function readEnvelope(path: string, limits: ResolvedEncryptedCredentialStoreLimits): EncryptedEnvelope | undefined {
  const raw = readFileIfExists(path, limits.maxFileBytes);
  if (!raw) return undefined;
  try {
    return parseEncryptedEnvelope(JSON.parse(raw.toString("utf8")), limits);
  } catch (error) {
    if (error instanceof CredentialDecryptError || error instanceof WeakKdfParametersError) throw error;
    throw new CredentialDecryptError("Invalid encrypted credential envelope");
  }
}

function writeEnvelope(
  path: string,
  envelope: EncryptedEnvelope,
  fileMode: number,
  maxFileBytes: number,
): void {
  const bytes = Buffer.from(JSON.stringify(envelope), "utf8");
  if (bytes.length > maxFileBytes) throw new RangeError(`Credential envelope exceeds ${maxFileBytes} byte limit`);
  atomicWriteFile(path, bytes, fileMode);
}

export function createEncryptedCredentialStore(options: EncryptedCredentialStoreOptions): EncryptedCredentialStore {
  const fileMode = options.fileMode ?? DEFAULT_FILE_MODE;
  assertCredentialFileMode(fileMode);
  const limits = resolveEncryptedCredentialStoreLimits(options.limits);
  const scrypt = resolveScryptParameters(options.scrypt, limits.maxScryptMemoryBytes);
  let vault = createEmptyVault();

  const persist = async (nextVault = vault): Promise<void> => {
    const plaintext = serializeVault(nextVault, limits.maxVaultBytes);
    try {
      const passphrase = await resolvePassphrase(options.getPassphrase);
      const envelope = await encryptBytes(plaintext, passphrase, scrypt, limits);
      writeEnvelope(options.path, envelope, fileMode, limits.maxFileBytes);
      vault = nextVault;
    } finally {
      plaintext.fill(0);
    }
  };

  const load = async (): Promise<void> => {
    const existing = readEnvelope(options.path, limits);
    if (!existing) {
      vault = createEmptyVault();
      return;
    }
    const passphrase = await resolvePassphrase(options.getPassphrase);
    const plaintext = await decryptBytes(existing, passphrase, limits);
    try {
      vault = parseVault(plaintext, limits.maxVaultBytes);
    } finally {
      plaintext.fill(0);
    }
  };

  return {
    path: options.path,
    async resolve(request) {
      return getCredentialEntry(vault, request.name, request.provider);
    },
    async get(request) {
      return getCredentialEntry(vault, request.name, request.provider);
    },
    async set(record) {
      await persist(upsertCredentialEntry(vault, record));
    },
    async delete(request) {
      const result = deleteCredentialEntry(vault, request.name, request.provider);
      if (!result.deleted) return false;
      await persist(result.vault);
      return true;
    },
    async setOAuth(provider, credentials, accountId) {
      await persist(upsertOAuthEntry(vault, provider, credentials, accountId));
    },
    async getOAuth(provider, accountId) {
      return getOAuthEntry(vault, provider, accountId);
    },
    async deleteOAuth(provider, accountId) {
      const result = deleteOAuthEntry(vault, provider, accountId);
      if (!result.deleted) return false;
      await persist(result.vault);
      return true;
    },
    async list() {
      return vaultToCredentialRecords(vault);
    },
    async listOAuth() {
      return listOAuthEntries(vault);
    },
    async reload() {
      await load();
    },
    async flush() {
      await persist();
    },
  };
}

export async function openEncryptedCredentialStore(options: EncryptedCredentialStoreOptions): Promise<EncryptedCredentialStore> {
  const store = createEncryptedCredentialStore(options);
  await store.reload();
  return store;
}

export async function rotateEncryptedCredentialStorePassphrase(
  options: RotateEncryptedCredentialStoreOptions,
): Promise<void> {
  const fileMode = options.fileMode ?? DEFAULT_FILE_MODE;
  assertCredentialFileMode(fileMode);
  const limits = resolveEncryptedCredentialStoreLimits(options.limits);
  const scrypt = resolveScryptParameters(options.scrypt, limits.maxScryptMemoryBytes);
  const existing = readEnvelope(options.path, limits);
  if (!existing) return;
  const current = await resolvePassphrase(options.getCurrentPassphrase);
  const plaintext = await decryptBytes(existing, current, limits);
  try {
    const vault = parseVault(plaintext, limits.maxVaultBytes);
    const serialized = serializeVault(vault, limits.maxVaultBytes);
    try {
      const next = await resolvePassphrase(options.getNewPassphrase);
      const envelope = await encryptBytes(serialized, next, scrypt, limits);
      writeEnvelope(options.path, envelope, fileMode, limits.maxFileBytes);
    } finally {
      serialized.fill(0);
    }
  } finally {
    plaintext.fill(0);
  }
}
