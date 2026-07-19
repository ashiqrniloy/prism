import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderRequest } from "@arnilo/prism";
import { createOpenAICodexProvider, createOpenAICodexOAuthProvider, createOpenAIResponsesProvider } from "../index.js";
import { computeS256Challenge, createPkceVerifier } from "../oauth.js";

const BASE64URL = /^[A-Za-z0-9_-]+$/;

describe("@arnilo/prism-provider-openai codex oauth", () => {
  it("codex_oauth_browser_uses_s256_pkce_challenge", async () => {
    let authUrl = "";
    let tokenBody: Record<string, string> | undefined;
    const provider = createOpenAICodexOAuthProvider({
      fetch: (async (_url, init) => {
        if (init?.body) tokenBody = JSON.parse(String(init.body)) as Record<string, string>;
        return Response.json({ access_token: "browser-access", refresh_token: "fake-refresh", expires_in: 60, account_id: "acct" });
      }) as typeof fetch,
    });
    const credentials = await provider.login({
      onAuth: (url) => { authUrl = url; },
      onPrompt: () => "fake-code",
    });

    const params = new URL(authUrl).searchParams;
    assert.equal(params.get("code_challenge_method"), "S256");
    const challenge = params.get("code_challenge");
    const verifier = tokenBody!.code_verifier;
    assert.match(challenge!, BASE64URL);
    assert.equal(challenge!.length, 43);
    assert.match(verifier, BASE64URL);
    assert.equal(verifier.length, 43);
    assert.equal(challenge, computeS256Challenge(verifier));
    assert.notEqual(challenge, verifier);
    assert.equal(credentials.access, "browser-access");
    assert.equal(tokenBody!.grant_type, "authorization_code");
    assert.equal(tokenBody!.code, "fake-code");
    assert.equal(tokenBody!.code_verifier, verifier);
  });

  it("codex_oauth_authorize_url_includes_redirect_and_scope", async () => {
    let authUrl = "";
    const provider = createOpenAICodexOAuthProvider({
      fetch: (async () => Response.json({ access_token: "x" })) as typeof fetch,
      redirectUri: "https://app.example.test/cb",
      scope: "openid profile offline_access",
    });
    await provider.login({ onAuth: (url) => { authUrl = url; }, onPrompt: () => "code" });
    const params = new URL(authUrl).searchParams;
    assert.equal(params.get("redirect_uri"), "https://app.example.test/cb");
    assert.equal(params.get("scope"), "openid profile offline_access");
    assert.equal(params.get("code_challenge_method"), "S256");
    assert.match(params.get("code_challenge")!, BASE64URL);
  });

  it("codex_oauth_device_code_includes_scope_when_supplied", async () => {
    let deviceBody: Record<string, string> | undefined;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("device")) deviceBody = JSON.parse(String(init?.body)) as Record<string, string>;
      return String(url).includes("device")
        ? Response.json({ device_code: "device", user_code: "FAKE-CODE", verification_uri: "https://example.test/device", interval: 0, expires_in: 600 })
        : Response.json({ access_token: "device-access" });
    }) as typeof fetch;
    const provider = createOpenAICodexOAuthProvider({ fetch: fetchImpl, scope: "openid offline_access", sleep: async () => {} });
    const credentials = await provider.login({ onDeviceCode: () => {} });
    assert.equal(deviceBody!.scope, "openid offline_access");
    assert.equal(deviceBody!.client_id, "prism-codex");
    assert.equal(credentials.access, "device-access");
  });

  it("codex_oauth_device_code_polls_pending_then_succeeds", async () => {
    let tokenPolls = 0;
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes("device")) {
        return Response.json({
          device_code: "secret-device-code",
          user_code: "FAKE-CODE",
          verification_uri: "https://example.test/device",
          interval: 1,
          expires_in: 60,
        });
      }
      tokenPolls += 1;
      if (tokenPolls < 3) {
        return Response.json({ error: "authorization_pending" }, { status: 400 });
      }
      return Response.json({ access_token: "polled-access", refresh_token: "polled-refresh", expires_in: 120, account_id: "acct" });
    }) as typeof fetch;
    const sleeps: number[] = [];
    const provider = createOpenAICodexOAuthProvider({
      fetch: fetchImpl,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    const credentials = await provider.login({ onDeviceCode: () => {} });
    assert.equal(tokenPolls, 3);
    assert.deepEqual(sleeps, [1_000, 1_000, 1_000]);
    assert.equal(credentials.access, "polled-access");
    assert.equal(credentials.refresh, "polled-refresh");
    assert.equal(credentials.accountId, "acct");
  });

  it("codex_oauth_device_code_honors_slow_down", async () => {
    let tokenPolls = 0;
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes("device")) {
        return Response.json({
          device_code: "device",
          user_code: "FAKE-CODE",
          verification_uri: "https://example.test/device",
          interval: 2,
          expires_in: 60,
        });
      }
      tokenPolls += 1;
      if (tokenPolls === 1) return Response.json({ error: "slow_down" }, { status: 400 });
      return Response.json({ access_token: "after-slow-down" });
    }) as typeof fetch;
    const sleeps: number[] = [];
    const provider = createOpenAICodexOAuthProvider({
      fetch: fetchImpl,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    const credentials = await provider.login({ onDeviceCode: () => {} });
    assert.equal(credentials.access, "after-slow-down");
    assert.deepEqual(sleeps, [2_000, 7_000]);
  });

  it("codex_oauth_device_code_expires_when_pending_persists", async () => {
    let now = 1_000;
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes("device")) {
        return Response.json({
          device_code: "secret-device-code",
          user_code: "FAKE-CODE",
          verification_uri: "https://example.test/device",
          interval: 1,
          expires_in: 3,
        });
      }
      return Response.json({ error: "authorization_pending" }, { status: 400 });
    }) as typeof fetch;
    const provider = createOpenAICodexOAuthProvider({
      fetch: fetchImpl,
      now: () => now,
      sleep: async (ms) => { now += ms; },
    });
    await assert.rejects(async () => provider.login({ onDeviceCode: () => {} }), (error: Error) => {
      assert.match(error.message, /expired before authorization completed/);
      return true;
    });
  });

  it("codex_oauth_device_code_aborts_during_poll", async () => {
    const controller = new AbortController();
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes("device")) {
        return Response.json({
          device_code: "device",
          user_code: "FAKE-CODE",
          verification_uri: "https://example.test/device",
          interval: 1,
          expires_in: 60,
        });
      }
      return Response.json({ error: "authorization_pending" }, { status: 400 });
    }) as typeof fetch;
    const provider = createOpenAICodexOAuthProvider({
      fetch: fetchImpl,
      sleep: async () => { controller.abort(new Error("login cancelled")); },
    });
    await assert.rejects(
      async () => provider.login({ onDeviceCode: () => {}, signal: controller.signal }),
      (error: Error) => {
        assert.match(error.message, /login cancelled|aborted/i);
        return true;
      },
    );
  });

  it("codex_oauth_device_code_terminal_error_redacts_secrets", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes("device")) {
        return Response.json({
          device_code: "secret-device-code",
          user_code: "secret-user-code",
          verification_uri: "https://example.test/device",
          interval: 0,
          expires_in: 60,
        });
      }
      return Response.json({ error: "access_denied", error_description: "denied secret-device-code secret-user-code" }, { status: 400 });
    }) as typeof fetch;
    const provider = createOpenAICodexOAuthProvider({ fetch: fetchImpl, sleep: async () => {} });
    await assert.rejects(async () => provider.login({ onDeviceCode: () => {} }), (error: Error) => {
      assert.match(error.message, /access_denied|invalid_token_response/);
      assert(!error.message.includes("secret-device-code"));
      assert(!error.message.includes("secret-user-code"));
      assert.ok(error.message.includes("[REDACTED]"));
      return true;
    });
  });

  it("codex_oauth_authorization_code_errors_redact_code_and_verifier", async () => {
    let tokenBody: Record<string, string> | undefined;
    const provider = createOpenAICodexOAuthProvider({
      fetch: (async (_url, init) => {
        tokenBody = JSON.parse(String(init?.body)) as Record<string, string>;
        return Response.json({ error: "invalid_grant", error_description: "bad secret-auth-code" }, { status: 400 });
      }) as typeof fetch,
    });
    await assert.rejects(async () => provider.login({
      onAuth: () => {},
      onPrompt: () => "secret-auth-code",
    }), (error: Error) => {
      assert(!error.message.includes("secret-auth-code"));
      assert(!error.message.includes(tokenBody!.code_verifier!));
      assert.ok(error.message.includes("[REDACTED]"));
      return true;
    });
  });

  it("codex_oauth_verifier_is_cryptographically_random", () => {
    const a = createPkceVerifier();
    const b = createPkceVerifier();
    assert.match(a, BASE64URL);
    assert.match(b, BASE64URL);
    assert.ok(a.length >= 43 && a.length <= 128, `verifier length ${a.length}`);
    assert.notEqual(a, b);
    assert.notEqual(computeS256Challenge(a), a);
  });

  it("codex_provider_separates_api_and_codex_base_urls", async () => {
    let codexUrl = "";
    let apiUrl = "";
    const request: ProviderRequest = {
      model: { provider: "openai", model: "gpt-5.1" },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    };
    const codex = createOpenAICodexProvider({
      accessToken: "fake-codex-token",
      fetch: (async (url: string | URL | Request) => { codexUrl = String(url); return ok(sse([])); }) as typeof fetch,
    });
    for await (const _ of codex.generate(request)) { void _; }

    const api = createOpenAIResponsesProvider({
      apiKey: "fake-openai-key",
      fetch: (async (url: string | URL | Request) => { apiUrl = String(url); return ok(sse([])); }) as typeof fetch,
    });
    for await (const _ of api.generate(request)) { void _; }

    assert.ok(codexUrl.startsWith("https://chatgpt.com/backend-api/codex"), codexUrl);
    assert.ok(apiUrl.startsWith("https://api.openai.com/v1"), apiUrl);
    assert.notEqual(new URL(codexUrl).origin, new URL(apiUrl).origin);
  });

  it("codex_oauth_refresh_redacts_tokens_from_errors", async () => {
    const provider = createOpenAICodexOAuthProvider({
      fetch: (async () => new Response("bad fake-access fake-refresh", { status: 400 })) as typeof fetch,
    });
    await assert.rejects(
      async () => provider.refresh!({ access: "fake-access", refresh: "fake-refresh" }),
      (error: Error) => {
        assert(!error.message.includes("fake-access"));
        assert(!error.message.includes("fake-refresh"));
        assert(error.message.includes("[REDACTED]"));
        return true;
      },
    );
  });
});

function ok(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { status: 200 });
}

function sse(events: readonly object[]): ReadableStream<Uint8Array> {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });
}
