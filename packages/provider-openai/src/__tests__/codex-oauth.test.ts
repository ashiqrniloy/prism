import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderRequest } from "prism";
import { createOpenAICodexProvider, createOpenAICodexOAuthProvider, createOpenAIResponsesProvider } from "../index.js";
import { computeS256Challenge, createPkceVerifier } from "../oauth.js";

const BASE64URL = /^[A-Za-z0-9_-]+$/;

describe("@prism/provider-openai codex oauth", () => {
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
        ? Response.json({ device_code: "device", user_code: "FAKE-CODE", verification_uri: "https://example.test/device" })
        : Response.json({ access_token: "device-access" });
    }) as typeof fetch;
    const provider = createOpenAICodexOAuthProvider({ fetch: fetchImpl, scope: "openid offline_access" });
    const credentials = await provider.login({ onDeviceCode: () => {} });
    assert.equal(deviceBody!.scope, "openid offline_access");
    assert.equal(deviceBody!.client_id, "prism-codex");
    assert.equal(credentials.access, "device-access");
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
    const provider = createOpenAICodexOAuthProvider({ fetch: (async () => new Response("bad fake-refresh", { status: 400 })) as typeof fetch });
    await assert.rejects(async () => provider.refresh!({ access: "fake-access", refresh: "fake-refresh" }), (error: Error) => {
      assert(!error.message.includes("fake-refresh"));
      assert(error.message.includes("[REDACTED]"));
      return true;
    });
  });
});

function ok(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { status: 200 });
}

function sse(events: readonly object[]): ReadableStream<Uint8Array> {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });
}
