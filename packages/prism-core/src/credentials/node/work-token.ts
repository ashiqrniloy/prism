import { type AgentIdentity, type OAuthCredentials, type OAuthProvider, type Secret } from "@arnilo/prism";
import { refreshOAuthCredential, secretToOAuthCredentials } from "@arnilo/prism/provider-kit";

/** Provider-keyed OAuth rows a work token resolves through. `@arnilo/prism-credentials-keyring` stores implement it. */
export interface WorkTokenOAuthStore {
  set(provider: string, credentials: OAuthCredentials): void | Promise<void>;
  get(provider: string, accountId?: string): Promise<OAuthCredentials | undefined> | OAuthCredentials | undefined;
  delete(provider: string, accountId?: string): Promise<boolean> | boolean;
}

export interface OAuthWorkTokenOptions {
  readonly provider: OAuthProvider;
  readonly store: WorkTokenOAuthStore;
  /** Env var the resolved access token is injected into (never argv, never model context). */
  readonly envVar: string;
  readonly now?: () => number;
  /** Refresh this long before expiry (late-bound). Default 60s. */
  readonly refreshSkewMs?: number;
}

export interface OAuthWorkTokenProvider {
  tokenEnv(identity: AgentIdentity, signal?: AbortSignal): Promise<Record<string, string> | undefined>;
}

/**
 * Bridges stored OAuth credentials to a per-identity connector token env var. Refresh is
 * late-bound and single-flighted per account (no refresh storm under reconnect); missing,
 * expired-without-refresh, revoked, cross-identity, or wrong-tenant credentials fail closed
 * (undefined) so the connector denies the call.
 */
export function createOAuthWorkTokenProvider(options: OAuthWorkTokenOptions): OAuthWorkTokenProvider {
  const now = options.now ?? Date.now;
  const skew = options.refreshSkewMs ?? 60_000;
  const inflight = new Map<string, Promise<OAuthCredentials | undefined>>();
  const ref = `keyring:${options.provider.id}`;

  const resolve = async (identity: AgentIdentity): Promise<OAuthCredentials | undefined> => {
    const accountKey = identity.accountId ?? "";
    const stored = await options.store.get(options.provider.id, identity.accountId);
    if (!stored?.access) return undefined;
    // Per-identity isolation: never fall back to another account's token.
    if (stored.accountId && identity.accountId && stored.accountId !== identity.accountId) return undefined;
    const tenant = stored.metadata?.tenantId;
    if (typeof tenant === "string" && tenant !== identity.tenantId) return undefined;

    const expiresMs =
      typeof stored.expires === "number" ? stored.expires : typeof stored.expires === "string" ? Date.parse(stored.expires) : Number.NaN;
    const needsRefresh = Number.isFinite(expiresMs) && now() >= expiresMs - skew;
    if (!needsRefresh) return stored;
    if (!stored.refresh) return undefined; // expired and cannot refresh -> fail closed

    // Single-flight per account so concurrent ops share one refresh.
    const existing = inflight.get(accountKey);
    if (existing) return existing;
    const pending = (async () => {
      try {
        const refreshed = await refreshOAuthCredential({
          provider: options.provider,
          credentials: stored,
          ref,
          sink: {
            store: (_ref: string, secret: Secret) => options.store.set(options.provider.id, secretToOAuthCredentials(secret)),
            delete: async () => {
              await options.store.delete(options.provider.id, stored.accountId);
            },
          },
        });
        return refreshed.access ? refreshed : undefined;
      } catch {
        return undefined;
      } finally {
        inflight.delete(accountKey);
      }
    })();
    inflight.set(accountKey, pending);
    return pending;
  };

  return {
    async tokenEnv(identity) {
      const credentials = await resolve(identity);
      if (!credentials?.access) return undefined;
      return { [options.envVar]: credentials.access };
    },
  };
}
