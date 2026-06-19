import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createEnvCredentialResolver,
  createExplicitCredentialResolver,
  createProviderRegistry,
  errorToErrorInfo,
  redactSecrets,
  refreshOAuthCredential,
  resolveCredentialValue,
} from "../index.js";
import type { CredentialResolver, OAuthLoginCallbacks, OAuthProvider } from "../index.js";

describe("credential boundary", () => {
  it("resolves credentials from direct value callback or resolver", async () => {
    const resolver: CredentialResolver = {
      resolve(request) {
        return { type: "api_key", value: `${request.provider}:token` };
      },
    };

    assert.equal(await resolveCredentialValue("literal", { name: "api" }), "literal");
    assert.equal(await resolveCredentialValue(() => "callback", { name: "api" }), "callback");
    assert.equal(
      await resolveCredentialValue(resolver, { name: "api", provider: "mock" }),
      "mock:token",
    );
  });

  it("provider registry does not accept or store credentials", () => {
    const registry = createProviderRegistry();

    registry.register({
      id: "mock",
      async *generate() {
        yield { type: "done" };
      },
    });

    assert.deepEqual(Object.keys(registry.resolve("mock")), ["id", "generate"]);
  });

  it("credential resolution is explicit and not global", async () => {
    process.env.PRISM_TEST_API_KEY = "unused-test-secret";
    try {
      assert.equal(await resolveCredentialValue(undefined, { name: "apiKey", provider: "mock" }), undefined);
    } finally {
      delete process.env.PRISM_TEST_API_KEY;
    }
  });

  it("explicit credential resolver uses documented order", async () => {
    const resolver = createExplicitCredentialResolver([
      { name: "runtime", resolver: { resolve: () => ({ type: "api_key", value: "runtime-key" }) } },
      { name: "stored", resolver: { resolve: () => ({ type: "api_key", value: "stored-key" }) } },
      { name: "fallback", resolver: { resolve: () => ({ type: "api_key", value: "fallback-key" }) } },
    ]);

    assert.equal(await resolveCredentialValue(resolver, { name: "apiKey", provider: "mock" }), "runtime-key");
  });

  it("env credential resolver reads only passed env object", async () => {
    process.env.PRISM_TEST_API_KEY = "real-env-is-ignored";
    try {
      const resolver = createEnvCredentialResolver(
        { DEMO_API_KEY: "passed-env-key" },
        { "mock:apiKey": "DEMO_API_KEY" },
      );

      assert.equal(await resolveCredentialValue(resolver, { name: "apiKey", provider: "mock" }), "passed-env-key");
      assert.equal(await resolveCredentialValue(createEnvCredentialResolver({}, { mock: "PRISM_TEST_API_KEY" }), { name: "apiKey", provider: "mock" }), undefined);
    } finally {
      delete process.env.PRISM_TEST_API_KEY;
    }
  });

  it("oauth callbacks typecheck and refresh updates caller store", async () => {
    const callbacks: OAuthLoginCallbacks = {
      onAuth(url) { assert.equal(url.startsWith("https://"), true); },
      onDeviceCode(code) { assert.equal(code.userCode, "ABCD"); },
      onPrompt() { return "browser"; },
      onSelect() { return "device"; },
    };
    const provider: OAuthProvider = {
      id: "mock-oauth",
      async login(cb = callbacks) {
        await cb.onAuth?.("https://example.test/login");
        await cb.onDeviceCode?.({ userCode: "ABCD", verificationUri: "https://example.test/device" });
        return { access: "old-access", refresh: "refresh-token" };
      },
      refresh(credentials) {
        assert.equal(credentials.refresh, "refresh-token");
        return { access: "new-access", refresh: credentials.refresh };
      },
      getCredential(credentials) {
        return credentials.access ? { type: "bearer", value: credentials.access } : undefined;
      },
    };
    const stored: Array<[string, string | undefined]> = [];
    const credentials = await provider.login(callbacks);
    const refreshed = await refreshOAuthCredential({
      provider,
      credentials,
      store: { set: (providerId, next) => { stored.push([providerId, next.access]); } },
    });

    assert.equal(refreshed.access, "new-access");
    assert.deepEqual(stored, [["mock-oauth", "new-access"]]);
    assert.equal((await provider.getCredential?.(refreshed))?.value, "new-access");
  });
});

describe("redaction", () => {
  it("redacts known secret values from strings and objects", () => {
    const secret = "sk-test-123";

    assert.equal(redactSecrets(`token=${secret}`, [secret]), "token=[REDACTED]");
    assert.deepEqual(redactSecrets({ nested: [`Bearer ${secret}`] }, [secret]), {
      nested: ["Bearer [REDACTED]"],
    });
  });

  it("redacts known secret values from error info", () => {
    const info = errorToErrorInfo(new Error("bad key sk-test-123"), ["sk-test-123"]);

    assert.equal(info.message, "bad key [REDACTED]");
  });
});
