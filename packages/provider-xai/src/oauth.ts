import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProvider, OAuthTokenSuccessPayload } from "@arnilo/prism";
import { abortableSleep, pollDeviceCodeToken, redactOAuthError, throwIfAborted } from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText } from "@arnilo/prism/providers/transport";

export const XAI_DEFAULT_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const XAI_DEFAULT_SCOPE = "openid profile email offline_access grok-cli:access api:access";
export const XAI_DEFAULT_DEVICE_CODE_URL = "https://auth.x.ai/oauth2/device/code";
export const XAI_DEFAULT_TOKEN_URL = "https://auth.x.ai/oauth2/token";
export const XAI_DEFAULT_REVOKE_URL = "https://auth.x.ai/oauth2/revoke";
export const XAI_DEFAULT_REFERRER = "prism";
export const XAI_REFRESH_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600;

export interface XaiOAuthOptions {
  readonly clientId?: string;
  readonly fetch?: typeof fetch;
  readonly deviceCodeUrl?: string;
  readonly tokenUrl?: string;
  readonly revokeUrl?: string;
  readonly scope?: string;
  readonly referrer?: string;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function createXaiOAuthProvider(options: XaiOAuthOptions = {}): OAuthProvider {
  const clientId = options.clientId ?? XAI_DEFAULT_CLIENT_ID;
  const fetchImpl = options.fetch ?? fetch;
  const deviceCodeUrl = options.deviceCodeUrl ?? XAI_DEFAULT_DEVICE_CODE_URL;
  const tokenUrl = options.tokenUrl ?? XAI_DEFAULT_TOKEN_URL;
  const revokeUrl = options.revokeUrl ?? XAI_DEFAULT_REVOKE_URL;
  const scope = options.scope ?? XAI_DEFAULT_SCOPE;
  const referrer = options.referrer ?? XAI_DEFAULT_REFERRER;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? abortableSleep;
  return {
    id: "xai",
    async login(callbacks?: OAuthLoginCallbacks) {
      throwIfAborted(callbacks?.signal);
      if (!callbacks?.onDeviceCode) {
        throw new Error("xAI SuperGrok login requires onDeviceCode");
      }
      return pollDeviceCodeToken({
        fetchImpl,
        deviceCodeUrl,
        tokenUrl,
        clientId,
        scope,
        extraDeviceParams: { referrer },
        bodyEncoding: "form",
        callbacks,
        errorPrefix: "xAI",
        now,
        sleep,
        parseTokenCredentials: (json) => parseXaiTokenCredentials(json, undefined, now),
      });
    },
    async refresh(credentials) {
      if (!credentials.refresh) return credentials;
      return exchangeForm(
        fetchImpl,
        tokenUrl,
        { grant_type: "refresh_token", client_id: clientId, refresh_token: credentials.refresh },
        [credentials.access, credentials.refresh],
        (json) => parseXaiTokenCredentials(json, credentials.refresh, now),
      );
    },
    async revoke(credentials) {
      const token = credentials.access ?? credentials.refresh;
      if (!token) return;
      const secrets = [credentials.access, credentials.refresh];
      try {
        const response = await fetchImpl(revokeUrl, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token,
            client_id: clientId,
            token_type_hint: credentials.access ? "access_token" : "refresh_token",
          }).toString(),
        });
        if (!response.ok) await readBoundedResponseText(response, { secrets });
      } catch {
        // best-effort; local store delete is the fail-closed boundary
      }
    },
    getCredential(credentials) {
      return credentials.access ? { type: "bearer", value: credentials.access } : undefined;
    },
  };
}

export function parseXaiTokenCredentials(
  json: OAuthTokenSuccessPayload,
  previousRefresh?: string,
  now: () => number = Date.now,
): OAuthCredentials {
  const expiresIn = json.expires_in ?? DEFAULT_TOKEN_LIFETIME_SECONDS;
  return {
    access: json.access_token,
    refresh: json.refresh_token ?? previousRefresh,
    expires: now() + expiresIn * 1_000 - XAI_REFRESH_SKEW_MS,
  };
}

async function exchangeForm(
  fetchImpl: typeof fetch,
  url: string,
  body: Record<string, string>,
  secrets: readonly (string | undefined)[],
  parse: (json: OAuthTokenSuccessPayload) => OAuthCredentials,
): Promise<OAuthCredentials> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!response.ok) {
    const detail = await readBoundedResponseText(response, { secrets });
    throw redactOAuthError(new Error(`xAI token request failed: ${response.status} ${detail}`), secrets);
  }
  const json = await readBoundedResponseJson<OAuthTokenSuccessPayload>(response, {
    shape: (value: unknown): boolean =>
      typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).access_token === "string",
  });
  return parse(json);
}
