/**
 * The sign-in client against a fake auth server: one `fetch` that speaks discovery, JWKS, token, and
 * revocation, with ID tokens really signed (RS256) so the verification path is exercised rather than
 * stubbed. The listener tests bind a real loopback port.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import type { AuthContext, HostPort, Secret } from "@arnilo/prism";
import {
  credentialRecordFromSecret,
  credentialRecordToSecret,
  credentialRegistrationFromSecret,
  DYNAMIC_AGENT_CLIENT_ID,
  OPENAI_CODEX_AUTHORIZE_URL,
  OPENAI_CODEX_DIRECT_TOKEN_SCOPE,
  OPENAI_CODEX_OIDC_URL,
  OPENAI_CODEX_RESOURCE,
  OPENAI_CODEX_SCOPE,
  OPENAI_CODEX_TERMINAL_REFRESH_CODES,
  type OpenAICodexCredentialRecord,
  openAICodexApiKey,
  openAICodexAuth,
  openAICodexImportCredentials,
  openAICodexLogout,
} from "../oauth.js";

const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
const JWKS_URI = "https://auth.openai.com/.well-known/jwks.json";
const REVOKE_URL = "https://auth.openai.com/api/accounts/oauth/revoke";
const ISSUER = "https://auth.openai.com";

const keyPair = (await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
)) as CryptoKeyPair;
const foreignPair = (await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
)) as CryptoKeyPair;
const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

const b64u = (value: Uint8Array | string): string => Buffer.from(value).toString("base64url");

async function signIdToken(claims: Record<string, unknown>, signer: CryptoKey = keyPair.privateKey): Promise<string> {
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key" }));
  const payload = b64u(JSON.stringify(claims));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signer, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64u(new Uint8Array(signature))}`;
}

interface FakeAuth {
  readonly fetch: typeof fetch;
  readonly calls: { readonly url: string; readonly form: Record<string, string> }[];
  /** The `nonce` from the last authorize URL the host was asked to open. */
  nonce: string;
  tokenCalls: number;
  revokeCalls: number;
  scope: string;
  idTokenClaims: (base: Record<string, unknown>) => Record<string, unknown>;
  signer: CryptoKey;
  refreshResponse: (form: Record<string, string>, call: number) => { status: number; body?: unknown } | undefined;
  revokeResponse: (call: number) => number;
}

function fakeAuth(): FakeAuth {
  const state: FakeAuth = {
    calls: [],
    nonce: "",
    tokenCalls: 0,
    revokeCalls: 0,
    scope: OPENAI_CODEX_SCOPE,
    idTokenClaims: (base) => base,
    signer: keyPair.privateKey,
    refreshResponse: () => undefined,
    revokeResponse: () => 200,
    fetch: (async () => {
      throw new Error("fake fetch not wired");
    }) as unknown as typeof fetch,
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const form = typeof init?.body === "string" ? Object.fromEntries(new URLSearchParams(init.body)) : {};
    if (url.startsWith("http")) state.calls.push({ url, form });
    if (url === OPENAI_CODEX_OIDC_URL)
      return json({ issuer: ISSUER, jwks_uri: JWKS_URI, revocation_endpoint: REVOKE_URL, token_endpoint: TOKEN_URL });
    if (url === JWKS_URI) return json({ keys: [{ ...publicJwk, kid: "test-key", alg: "RS256", use: "sig" }] });
    if (url === REVOKE_URL) {
      state.revokeCalls += 1;
      const status = state.revokeResponse(state.revokeCalls);
      return new Response(status === 200 ? "" : '{"error":"server_error"}', { status });
    }
    if (url !== TOKEN_URL) return new Response("not found", { status: 404 });
    state.tokenCalls += 1;
    if (form.grant_type === "refresh_token") {
      const override = state.refreshResponse(form, state.tokenCalls);
      if (override) return json(override.body ?? {}, override.status);
      return json({
        access_token: `rotated-access-${state.tokenCalls}`,
        refresh_token: `rotated-refresh-${state.tokenCalls}`,
        id_token: await signIdToken(state.idTokenClaims({ iss: ISSUER, aud: form.client_id, exp: Math.floor(Date.now() / 1000) + 3600 })),
        expires_in: 3600,
        scope: state.scope,
      });
    }
    return json({
      access_token: "access-sentinel-ALPHA",
      refresh_token: "refresh-sentinel-BRAVO",
      id_token: await signIdToken(
        state.idTokenClaims({
          iss: ISSUER,
          aud: form.client_id,
          exp: Math.floor(Date.now() / 1000) + 3600,
          nonce: state.nonce,
          sub: "user-123",
        }),
        state.signer,
      ),
      expires_in: 3600,
      earliest_refresh_at: 1_800_000_000,
      scope: state.scope,
    });
  };
  return Object.assign(state, { fetch: fetchImpl as typeof fetch });
}

interface Vault {
  readonly slot: {
    resolve(ref: string): Promise<Secret | undefined>;
    store(ref: string, secret: Secret): Promise<void>;
    delete(ref: string): Promise<void>;
  };
  readonly writes: Secret[];
  record(): OpenAICodexCredentialRecord | undefined;
}

function vault(initial?: OpenAICodexCredentialRecord): Vault {
  let secret = initial === undefined ? undefined : credentialRecordToSecret(initial);
  const writes: Secret[] = [];
  return {
    writes,
    slot: {
      resolve: async () => secret,
      store: async (_ref, value) => {
        writes.push(value);
        secret = value;
      },
      delete: async () => {
        secret = undefined;
      },
    },
    record: () => credentialRecordFromSecret(secret),
  };
}

interface UiCall {
  readonly kind: string;
  readonly payload: unknown;
}

interface FakeHost {
  readonly host: HostPort;
  readonly calls: UiCall[];
}

/** A host whose `input` answers `paste(authorizeUrl)` and whose `open-url` just records the URL. */
function fakeHost(paste?: (authorize: URL) => string | undefined): FakeHost {
  const calls: UiCall[] = [];
  const host = {
    ui: {
      async request(request: { kind: string }) {
        calls.push({ kind: request.kind, payload: JSON.parse(JSON.stringify(request)) });
        if (request.kind === "open-url") return { status: "answered" as const, value: undefined };
        if (request.kind === "input") {
          const authorize = calls.find((call) => call.kind === "open-url")?.payload as { url: string } | undefined;
          const answer = paste?.(new URL(authorize!.url));
          return answer === undefined ? { status: "unavailable" as const } : { status: "answered" as const, value: answer };
        }
        return { status: "unavailable" as const };
      },
    },
  } as unknown as HostPort;
  return { host, calls };
}

function callbackUrl(authorize: URL, overrides: Record<string, string> = {}): string {
  const redirect = new URL(authorize.searchParams.get("redirect_uri")!);
  redirect.searchParams.set("code", "code-sentinel-CHARLIE");
  redirect.searchParams.set("state", authorize.searchParams.get("state")!);
  redirect.searchParams.set("client_id", "oaiapp_test123");
  for (const [key, value] of Object.entries(overrides)) redirect.searchParams.set(key, value);
  return redirect.toString();
}

function context(host: HostPort, value: Vault): AuthContext {
  return {
    host,
    credentials: {
      store: (ref: string, secret: Secret) => value.slot.store(ref, secret),
      delete: (ref: string) => value.slot.delete(ref),
    },
  } as AuthContext;
}

const NOW = 1_700_000_000_000;

function record(overrides: Partial<OpenAICodexCredentialRecord> = {}): OpenAICodexCredentialRecord {
  return {
    v: 1,
    clientId: "oaiapp_stored",
    hostId: "urn:uuid:11111111-2222-3333-4444-555555555555",
    access: "stored-access",
    refresh: "stored-refresh",
    expires: NOW + 1000,
    scope: OPENAI_CODEX_SCOPE,
    ...overrides,
  };
}

/** Runs a login through the paste path and returns the authorize URL the host was asked to open. */
async function loginWithPaste(
  auth: FakeAuth,
  value: Vault,
  appName = "Prism Test",
  extra: Record<string, unknown> = {},
  issuedClientId = "oaiapp_test123",
) {
  const paste = (authorize: URL) => {
    auth.nonce = authorize.searchParams.get("nonce")!;
    return callbackUrl(authorize, { client_id: issuedClientId });
  };
  const fake = fakeHost(paste);
  await openAICodexAuth({
    credential: "keyring:openai-codex",
    appName,
    fetch: auth.fetch,
    now: () => NOW,
    slot: value.slot,
    callbackPort: 0,
    ...extra,
  }).login(context(fake.host, value));
  const authorize = new URL((fake.calls.find((call) => call.kind === "open-url")!.payload as { url: string }).url);
  return { authorize, calls: fake.calls };
}

describe("openai-codex sign in with ChatGPT (plan 204 Task 4)", () => {
  it("oauth_first_registration_uses_dynamic_client_and_saves_issued", async () => {
    const auth = fakeAuth();
    const value = vault();
    const { authorize } = await loginWithPaste(auth, value);
    assert.equal(authorize.searchParams.get("client_id"), DYNAMIC_AGENT_CLIENT_ID);
    assert.equal(authorize.searchParams.get("agent_name_hint"), "Prism Test");
    const exchange = auth.calls.find((call) => call.url === TOKEN_URL)!;
    assert.equal(exchange.form.client_id, "oaiapp_test123", "the exchange uses the issued client ID");
    assert.equal(exchange.form.resource, OPENAI_CODEX_RESOURCE);
    const stored = value.record()!;
    assert.equal(stored.clientId, "oaiapp_test123");
    assert.match(stored.hostId, /^urn:uuid:[0-9a-f-]{36}$/);
    assert.equal(stored.access, "access-sentinel-ALPHA");
    assert.equal(stored.refresh, "refresh-sentinel-BRAVO");
    assert.equal(stored.expires, NOW + 3_600_000);
    assert.equal(stored.earliestRefreshAt, 1_800_000_000_000);
    assert.equal(stored.scope, OPENAI_CODEX_SCOPE);
    assert.equal(stored.sub, "user-123");
    assert.ok(stored.idToken);

    // The sentinel may never be used for the exchange: only the issued client ID is.
    const sentinel = fakeAuth();
    const rejected = vault();
    const fake = fakeHost((url) => {
      sentinel.nonce = url.searchParams.get("nonce")!;
      return callbackUrl(url, { client_id: DYNAMIC_AGENT_CLIENT_ID });
    });
    await assert.rejects(
      openAICodexAuth({
        credential: "keyring:openai-codex",
        appName: "Prism Test",
        callbackPort: 0,
        fetch: sentinel.fetch,
        now: () => NOW,
        slot: rejected.slot,
      }).login(context(fake.host, rejected)),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "openai_codex_registration");
        assert.match(error.message, /did not issue a client ID/);
        return true;
      },
    );
    assert.equal(sentinel.tokenCalls, 0, "no exchange ran with the registration sentinel");
    assert.equal(rejected.writes.length, 0);
  });

  it("oauth_has_no_device_code_fallback", () => {
    for (const file of ["../oauth.ts", "../jwt.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      assert.equal(/deviceauth|device_code|device-authorization/i.test(source), false, `${file} has no device flow`);
    }
  });

  it("oauth_loads_node_http_only_inside_login", () => {
    const source = readFileSync(new URL("../oauth.ts", import.meta.url), "utf8");
    assert.equal(/^import .*node:http/m.test(source), false, "no static node:http import");
    assert.equal(source.includes('await import("node:http")'), true, "the listener module is loaded lazily");
  });

  it("oauth_paste_only_mode_binds_no_listener", async () => {
    const auth = fakeAuth();
    const value = vault();
    const { authorize } = await loginWithPaste(auth, value, "Prism Test", { callback: "paste", callbackPort: 9 });
    assert.equal(
      authorize.searchParams.get("redirect_uri"),
      "http://127.0.0.1:9/auth/callback",
      "paste mode uses the configured port without trying to bind it",
    );
    assert.ok(value.record(), "the paste login completed");
    // No UI at all, and a UI that cannot open the URL, both fail closed before the exchange.
    const refused = { host: {} as never, credentials: {} as never };
    await assert.rejects(
      openAICodexAuth({ credential: "keyring:openai-codex", appName: "Prism", fetch: auth.fetch, slot: value.slot }).login(refused),
      /needs a host UI/,
    );
    const closed = vault();
    const cannotOpen = { ui: { request: async () => ({ status: "unavailable" as const }) } } as unknown as HostPort;
    await assert.rejects(
      openAICodexAuth({
        credential: "keyring:openai-codex",
        appName: "Prism",
        callbackPort: 0,
        fetch: auth.fetch,
        slot: closed.slot,
      }).login(context(cannotOpen, closed)),
      /could not open the sign-in URL/,
    );
  });

  it("oauth_registration_callback_without_a_client_id_is_refused", async () => {
    const auth = fakeAuth();
    const value = vault();
    const fake = fakeHost((url) => {
      auth.nonce = url.searchParams.get("nonce")!;
      const callback = new URL(callbackUrl(url));
      callback.searchParams.delete("client_id");
      return callback.toString();
    });
    await assert.rejects(
      openAICodexAuth({
        credential: "keyring:openai-codex",
        appName: "Prism Test",
        fetch: auth.fetch,
        now: () => NOW,
        slot: value.slot,
        callbackPort: 0,
      }).login(context(fake.host, value)),
      /did not carry an issued client ID/,
    );
    assert.equal(value.writes.length, 0);
  });

  it("oauth_reauthorization_reuses_client_and_host_id", async () => {
    const auth = fakeAuth();
    const value = vault(record({ clientId: "oaiapp_stored", hostId: "urn:uuid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }));
    // A re-sign-in comes back as the client the host presented, which is what the consent screen echoes.
    const { authorize } = await loginWithPaste(auth, value, "Prism Test", {}, "oaiapp_stored");
    assert.equal(authorize.searchParams.get("client_id"), "oaiapp_stored");
    assert.equal(authorize.searchParams.get("agent_name_hint"), null, "a registration hint is sent only on the first sign-in");
    assert.equal(authorize.searchParams.get("ext_agent_host_id"), "urn:uuid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    assert.equal(value.record()!.hostId, "urn:uuid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("oauth_authorize_url_params_exact", async () => {
    const auth = fakeAuth();
    const { authorize } = await loginWithPaste(auth, vault());
    assert.equal(authorize.origin + authorize.pathname, OPENAI_CODEX_AUTHORIZE_URL);
    assert.deepEqual(Object.keys(Object.fromEntries(authorize.searchParams)).sort(), [
      "agent_name_hint",
      "client_id",
      "code_challenge",
      "code_challenge_method",
      "ext_agent_host_id",
      "nonce",
      "redirect_uri",
      "resource",
      "response_type",
      "scope",
      "state",
    ]);
    assert.equal(authorize.searchParams.get("response_type"), "code");
    assert.equal(authorize.searchParams.get("scope"), OPENAI_CODEX_SCOPE);
    assert.equal(authorize.searchParams.get("resource"), OPENAI_CODEX_RESOURCE);
    assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
    assert.match(authorize.searchParams.get("code_challenge")!, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(authorize.searchParams.get("state")!.length, 43);
    assert.equal(authorize.searchParams.get("nonce")!.length, 43);
    assert.match(authorize.searchParams.get("redirect_uri")!, /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    // The challenge must be S256 of the verifier the same login sends at exchange.
    const auth2 = fakeAuth();
    const value2 = vault();
    const fake2 = fakeHost((url) => {
      auth2.nonce = url.searchParams.get("nonce")!;
      return callbackUrl(url);
    });
    await openAICodexAuth({
      credential: "keyring:openai-codex",
      appName: "Prism Test",
      fetch: auth2.fetch,
      now: () => NOW,
      slot: value2.slot,
    }).login(context(fake2.host, value2));
    const own = new URL((fake2.calls.find((call) => call.kind === "open-url")!.payload as { url: string }).url);
    const form = auth2.calls.find((call) => call.url === TOKEN_URL)!.form;
    assert.equal(form.grant_type, "authorization_code");
    assert.equal(form.redirect_uri, own.searchParams.get("redirect_uri"));
    assert.match(form.code_verifier!, /^[A-Za-z0-9_-]{64}$/, "the verifier is the PKCE verifier the challenge came from");
    assert.equal(
      b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(form.code_verifier!)))),
      own.searchParams.get("code_challenge"),
      "the challenge is S256 of the verifier",
    );
  });

  it("oauth_paste_fallback_validates_state_and_redirect", async () => {
    const cases: { name: string; url: (authorize: URL) => string; pattern: RegExp }[] = [
      { name: "state", url: (authorize) => callbackUrl(authorize, { state: "not-the-state" }), pattern: /state does not match/ },
      { name: "host", url: (authorize) => callbackUrl(authorize).replace("127.0.0.1", "localhost"), pattern: /must start with/ },
      { name: "path", url: (authorize) => callbackUrl(authorize).replace("/auth/callback", "/callback"), pattern: /must start with/ },
    ];
    for (const entry of cases) {
      const auth = fakeAuth();
      const value = vault();
      const fake = fakeHost((authorize) => entry.url(authorize));
      await assert.rejects(
        openAICodexAuth({
          credential: "keyring:openai-codex",
          appName: "Prism Test",
          fetch: auth.fetch,
          now: () => NOW,
          slot: value.slot,
        }).login(context(fake.host, value)),
        entry.pattern,
        entry.name,
      );
      assert.equal(auth.tokenCalls, 0, `${entry.name}: no exchange happened`);
      assert.equal(value.writes.length, 0, `${entry.name}: nothing was stored`);
    }
  });

  it("oauth_id_token_validation_fails_closed", async () => {
    const cases: {
      name: string;
      setup: (auth: FakeAuth) => void;
      pattern: RegExp;
    }[] = [
      { name: "signature", setup: (auth) => void (auth.signer = foreignPair.privateKey), pattern: /signature is invalid/ },
      {
        name: "audience",
        setup: (auth) => void (auth.idTokenClaims = (base) => ({ ...base, aud: "oaiapp_someone_else" })),
        pattern: /audience is not this client/,
      },
      { name: "issuer", setup: (auth) => void (auth.idTokenClaims = (base) => ({ ...base, iss: "https://evil.test" })), pattern: /issuer/ },
      {
        name: "expiry",
        setup: (auth) => void (auth.idTokenClaims = (base) => ({ ...base, exp: Math.floor(NOW / 1000) - 60 })),
        pattern: /expired/,
      },
      { name: "nonce", setup: (auth) => void (auth.idTokenClaims = (base) => ({ ...base, nonce: "other" })), pattern: /nonce/ },
    ];
    for (const entry of cases) {
      const auth = fakeAuth();
      entry.setup(auth);
      const value = vault();
      await assert.rejects(loginWithPaste(auth, value), entry.pattern, entry.name);
      assert.equal(value.writes.length, 0, `${entry.name}: nothing was stored`);
    }
  });

  it("oauth_missing_direct_scope_stores_nothing", async () => {
    const auth = fakeAuth();
    auth.scope = "openid profile email offline_access resource.invoke";
    const value = vault();
    await assert.rejects(loginWithPaste(auth, value), (error: Error & { code?: string }) => {
      assert.equal(error.name, "OpenAICodexPlanUsageNotGrantedError");
      assert.equal(error.code, "openai_codex_plan_usage_not_granted");
      assert.match(error.message, /sign in again/i, "the message offers re-consent");
      assert.equal(error.message.includes(OPENAI_CODEX_DIRECT_TOKEN_SCOPE), true, "and names the missing permission");
      return true;
    });
    assert.equal(value.writes.length, 0);
    assert.equal(value.record(), undefined);
  });

  it("refresh_single_flight_and_persists_rotation", async () => {
    const auth = fakeAuth();
    const value = vault(record({ expires: NOW + 1000 }));
    const apiKey = openAICodexApiKey({ credential: "keyring:openai-codex", fetch: auth.fetch, now: () => NOW, slot: value.slot });
    const first = await apiKey();
    const second = await apiKey();
    assert.equal(auth.tokenCalls, 1, "two calls made one refresh");
    assert.equal(first, "rotated-access-1");
    assert.equal(second, "rotated-access-1", "the second call reused the rotated token");
    assert.equal(value.record()!.access, "rotated-access-1");
    assert.equal(value.record()!.refresh, "rotated-refresh-1");
    assert.equal(value.writes.length, 1, "the rotation was persisted once");
    const form = auth.calls.find((call) => call.form.grant_type === "refresh_token")!.form;
    assert.deepEqual(Object.keys(form).sort(), ["client_id", "grant_type", "refresh_token", "resource"]);
    assert.equal(form.client_id, "oaiapp_stored");
    assert.equal(form.refresh_token, "stored-refresh");
  });

  it("refresh_reused_rereads_store_once", async () => {
    const auth = fakeAuth();
    auth.refreshResponse = () => ({ status: 400, body: { error: "refresh_token_reused" } });
    const value = vault(record({ expires: NOW + 1000 }));
    let resolves = 0;
    const slot = {
      ...value.slot,
      resolve: async (ref: string) => {
        resolves += 1;
        // The second read is the one that sees the other process's rotation.
        if (resolves >= 3) return credentialRecordToSecret(record({ access: "other-process-access", refresh: "other-process-refresh" }));
        return value.slot.resolve(ref);
      },
    };
    const apiKey = openAICodexApiKey({ credential: "keyring:openai-codex", fetch: auth.fetch, now: () => NOW, slot });
    assert.equal(await apiKey(), "other-process-access");
    assert.equal(auth.tokenCalls, 1, "one refresh attempt");
    assert.equal(value.writes.length, 0, "the other process's record was left alone");
  });

  it("refresh_terminal_codes_require_reauthorize", async () => {
    for (const code of OPENAI_CODEX_TERMINAL_REFRESH_CODES) {
      const auth = fakeAuth();
      auth.refreshResponse = () => ({ status: 400, body: { error: code } });
      const value = vault(record({ expires: NOW + 1000 }));
      const apiKey = openAICodexApiKey({ credential: "keyring:openai-codex", fetch: auth.fetch, now: () => NOW, slot: value.slot });
      await assert.rejects(apiKey(), (error: Error & { code?: string }) => {
        assert.equal(error.name, "OpenAICodexReauthorizeError", code);
        assert.equal(error.code, "openai_codex_reauthorize", code);
        return true;
      });
    }
  });

  it("refresh_ignores_earliest_refresh_at", async () => {
    const auth = fakeAuth();
    const value = vault(record({ expires: NOW + 1000, earliestRefreshAt: NOW + 86_400_000 }));
    const apiKey = openAICodexApiKey({ credential: "keyring:openai-codex", fetch: auth.fetch, now: () => NOW, slot: value.slot });
    assert.equal(await apiKey(), "rotated-access-1");
    assert.equal(auth.tokenCalls, 1, "a future earliest_refresh_at does not gate the refresh");
  });

  it("refresh_survives_pre_rotation_token_reuse", async () => {
    const auth = fakeAuth();
    const value = vault(record({ expires: NOW + 1000 }));
    const apiKey = openAICodexApiKey({ credential: "keyring:openai-codex", fetch: auth.fetch, now: () => NOW, slot: value.slot });
    // The server accepts the pre-rotation token inside its grace window; a crash after a rotation must
    // therefore not wedge the provider.
    assert.equal(await apiKey(), "rotated-access-1");
    assert.equal(value.record()!.refresh, "rotated-refresh-1");
    assert.equal(await apiKey(), "rotated-access-1", "the stored rotation is used on the next call");
    assert.equal(auth.tokenCalls, 1);
  });

  it("refresh_without_a_fresh_token_still_returns_the_access_token", async () => {
    const auth = fakeAuth();
    const value = vault(record({ expires: NOW + 3_600_000 }));
    const apiKey = openAICodexApiKey({ credential: "keyring:openai-codex", fetch: auth.fetch, now: () => NOW, slot: value.slot });
    assert.equal(await apiKey(), "stored-access");
    assert.equal(auth.tokenCalls, 0, "a fresh token makes no request");
  });

  it("refresh_without_a_record_requires_reauthorize", async () => {
    const auth = fakeAuth();
    const value = vault();
    const apiKey = openAICodexApiKey({ credential: "keyring:openai-codex", fetch: auth.fetch, now: () => NOW, slot: value.slot });
    await assert.rejects(apiKey(), /sign in with ChatGPT/);
  });

  it("logout_revokes_the_grant_and_keeps_the_registration", async () => {
    const auth = fakeAuth();
    const value = vault(record());
    const fake = fakeHost();
    await openAICodexLogout({ credential: "keyring:openai-codex", fetch: auth.fetch, now: () => NOW, slot: value.slot })(
      context(fake.host, value),
    );
    const revoke = auth.calls.find((call) => call.url === REVOKE_URL)!;
    assert.deepEqual(Object.keys(revoke.form).sort(), ["client_id", "token", "token_type_hint"]);
    assert.equal(revoke.form.token, "stored-refresh");
    assert.equal(revoke.form.token_type_hint, "refresh_token");
    assert.equal(revoke.form.client_id, "oaiapp_stored");
    assert.equal(value.record(), undefined, "no grant survives the 200");
    const kept = credentialRegistrationFromSecret(value.writes.at(-1))!;
    assert.deepEqual(kept, { clientId: "oaiapp_stored", hostId: "urn:uuid:11111111-2222-3333-4444-555555555555" });
    assert.equal(value.writes.at(-1)!.type, "custom", "the kept secret is not a bearer token");
    assert.equal(value.writes.at(-1)!.value, "registration-only", "and its value is a marker, not a credential");
    await assert.rejects(
      openAICodexApiKey({ credential: "keyring:openai-codex", fetch: auth.fetch, now: () => NOW, slot: value.slot })(),
      /sign in with ChatGPT/,
      "a registration without a grant is not a credential",
    );
  });

  it("login_after_logout_reuses_the_issued_client_and_host_id", async () => {
    const auth = fakeAuth();
    const value = vault(record());
    await openAICodexLogout({ credential: "keyring:openai-codex", fetch: auth.fetch, now: () => NOW, slot: value.slot })(
      context(fakeHost().host, value),
    );
    // A re-sign-in's callback carries no issued client (measured 2026-10-25): the presented one stands in.
    const fake = fakeHost((url) => {
      auth.nonce = url.searchParams.get("nonce")!;
      const callback = new URL(callbackUrl(url));
      callback.searchParams.delete("client_id");
      return callback.toString();
    });
    await openAICodexAuth({
      credential: "keyring:openai-codex",
      appName: "Prism Test",
      fetch: auth.fetch,
      now: () => NOW,
      slot: value.slot,
      callbackPort: 0,
    }).login(context(fake.host, value));
    const authorize = new URL((fake.calls.find((call) => call.kind === "open-url")!.payload as { url: string }).url);
    assert.equal(authorize.searchParams.get("client_id"), "oaiapp_stored", "the issued client is reused");
    assert.equal(authorize.searchParams.get("ext_agent_host_id"), "urn:uuid:11111111-2222-3333-4444-555555555555");
    assert.equal(authorize.searchParams.get("agent_name_hint"), null, "a kept registration is not a first sign-in");
    assert.equal(value.record()!.clientId, "oaiapp_stored");

    // A callback that swaps in another client is refused rather than stored.
    const swapped = vault(record());
    await openAICodexLogout({ credential: "keyring:openai-codex", fetch: auth.fetch, now: () => NOW, slot: swapped.slot })(
      context(fakeHost().host, swapped),
    );
    await assert.rejects(
      openAICodexAuth({
        credential: "keyring:openai-codex",
        appName: "Prism Test",
        fetch: auth.fetch,
        now: () => NOW,
        slot: swapped.slot,
        callbackPort: 0,
      }).login(context(fakeHost((url) => callbackUrl(url, { client_id: "oaiapp_someone_else" })).host, swapped)),
      /different client ID/,
    );
    assert.equal(swapped.record(), undefined, "the swapped client is never stored");
  });

  it("logout_5xx_keeps_record", async () => {
    const auth = fakeAuth();
    auth.revokeResponse = () => 503;
    const value = vault(record());
    await openAICodexLogout({ credential: "keyring:openai-codex", fetch: auth.fetch, now: () => NOW, slot: value.slot })(
      context(fakeHost().host, value),
    );
    assert.equal(auth.revokeCalls, 3, "bounded backoff: three attempts");
    assert.ok(value.record(), "a 5xx keeps the record so logout can be retried");
  });

  it("import_credentials_keeps_local_host_id", async () => {
    const value = vault(record({ clientId: "oaiapp_local", hostId: "urn:uuid:aaaa1111-2222-3333-4444-555555555555" }));
    const imported = record({ hostId: "urn:uuid:bbbb1111-2222-3333-4444-555555555555", access: "imported-access" });
    await openAICodexImportCredentials({ credential: "keyring:openai-codex", slot: value.slot })(context(fakeHost().host, value), imported);
    assert.equal(value.record()!.hostId, "urn:uuid:aaaa1111-2222-3333-4444-555555555555", "the local host ID wins");
    assert.equal(value.record()!.access, "imported-access");
    const fresh = vault();
    await openAICodexImportCredentials({ credential: "keyring:openai-codex", slot: fresh.slot })(context(fakeHost().host, fresh), imported);
    assert.match(fresh.record()!.hostId, /^urn:uuid:/, "a host without a record mints its own ID");
    assert.notEqual(fresh.record()!.hostId, imported.hostId, "and does not adopt the imported host's");
    await assert.rejects(
      openAICodexImportCredentials({ credential: "keyring:openai-codex", slot: fresh.slot })(context(fakeHost().host, fresh), { v: 2 }),
      /not a v1 record/,
    );
  });

  it("oauth_secrets_never_leak", async () => {
    const auth = fakeAuth();
    const value = vault();
    const seen: string[] = [];
    const fake = fakeHost((authorize) => {
      auth.nonce = authorize.searchParams.get("nonce")!;
      return callbackUrl(authorize);
    });
    const spyHost = {
      ui: {
        async request(request: { kind: string }) {
          const answer = await fake.host.ui!.request(request as never);
          seen.push(JSON.stringify(request));
          return answer;
        },
      },
    } as unknown as HostPort;
    await openAICodexAuth({
      credential: "keyring:openai-codex",
      appName: "Prism Test",
      fetch: auth.fetch,
      now: () => NOW,
      slot: value.slot,
    }).login(context(spyHost, value));
    const verifier = auth.calls.find((call) => call.form.grant_type === "authorization_code")!.form.code_verifier!;
    const stored = value.record()!;
    for (const secret of ["access-sentinel-ALPHA", "refresh-sentinel-BRAVO", "code-sentinel-CHARLIE", verifier, stored.idToken!]) {
      for (const payload of seen) assert.equal(payload.includes(secret), false, "a token, code, or verifier reached host.ui");
    }
    // The failure paths are quieter still: each message is checked against the same sentinels.
    const failing = fakeAuth();
    failing.scope = "openid";
    try {
      await loginWithPaste(failing, vault());
      assert.fail("expected the missing scope to throw");
    } catch (error) {
      const message = (error as Error).message;
      for (const secret of ["access-sentinel-ALPHA", "refresh-sentinel-BRAVO", "code-sentinel-CHARLIE"])
        assert.equal(message.includes(secret), false);
    }
  });

  it("listener_binds_loopback_only_and_closes", async () => {
    const auth = fakeAuth();
    const value = vault();
    let redirect: URL | undefined;
    const host = {
      ui: {
        async request(request: { kind: string; url?: string }) {
          if (request.kind === "open-url") {
            const authorize = new URL(request.url!);
            auth.nonce = authorize.searchParams.get("nonce")!;
            redirect = new URL(authorize.searchParams.get("redirect_uri")!);
            assert.equal(redirect.hostname, "127.0.0.1", "the listener is loopback only");
            assert.notEqual(redirect.hostname, "localhost");
            const wrong = await fetch(`${redirect.origin}/not-the-callback`);
            assert.equal(wrong.status, 404, "only the callback path is served");
            const response = await fetch(callbackUrl(authorize));
            assert.equal(response.status, 200);
            return { status: "answered" as const, value: undefined };
          }
          return { status: "unavailable" as const };
        },
      },
    } as unknown as HostPort;
    await openAICodexAuth({
      credential: "keyring:openai-codex",
      appName: "Prism Test",
      callbackPort: 0,
      fetch: auth.fetch,
      now: () => NOW,
      slot: value.slot,
    }).login(context(host, value));
    assert.ok(value.record(), "the listener login completed");
    await assert.rejects(fetch(`${redirect!.origin}/auth/callback?code=x&state=y&client_id=z`), "the listener closed after the callback");
  });

  it("listener_falls_back_to_an_ephemeral_port", async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, "127.0.0.1", resolve));
    const port = (taken.address() as { port: number }).port;
    try {
      const auth = fakeAuth();
      const value = vault();
      let redirect: URL | undefined;
      const host = {
        ui: {
          async request(request: { kind: string; url?: string }) {
            if (request.kind !== "open-url") return { status: "unavailable" as const };
            const authorize = new URL(request.url!);
            auth.nonce = authorize.searchParams.get("nonce")!;
            redirect = new URL(authorize.searchParams.get("redirect_uri")!);
            const response = await fetch(callbackUrl(authorize));
            assert.equal(response.status, 200);
            return { status: "answered" as const, value: undefined };
          },
        },
      } as unknown as HostPort;
      await openAICodexAuth({
        credential: "keyring:openai-codex",
        appName: "Prism Test",
        callbackPort: port,
        fetch: auth.fetch,
        now: () => NOW,
        slot: value.slot,
      }).login(context(host, value));
      assert.notEqual(Number(redirect!.port), port, "a busy port falls back to an ephemeral one");
      assert.ok(value.record());
    } finally {
      taken.close();
    }
  });
});
