import { type OAuthCredentials, type OAuthProvider, redactOAuthError, refreshOAuthCredential, revokeOAuthCredential } from "@arnilo/prism";
import type { PrismCodeCredentialManager } from "./credentials.js";
import type { ShippedProviderDescriptor } from "./providers.js";

/** Refresh when the access token expires within this window. */
export const OAUTH_REFRESH_SKEW_MS = 60_000;

/** Single-flight refresh per provider: concurrent requests share one refresh round-trip. */
const inflightRefreshes = new Map<string, Promise<OAuthCredentials>>();

/** Lazily resolves the shipped OAuth provider for `openai-codex` / `xai`; undefined for API-key-only providers. */
export async function resolveOAuthProvider(providerId: string): Promise<OAuthProvider | undefined> {
  switch (providerId.toLowerCase()) {
    case "openai-codex": {
      const mod = await import("@arnilo/prism-providers/openai");
      return mod.openAICodexOAuthProvider;
    }
    case "xai": {
      const mod = await import("@arnilo/prism-providers/xai");
      return mod.createXaiOAuthProvider();
    }
    default:
      return undefined;
  }
}

/**
 * Access-token `CredentialValueSource` for OAuth providers: reads the stored `OAuthCredentials`,
 * refreshes proactively when expiry is within `skewMs` (default 60 s), persists the refreshed
 * tokens, and shares one in-flight refresh per provider. Env overrides are handled before this
 * source is built (a static token never reaches here).
 */
export function createOAuthTokenSource(
  providerId: string,
  oauthProvider: OAuthProvider,
  credentials: PrismCodeCredentialManager,
  options: { readonly now?: () => number; readonly skewMs?: number } = {},
): () => Promise<string | undefined> {
  const now = options.now ?? Date.now;
  const skewMs = options.skewMs ?? OAUTH_REFRESH_SKEW_MS;

  return async (): Promise<string | undefined> => {
    const stored = await credentials.getOAuth(providerId);
    if (!stored?.access) return undefined;

    const expires = parseOAuthExpiry(stored.expires);
    if (expires === undefined || expires - now() > skewMs) return stored.access;

    try {
      const refreshed = await refreshInFlight(providerId, oauthProvider, credentials);
      return refreshed.access ?? stored.access;
    } catch (error) {
      // Still valid for a moment: keep serving it and retry on the next request.
      if (expires > now()) return stored.access;
      const message = error instanceof Error ? error.message : String(error);
      throw redactOAuthError(new Error(`${providerId} OAuth token refresh failed: ${message}. Run /provider to log in again`), [
        stored.access,
        stored.refresh,
      ]);
    }
  };
}

function refreshInFlight(
  providerId: string,
  oauthProvider: OAuthProvider,
  credentials: PrismCodeCredentialManager,
): Promise<OAuthCredentials> {
  const existing = inflightRefreshes.get(providerId);
  if (existing) return existing;

  const pending = (async () => {
    const stored = await credentials.getOAuth(providerId);
    if (!stored) throw new Error(`no stored ${providerId} OAuth credentials to refresh`);
    return refreshOAuthCredential({
      provider: oauthProvider,
      credentials: stored,
      store: { set: (provider, refreshed) => credentials.setOAuth(provider, refreshed) },
    });
  })().finally(() => {
    inflightRefreshes.delete(providerId);
  });

  inflightRefreshes.set(providerId, pending);
  return pending;
}

/** `OAuthCredentials.expires` is epoch-ms or an ISO string; undefined means unknown (never refresh). */
export function parseOAuthExpiry(expires: string | number | undefined): number | undefined {
  if (typeof expires === "number") return Number.isFinite(expires) ? expires : undefined;
  if (typeof expires === "string") {
    const parsed = Date.parse(expires);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Provider credential status (never reveals values)
// ---------------------------------------------------------------------------

export type ProviderCredentialStatus =
  | { readonly kind: "oauth"; readonly expires?: string | number }
  | { readonly kind: "stored-key" }
  | { readonly kind: "env"; readonly envVar: string }
  | { readonly kind: "ambient" }
  | { readonly kind: "host-setup" }
  | { readonly kind: "not-configured" };

/** Store-first status for `/provider`; falls back to env reporting without reading values. */
export async function describeProviderCredentialStatus(
  descriptor: ShippedProviderDescriptor,
  credentials: PrismCodeCredentialManager,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderCredentialStatus> {
  if (descriptor.authKinds.includes("ambient")) return { kind: "ambient" };

  try {
    const oauth = await credentials.getOAuth(descriptor.id);
    if (oauth?.access || oauth?.refresh) return { kind: "oauth", expires: oauth.expires };

    const record = await credentials.getStore().get({ name: "apiKey", provider: descriptor.id });
    if (record && typeof record === "object" && "value" in record && record.value) return { kind: "stored-key" };
  } catch {
    // A locked/unavailable store reports as unconfigured instead of failing the picker.
  }

  const envVar = descriptor.envVars.find((name) => env[name]);
  if (envVar) return { kind: "env", envVar };
  return descriptor.authKinds.includes("host_setup") ? { kind: "host-setup" } : { kind: "not-configured" };
}

export function formatProviderCredentialStatus(status: ProviderCredentialStatus): string {
  switch (status.kind) {
    case "oauth":
      return status.expires === undefined ? "oauth" : `oauth (expires ${formatExpiry(status.expires)})`;
    case "stored-key":
      return "stored key";
    case "env":
      return `env ${status.envVar}`;
    case "ambient":
      return "ambient";
    case "host-setup":
      return "host setup (env)";
    case "not-configured":
      return "not configured";
  }
}

function formatExpiry(expires: string | number): string {
  if (typeof expires === "number") return new Date(expires).toISOString();
  return expires;
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export interface LogoutResult {
  readonly provider: string;
  readonly oauthRevoked: boolean;
  readonly oauthDeleted: boolean;
  readonly apiKeyDeleted: boolean;
  /** Redacted revocation failure; the local delete still ran (fail closed). */
  readonly revokeError?: string;
}

/**
 * Revokes (best effort, when the provider supports it) and always deletes stored OAuth and
 * API-key entries. Environment variables are never touched.
 */
export async function logoutProvider(
  providerId: string,
  credentials: PrismCodeCredentialManager,
  oauthProvider?: OAuthProvider,
): Promise<LogoutResult> {
  const id = providerId.toLowerCase();
  const resolved = oauthProvider ?? (await resolveOAuthProvider(id));
  const stored = resolved ? await credentials.getOAuth(id) : undefined;

  let oauthRevoked = false;
  let revokeError: string | undefined;
  let oauthDeleted = false;

  if (resolved && (stored?.access || stored?.refresh)) {
    try {
      await revokeOAuthCredential({
        provider: resolved,
        credentials: stored,
        store: {
          set: (provider, refreshed) => credentials.setOAuth(provider, refreshed),
          delete: (provider, accountId) => credentials.deleteOAuth(provider, accountId),
        },
      });
      oauthRevoked = typeof resolved.revoke === "function";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      revokeError = redactOAuthError(new Error(message), [stored?.access, stored?.refresh]).message;
    }
    // Fail closed: delete locally even when the upstream revoke failed.
    await credentials.deleteOAuth(id);
    oauthDeleted = true;
  } else {
    oauthDeleted = await credentials.deleteOAuth(id);
  }

  const apiKeyDeleted = await credentials.delete(id);
  return {
    provider: id,
    oauthRevoked,
    oauthDeleted,
    apiKeyDeleted,
    ...(revokeError ? { revokeError } : {}),
  };
}
