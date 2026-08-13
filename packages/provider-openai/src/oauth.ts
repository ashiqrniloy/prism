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
        const pollOptions: PollDeviceCodeTokenOptions = {
          fetchImpl,
          deviceCodeUrl,
          tokenUrl,
          clientId,
          scope: options.scope,
          callbacks,
          errorPrefix: "OpenAI",
          now,
          sleep,
          parseTokenCredentials,
        };
        return pollDeviceCodeToken(pollOptions);
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
      return exchangeToken(
        fetchImpl,
        tokenUrl,
        {
          grant_type: "authorization_code",
          client_id: clientId,
          code,
          code_verifier: verifier,
          ...(options.redirectUri ? { redirect_uri: options.redirectUri } : {}),
        },
        [code, verifier],
        callbacks?.signal,
      );
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
      return credentials.access
        ? { type: "bearer", value: credentials.access, metadata: { accountId: credentials.accountId, expires: credentials.expires } }
        : undefined;
    },
  };
}

function parseTokenCredentials(json: OAuthTokenSuccessPayload): OAuthCredentials {
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: json.expires_in ? Date.now() + json.expires_in * 1_000 : undefined,
    accountId: json.account_id,
  };
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
  const json = await readBoundedResponseJson<OAuthTokenSuccessPayload>(response, {
    shape: (value: unknown): boolean =>
      typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).access_token === "string",
  });
  return parseTokenCredentials(json);
}
