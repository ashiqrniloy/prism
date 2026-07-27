import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type AgentIdentity, type OAuthCredentials, revokeOAuthCredential } from "@arnilo/prism";
import {
  computeOAuth2S256Challenge,
  createGoogleWorkspaceOAuthProvider,
  createMicrosoft365OAuthProvider,
  createOAuthWorkTokenProvider,
  type ExtendedOAuthCredentialStore,
  resolveGoogleWorkspaceScopes,
  resolveMicrosoft365Scopes,
} from "../index.js";

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function identity(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    tenantId: "tenant-1",
    accountId: "acct-1",
    userId: "user-1",
    principal: { kind: "user", id: "user-1" },
    scopes: ["Mail.Read"],
    issuedAt: new Date().toISOString(),
    verified: true,
    ...overrides,
  };
}

function memoryStore(
  initial: Record<string, OAuthCredentials> = {},
): ExtendedOAuthCredentialStore & { dump(): Record<string, OAuthCredentials> } {
  const map = new Map<string, OAuthCredentials>(Object.entries(initial));
  const key = (provider: string, accountId?: string) => `${provider}\u0000${accountId ?? ""}`;
  return {
    async set(provider, credentials) {
      map.set(key(provider, credentials.accountId), credentials);
    },
    async get(provider, accountId) {
      return map.get(key(provider, accountId));
    },
    async delete(provider, accountId) {
      return map.delete(key(provider, accountId));
    },
    dump() {
      return Object.fromEntries(map);
    },
  };
}

describe("workload scope maps (least-privilege)", () => {
  it("M365 read bundles omit mutation scopes; mutation adds them", () => {
    const read = resolveMicrosoft365Scopes(["mail"], "read");
    assert.ok(read.includes("Mail.Read"));
    assert.ok(!read.includes("Mail.Send"));
    assert.ok(!read.includes("Mail.ReadWrite"));
    const mutation = resolveMicrosoft365Scopes(["mail"], "mutation");
    assert.ok(mutation.includes("Mail.Read"));
    assert.ok(mutation.includes("Mail.Send"));
    assert.ok(mutation.includes("offline_access"));
  });

  it("GWS read bundles are readonly; mutation adds write scopes", () => {
    const read = resolveGoogleWorkspaceScopes(["mail", "files"], "read");
    assert.ok(read.includes("https://www.googleapis.com/auth/gmail.readonly"));
    assert.ok(read.includes("https://www.googleapis.com/auth/drive.readonly"));
    assert.ok(!read.some((s) => s.includes("gmail.send")));
    const mutation = resolveGoogleWorkspaceScopes(["mail"], "mutation");
    assert.ok(mutation.some((s) => s.includes("gmail.send")));
    assert.ok(mutation.includes("openid") && mutation.includes("email"));
  });

  it("unknown capability fails closed rather than broadening consent", () => {
    assert.throws(() => resolveMicrosoft365Scopes(["bogus" as never], "read"), /Unknown workload capability/);
  });
});

describe("M365 / GWS OAuth providers", () => {
  it("establishes via PKCE S256 and requests least-privilege scopes", async () => {
    let authUrl = "";
    let tokenBody: Record<string, string> | undefined;
    const provider = createMicrosoft365OAuthProvider({
      capabilities: ["mail"],
      access: "read",
      fetch: (async (_url, init) => {
        if (init?.body) tokenBody = JSON.parse(String(init.body)) as Record<string, string>;
        return Response.json({ access_token: "m365-access", refresh_token: "m365-refresh", expires_in: 3600 });
      }) as typeof fetch,
    });
    const credentials = await provider.login({
      onAuth: (url) => {
        authUrl = url;
      },
      onPrompt: () => "fake-code",
    });
    const params = new URL(authUrl).searchParams;
    assert.equal(params.get("code_challenge_method"), "S256");
    assert.match(params.get("code_challenge")!, BASE64URL);
    assert.equal(params.get("scope"), "openid profile offline_access User.Read Mail.Read");
    assert.equal(computeOAuth2S256Challenge(tokenBody!.code_verifier), params.get("code_challenge"));
    assert.equal(credentials.access, "m365-access");
    assert.equal(tokenBody!.grant_type, "authorization_code");
  });

  it("supports the device-code flow", async () => {
    const fetchImpl = (async (url: string | URL | Request) =>
      String(url).includes("devicecode")
        ? Response.json({
            device_code: "dev",
            user_code: "CODE",
            verification_uri: "https://example.test/device",
            interval: 0,
            expires_in: 600,
          })
        : Response.json({ access_token: "device-access" })) as typeof fetch;
    const provider = createMicrosoft365OAuthProvider({ fetch: fetchImpl, sleep: async () => {} });
    const credentials = await provider.login({ onDeviceCode: () => {} });
    assert.equal(credentials.access, "device-access");
  });

  it("refresh exchanges the refresh token", async () => {
    let body: Record<string, string> | undefined;
    const provider = createGoogleWorkspaceOAuthProvider({
      fetch: (async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, string>;
        return Response.json({ access_token: "refreshed-access", expires_in: 3600 });
      }) as typeof fetch,
    });
    const refreshed = await provider.refresh!({ access: "old", refresh: "the-refresh" });
    assert.equal(body!.grant_type, "refresh_token");
    assert.equal(body!.refresh_token, "the-refresh");
    assert.equal(refreshed.access, "refreshed-access");
  });

  it("aborts login when the signal is already aborted", async () => {
    const provider = createMicrosoft365OAuthProvider({ fetch: (async () => Response.json({})) as typeof fetch });
    const controller = new AbortController();
    controller.abort(new Error("login aborted"));
    await assert.rejects(() => Promise.resolve(provider.login({ signal: controller.signal, onPrompt: () => "x" })), /aborted/);
  });

  it("redacts authorization codes from token errors", async () => {
    const provider = createMicrosoft365OAuthProvider({
      fetch: (async () => new Response("invalid_grant secret-code-xyz", { status: 400 })) as typeof fetch,
    });
    await assert.rejects(
      () => Promise.resolve(provider.login({ onAuth: () => {}, onPrompt: () => "secret-code-xyz" })),
      (error: Error) => !error.message.includes("secret-code-xyz"),
    );
  });
});

describe("revokeOAuthCredential", () => {
  it("GWS revokes upstream and deletes locally", async () => {
    let revokedToken: string | undefined;
    const provider = createGoogleWorkspaceOAuthProvider({
      fetch: (async (_url, init) => {
        revokedToken = new URLSearchParams(String(init?.body)).get("token") ?? undefined;
        return new Response(null, { status: 200 });
      }) as typeof fetch,
    });
    const store = memoryStore({ "google-workspace\u0000acct-1": { access: "a", refresh: "the-refresh", accountId: "acct-1" } });
    await revokeOAuthCredential({ provider, credentials: { access: "a", refresh: "the-refresh", accountId: "acct-1" }, store });
    assert.equal(revokedToken, "the-refresh");
    assert.equal(await store.get("google-workspace", "acct-1"), undefined);
  });

  it("M365 has no upstream endpoint but the local delete still fails closed", async () => {
    const provider = createMicrosoft365OAuthProvider({
      fetch: (async () => {
        throw new Error("must not call upstream");
      }) as typeof fetch,
    });
    const store = memoryStore({ "microsoft365\u0000acct-1": { access: "a", refresh: "r", accountId: "acct-1" } });
    await revokeOAuthCredential({ provider, credentials: { access: "a", refresh: "r", accountId: "acct-1" }, store });
    assert.equal(await store.get("microsoft365", "acct-1"), undefined);
  });
});

describe("createOAuthWorkTokenProvider", () => {
  const envVar = "M365_ACCESSTOKEN";

  it("injects a valid access token into env", async () => {
    const store = memoryStore({
      "microsoft365\u0000acct-1": { access: "good-token", accountId: "acct-1", expires: Date.now() + 3600_000 },
    });
    const provider = createMicrosoft365OAuthProvider({ fetch: (async () => Response.json({})) as typeof fetch });
    const tokenProvider = createOAuthWorkTokenProvider({ provider, store, envVar });
    assert.deepEqual(await tokenProvider.tokenEnv(identity()), { [envVar]: "good-token" });
  });

  it("fails closed when the credential is missing (revoked)", async () => {
    const store = memoryStore();
    const provider = createMicrosoft365OAuthProvider({ fetch: (async () => Response.json({})) as typeof fetch });
    const tokenProvider = createOAuthWorkTokenProvider({ provider, store, envVar });
    assert.equal(await tokenProvider.tokenEnv(identity()), undefined);
  });

  it("late-binds a refresh when expired and persists it", async () => {
    let refreshCalls = 0;
    const store = memoryStore({
      "microsoft365\u0000acct-1": { access: "expired", refresh: "r", accountId: "acct-1", expires: Date.now() - 1000 },
    });
    const provider = createMicrosoft365OAuthProvider({
      fetch: (async () => {
        refreshCalls += 1;
        return Response.json({ access_token: "fresh", refresh_token: "r2", expires_in: 3600 });
      }) as typeof fetch,
    });
    const tokenProvider = createOAuthWorkTokenProvider({ provider, store, envVar });
    assert.deepEqual(await tokenProvider.tokenEnv(identity()), { [envVar]: "fresh" });
    assert.equal(refreshCalls, 1);
    assert.equal((await store.get("microsoft365", "acct-1"))!.access, "fresh");
  });

  it("fails closed when expired without a refresh token", async () => {
    const store = memoryStore({ "microsoft365\u0000acct-1": { access: "expired", accountId: "acct-1", expires: Date.now() - 1000 } });
    const provider = createMicrosoft365OAuthProvider({ fetch: (async () => Response.json({})) as typeof fetch });
    const tokenProvider = createOAuthWorkTokenProvider({ provider, store, envVar });
    assert.equal(await tokenProvider.tokenEnv(identity()), undefined);
  });

  it("isolates per identity (no cross-account fallback)", async () => {
    const store = memoryStore({
      "microsoft365\u0000acct-OTHER": { access: "other-token", accountId: "acct-OTHER", expires: Date.now() + 3600_000 },
    });
    const provider = createMicrosoft365OAuthProvider({ fetch: (async () => Response.json({})) as typeof fetch });
    const tokenProvider = createOAuthWorkTokenProvider({ provider, store, envVar });
    assert.equal(await tokenProvider.tokenEnv(identity({ accountId: "acct-1" })), undefined);
  });

  it("rejects a wrong-tenant token", async () => {
    const store = memoryStore({
      "microsoft365\u0000acct-1": {
        access: "t",
        accountId: "acct-1",
        expires: Date.now() + 3600_000,
        metadata: { tenantId: "tenant-OTHER" },
      },
    });
    const provider = createMicrosoft365OAuthProvider({ fetch: (async () => Response.json({})) as typeof fetch });
    const tokenProvider = createOAuthWorkTokenProvider({ provider, store, envVar });
    assert.equal(await tokenProvider.tokenEnv(identity({ tenantId: "tenant-1" })), undefined);
  });

  it("single-flights concurrent refreshes (no refresh storm)", async () => {
    let refreshCalls = 0;
    const store = memoryStore({
      "microsoft365\u0000acct-1": { access: "expired", refresh: "r", accountId: "acct-1", expires: Date.now() - 1000 },
    });
    const provider = createMicrosoft365OAuthProvider({
      fetch: (async () => {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return Response.json({ access_token: "fresh", refresh_token: "r2", expires_in: 3600 });
      }) as typeof fetch,
    });
    const tokenProvider = createOAuthWorkTokenProvider({ provider, store, envVar });
    const results = await Promise.all([
      tokenProvider.tokenEnv(identity()),
      tokenProvider.tokenEnv(identity()),
      tokenProvider.tokenEnv(identity()),
    ]);
    for (const result of results) assert.deepEqual(result, { [envVar]: "fresh" });
    assert.equal(refreshCalls, 1);
  });
});
