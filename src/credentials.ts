import type {
  Credential,
  CredentialRequest,
  CredentialResolver,
  CredentialResolverSource,
  OAuthCredentialStore,
  OAuthCredentials,
  OAuthProvider,
} from "./contracts.js";

export type CredentialValueSource = string | (() => string | undefined | Promise<string | undefined>) | CredentialResolver;

export interface CredentialRecord {
  readonly name: string;
  readonly provider?: string;
  readonly credential: Credential;
}

export interface MemoryCredentialStore extends CredentialResolver {
  set(record: CredentialRecord): void;
  delete(request: Pick<CredentialRequest, "name" | "provider">): boolean;
  clear(): void;
}

export interface MemoryCredentialStoreOptions {
  /** When true (default, backward compatible), a provider-scoped request falls back to a
   *  providerless record of the same name — that record is then served to EVERY provider.
   *  Set false for exact-match-only resolution (strict provider scoping). */
  readonly allowProviderFallback?: boolean;
}

export function createMemoryCredentialStore(
  initial: readonly CredentialRecord[] = [],
  options: MemoryCredentialStoreOptions = {},
): MemoryCredentialStore {
  const records = new Map<string, Credential>();
  const allowProviderFallback = options.allowProviderFallback ?? true;
  const key = (name: string, provider?: string) => `${provider ?? ""}\u0000${name}`;
  const store: MemoryCredentialStore = {
    set(record) {
      records.set(key(record.name, record.provider), record.credential);
    },
    delete(request) {
      return records.delete(key(request.name, request.provider));
    },
    clear() {
      records.clear();
    },
    resolve(request) {
      const exact = records.get(key(request.name, request.provider));
      if (exact !== undefined || !allowProviderFallback || request.provider === undefined) return exact;
      return records.get(key(request.name));
    },
  };
  for (const record of initial) store.set(record);
  return store;
}

export function createChainedCredentialResolver(resolvers: readonly CredentialResolver[]): CredentialResolver {
  return createExplicitCredentialResolver(resolvers.map((resolver, index) => ({ name: String(index), resolver })));
}

export function createExplicitCredentialResolver(sources: readonly CredentialResolverSource[]): CredentialResolver {
  return {
    async resolve(request) {
      for (const source of sources) {
        const credential = await source.resolver.resolve(request);
        if (credential) return credential;
      }
      return undefined;
    },
  };
}

export function createEnvCredentialResolver(
  env: Readonly<Record<string, string | undefined>>,
  map: Readonly<Record<string, string>>,
): CredentialResolver {
  return {
    resolve(request) {
      const envName =
        map[credentialMapKey(request.name, request.provider)] ??
        (request.provider ? map[request.provider] : undefined) ??
        map[request.name];
      const value = envName ? env[envName] : undefined;
      return value ? { type: "api_key", value, metadata: { source: "env", envName } } : undefined;
    },
  };
}

export async function refreshOAuthCredential(options: {
  readonly provider: OAuthProvider;
  readonly credentials: OAuthCredentials;
  readonly store?: OAuthCredentialStore;
}): Promise<OAuthCredentials> {
  const refreshed = options.provider.refresh ? await options.provider.refresh(options.credentials) : options.credentials;
  await options.store?.set(options.provider.id, refreshed);
  return refreshed;
}

/** A credential store that can also remove entries (revocation fails closed on the delete). */
export interface RevocableOAuthCredentialStore extends OAuthCredentialStore {
  delete(provider: string, accountId?: string): Promise<boolean> | boolean;
}

/**
 * Revokes an OAuth credential: best-effort upstream revocation, then a mandatory local
 * store delete so subsequent connector calls fail closed. The local delete is the trust
 * boundary — an upstream revoke failure never leaves a stored token usable.
 */
export async function revokeOAuthCredential(options: {
  readonly provider: OAuthProvider;
  readonly credentials: OAuthCredentials;
  readonly store?: RevocableOAuthCredentialStore;
}): Promise<void> {
  await options.provider.revoke?.(options.credentials);
  await options.store?.delete(options.provider.id, options.credentials.accountId);
}

function credentialMapKey(name: string, provider?: string): string {
  return provider ? `${provider}:${name}` : name;
}

export async function resolveCredentialValue(
  source: CredentialValueSource | undefined,
  request: CredentialRequest,
): Promise<string | undefined> {
  if (!source) return undefined;
  if (typeof source === "string") return source;
  if (typeof source === "function") return source();
  return (await source.resolve(request))?.value;
}
