import type { CredentialResolver, OAuthCredentials } from "@arnilo/prism";
import { secretToOAuthCredentials, type OAuthCredentialSink } from "@arnilo/prism/provider-kit";
import type { StoredCredentialStore } from "./encrypted-store.js";

/** A `CredentialResolver` over a name-keyed stored credential store. The ref is the record name. */
export function createStoredCredentialResolver(store: StoredCredentialStore): CredentialResolver {
  return {
    resolve(ref) {
      return store.get({ name: ref });
    },
  };
}

export interface ExtendedOAuthCredentialStore {
  set(provider: string, credentials: OAuthCredentials): void | Promise<void>;
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

/**
 * Adapts a provider-keyed OAuth store to the credentials-slot `store`/`delete` handle the provider-kit
 * OAuth helpers take. The refreshed tokens are encoded as a `Secret`; `accountId` scopes the delete.
 */
export function createOAuthCredentialSink(store: ExtendedOAuthCredentialStore, provider: string, accountId?: string): OAuthCredentialSink {
  return {
    store: (_ref, secret) => store.set(provider, secretToOAuthCredentials(secret)),
    delete: async () => {
      await store.delete(provider, accountId);
    },
  };
}
