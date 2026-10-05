import type { CredentialContext, OAuthCredentials, OAuthProvider, Secret } from "../contracts.js";

/** The slot subset an OAuth helper writes refreshed tokens through (`CredentialResolver` satisfies it). */
export interface OAuthCredentialSink {
  store?(ref: string, secret: Secret, ctx: CredentialContext): Promise<void> | void;
  delete?(ref: string, ctx: CredentialContext): Promise<void> | void;
}

/** Encodes OAuth tokens as a slot `Secret`. The access token is `value` so the kernel redactor masks it. */
export function oauthCredentialsToSecret(credentials: OAuthCredentials): Secret {
  return {
    type: credentials.access ? "bearer" : "custom",
    value: credentials.access ?? credentials.refresh ?? "",
    metadata: {
      ...(credentials.refresh !== undefined ? { refresh: credentials.refresh } : {}),
      ...(credentials.expires !== undefined ? { expires: credentials.expires } : {}),
      ...(credentials.accountId !== undefined ? { accountId: credentials.accountId } : {}),
      ...(credentials.metadata !== undefined ? { oauthMetadata: credentials.metadata } : {}),
    },
  };
}

/** The inverse of {@link oauthCredentialsToSecret}. */
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

/** Refreshes an OAuth credential and persists the result through the credentials slot at `ref`. */
export async function refreshOAuthCredential(options: {
  readonly provider: OAuthProvider;
  readonly credentials: OAuthCredentials;
  readonly ref: string;
  readonly sink?: OAuthCredentialSink;
  readonly ctx?: CredentialContext;
}): Promise<OAuthCredentials> {
  const refreshed = options.provider.refresh ? await options.provider.refresh(options.credentials) : options.credentials;
  await options.sink?.store?.(options.ref, oauthCredentialsToSecret(refreshed), options.ctx ?? {});
  return refreshed;
}

/**
 * Revokes an OAuth credential: best-effort upstream revocation, then a mandatory local slot delete so
 * subsequent connector calls fail closed. The local delete is the trust boundary — an upstream revoke
 * failure never leaves a stored token usable.
 */
export async function revokeOAuthCredential(options: {
  readonly provider: OAuthProvider;
  readonly credentials: OAuthCredentials;
  readonly ref: string;
  readonly sink?: OAuthCredentialSink;
  readonly ctx?: CredentialContext;
}): Promise<void> {
  await options.provider.revoke?.(options.credentials);
  await options.sink?.delete?.(options.ref, options.ctx ?? {});
}
