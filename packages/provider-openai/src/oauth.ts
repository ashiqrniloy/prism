import { createHash, randomBytes } from "node:crypto";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProvider } from "@arnilo/prism";

export interface OpenAICodexOAuthOptions {
  readonly clientId?: string;
  readonly fetch?: typeof fetch;
  readonly authorizeUrl?: string;
  readonly tokenUrl?: string;
  readonly deviceCodeUrl?: string;
  readonly redirectUri?: string;
  readonly scope?: string;
}

export const openAICodexOAuthProvider = createOpenAICodexOAuthProvider();

const REDACTED = "[REDACTED]";

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
  return {
    id: "openai-codex",
    async login(callbacks?: OAuthLoginCallbacks) {
      if (callbacks?.onDeviceCode) {
        return deviceLogin({ callbacks, clientId, fetchImpl, tokenUrl, deviceCodeUrl, scope: options.scope });
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
      const code = await callbacks?.onPrompt?.("OpenAI authorization code");
      if (!code) throw new Error("OpenAI authorization code was not provided");
      return tokenRequest(fetchImpl, tokenUrl, {
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: verifier,
        ...(options.redirectUri ? { redirect_uri: options.redirectUri } : {}),
      });
    },
    refresh(credentials) {
      if (!credentials.refresh) return credentials;
      return tokenRequest(
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

async function deviceLogin(options: {
  readonly callbacks: OAuthLoginCallbacks;
  readonly clientId: string;
  readonly fetchImpl: typeof fetch;
  readonly tokenUrl: string;
  readonly deviceCodeUrl: string;
  readonly scope?: string;
}): Promise<OAuthCredentials> {
  const body: Record<string, string> = { client_id: options.clientId };
  if (options.scope) body.scope = options.scope;
  const response = await options.fetchImpl(options.deviceCodeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`OpenAI device code failed: ${response.status} ${await response.text()}`);
  const json = await response.json() as { device_code: string; user_code: string; verification_uri: string; expires_in?: number };
  await options.callbacks.onDeviceCode?.({ userCode: json.user_code, verificationUri: json.verification_uri, expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : undefined });
  return tokenRequest(options.fetchImpl, options.tokenUrl, {
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    client_id: options.clientId,
    device_code: json.device_code,
  });
}

async function tokenRequest(fetchImpl: typeof fetch, url: string, body: Record<string, string>, secrets: readonly (string | undefined)[] = []): Promise<OAuthCredentials> {
  const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw redact(new Error(`OpenAI token request failed: ${response.status} ${await response.text()}`), secrets);
  const json = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; account_id?: string };
  return { access: json.access_token, refresh: json.refresh_token, expires: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined, accountId: json.account_id };
}

function redact(error: Error, secrets: readonly (string | undefined)[]): Error {
  let message = error.message;
  for (const secret of secrets) if (secret) message = message.split(secret).join(REDACTED);
  return new Error(message);
}
