/**
 * Sign in with ChatGPT for the OpenAI Codex provider: the OAuth client, the request-time token source,
 * logout, and the headless import path.
 *
 * The flow is OpenAI's documented open-source client flow (no client secret): a loopback listener on
 * `127.0.0.1` plus a paste fallback, S256 PKCE, `state`, `nonce`, and a stable per-host ID
 * (`urn:uuid:<v4>`) stored with the credential. The first sign-in registers with
 * `client_id=dynamic_agent_client` and `agent_name_hint`; the callback returns the issued `oaiapp_…`
 * client ID, which every later sign-in and refresh reuses. The issued client ID is also the ID token's
 * `aud`, and it is verified before anything is stored.
 *
 * Nothing here opens a browser itself: the URL goes out through `host.ui` `open-url`, and the answer
 * comes back through `host.ui` `input` or the listener. Tokens, the code, the verifier, and the ID
 * token never appear in a `host.ui` payload, a status note, an error message, or a log.
 *
 * The stored record is one `bearer` secret whose value is the access token, with the rest of the record
 * in metadata, so a host that adapts OAuth credentials (`access`/`refresh`/`expires`) sees them.
 */

import type { AuthContext, AuthMethod, Secret } from "@arnilo/prism";
import { verifyIdToken } from "./jwt.js";

/** The `AuthMethod` id a host uses to find this login. */
export const OPENAI_CODEX_AUTH_ID = "openai-codex";
/** Where the first sign-in registers its client. */
export const OPENAI_CODEX_AUTHORIZE_URL = "https://auth.openai.com/api/accounts/authorize";
/** Code exchange and refresh. */
export const OPENAI_CODEX_TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
/** Discovery, for the issuer, the JWKS, and the revocation endpoint. */
export const OPENAI_CODEX_OIDC_URL = "https://auth.openai.com/.well-known/openid-configuration";
/** The revocation endpoint the discovery document names; the fallback if discovery cannot be read. */
export const OPENAI_CODEX_REVOKE_URL = "https://auth.openai.com/api/accounts/oauth/revoke";
/** The resource the grant is scoped to; the access token is sent to it directly. */
export const OPENAI_CODEX_RESOURCE = "https://api.openai.com/v1";
/** The scope that makes the grant usable for inference. Without it the plan consent is incomplete. */
export const OPENAI_CODEX_DIRECT_TOKEN_SCOPE = "chatgpt.tokens.use.direct";
/** The full scope every sign-in asks for, in the documented order. */
export const OPENAI_CODEX_SCOPE = `openid profile email offline_access resource.invoke ${OPENAI_CODEX_DIRECT_TOKEN_SCOPE}`;
/** The registration sentinel; only the authorize step may use it. */
export const DYNAMIC_AGENT_CLIENT_ID = "dynamic_agent_client";
/** The documented loopback port. A busy port falls back to an ephemeral one. */
export const OPENAI_CODEX_DEFAULT_CALLBACK_PORT = 1455;
export const OPENAI_CODEX_CALLBACK_PATH = "/auth/callback";
/** Refresh this long before the access token actually expires, so a request never starts on a dying token. */
export const OPENAI_CODEX_EXPIRY_MARGIN_MS = 300_000;
/** Codes that mean the refresh grant is gone: clear it and sign in again. */
export const OPENAI_CODEX_TERMINAL_REFRESH_CODES = [
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
] as const;

/** The record the credential ref holds. `expires` and `earliestRefreshAt` are epoch milliseconds. */
export interface OpenAICodexCredentialRecord {
  readonly v: 1;
  /** The issued `oaiapp_…` client ID: reused for every sign-in, refresh, and the ID token `aud`. */
  readonly clientId: string;
  /** `urn:uuid:<v4>`, stable per host and sent as `ext_agent_host_id`. */
  readonly hostId: string;
  readonly access: string;
  readonly refresh: string;
  readonly expires: number;
  /** The token response's advisory `earliest_refresh_at`; stored, never used as a gate. */
  readonly earliestRefreshAt?: number;
  /** Space-delimited granted scope. */
  readonly scope: string;
  readonly sub?: string;
  readonly idToken?: string;
}

/** Base for every sign-in failure. The message is user-facing; no token, code, or verifier is in it. */
export class OpenAICodexAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OpenAICodexAuthError";
  }
}

/** The login could not register or exchange. Re-running login is the recovery. */
export class OpenAICodexRegistrationError extends OpenAICodexAuthError {
  constructor(message: string) {
    super("openai_codex_registration", message);
    this.name = "OpenAICodexRegistrationError";
  }
}

/** The grant lacks `chatgpt.tokens.use.direct`: nothing was stored. Re-consent is the recovery. */
export class OpenAICodexPlanUsageNotGrantedError extends OpenAICodexAuthError {
  constructor(message: string) {
    super("openai_codex_plan_usage_not_granted", message);
    this.name = "OpenAICodexPlanUsageNotGrantedError";
  }
}

/** The refresh grant is gone. Non-transient: a signed-out provider stays signed out until login. */
export class OpenAICodexReauthorizeError extends OpenAICodexAuthError {
  constructor(message: string) {
    super("openai_codex_reauthorize", message);
    this.name = "OpenAICodexReauthorizeError";
  }
}

/** What the OAuth client needs from the credentials slot: read the record, write the rotation. */
export interface OpenAICodexCredentialSlot {
  resolve(ref: string): Promise<Secret | undefined>;
  store?(ref: string, secret: Secret): Promise<void>;
  delete?(ref: string): Promise<void>;
}

export interface OpenAICodexOAuthConfig {
  /** A writable ref (`keyring:<name>`) holding the record. */
  readonly credential: string;
  /** Sent as `agent_name_hint` on the first registration. Required by `login` only. */
  readonly appName?: string;
  /** Loopback port to try first; defaults to {@link OPENAI_CODEX_DEFAULT_CALLBACK_PORT}. */
  readonly callbackPort?: number;
  /** `listen` (default) binds the loopback listener; `paste` waits for a pasted callback URL only. */
  readonly callback?: "listen" | "paste";
  readonly fetch?: typeof fetch;
  /** Epoch milliseconds; tests inject a clock. */
  readonly now?: () => number;
  /** Reads the current record. Absent means login cannot reuse an issued client or host ID. */
  readonly slot?: OpenAICodexCredentialSlot;
  /** Aborts a pending listener or paste prompt. */
  readonly signal?: AbortSignal;
}

// ---------------------------------------------------------------- record

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Validates a stored or imported record. A malformed one is `undefined`, never half-trusted. */
export function parseCredentialRecord(value: unknown): OpenAICodexCredentialRecord | undefined {
  if (!isRecord(value) || value.v !== 1) return undefined;
  const clientId = text(value.clientId);
  const hostId = text(value.hostId);
  const access = text(value.access);
  const refresh = text(value.refresh);
  const expires = stamp(value.expires);
  const scope = text(value.scope);
  if (!clientId || !hostId || !access || !refresh || expires === undefined || !scope) return undefined;
  return {
    v: 1,
    clientId,
    hostId,
    access,
    refresh,
    expires,
    scope,
    ...(stamp(value.earliestRefreshAt) !== undefined ? { earliestRefreshAt: value.earliestRefreshAt as number } : {}),
    ...(text(value.sub) !== undefined ? { sub: value.sub as string } : {}),
    ...(text(value.idToken) !== undefined ? { idToken: value.idToken as string } : {}),
  };
}

/** The record as a `bearer` secret: the token is the value, the rest is metadata. */
export function credentialRecordToSecret(record: OpenAICodexCredentialRecord): Secret {
  return {
    type: "bearer",
    value: record.access,
    metadata: { refresh: record.refresh, expires: record.expires, oauthMetadata: record },
  };
}

/** Reads a record back out of a secret, accepting the keyring's OAuth adapters and our own metadata. */
export function credentialRecordFromSecret(secret: Secret | undefined): OpenAICodexCredentialRecord | undefined {
  const metadata = secret?.metadata;
  if (secret === undefined || !isRecord(metadata)) return undefined;
  // The `refresh`/`expires` fields beside the record are for hosts that adapt OAuth credentials; the
  // record itself is the only thing read back, because a bare token pair cannot refresh without the
  // issued client ID.
  return parseCredentialRecord(metadata.oauthMetadata);
}

/**
 * What a sign-out keeps: the issued client and this host's ID, with no token. Deleting the whole record
 * would make the next sign-in register a second client for the same person, so the registration stays and
 * the grant does not (plan 204 Task 9 measured the difference: a delete re-issues both identifiers).
 */
export interface OpenAICodexRegistration {
  readonly clientId: string;
  readonly hostId: string;
}

/**
 * The registration as a non-bearer secret: `type: "custom"` and a fixed marker, so no generic consumer of
 * this ref can send it as a token, and the keyring's "a secret has a value" rule still holds.
 */
export const OPENAI_CODEX_REGISTRATION_MARKER = "registration-only";

export function credentialRegistrationToSecret(registration: OpenAICodexRegistration): Secret {
  return { type: "custom", value: OPENAI_CODEX_REGISTRATION_MARKER, metadata: { oauthRegistration: registration } };
}

/** Reads the kept registration back; `undefined` when the stored secret holds a grant or nothing at all. */
export function credentialRegistrationFromSecret(secret: Secret | undefined): OpenAICodexRegistration | undefined {
  const metadata = secret?.metadata;
  if (!isRecord(metadata) || !isRecord(metadata.oauthRegistration)) return undefined;
  const clientId = text(metadata.oauthRegistration.clientId);
  const hostId = text(metadata.oauthRegistration.hostId);
  if (!clientId || !hostId) return undefined;
  return { clientId, hostId };
}

/** A record is written through the slot, so an `env:` ref is refused before login starts. */
export function assertWritableCredentialRef(ref: string): void {
  if (!ref.startsWith("keyring:"))
    throw new OpenAICodexAuthError(
      "openai_codex_credential_ref",
      `openai-codex: ${ref.split(":")[0]}: refs are read-only; use keyring:openai-codex`,
    );
}

async function readRecord(config: OpenAICodexOAuthConfig): Promise<OpenAICodexCredentialRecord | undefined> {
  const secret = await config.slot?.resolve(config.credential);
  return credentialRecordFromSecret(secret);
}

// ---------------------------------------------------------------- http

interface TokenResponse {
  readonly access: string;
  readonly refresh: string;
  readonly idToken: string;
  readonly expires: number;
  readonly earliestRefreshAt?: number;
  readonly scope: string;
}

async function postForm(
  config: OpenAICodexOAuthConfig,
  url: string,
  form: Readonly<Record<string, string>>,
): Promise<{ readonly status: number; readonly body: Record<string, unknown> | undefined }> {
  const response = await (config.fetch ?? fetch)(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    signal: config.signal,
  });
  const raw = await response.text();
  let body: unknown;
  try {
    body = raw.length === 0 ? undefined : JSON.parse(raw);
  } catch {
    body = undefined;
  }
  return { status: response.status, body: isRecord(body) ? body : undefined };
}

/** The `error` code from a refusal body. Never the raw body: it can echo request material. */
function errorCode(body: Record<string, unknown> | undefined): string | undefined {
  return text(body?.error);
}

function tokenResponse(body: Record<string, unknown> | undefined, now: number): TokenResponse {
  const access = text(body?.access_token);
  const refresh = text(body?.refresh_token);
  const idToken = text(body?.id_token);
  const scope = text(body?.scope);
  const expiresIn = body?.expires_in;
  if (!access) throw new OpenAICodexRegistrationError("openai-codex: the token response has no access token");
  if (!refresh) throw new OpenAICodexRegistrationError("openai-codex: the token response has no refresh token");
  if (!idToken) throw new OpenAICodexRegistrationError("openai-codex: the token response has no ID token");
  if (!scope) throw new OpenAICodexRegistrationError("openai-codex: the token response has no scope");
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0)
    throw new OpenAICodexRegistrationError("openai-codex: the token response has an invalid expires_in");
  const earliestRefreshAt = stamp(body?.earliest_refresh_at);
  return {
    access,
    refresh,
    idToken,
    expires: now + expiresIn * 1000,
    scope,
    // The response reports `earliest_refresh_at` in seconds.
    ...(earliestRefreshAt !== undefined ? { earliestRefreshAt: earliestRefreshAt * 1000 } : {}),
  };
}

// ---------------------------------------------------------------- pkce / callback

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** S256 PKCE through WebCrypto: a 64-character verifier and its base64url SHA-256 challenge. */
export async function generatePkce(): Promise<{ readonly verifier: string; readonly challenge: string }> {
  const verifier = randomToken(48);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

export interface OpenAICodexAuthorizeParams {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly nonce: string;
  readonly challenge: string;
  readonly hostId: string;
  /** Present only on the first registration. */
  readonly agentName?: string;
}

/** The authorize URL. `agent_name_hint` is present only when the client is being registered. */
export function openAICodexAuthorizeUrl(params: OpenAICodexAuthorizeParams): string {
  const url = new URL(OPENAI_CODEX_AUTHORIZE_URL);
  const query: Record<string, string> = {
    response_type: "code",
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: OPENAI_CODEX_SCOPE,
    resource: OPENAI_CODEX_RESOURCE,
    state: params.state,
    nonce: params.nonce,
    code_challenge_method: "S256",
    code_challenge: params.challenge,
    ext_agent_host_id: params.hostId,
  };
  if (params.agentName !== undefined) query.agent_name_hint = params.agentName;
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

interface CallbackResult {
  readonly code: string;
  readonly clientId: string;
}

interface CallbackListener {
  readonly redirectUri: string;
  readonly result: Promise<CallbackResult>;
  close(): void;
}

const HTML = { "content-type": "text/html; charset=utf-8" };

/**
 * Reads a callback URL: the code, the issued client ID, and a `state` that must be the one this login
 * sent. Static answers only — nothing from the query is echoed back into the page.
 */
function callbackFromUrl(raw: string, expected: URL, state: string, fallbackClientId?: string): CallbackResult {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new OpenAICodexRegistrationError("openai-codex: paste the full callback URL from the browser");
  }
  if (url.origin !== expected.origin || url.pathname !== expected.pathname)
    throw new OpenAICodexRegistrationError(`openai-codex: the pasted callback URL must start with ${expected.origin}${expected.pathname}`);
  const failure = url.searchParams.get("error");
  if (failure) throw new OpenAICodexRegistrationError(`openai-codex: authorization failed (${failure})`);
  if (url.searchParams.get("state") !== state)
    throw new OpenAICodexRegistrationError("openai-codex: the callback state does not match this login");
  const code = url.searchParams.get("code");
  if (!code) throw new OpenAICodexRegistrationError("openai-codex: the callback has no authorization code");
  // Registration answers with the issued client; a re-sign-in measured on 2026-10-25 answers without one,
  // so the presented client stands in and the caller still checks any echoed value against it.
  const clientId = url.searchParams.get("client_id")?.trim() || fallbackClientId;
  if (!clientId) throw new OpenAICodexRegistrationError("openai-codex: the callback did not carry an issued client ID");
  return { code, clientId };
}

/**
 * Binds the loopback listener. `node:http` is imported here, inside `login`, so importing the package
 * never loads it. The configured port is tried first; a busy port falls back to an ephemeral one, which
 * only changes the redirect URI in the authorize URL.
 */
async function openCallbackListener(
  config: OpenAICodexOAuthConfig,
  state: string,
  signal: AbortSignal | undefined,
  fallbackClientId: string | undefined,
): Promise<CallbackListener> {
  const { createServer } = await import("node:http");
  const server = createServer();
  const listen = (port: number): Promise<number> =>
    new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        server.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        const address = server.address();
        resolve(typeof address === "object" && address !== null ? address.port : port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });
  const wanted = config.callbackPort ?? OPENAI_CODEX_DEFAULT_CALLBACK_PORT;
  let port: number;
  try {
    port = await listen(wanted);
  } catch {
    port = await listen(0);
  }
  const base = `http://127.0.0.1:${port}`;
  const expected = new URL(`${base}${OPENAI_CODEX_CALLBACK_PATH}`);
  let settle: { resolve(value: CallbackResult): void; reject(error: unknown): void } | undefined;
  const result = new Promise<CallbackResult>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const close = () => {
    settle = undefined;
    server.close();
    // A browser keeps spare connections open ahead of time; without this a later login's callback can
    // arrive on one of them and be rejected by this closed-out state.
    server.closeAllConnections?.();
    signal?.removeEventListener("abort", onAbort);
  };
  const onAbort = () => {
    settle?.reject(config.signal?.reason ?? new OpenAICodexAuthError("openai_codex_login_cancelled", "openai-codex: sign-in cancelled"));
    close();
  };
  server.on("request", (request, response) => {
    const url = new URL(request.url ?? "/", base);
    if (url.pathname !== OPENAI_CODEX_CALLBACK_PATH) {
      response.writeHead(404, HTML).end("<p>Not found.</p>");
      return;
    }
    let callback: CallbackResult;
    try {
      callback = callbackFromUrl(url.toString(), expected, state, fallbackClientId);
    } catch (error) {
      response.writeHead(400, HTML).end("<p>Sign-in did not complete. Return to the host.</p>");
      settle?.reject(error);
      return;
    }
    response.writeHead(200, HTML).end("<p>Signed in. Close this tab and return to the host.</p>");
    settle?.resolve(callback);
  });
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  return { redirectUri: expected.toString(), result, close };
}

/** The paste fallback. `unavailable` means no UI: it never settles, so a listener can still win. */
function pasteCallback(ctx: AuthContext, expected: URL, state: string, fallbackClientId?: string): Promise<CallbackResult> {
  const ui = ctx.host.ui;
  if (!ui) return new Promise<CallbackResult>(() => {});
  const answer = ui.request({
    kind: "input",
    title: "Paste the callback URL",
    detail: "The browser ends at a page that will not load. Copy its full address and paste it here.",
    placeholder: expected.toString(),
  });
  return answer.then((response) => {
    if (response.status === "unavailable") return new Promise<CallbackResult>(() => {});
    if (response.status === "dismissed") throw new OpenAICodexAuthError("openai_codex_login_cancelled", "openai-codex: sign-in cancelled");
    return callbackFromUrl(response.value, expected, state, fallbackClientId);
  });
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(signal.reason ?? new OpenAICodexAuthError("openai_codex_login_cancelled", "openai-codex: sign-in cancelled"));
    if (signal.aborted) onAbort();
    else {
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    }
  });
}

// ---------------------------------------------------------------- login

interface Discovery {
  readonly issuer: string;
  readonly jwksUri: string;
  readonly revocationEndpoint: string;
}

async function discovery(config: OpenAICodexOAuthConfig): Promise<Discovery> {
  const response = await (config.fetch ?? fetch)(OPENAI_CODEX_OIDC_URL, { headers: { accept: "application/json" }, signal: config.signal });
  const body = (await response.json().catch(() => undefined)) as unknown;
  const issuer = isRecord(body) ? text(body.issuer) : undefined;
  const jwksUri = isRecord(body) ? text(body.jwks_uri) : undefined;
  if (!response.ok || !issuer || !jwksUri)
    throw new OpenAICodexRegistrationError("openai-codex: the sign-in discovery document is unavailable");
  return { issuer, jwksUri, revocationEndpoint: (isRecord(body) ? text(body.revocation_endpoint) : undefined) ?? OPENAI_CODEX_REVOKE_URL };
}

async function jwks(config: OpenAICodexOAuthConfig, uri: string): Promise<{ keys?: readonly Record<string, unknown>[] } | undefined> {
  const response = await (config.fetch ?? fetch)(uri, { headers: { accept: "application/json" }, signal: config.signal });
  const body = (await response.json().catch(() => undefined)) as unknown;
  if (!response.ok || !isRecord(body)) return undefined;
  const keys = Array.isArray(body.keys) ? body.keys.filter(isRecord) : [];
  return { keys };
}

async function login(config: OpenAICodexOAuthConfig, ctx: AuthContext): Promise<void> {
  const appName = config.appName?.trim();
  if (!appName)
    throw new OpenAICodexAuthError("openai_codex_app_name_required", "openai-codex: sign-in needs appName (the host's name for this app)");
  if (!ctx.host.ui)
    throw new OpenAICodexAuthError("openai_codex_login_unavailable", "openai-codex: sign-in needs a host UI (open-url and input)");
  assertWritableCredentialRef(config.credential);
  const now = config.now ?? Date.now;
  const stored = await config.slot?.resolve(config.credential);
  const identity = credentialRecordFromSecret(stored) ?? credentialRegistrationFromSecret(stored);
  const hostId = identity?.hostId ?? `urn:uuid:${crypto.randomUUID()}`;
  const registering = identity === undefined;
  const clientId = identity?.clientId ?? DYNAMIC_AGENT_CLIENT_ID;
  const { verifier, challenge } = await generatePkce();
  const state = randomToken();
  const nonce = randomToken();
  // A re-sign-in reuses the issued client, and its callback may omit `client_id`; a registration's may not.
  const presentedClient = registering ? undefined : clientId;
  const listener = config.callback === "paste" ? undefined : await openCallbackListener(config, state, config.signal, presentedClient);
  const redirectUri =
    listener?.redirectUri ?? `http://127.0.0.1:${config.callbackPort ?? OPENAI_CODEX_DEFAULT_CALLBACK_PORT}${OPENAI_CODEX_CALLBACK_PATH}`;
  try {
    const authorizeUrl = openAICodexAuthorizeUrl({
      clientId,
      redirectUri,
      state,
      nonce,
      challenge,
      hostId,
      ...(registering ? { agentName: appName } : {}),
    });
    // The URL carries the state, nonce, and challenge — never a token; it is the only thing shown. A host
    // that cannot show it cannot complete the flow, so this fails before anything is exchanged.
    const opened = await ctx.host.ui.request({ kind: "open-url", title: "Sign in with ChatGPT", url: authorizeUrl });
    if (opened.status !== "answered")
      throw new OpenAICodexAuthError("openai_codex_login_unavailable", "openai-codex: the host could not open the sign-in URL");
    const expected = new URL(redirectUri);
    const callback = await abortable(
      listener
        ? (Promise.race([listener.result, pasteCallback(ctx, expected, state, presentedClient)]) as Promise<CallbackResult>)
        : pasteCallback(ctx, expected, state, presentedClient),
      config.signal,
    );
    if (callback.clientId === DYNAMIC_AGENT_CLIENT_ID)
      throw new OpenAICodexRegistrationError("openai-codex: OpenAI did not issue a client ID for this sign-in");
    // A re-sign-in must come back as the client we presented; anything else would silently replace the
    // stored registration with a different app's.
    if (!registering && callback.clientId !== clientId)
      throw new OpenAICodexRegistrationError("openai-codex: the callback carried a different client ID than this host signed in with");
    const { status, body } = await postForm(config, OPENAI_CODEX_TOKEN_URL, {
      grant_type: "authorization_code",
      client_id: callback.clientId,
      code: callback.code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource: OPENAI_CODEX_RESOURCE,
    });
    if (status !== 200) {
      const code = errorCode(body);
      throw new OpenAICodexRegistrationError(`openai-codex: the code exchange was refused (${status}${code ? ` ${code}` : ""})`);
    }
    const token = tokenResponse(body, now());
    const { issuer, jwksUri } = await discovery(config);
    const payload = await verifyIdToken(token.idToken, {
      jwks: await jwks(config, jwksUri),
      issuer,
      audience: callback.clientId,
      nonce,
      now: now(),
    });
    const scope = token.scope.trim().split(/\s+/);
    if (!scope.includes(OPENAI_CODEX_DIRECT_TOKEN_SCOPE))
      throw new OpenAICodexPlanUsageNotGrantedError(
        "openai-codex: the ChatGPT plan consent did not grant chatgpt.tokens.use.direct, so this app cannot use the plan. Sign in again and allow the ChatGPT plan permission.",
      );
    const record: OpenAICodexCredentialRecord = {
      v: 1,
      clientId: callback.clientId,
      hostId,
      access: token.access,
      refresh: token.refresh,
      expires: token.expires,
      scope: scope.join(" "),
      ...(token.earliestRefreshAt !== undefined ? { earliestRefreshAt: token.earliestRefreshAt } : {}),
      ...(text(payload.sub) !== undefined ? { sub: payload.sub as string } : {}),
      idToken: token.idToken,
    };
    await ctx.credentials.store(config.credential, credentialRecordToSecret(record));
  } finally {
    listener?.close();
  }
}

/** The shape `openAICodexAuth` returns; still a plain `AuthMethod` to a host. */
export type OpenAICodexAuthMethod = Extract<AuthMethod, { kind: "oauth" }>;

/** The provider's `AuthMethod`. The host runs `login`; the kernel never does. */
export function openAICodexAuth(config: OpenAICodexOAuthConfig): OpenAICodexAuthMethod {
  return { kind: "oauth", id: OPENAI_CODEX_AUTH_ID, login: (ctx) => login(config, ctx) };
}

// ---------------------------------------------------------------- refresh

/** In-process single-flight per credential ref: two concurrent turns make one refresh request. */
const refreshes = new Map<string, Promise<OpenAICodexCredentialRecord>>();

async function requireRecord(config: OpenAICodexOAuthConfig): Promise<OpenAICodexCredentialRecord> {
  const record = await readRecord(config);
  if (!record)
    throw new OpenAICodexReauthorizeError(
      `openai-codex: no usable credential at ${config.credential}; sign in with ChatGPT (or import a record on a self-hosted host)`,
    );
  return record;
}

async function persist(config: OpenAICodexOAuthConfig, record: OpenAICodexCredentialRecord): Promise<void> {
  // shortcut: a read-only slot keeps the rotation only for this process, revisit when a host needs
  // refresh without the credentials:write capability.
  if (!config.slot?.store) return;
  await config.slot.store(config.credential, credentialRecordToSecret(record));
}

async function refreshGrant(
  config: OpenAICodexOAuthConfig,
  record: OpenAICodexCredentialRecord,
  now: () => number,
): Promise<OpenAICodexCredentialRecord> {
  const { status, body } = await postForm(config, OPENAI_CODEX_TOKEN_URL, {
    grant_type: "refresh_token",
    client_id: record.clientId,
    refresh_token: record.refresh,
    resource: OPENAI_CODEX_RESOURCE,
  });
  if (status !== 200) {
    const code = errorCode(body);
    if (code === "refresh_token_reused" || code === "invalid_grant") {
      // Another process may have rotated the token between our read and this request: keep the stored
      // record if it moved, and only then call the grant dead.
      const current = await readRecord(config);
      if (current && current.refresh !== record.refresh) return current;
    }
    if (code !== undefined && (OPENAI_CODEX_TERMINAL_REFRESH_CODES as readonly string[]).includes(code))
      throw new OpenAICodexReauthorizeError("openai-codex: the ChatGPT sign-in expired; sign in again");
    if (code === "invalid_client") throw new OpenAICodexReauthorizeError("openai-codex: OpenAI refused the saved client ID; sign in again");
    throw new OpenAICodexRegistrationError(`openai-codex: the token refresh was refused (${status}${code ? ` ${code}` : ""})`);
  }
  const token = tokenResponse(body, now());
  const rotated: OpenAICodexCredentialRecord = {
    ...record,
    access: token.access,
    refresh: token.refresh,
    expires: token.expires,
    scope: token.scope.trim().split(/\s+/).join(" "),
    ...(token.earliestRefreshAt !== undefined ? { earliestRefreshAt: token.earliestRefreshAt } : {}),
    idToken: token.idToken,
  };
  // Persisted before it is used: a crash between the two would leave the old, rotated-away token stored.
  await persist(config, rotated);
  return rotated;
}

/**
 * The provider's request-time credential: the stored access token, refreshed when it expires within
 * {@link OPENAI_CODEX_EXPIRY_MARGIN_MS}. `earliest_refresh_at` is stored but never gates — the server
 * accepted an early refresh four minutes after issue.
 */
export function openAICodexApiKey(config: OpenAICodexOAuthConfig): (signal?: AbortSignal) => Promise<string> {
  const now = config.now ?? Date.now;
  return async (signal) => {
    const record = await requireRecord(config);
    if (record.expires - now() > OPENAI_CODEX_EXPIRY_MARGIN_MS) return record.access;
    const pending = refreshes.get(config.credential);
    if (pending) return (await pending).access;
    const attempt = signal ? { ...config, signal } : config;
    const refresh = (async () => {
      // Re-read first: another turn or process may already have rotated the record this call saw.
      const current = await requireRecord(attempt);
      if (current.expires - now() > OPENAI_CODEX_EXPIRY_MARGIN_MS) return current;
      return refreshGrant(attempt, current, now);
    })();
    refreshes.set(config.credential, refresh);
    try {
      return (await refresh).access;
    } finally {
      if (refreshes.get(config.credential) === refresh) refreshes.delete(config.credential);
    }
  };
}

// ---------------------------------------------------------------- logout / import

/** Revokes the refresh grant and stores the registration with no token, so the next sign-in reuses it. */
export function openAICodexLogout(config: OpenAICodexOAuthConfig): (ctx: AuthContext) => Promise<void> {
  return async (ctx) => {
    const record = await readRecord(config);
    if (!record) return;
    const { revocationEndpoint } = await discovery(config).catch(() => ({ revocationEndpoint: OPENAI_CODEX_REVOKE_URL }));
    const revokeUrl = revocationEndpoint;
    let revoked = false;
    for (let attempt = 1; attempt <= 3 && !revoked; attempt += 1) {
      const { status } = await postForm({ ...config, signal: undefined }, revokeUrl, {
        token: record.refresh,
        token_type_hint: "refresh_token",
        client_id: record.clientId,
      });
      // 200 revokes; 400/401 means the grant was already unusable, which is the same end state.
      if (status === 200 || status === 400 || status === 401) revoked = true;
      else if (status >= 500 && attempt < 3) await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** (attempt - 1)));
      else break;
    }
    // The grant is dropped only once it is gone; a 5xx keeps the record so logout can be retried. The
    // issued client and this host's ID stay, so signing in again does not register a second client.
    if (revoked) await ctx.credentials.store(config.credential, credentialRegistrationToSecret(record));
  };
}

/** Validates an imported record, keeps this host's own host ID, and stores it. */
export function openAICodexImportCredentials(config: OpenAICodexOAuthConfig): (ctx: AuthContext, record: unknown) => Promise<void> {
  return async (ctx, record) => {
    const parsed = parseCredentialRecord(record);
    if (!parsed)
      throw new OpenAICodexAuthError("openai_codex_invalid_record", "openai-codex: the imported credential record is not a v1 record");
    const secret = await config.slot?.resolve(config.credential);
    const local = credentialRecordFromSecret(secret)?.hostId ?? credentialRegistrationFromSecret(secret)?.hostId;
    await ctx.credentials.store(
      config.credential,
      credentialRecordToSecret({ ...parsed, hostId: local ?? `urn:uuid:${crypto.randomUUID()}` }),
    );
  };
}
