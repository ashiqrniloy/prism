import type { Credential, OAuthCredentials } from "@arnilo/prism";
import type { CredentialRecord } from "@arnilo/prism";
import type { CredentialVault, VaultCredentialEntry, VaultEntry, VaultOAuthEntry } from "./types.js";
import { VAULT_VERSION } from "./types.js";
import { DEFAULT_MAX_VAULT_BYTES } from "./limits.js";

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function parseVault(bytes: Buffer, maxBytes = DEFAULT_MAX_VAULT_BYTES): CredentialVault {
  if (bytes.length > maxBytes) throw new Error("Credential vault exceeds byte limit");
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  if (!isObject(parsed) || !hasOnlyKeys(parsed, ["version", "entries"]) || Object.keys(parsed).length !== 2 ||
      parsed.version !== VAULT_VERSION || !isObject(parsed.entries)) {
    throw new Error("Invalid credential vault payload");
  }
  for (const [key, value] of Object.entries(parsed.entries)) {
    assertVaultEntry(value);
    const expected = value.kind === "credential"
      ? credentialKey(value.name, value.provider)
      : oauthKey(value.provider, value.accountId);
    if (key !== expected) throw new Error("Invalid credential vault entry key");
  }
  return parsed as unknown as CredentialVault;
}

export function serializeVault(vault: CredentialVault, maxBytes = DEFAULT_MAX_VAULT_BYTES): Buffer {
  const bytes = Buffer.from(JSON.stringify(vault), "utf8");
  if (bytes.length > maxBytes) {
    bytes.fill(0);
    throw new Error("Credential vault exceeds byte limit");
  }
  return bytes;
}

export function assertVaultEntry(entry: unknown): asserts entry is VaultEntry {
  if (!isObject(entry) || typeof entry.kind !== "string") throw new Error("Invalid credential vault entry");
  if (entry.kind === "credential") {
    if (!hasOnlyKeys(entry, ["kind", "name", "provider", "credential", "updatedAt"]) ||
        typeof entry.name !== "string" || entry.name.length === 0 ||
        (entry.provider !== undefined && typeof entry.provider !== "string") ||
        typeof entry.updatedAt !== "string" || !isObject(entry.credential) ||
        !hasOnlyKeys(entry.credential, ["type", "value", "metadata"]) ||
        !["bearer", "api_key", "basic", "custom"].includes(String(entry.credential.type)) ||
        typeof entry.credential.value !== "string" || entry.credential.value.length === 0 ||
        (entry.credential.metadata !== undefined && !isObject(entry.credential.metadata))) {
      throw new Error("Invalid credential vault entry");
    }
    return;
  }
  if (entry.kind === "oauth") {
    if (!hasOnlyKeys(entry, ["kind", "provider", "accountId", "credentials", "updatedAt"]) ||
        typeof entry.provider !== "string" || entry.provider.length === 0 ||
        (entry.accountId !== undefined && typeof entry.accountId !== "string") ||
        typeof entry.updatedAt !== "string" || !isObject(entry.credentials) ||
        !hasOnlyKeys(entry.credentials, ["access", "refresh", "expires", "accountId", "metadata"]) ||
        (entry.credentials.access !== undefined && typeof entry.credentials.access !== "string") ||
        (entry.credentials.refresh !== undefined && typeof entry.credentials.refresh !== "string") ||
        (entry.credentials.expires !== undefined && typeof entry.credentials.expires !== "string" && typeof entry.credentials.expires !== "number") ||
        (entry.credentials.accountId !== undefined && typeof entry.credentials.accountId !== "string") ||
        (entry.credentials.metadata !== undefined && !isObject(entry.credentials.metadata))) {
      throw new Error("Invalid oauth vault entry");
    }
    return;
  }
  throw new Error("Unknown vault entry kind");
}
