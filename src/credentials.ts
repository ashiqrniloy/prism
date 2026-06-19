import type { Credential, CredentialResolver, CredentialRequest, CredentialResolverSource, OAuthCredentialStore, OAuthCredentials, OAuthProvider } from "./contracts.js";

export type CredentialValueSource =
  | string
  | (() => string | undefined | Promise<string | undefined>)
  | CredentialResolver;

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

export function createMemoryCredentialStore(initial: readonly CredentialRecord[] = []): MemoryCredentialStore {
  const records = new Map<string, Credential>();
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
      return records.get(key(request.name, request.provider)) ?? records.get(key(request.name));
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

export function createEnvCredentialResolver(env: Readonly<Record<string, string | undefined>>, map: Readonly<Record<string, string>>): CredentialResolver {
  return {
    resolve(request) {
      const envName = map[credentialMapKey(request.name, request.provider)] ?? (request.provider ? map[request.provider] : undefined) ?? map[request.name];
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
