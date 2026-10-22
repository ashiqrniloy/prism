import type { CredentialContext, CredentialResolver, OAuthCredentials, Secret } from "@arnilo/prism";
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

export interface OAuthCredentialSink {
  store?(ref: string, secret: Secret, ctx?: CredentialContext): Promise<void> | void;
  delete?(ref: string, ctx?: CredentialContext): Promise<void> | void;
}

export function secretToOAuthCredentials(secret: Secret): OAuthCredentials {
  const metadata = secret.metadata ?? {};
  const access = secret.type === "bearer" ? secret.value : undefined;
  const refresh = typeof metadata.refresh === "string" ? metadata.refresh : undefined;
  const expires = typeof metadata.expires === "string" || typeof metadata.expires === "number" ? metadata.expires : undefined;
  const accountId = typeof metadata.accountId === "string" ? metadata.accountId : undefined;
  const oauthMetadata = metadata.oauthMetadata;
  return {
    ...(access !== undefined ? { access } : {}),
    ...(refresh !== undefined ? { refresh } : {}),
    ...(expires !== undefined ? { expires } : {}),
    ...(accountId !== undefined ? { accountId } : {}),
    ...(oauthMetadata !== undefined && typeof oauthMetadata === "object" && oauthMetadata !== null
      ? { metadata: oauthMetadata as Readonly<Record<string, unknown>> }
      : {}),
  };
}

/**
 * Adapts a provider-keyed OAuth store to the credentials-slot `store`/`delete` handle.
 * The refreshed tokens are encoded as a `Secret`; `accountId` scopes the delete.
 */
export function createOAuthCredentialSink(store: ExtendedOAuthCredentialStore, provider: string, accountId?: string): OAuthCredentialSink {
  return {
    store: (_ref, secret) => store.set(provider, secretToOAuthCredentials(secret)),
    delete: async () => {
      await store.delete(provider, accountId);
    },
  };
}

