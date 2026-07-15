import type { CredentialResolver, OAuthCredentialStore, OAuthCredentials } from "@arnilo/prism";
import type { StoredCredentialStore } from "./encrypted-store.js";

export function createStoredCredentialResolver(store: StoredCredentialStore): CredentialResolver {
  return {
    resolve(request) {
      return store.get(request);
    },
  };
}

export interface ExtendedOAuthCredentialStore extends OAuthCredentialStore {
  get(provider: string, accountId?: string): Promise<OAuthCredentials | undefined> | OAuthCredentials | undefined;
  delete(provider: string, accountId?: string): Promise<boolean> | boolean;
}

export function createOAuthCredentialStoreAdapter(store: StoredCredentialStore): ExtendedOAuthCredentialStore {
  return {
    set(provider, credentials) {
      return store.setOAuth(provider, credentials);
    },
    get(provider, accountId) {
      return store.getOAuth(provider, accountId);
    },
    delete(provider, accountId) {
      return store.deleteOAuth(provider, accountId);
    },
  };
}
