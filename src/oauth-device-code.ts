import { setTimeout as delay } from "node:timers/promises";
import type { OAuthCredentials, OAuthLoginCallbacks } from "./contracts-core.js";
import { readBoundedResponseJson, readBoundedResponseText } from "./providers/transport.js";

/**
 * Shared RFC 8628 device-code flow used by both the OpenAI Codex OAuth provider
 * (provider-openai) and the generic OAuth 2.0 provider (credentials-node).
 * Owns the device-code request, the poll loop (authorization_pending continue,
 * slow_down backoff, expiry deadline), cancellation, bounded success/error
 * body reads, secret redaction, and token-shape parsing. Adapter-specific
 * fields are parameters/callbacks, not subclasses.
 */

export const REDACTED = "[REDACTED]";
export const DEFAULT_DEVICE_POLL_INTERVAL_MS = 5_000;
export const SLOW_DOWN_INCREMENT_MS = 5_000;

export interface OAuthDeviceCodePayload {
  readonly device_code: string;
  readonly user_code: string;
  readonly verification_uri: string;
  readonly verification_uri_complete?: string;
  readonly expires_in?: number;
  readonly interval?: number;
}

export interface OAuthTokenSuccessPayload {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
  readonly account_id?: string;
}

export interface OAuthTokenErrorPayload {
  readonly error?: string;
  readonly error_description?: string;
}

export interface PollDeviceCodeTokenOptions {
  readonly fetchImpl: typeof fetch;
  readonly deviceCodeUrl: string;
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly scope?: string;
  /** Extra token-request params merged into every poll body (e.g. client_secret, audience). Never logged. */
  readonly extraTokenParams?: Readonly<Record<string, string>>;
  /** Extra device-code params merged into the device-code body only (e.g. referrer). Never logged. */
  readonly extraDeviceParams?: Readonly<Record<string, string>>;
  /** Wire encoding for device-code and token POSTs. Default `json` keeps Codex / M365 callers byte-compatible. */
  readonly bodyEncoding?: "json" | "form";
  readonly callbacks?: Pick<OAuthLoginCallbacks, "onDeviceCode" | "signal">;
  /** Message prefix, e.g. "OpenAI" or the adapter id. */
  readonly errorPrefix: string;
  /** Test seam: override wall clock for device-code expiry. */
  readonly now?: () => number;
  /** Test seam: override poll delay between device-code token requests. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Token-shape parsing; adapter-specific fields (e.g. accountId fallback) applied here. */
  readonly parseTokenCredentials: (json: OAuthTokenSuccessPayload) => OAuthCredentials;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error("OAuth login aborted");
}

export async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  throwIfAborted(signal);
  await delay(ms, undefined, { signal });
}

export function redactOAuthError(error: Error, secrets: readonly (string | undefined)[]): Error {
  let message = error.message;
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join(REDACTED);
  }
  return new Error(message);
}

const isDeviceCodePayload = (value: unknown): value is OAuthDeviceCodePayload => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.device_code === "string" &&
    candidate.device_code.length > 0 &&
    typeof candidate.user_code === "string" &&
    candidate.user_code.length > 0 &&
    typeof candidate.verification_uri === "string" &&
    candidate.verification_uri.length > 0
  );
};

const isTokenSuccessPayload = (value: unknown): value is OAuthTokenSuccessPayload => {
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as Record<string, unknown>).access_token === "string";
};

const encodeOAuthBody = (encoding: "json" | "form", params: Record<string, string>): { contentType: string; body: string } =>
  encoding === "form"
    ? { contentType: "application/x-www-form-urlencoded", body: new URLSearchParams(params).toString() }
    : { contentType: "application/json", body: JSON.stringify(params) };

const requireHttpsVerificationUri = (value: string, label: string, errorPrefix: string, secrets: readonly (string | undefined)[]): string => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw redactOAuthError(new Error(`${errorPrefix} ${label} must be https`), secrets);
  }
  if (parsed.protocol !== "https:") {
    throw redactOAuthError(new Error(`${errorPrefix} ${label} must be https`), secrets);
  }
  return value;
};

/**
 * Request a device code, surface it through `onDeviceCode`, then poll the token
 * endpoint until success, expiry, a terminal OAuth error, or abort. All response
 * bodies are read under the shared byte ceiling; success bodies must be bounded
 * JSON with an `access_token` string (fail closed otherwise); error bodies are
 * bounded text parsed as JSON with a redacted-text fallback.
 */
export async function pollDeviceCodeToken(options: PollDeviceCodeTokenOptions): Promise<OAuthCredentials> {
  const { fetchImpl, deviceCodeUrl, tokenUrl, clientId, scope, extraTokenParams, extraDeviceParams, callbacks, errorPrefix, parseTokenCredentials } = options;
  const bodyEncoding = options.bodyEncoding === "form" ? "form" : "json";
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? abortableSleep;
  const deviceBody = encodeOAuthBody(bodyEncoding, {
    client_id: clientId,
    ...(scope ? { scope } : {}),
    ...extraDeviceParams,
  });
  const response = await fetchImpl(deviceCodeUrl, {
    method: "POST",
    headers: { "content-type": deviceBody.contentType },
    body: deviceBody.body,
    signal: callbacks?.signal,
  });
  if (!response.ok) {
    const detail = await readBoundedResponseText(response);
    throw redactOAuthError(new Error(`${errorPrefix} device code failed: ${response.status}${detail ? ` ${detail}` : ""}`), []);
  }
  const json = await readBoundedResponseJson<OAuthDeviceCodePayload>(response, { shape: isDeviceCodePayload });
  const secrets = [json.device_code, json.user_code];
  requireHttpsVerificationUri(json.verification_uri, "verification_uri", errorPrefix, secrets);
  const verificationUri =
    typeof json.verification_uri_complete === "string" && json.verification_uri_complete.length > 0
      ? requireHttpsVerificationUri(json.verification_uri_complete, "verification_uri_complete", errorPrefix, secrets)
      : json.verification_uri;
  const expiresAtMs = now() + (json.expires_in ?? 0) * 1_000;
  await callbacks?.onDeviceCode?.({
    userCode: json.user_code,
    verificationUri,
    expiresAt: json.expires_in ? new Date(expiresAtMs).toISOString() : undefined,
  });
  let intervalMs = Math.max(1, (json.interval ?? DEFAULT_DEVICE_POLL_INTERVAL_MS / 1_000) * 1_000);
  while (now() < expiresAtMs) {
    throwIfAborted(callbacks?.signal);
    await sleep(intervalMs, callbacks?.signal);
    throwIfAborted(callbacks?.signal);
    const tokenBody = encodeOAuthBody(bodyEncoding, {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: clientId,
      device_code: json.device_code,
      ...extraTokenParams,
    });
    const tokenResponse = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "content-type": tokenBody.contentType },
      body: tokenBody.body,
      signal: callbacks?.signal,
    });
    if (tokenResponse.ok) {
      const payload = await readBoundedResponseJson<OAuthTokenSuccessPayload>(tokenResponse, { shape: isTokenSuccessPayload });
      return parseTokenCredentials(payload);
    }
    const errorText = await readBoundedResponseText(tokenResponse, { secrets });
    let errorPayload: OAuthTokenErrorPayload;
    try {
      errorPayload = JSON.parse(errorText) as OAuthTokenErrorPayload;
    } catch {
      errorPayload = { error: "invalid_token_response", error_description: errorText };
    }
    const code = errorPayload.error ?? "unknown_error";
    if (code === "authorization_pending") continue;
    if (code === "slow_down") {
      intervalMs += SLOW_DOWN_INCREMENT_MS;
      continue;
    }
    throw redactOAuthError(
      new Error(
        `${errorPrefix} device code login failed: ${code}${errorPayload.error_description ? ` ${errorPayload.error_description}` : ""}`,
      ),
      secrets,
    );
  }
  throw redactOAuthError(new Error(`${errorPrefix} device code login expired before authorization completed`), secrets);
}
