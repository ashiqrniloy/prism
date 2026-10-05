import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgent, type HostUiRequest, type Secret } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import openaiDefinition, { OPENAI_CODEX_DEFAULT_ACCESS_TOKEN_REF, OPENAI_DEFAULT_API_KEY_REF, openai } from "../index.js";

const UNSET_REF = "env:PRISM_TEST_UNSET_OPENAI_KEY";

/** Routes the Codex device-code and token endpoints; any other request is a test failure. */
function oauthFetch(): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/device/code")) {
      return new Response(
        JSON.stringify({ device_code: "device-1", user_code: "ABCD-1234", verification_uri: "https://example.test/device", expires_in: 900, interval: 1 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.endsWith("/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "codex-access-token", refresh_token: "codex-refresh-token", expires_in: 900 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected oauth request: ${url}`);
  }) as typeof fetch;
  return { fetch: impl, urls };
}

async function codexOAuthMethod() {
  const oauth = oauthFetch();
  const agent = await createAgent({
    model: { provider: "openai", model: "gpt-5.1" },
    packages: [openai({ oauth: { fetch: oauth.fetch, now: () => 0, sleep: async () => {} } })],
  });
  const provider = agent.models.resolve("openai-codex/gpt-5.1-codex").provider;
  const method = provider.auth?.find((entry) => entry.kind === "oauth");
  assert.ok(method !== undefined && method.kind === "oauth", "openai-codex carries an oauth auth descriptor");
  return { agent, method, urls: oauth.urls };
}

describe("@arnilo/prism-provider-openai package", () => {
  it("openai_passes_package_conformance", async () => {
    const result = await packageConformance(openaiDefinition, { config: { apiKey: "env:PRISM_TEST_OPENAI_CONFORMANCE" } });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("openai_default_refs_are_the_vendor_env_var_and_codex_keyring_entry", () => {
    assert.equal(OPENAI_DEFAULT_API_KEY_REF, "env:OPENAI_API_KEY");
    assert.equal(OPENAI_CODEX_DEFAULT_ACCESS_TOKEN_REF, "keyring:openai-codex");
    const properties = openaiDefinition.config?.properties;
    assert.equal(properties?.apiKey?.default, OPENAI_DEFAULT_API_KEY_REF);
    assert.equal(properties?.apiKey?.["x-prism-secret"], true);
    assert.equal(properties?.codexAccessToken?.default, OPENAI_CODEX_DEFAULT_ACCESS_TOKEN_REF);
    assert.equal(properties?.codexAccessToken?.["x-prism-secret"], true);
  });

  it("openai_missing_key_notes_status_and_does_not_fail_create_agent", async () => {
    const agent = await createAgent({
      model: { provider: "openai", model: "gpt-5.1" },
      packages: [openai({ apiKey: UNSET_REF })],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.message.includes(`no API key at ${UNSET_REF}`));
      assert.equal(notes.length, 1, "a missing key is a status note, not a failed load");
      assert.equal(notes[0]?.level, "warn");
      const result = await (await agent.session()).run("hi");
      assert.equal(result.status, "failed");
      assert.equal((result as { error?: { code?: string } }).error?.code, "credential_unavailable");
    } finally {
      await agent.dispose();
    }
  });

  it("openai_literal_api_key_fails_config_validation", async () => {
    await assert.rejects(
      () => createAgent({ model: { provider: "openai", model: "m" }, packages: [openai({ apiKey: "sk-literal" })] }),
      (error: { code?: string }) => error.code === "secret_literal",
    );
  });

  it("openai_registers_both_providers_and_setup_does_not_fetch", async () => {
    const previous = process.env.PRISM_TEST_OPENAI_KEY;
    process.env.PRISM_TEST_OPENAI_KEY = "prism-test-openai-key";
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "openai", model: "gpt-5.1" },
      packages: [openai({ fetch: fetchImpl, apiKey: "env:PRISM_TEST_OPENAI_KEY" })],
    });
    try {
      assert.equal(fetches, 0, "setup must not fetch");
      assert.equal(agent.models.resolve("openai/gpt-5.1").provider.id, "openai");
      assert.equal(agent.models.resolve("openai-codex/gpt-5.1-codex").provider.id, "openai-codex");
      await (await agent.session()).run("hi").catch(() => undefined);
      assert.ok(fetches > 0, "a run reaches the vendor transport");
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_OPENAI_KEY;
      else process.env.PRISM_TEST_OPENAI_KEY = previous;
    }
  });

  it("openai_codex_oauth_uses_host_ui_and_stores_through_slot", async () => {
    const { agent, method, urls } = await codexOAuthMethod();
    const requests: HostUiRequest[] = [];
    const stored: { ref: string; secret: Secret }[] = [];
    try {
      await method.login({
        host: {
          ui: {
            async request(request) {
              requests.push(request as HostUiRequest);
              return { status: "answered", value: undefined } as never;
            },
          },
        },
        credentials: {
          async store(ref, secret) {
            stored.push({ ref, secret });
          },
          async delete() {},
        },
      });
    } finally {
      await agent.dispose();
    }
    assert.deepEqual(urls, ["https://auth.openai.com/oauth/device/code", "https://auth.openai.com/oauth/token"]);
    assert.deepEqual(
      requests.map((request) => request.kind),
      ["open-url"],
    );
    assert.equal((requests[0] as { url: string }).url, "https://example.test/device");
    assert.equal(stored.length, 1, "the login persists exactly one credential");
    assert.equal(stored[0]?.ref, "keyring:openai-codex");
    assert.equal(stored[0]?.secret.value, "codex-access-token");
    assert.equal(stored[0]?.secret.metadata?.refresh, "codex-refresh-token", "the refresh token survives in metadata");
    assert.equal(JSON.stringify(requests).includes("codex-access-token"), false, "no token reaches a host.ui request");
    assert.equal(JSON.stringify(requests).includes("codex-refresh-token"), false, "no refresh token reaches a host.ui request");
  });

  it("openai_codex_oauth_without_ui_fails_closed", async () => {
    const { agent, method } = await codexOAuthMethod();
    const stored: string[] = [];
    try {
      await assert.rejects(
        () =>
          method.login({
            host: {},
            credentials: {
              async store(ref) {
                stored.push(ref);
              },
              async delete() {},
            },
          }),
        (error: { code?: string }) => error.code === "oauth_unavailable",
      );
    } finally {
      await agent.dispose();
    }
    assert.deepEqual(stored, [], "an unavailable host stores nothing");
  });
});
