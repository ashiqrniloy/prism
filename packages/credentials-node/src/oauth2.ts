import { createHash, randomBytes } from "node:crypto";
import type {
  OAuthCredentials,
  OAuthLoginCallbacks,
  OAuthProvider,
  OAuthTokenSuccessPayload,
  PollDeviceCodeTokenOptions,
} from "@arnilo/prism";
import { abortableSleep, pollDeviceCodeToken, redactOAuthError, throwIfAborted } from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText } from "@arnilo/prism/providers/transport";

/** RFC 7636 PKCE verifier: base64url(32 random bytes) = 43 unreserved chars. */
export function createOAuth2PkceVerifier(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** S256 code challenge: base64url(SHA-256(verifier)). */
export function computeOAuth2S256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export interface OAuth2ProviderConfig {
  readonly id: string;
  readonly clientId?: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly deviceCodeUrl?: string;
  readonly revocationUrl?: string;
  readonly redirectUri?: string;
  /** Space-delimited scopes requested at login (least-privilege per workload bundle). */
  readonly scope?: string;
  /** Extra token-request params (e.g. client_secret, audience). Never logged. */
  readonly extraTokenParams?: Readonly<Record<string, string>>;
  /** Static account/tenant binding recorded on issued credentials. */
  readonly accountId?: string;
  readonly fetch?: typeof fetch;
  /** Test seam: wall clock for device-code expiry. */
  readonly now?: () => number;
  /** Test seam: poll delay between device-code token requests. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Generic OAuth 2.0 provider (PKCE authorization-code + device-code + refresh + revoke),
 * the shared seam behind the Microsoft 365 / Google Workspace workload adapters. The
 * device-code flow runs on the shared core `pollDeviceCodeToken` (RFC 8628 poll loop,
 * bounded bodies, redaction, fail-closed token shape); codes/tokens are redacted in
 * every thrown error.
 */
export function createOAuth2Provider(config: OAuth2ProviderConfig): OAuthProvider {
  const fetchImpl = config.fetch ?? fetch;
  const now = config.now ?? Date.now;
  const sleep = config.sleep ?? abortableSleep;
  const clientId = config.clientId ?? `prism-${config.id}`;
  const parseTokenCredentials = (json: OAuthTokenSuccessPayload): OAuthCredentials => ({
    access: json.access_token,
    refresh: json.refresh_token,
    expires: json.expires_in ? Date.now() + json.expires_in * 1_000 : undefined,
    accountId: json.account_id ?? config.accountId,
  });
  return {
    id: config.id,
    async login(callbacks?: OAuthLoginCallbacks) {
      throwIfAborted(callbacks?.signal);
      if (callbacks?.onDeviceCode && config.deviceCodeUrl) {
        const pollOptions: PollDeviceCodeTokenOptions = {
          fetchImpl,
          deviceCodeUrl: config.deviceCodeUrl,
          tokenUrl: config.tokenUrl,
          clientId,
          scope: config.scope,
          extraTokenParams: config.extraTokenParams,
          callbacks,
          errorPrefix: config.id,
          now,
          sleep,
          parseTokenCredentials,
        };
        return pollDeviceCodeToken(pollOptions);
      }
      const verifier = createOAuth2PkceVerifier();
      const challenge = computeOAuth2S256Challenge(verifier);
      const params = new URLSearchParams({
        client_id: clientId,
        code_challenge: challenge,
        code_challenge_method: "S256",
        response_type: "code",
      });
      if (config.redirectUri) params.set("redirect_uri", config.redirectUri);
      if (config.scope) params.set("scope", config.scope);
      await callbacks?.onAuth?.(`${config.authorizeUrl}?${params}`);
      throwIfAborted(callbacks?.signal);
      const code = await callbacks?.onPrompt?.(`${config.id} authorization code`);
      if (!code) throw new Error(`${config.id} authorization code was not provided`);
      return exchangeToken(
        config,
        clientId,
        fetchImpl,
        {
          grant_type: "authorization_code",
          client_id: clientId,
          code,
          code_verifier: verifier,
          ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {}),
        },
        [code, verifier],
        callbacks?.signal,
        parseTokenCredentials,
      );
    },
    async refresh(credentials) {
      if (!credentials.refresh) return credentials;
      const refreshed = await exchangeToken(
        config,
        clientId,
        fetchImpl,
        { grant_type: "refresh_token", client_id: clientId, refresh_token: credentials.refresh },
        [credentials.access, credentials.refresh].filter((s): s is string => Boolean(s)),
        undefined,
        parseTokenCredentials,
      );
      // Preserve the account binding across refresh so per-identity isolation survives.
      return refreshed.accountId ? refreshed : { ...refreshed, accountId: credentials.accountId };
    },
    async revoke(credentials) {
      const token = credentials.refresh ?? credentials.access;
      if (!token || !config.revocationUrl) return;
      const response = await fetchImpl(config.revocationUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, token }).toString(),
      });
      if (!response.ok) {
        throw redactOAuthError(new Error(`${config.id} token revocation failed: ${response.status}`), [token]);
      }
    },
    getCredential(credentials) {
      return credentials.access
        ? { type: "bearer", value: credentials.access, metadata: { accountId: credentials.accountId, expires: credentials.expires } }
        : undefined;
    },
    metadata: { scope: config.scope },
  };
}

async function exchangeToken(
  config: OAuth2ProviderConfig,
  _clientId: string,
  fetchImpl: typeof fetch,
  body: Record<string, string>,
  secrets: readonly (string | undefined)[] = [],
  signal: AbortSignal | undefined,
  parseTokenCredentials: (json: OAuthTokenSuccessPayload) => OAuthCredentials,
): Promise<OAuthCredentials> {
  const response = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, ...config.extraTokenParams }),
    signal,
  });
  if (!response.ok) {
    const detail = await readBoundedResponseText(response, { secrets });
    throw redactOAuthError(new Error(`${config.id} token request failed: ${response.status}${detail ? ` ${detail}` : ""}`), secrets);
  }
  const json = await readBoundedResponseJson<OAuthTokenSuccessPayload>(response, {
    shape: (value: unknown): boolean =>
      typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).access_token === "string",
  });
  return parseTokenCredentials(json);
}
