import type { Credential, OAuthCredentials } from "@arnilo/prism";
import type { CredentialRecord } from "@arnilo/prism";
import type { CredentialVault, VaultCredentialEntry, VaultEntry, VaultOAuthEntry } from "./types.js";
import { VAULT_VERSION } from "./types.js";

const KEY_SEPARATOR = "\u0000";

export function credentialKey(name: string, provider?: string): string {
  return `${provider ?? ""}${KEY_SEPARATOR}${name}`;
}

export function oauthKey(provider: string, accountId?: string): string {
  return `${provider}${KEY_SEPARATOR}oauth${KEY_SEPARATOR}${accountId ?? "default"}`;
}

export function keychainAccountName(namespace: string | undefined, key: string): string {
  return namespace ? `${namespace}${KEY_SEPARATOR}${key}` : key;
}

export function createEmptyVault(): CredentialVault {
  return { version: VAULT_VERSION, entries: {} };
}

export function vaultToCredentialRecords(vault: CredentialVault): CredentialRecord[] {
  const records: CredentialRecord[] = [];
  for (const entry of Object.values(vault.entries)) {
    if (entry.kind === "credential") {
      records.push({ name: entry.name, provider: entry.provider, credential: entry.credential });
    }
  }
  return records;
}

export function listOAuthEntries(vault: CredentialVault): Array<{ provider: string; accountId?: string; credentials: OAuthCredentials }> {
  const rows: Array<{ provider: string; accountId?: string; credentials: OAuthCredentials }> = [];
  for (const entry of Object.values(vault.entries)) {
    if (entry.kind === "oauth") {
      rows.push({ provider: entry.provider, accountId: entry.accountId, credentials: entry.credentials });
    }
  }
  return rows;
}

export function upsertCredentialEntry(vault: CredentialVault, record: CredentialRecord): CredentialVault {
  const key = credentialKey(record.name, record.provider);
  const nextEntry: VaultCredentialEntry = {
    kind: "credential",
    name: record.name,
    provider: record.provider,
    credential: record.credential,
    updatedAt: new Date().toISOString(),
  };
  return {
    version: VAULT_VERSION,
    entries: { ...vault.entries, [key]: nextEntry },
  };
}

export function deleteCredentialEntry(vault: CredentialVault, name: string, provider?: string): { vault: CredentialVault; deleted: boolean } {
  const key = credentialKey(name, provider);
  if (!(key in vault.entries)) return { vault, deleted: false };
  const entries = { ...vault.entries };
  delete entries[key];
  return { vault: { version: VAULT_VERSION, entries }, deleted: true };
}

export function upsertOAuthEntry(
  vault: CredentialVault,
  provider: string,
  credentials: OAuthCredentials,
  accountId?: string,
): CredentialVault {
  const key = oauthKey(provider, accountId);
  const nextEntry: VaultOAuthEntry = {
    kind: "oauth",
    provider,
    accountId,
    credentials,
    updatedAt: new Date().toISOString(),
  };
  return {
    version: VAULT_VERSION,
    entries: { ...vault.entries, [key]: nextEntry },
  };
}

export function getCredentialEntry(vault: CredentialVault, name: string, provider?: string): Credential | undefined {
  const exact = vault.entries[credentialKey(name, provider)];
  if (exact?.kind === "credential") return exact.credential;
  const fallback = vault.entries[credentialKey(name)];
  return fallback?.kind === "credential" ? fallback.credential : undefined;
}

export function getOAuthEntry(vault: CredentialVault, provider: string, accountId?: string): OAuthCredentials | undefined {
  const exact = vault.entries[oauthKey(provider, accountId)];
  if (exact?.kind === "oauth") return exact.credentials;
  const fallback = vault.entries[oauthKey(provider)];
  return fallback?.kind === "oauth" ? fallback.credentials : undefined;
}

export function deleteOAuthEntry(vault: CredentialVault, provider: string, accountId?: string): { vault: CredentialVault; deleted: boolean } {
  const key = oauthKey(provider, accountId);
  if (!(key in vault.entries)) return { vault, deleted: false };
  const entries = { ...vault.entries };
  delete entries[key];
  return { vault: { version: VAULT_VERSION, entries }, deleted: true };
}

export function parseVault(bytes: Buffer): CredentialVault {
  const parsed = JSON.parse(bytes.toString("utf8")) as CredentialVault;
  if (parsed.version !== VAULT_VERSION || typeof parsed.entries !== "object" || parsed.entries === null) {
    throw new Error("Invalid credential vault payload");
  }
  return parsed;
}

export function serializeVault(vault: CredentialVault): Buffer {
  return Buffer.from(JSON.stringify(vault), "utf8");
}

export function assertVaultEntry(entry: VaultEntry): void {
  if (entry.kind === "credential") {
    if (!entry.name || !entry.credential?.value) {
      throw new Error("Invalid credential vault entry");
    }
  } else if (entry.kind === "oauth") {
    if (!entry.provider) {
      throw new Error("Invalid oauth vault entry");
    }
  } else {
    throw new Error("Unknown vault entry kind");
  }
}
