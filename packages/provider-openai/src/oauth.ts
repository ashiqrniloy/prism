import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProvider } from "prism";

export interface OpenAICodexOAuthOptions {
  readonly clientId?: string;
  readonly fetch?: typeof fetch;
  readonly authorizeUrl?: string;
  readonly tokenUrl?: string;
  readonly deviceCodeUrl?: string;
}

export const openAICodexOAuthProvider = createOpenAICodexOAuthProvider();

export function createOpenAICodexOAuthProvider(options: OpenAICodexOAuthOptions = {}): OAuthProvider {
  const clientId = options.clientId ?? "prism-codex";
  const fetchImpl = options.fetch ?? fetch;
  const tokenUrl = options.tokenUrl ?? "https://auth.openai.com/oauth/token";
  return {
    id: "openai-codex",
    async login(callbacks?: OAuthLoginCallbacks) {
      if (callbacks?.onDeviceCode) return deviceLogin({ callbacks, clientId, fetchImpl, tokenUrl, deviceCodeUrl: options.deviceCodeUrl });
      const verifier = randomString();
      const url = `${options.authorizeUrl ?? "https://auth.openai.com/oauth/authorize"}?client_id=${encodeURIComponent(clientId)}&code_challenge=${encodeURIComponent(verifier)}&response_type=code`;
      await callbacks?.onAuth?.(url);
      const code = await callbacks?.onPrompt?.("OpenAI authorization code");
      if (!code) throw new Error("OpenAI authorization code was not provided");
      return tokenRequest(fetchImpl, tokenUrl, { grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier });
    },
    refresh(credentials) {
      if (!credentials.refresh) return credentials;
      return tokenRequest(fetchImpl, tokenUrl, { grant_type: "refresh_token", client_id: clientId, refresh_token: credentials.refresh }, [credentials.access, credentials.refresh]);
    },
    getCredential(credentials) {
      return credentials.access ? { type: "bearer", value: credentials.access, metadata: { accountId: credentials.accountId, expires: credentials.expires } } : undefined;
    },
  };
}

async function deviceLogin(options: { callbacks: OAuthLoginCallbacks; clientId: string; fetchImpl: typeof fetch; tokenUrl: string; deviceCodeUrl?: string }): Promise<OAuthCredentials> {
  const response = await options.fetchImpl(options.deviceCodeUrl ?? "https://auth.openai.com/oauth/device/code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: options.clientId }),
  });
  if (!response.ok) throw new Error(`OpenAI device code failed: ${response.status} ${await response.text()}`);
  const json = await response.json() as { device_code: string; user_code: string; verification_uri: string; expires_in?: number };
  await options.callbacks.onDeviceCode?.({ userCode: json.user_code, verificationUri: json.verification_uri, expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : undefined });
  return tokenRequest(options.fetchImpl, options.tokenUrl, { grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: options.clientId, device_code: json.device_code });
}

async function tokenRequest(fetchImpl: typeof fetch, url: string, body: Record<string, string>, secrets: readonly (string | undefined)[] = []): Promise<OAuthCredentials> {
  const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw redact(new Error(`OpenAI token request failed: ${response.status} ${await response.text()}`), secrets);
  const json = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; account_id?: string };
  return { access: json.access_token, refresh: json.refresh_token, expires: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined, accountId: json.account_id };
}

function redact(error: Error, secrets: readonly (string | undefined)[]): Error {
  let message = error.message;
  for (const secret of secrets) if (secret) message = message.split(secret).join("[REDACTED]");
  return new Error(message);
}

function randomString(): string {
  return Math.random().toString(36).slice(2);
}
