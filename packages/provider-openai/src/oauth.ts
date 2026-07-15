import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProvider } from "@arnilo/prism";
import { readBoundedResponseText } from "@arnilo/prism/providers/transport";

export interface OpenAICodexOAuthOptions {
  readonly clientId?: string;
  readonly fetch?: typeof fetch;
  readonly authorizeUrl?: string;
  readonly tokenUrl?: string;
  readonly deviceCodeUrl?: string;
  readonly redirectUri?: string;
  readonly scope?: string;
  /** Test seam: override wall clock for device-code expiry. */
  readonly now?: () => number;
  /** Test seam: override poll delay between device-code token requests. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export const openAICodexOAuthProvider = createOpenAICodexOAuthProvider();

const REDACTED = "[REDACTED]";
const DEFAULT_DEVICE_POLL_INTERVAL_MS = 5_000;
const SLOW_DOWN_INCREMENT_MS = 5_000;

/**
 * RFC 7636 PKCE code verifier: 43-128 chars from the unreserved set.
 * base64url(32 random bytes) yields exactly 43 chars, all unreserved.
 */
export function createPkceVerifier(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** S256 code challenge: base64url(SHA-256(verifier)). */
export function computeS256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createOpenAICodexOAuthProvider(options: OpenAICodexOAuthOptions = {}): OAuthProvider {
  const clientId = options.clientId ?? "prism-codex";
  const fetchImpl = options.fetch ?? fetch;
  const tokenUrl = options.tokenUrl ?? "https://auth.openai.com/oauth/token";
  const authorizeUrl = options.authorizeUrl ?? "https://auth.openai.com/oauth/authorize";
  const deviceCodeUrl = options.deviceCodeUrl ?? "https://auth.openai.com/oauth/device/code";
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? abortableSleep;
  return {
    id: "openai-codex",
    async login(callbacks?: OAuthLoginCallbacks) {
      throwIfAborted(callbacks?.signal);
      if (callbacks?.onDeviceCode) {
        return deviceLogin({
          callbacks,
          clientId,
          fetchImpl,
          tokenUrl,
          deviceCodeUrl,
          scope: options.scope,
          now,
          sleep,
        });
      }
      const verifier = createPkceVerifier();
      const challenge = computeS256Challenge(verifier);
      const params = new URLSearchParams({
        client_id: clientId,
        code_challenge: challenge,
        code_challenge_method: "S256",
        response_type: "code",
      });
      if (options.redirectUri) params.set("redirect_uri", options.redirectUri);
      if (options.scope) params.set("scope", options.scope);
      await callbacks?.onAuth?.(`${authorizeUrl}?${params}`);
      throwIfAborted(callbacks?.signal);
      const code = await callbacks?.onPrompt?.("OpenAI authorization code");
      if (!code) throw new Error("OpenAI authorization code was not provided");
      return exchangeToken(fetchImpl, tokenUrl, {
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: verifier,
        ...(options.redirectUri ? { redirect_uri: options.redirectUri } : {}),
      }, [code, verifier], callbacks?.signal);
    },
    refresh(credentials) {
      if (!credentials.refresh) return credentials;
      return exchangeToken(
        fetchImpl,
        tokenUrl,
        { grant_type: "refresh_token", client_id: clientId, refresh_token: credentials.refresh },
        [credentials.access, credentials.refresh].filter((s): s is string => Boolean(s)),
      );
    },
    getCredential(credentials) {
      return credentials.access ? { type: "bearer", value: credentials.access, metadata: { accountId: credentials.accountId, expires: credentials.expires } } : undefined;
    },
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

async function deviceLogin(options: {
  readonly callbacks: OAuthLoginCallbacks;
  readonly clientId: string;
  readonly fetchImpl: typeof fetch;
  readonly tokenUrl: string;
  readonly deviceCodeUrl: string;
  readonly scope?: string;
  readonly now: () => number;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}): Promise<OAuthCredentials> {
  const body: Record<string, string> = { client_id: options.clientId };
  if (options.scope) body.scope = options.scope;
  const response = await options.fetchImpl(options.deviceCodeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: options.callbacks.signal,
  });
  if (!response.ok) {
    const detail = await readBoundedResponseText(response);
    throw redactOAuthError(new Error(`OpenAI device code failed: ${response.status} ${detail}`), []);
  }
  const json = await response.json() as DeviceCodePayload;
  const secrets = [json.device_code, json.user_code];
  const expiresAtMs = options.now() + (json.expires_in ?? 0) * 1_000;
  await options.callbacks.onDeviceCode?.({
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    expiresAt: json.expires_in ? new Date(expiresAtMs).toISOString() : undefined,
  });
  let intervalMs = Math.max(1, (json.interval ?? DEFAULT_DEVICE_POLL_INTERVAL_MS / 1_000) * 1_000);
  while (options.now() < expiresAtMs) {
    throwIfAborted(options.callbacks.signal);
    await options.sleep(intervalMs, options.callbacks.signal);
    throwIfAborted(options.callbacks.signal);
    const tokenResponse = await options.fetchImpl(options.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: options.clientId,
        device_code: json.device_code,
      }),
      signal: options.callbacks.signal,
    });
    if (tokenResponse.ok) {
      const payload = await tokenResponse.json() as TokenSuccessPayload;
      return parseTokenCredentials(payload);
    }
    const errorPayload = await readTokenErrorPayload(tokenResponse);
    const code = errorPayload.error ?? "unknown_error";
    if (code === "authorization_pending") continue;
    if (code === "slow_down") {
      intervalMs += SLOW_DOWN_INCREMENT_MS;
      continue;
    }
    throw redactOAuthError(
      new Error(`OpenAI device code login failed: ${code}${errorPayload.error_description ? ` ${errorPayload.error_description}` : ""}`),
      secrets,
    );
  }
  throw redactOAuthError(new Error("OpenAI device code login expired before authorization completed"), secrets);
}

async function exchangeToken(
  fetchImpl: typeof fetch,
  url: string,
  body: Record<string, string>,
  secrets: readonly (string | undefined)[] = [],
  signal?: AbortSignal,
): Promise<OAuthCredentials> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const detail = await readBoundedResponseText(response, { secrets });
    throw redactOAuthError(new Error(`OpenAI token request failed: ${response.status} ${detail}`), secrets);
  }
  const json = await response.json() as TokenSuccessPayload;
  return parseTokenCredentials(json);
}

function parseTokenCredentials(json: TokenSuccessPayload): OAuthCredentials {
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: json.expires_in ? Date.now() + json.expires_in * 1_000 : undefined,
    accountId: json.account_id,
  };
}

async function readTokenErrorPayload(response: Response): Promise<TokenErrorPayload> {
  try {
    return await response.json() as TokenErrorPayload;
  } catch {
    const detail = await readBoundedResponseText(response);
    return { error: "invalid_token_response", error_description: detail };
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
