import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProvider } from "@arnilo/prism";

const REDACTED = "[REDACTED]";
const DEFAULT_DEVICE_POLL_INTERVAL_MS = 5_000;
const SLOW_DOWN_INCREMENT_MS = 5_000;

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
 * the shared seam behind the Microsoft 365 / Google Workspace workload adapters. Mirrors
 * the 0.0.12 Codex pattern; codes/tokens are redacted in every thrown error.
 */
export function createOAuth2Provider(config: OAuth2ProviderConfig): OAuthProvider {
  const fetchImpl = config.fetch ?? fetch;
  const now = config.now ?? Date.now;
  const sleep = config.sleep ?? abortableSleep;
  const clientId = config.clientId ?? `prism-${config.id}`;
  return {
    id: config.id,
    async login(callbacks?: OAuthLoginCallbacks) {
      throwIfAborted(callbacks?.signal);
      if (callbacks?.onDeviceCode && config.deviceCodeUrl) {
        return deviceLogin(config, clientId, fetchImpl, callbacks, now, sleep);
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

interface DeviceCodePayload {
  readonly device_code: string;
  readonly user_code: string;
  readonly verification_uri: string;
  readonly expires_in?: number;
  readonly interval?: number;
}

interface TokenSuccessPayload {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
  readonly account_id?: string;
}

interface TokenErrorPayload {
  readonly error?: string;
  readonly error_description?: string;
}

async function deviceLogin(
  config: OAuth2ProviderConfig,
  clientId: string,
  fetchImpl: typeof fetch,
  callbacks: OAuthLoginCallbacks,
  now: () => number,
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>,
): Promise<OAuthCredentials> {
  const body: Record<string, string> = { client_id: clientId };
  if (config.scope) body.scope = config.scope;
  const response = await fetchImpl(config.deviceCodeUrl!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: callbacks.signal,
  });
  if (!response.ok) {
    throw redactOAuthError(new Error(`${config.id} device code failed: ${response.status}`), []);
  }
  const json = (await response.json()) as DeviceCodePayload;
  const secrets = [json.device_code, json.user_code];
  const expiresAtMs = now() + (json.expires_in ?? 0) * 1_000;
  await callbacks.onDeviceCode?.({
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    expiresAt: json.expires_in ? new Date(expiresAtMs).toISOString() : undefined,
  });
  let intervalMs = Math.max(1, (json.interval ?? DEFAULT_DEVICE_POLL_INTERVAL_MS / 1_000) * 1_000);
  while (now() < expiresAtMs) {
    throwIfAborted(callbacks.signal);
    await sleep(intervalMs, callbacks.signal);
    throwIfAborted(callbacks.signal);
    const tokenResponse = await fetchImpl(config.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: clientId,
        device_code: json.device_code,
        ...config.extraTokenParams,
      }),
      signal: callbacks.signal,
    });
    if (tokenResponse.ok) return parseTokenCredentials(config, (await tokenResponse.json()) as TokenSuccessPayload);
    const errorPayload = await readTokenErrorPayload(tokenResponse);
    const code = errorPayload.error ?? "unknown_error";
    if (code === "authorization_pending") continue;
    if (code === "slow_down") {
      intervalMs += SLOW_DOWN_INCREMENT_MS;
      continue;
    }
    throw redactOAuthError(new Error(`${config.id} device code login failed: ${code}`), secrets);
  }
  throw redactOAuthError(new Error(`${config.id} device code login expired before authorization completed`), secrets);
}

async function exchangeToken(
  config: OAuth2ProviderConfig,
  _clientId: string,
  fetchImpl: typeof fetch,
  body: Record<string, string>,
  secrets: readonly (string | undefined)[] = [],
  signal?: AbortSignal,
): Promise<OAuthCredentials> {
  const response = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, ...config.extraTokenParams }),
    signal,
  });
  if (!response.ok) {
    throw redactOAuthError(new Error(`${config.id} token request failed: ${response.status}`), secrets);
  }
  return parseTokenCredentials(config, (await response.json()) as TokenSuccessPayload);
}

function parseTokenCredentials(config: OAuth2ProviderConfig, json: TokenSuccessPayload): OAuthCredentials {
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: json.expires_in ? Date.now() + json.expires_in * 1_000 : undefined,
    accountId: json.account_id ?? config.accountId,
  };
}

async function readTokenErrorPayload(response: Response): Promise<TokenErrorPayload> {
  try {
    return (await response.json()) as TokenErrorPayload;
  } catch {
    return { error: "invalid_token_response" };
  }
}

function redactOAuthError(error: Error, secrets: readonly (string | undefined)[]): Error {
  let message = error.message;
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join(REDACTED);
  }
  return new Error(message);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error("OAuth login aborted");
}

async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  throwIfAborted(signal);
  await delay(ms, undefined, { signal });
}
