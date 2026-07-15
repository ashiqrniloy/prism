import type { Credential, CredentialRequest, OAuthCredentials } from "@arnilo/prism";
import type { CredentialRecord } from "@arnilo/prism";
import type { EncryptedCredentialStoreOptions, EncryptedEnvelope } from "./types.js";
import { DEFAULT_FILE_MODE } from "./types.js";
import { decryptBytes, encryptBytes } from "./envelope.js";
import { atomicWriteFile, readFileIfExists } from "./file-io.js";
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
  return getPassphrase();
}

function readEnvelope(path: string): EncryptedEnvelope | undefined {
  const raw = readFileIfExists(path);
  if (!raw) return undefined;
  return JSON.parse(raw.toString("utf8")) as EncryptedEnvelope;
}

function writeEnvelope(path: string, envelope: EncryptedEnvelope, fileMode: number): void {
  atomicWriteFile(path, Buffer.from(JSON.stringify(envelope), "utf8"), fileMode);
}

export function createEncryptedCredentialStore(options: EncryptedCredentialStoreOptions): EncryptedCredentialStore {
  const fileMode = options.fileMode ?? DEFAULT_FILE_MODE;
  let vault = createEmptyVault();
  let envelope: EncryptedEnvelope | undefined;

  const persist = async (): Promise<void> => {
    const passphrase = await resolvePassphrase(options.getPassphrase);
    envelope = encryptBytes(serializeVault(vault), passphrase, options.scrypt);
    writeEnvelope(options.path, envelope, fileMode);
  };

  const load = async (): Promise<void> => {
    const existing = readEnvelope(options.path);
    if (!existing) {
      vault = createEmptyVault();
      envelope = undefined;
      return;
    }
    const passphrase = await resolvePassphrase(options.getPassphrase);
    vault = parseVault(decryptBytes(existing, passphrase));
    envelope = existing;
  };

  const store: EncryptedCredentialStore = {
    path: options.path,
    async resolve(request) {
      return getCredentialEntry(vault, request.name, request.provider);
    },
    async get(request) {
      return getCredentialEntry(vault, request.name, request.provider);
    },
    async set(record) {
      vault = upsertCredentialEntry(vault, record);
      await persist();
    },
    async delete(request) {
      const result = deleteCredentialEntry(vault, request.name, request.provider);
      vault = result.vault;
      if (!result.deleted) return false;
      await persist();
      return true;
    },
    async setOAuth(provider, credentials, accountId) {
      vault = upsertOAuthEntry(vault, provider, credentials, accountId);
      await persist();
    },
    async getOAuth(provider, accountId) {
      return getOAuthEntry(vault, provider, accountId);
    },
    async deleteOAuth(provider, accountId) {
      const result = deleteOAuthEntry(vault, provider, accountId);
      vault = result.vault;
      if (!result.deleted) return false;
      await persist();
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

  return store;
}

export async function openEncryptedCredentialStore(options: EncryptedCredentialStoreOptions): Promise<EncryptedCredentialStore> {
  const store = createEncryptedCredentialStore(options);
  await store.reload();
  return store;
}

export async function rotateEncryptedCredentialStorePassphrase(options: {
  readonly path: string;
  readonly getCurrentPassphrase: () => string | Promise<string>;
  readonly getNewPassphrase: () => string | Promise<string>;
  readonly scrypt?: EncryptedCredentialStoreOptions["scrypt"];
  readonly fileMode?: number;
}): Promise<void> {
  const fileMode = options.fileMode ?? DEFAULT_FILE_MODE;
  const existing = readEnvelope(options.path);
  if (!existing) return;
  const current = await options.getCurrentPassphrase();
  const vault = parseVault(decryptBytes(existing, current));
  const next = await options.getNewPassphrase();
  const envelope = encryptBytes(serializeVault(vault), next, options.scrypt);
  writeEnvelope(options.path, envelope, fileMode);
}
