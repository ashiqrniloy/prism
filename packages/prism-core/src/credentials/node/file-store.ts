import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Credential, CredentialRecord, CredentialRequest, OAuthCredentials } from "@arnilo/prism";
import type { StoredCredentialStore } from "./encrypted-store.js";
import { CredentialStoreError } from "./errors.js";
import { assertCredentialFileMode, atomicWriteFile, readFileIfExists } from "./file-io.js";
import {
  DEFAULT_MAX_ENVELOPE_FILE_BYTES,
  DEFAULT_MAX_VAULT_BYTES,
  HARD_MAX_ENVELOPE_FILE_BYTES,
  HARD_MAX_VAULT_BYTES,
  validateCredentialLimit,
} from "./limits.js";
import type { CredentialVault } from "./types.js";
import { DEFAULT_FILE_MODE } from "./types.js";
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

export interface FileCredentialStoreLimits {
  readonly maxFileBytes?: number;
  readonly maxVaultBytes?: number;
}

export interface FileCredentialStoreOptions {
  readonly path: string;
  /** Owner-only by default; `assertCredentialFileMode` rejects group/other bits. */
  readonly fileMode?: number;
  readonly limits?: FileCredentialStoreLimits;
}

/** Synchronous store: reads the vault once and rewrites the whole file atomically on mutation. */
export interface FileCredentialStore extends StoredCredentialStore {
  readonly path: string;
  resolve(request: CredentialRequest): Credential | undefined;
  get(request: Pick<CredentialRequest, "name" | "provider">): Credential | undefined;
  set(record: CredentialRecord): void;
  delete(request: Pick<CredentialRequest, "name" | "provider">): boolean;
  setOAuth(provider: string, credentials: OAuthCredentials, accountId?: string): void;
  getOAuth(provider: string, accountId?: string): OAuthCredentials | undefined;
  deleteOAuth(provider: string, accountId?: string): boolean;
  list(): CredentialRecord[];
  listOAuth(): Array<{ provider: string; accountId?: string; credentials: OAuthCredentials }>;
  reload(): void;
  flush(): void;
}

/**
 * Owner-only plaintext credential store (`auth.json`).
 * The file is `0600`, its parent directory is created `0700`, and a file with
 * group/other permission bits is refused on read with a fix-it message.
 */
export function createFileCredentialStore(options: FileCredentialStoreOptions): FileCredentialStore {
  const fileMode = options.fileMode ?? DEFAULT_FILE_MODE;
  assertCredentialFileMode(fileMode);
  const maxFileBytes = validateCredentialLimit(
    "limits.maxFileBytes",
    options.limits?.maxFileBytes ?? DEFAULT_MAX_ENVELOPE_FILE_BYTES,
    HARD_MAX_ENVELOPE_FILE_BYTES,
  );
  const maxVaultBytes = validateCredentialLimit(
    "limits.maxVaultBytes",
    options.limits?.maxVaultBytes ?? DEFAULT_MAX_VAULT_BYTES,
    HARD_MAX_VAULT_BYTES,
  );
  let vault: CredentialVault = createEmptyVault();

  const persist = (next: CredentialVault): void => {
    const bytes = serializeVault(next, maxVaultBytes);
    try {
      // Only directories created here get 0700; an existing user directory is never chmod'ed.
      mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 });
      atomicWriteFile(options.path, bytes, fileMode);
      vault = next;
    } finally {
      bytes.fill(0);
    }
  };

  const load = (): void => {
    const raw = readFileIfExists(options.path, maxFileBytes);
    if (!raw) {
      vault = createEmptyVault();
      return;
    }
    try {
      vault = parseVault(raw, maxVaultBytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CredentialStoreError(
        "credential_file_corrupt",
        `Credential file ${options.path} is not a valid credential store: ${message}`,
      );
    } finally {
      raw.fill(0);
    }
  };

  load();

  return {
    path: options.path,
    resolve(request: CredentialRequest) {
      return getCredentialEntry(vault, request.name, request.provider);
    },
    get(request: Pick<CredentialRequest, "name" | "provider">): Credential | undefined {
      return getCredentialEntry(vault, request.name, request.provider);
    },
    set(record: CredentialRecord) {
      persist(upsertCredentialEntry(vault, record));
    },
    delete(request: Pick<CredentialRequest, "name" | "provider">): boolean {
      const result = deleteCredentialEntry(vault, request.name, request.provider);
      if (!result.deleted) return false;
      persist(result.vault);
      return true;
    },
    setOAuth(provider: string, credentials: OAuthCredentials, accountId?: string) {
      persist(upsertOAuthEntry(vault, provider, credentials, accountId));
    },
    getOAuth(provider: string, accountId?: string): OAuthCredentials | undefined {
      return getOAuthEntry(vault, provider, accountId);
    },
    deleteOAuth(provider: string, accountId?: string): boolean {
      const result = deleteOAuthEntry(vault, provider, accountId);
      if (!result.deleted) return false;
      persist(result.vault);
      return true;
    },
    list(): CredentialRecord[] {
      return vaultToCredentialRecords(vault);
    },
    listOAuth() {
      return listOAuthEntries(vault);
    },
    reload(): void {
      load();
    },
    flush(): void {
      persist(vault);
    },
  };
}
