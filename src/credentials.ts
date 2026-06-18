import type { Credential, CredentialResolver, CredentialRequest } from "./contracts.js";

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
  return {
    async resolve(request) {
      for (const resolver of resolvers) {
        const credential = await resolver.resolve(request);
        if (credential) return credential;
      }
      return undefined;
    },
  };
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
