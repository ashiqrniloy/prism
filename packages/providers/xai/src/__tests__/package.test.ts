import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgent, type HostUiRequest, type ModelConfig, type ProviderRequest, type Secret } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import { providerConformance } from "@arnilo/prism/provider-kit";
import xaiDefinition, {
  createXaiProvider,
  XAI_DEFAULT_ACCESS_TOKEN_REF,
  XAI_DEFAULT_API_KEY_REF,
  xai,
  xaiModels,
} from "../index.js";

const UNSET_REF = "env:PRISM_TEST_UNSET_XAI_KEY";

const model: ModelConfig = xaiModels[0] as ModelConfig;

const request: ProviderRequest = {
  model,
  messages: [
    { role: "system", content: [{ type: "text", text: "instructions" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ],
};

function sse(events: readonly object[]): ReadableStream<Uint8Array> {
  const text = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function ok(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function completion(): ReadableStream<Uint8Array> {
  return sse([
    {
      choices: [{ delta: { content: "hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ]);
}

/** Routes the SuperGrok device-code and token endpoints; any other request is a test failure. */
function oauthFetch(): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/oauth2/device/code")) {
      return new Response(
        JSON.stringify({ device_code: "device-1", user_code: "ABCD-1234", verification_uri: "https://example.test/device", expires_in: 900, interval: 1 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.endsWith("/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "supergrok-access-token", refresh_token: "supergrok-refresh-token", expires_in: 900 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected oauth request: ${url}`);
  }) as typeof fetch;
  return { fetch: impl, urls };
}

async function oauthMethod() {
  const oauth = oauthFetch();
  const agent = await createAgent({
    model: { provider: "xai", model: model.model },
    packages: [xai({ oauth: { fetch: oauth.fetch, now: () => 0, sleep: async () => {} } })],
  });
  const method = agent.models.resolve(`xai/${model.model}`).provider.auth?.find((entry) => entry.kind === "oauth");
  assert.ok(method !== undefined && method.kind === "oauth", "xai carries an oauth auth descriptor");
  return { agent, method, urls: oauth.urls };
}

describe("@arnilo/prism-provider-xai package", () => {
  it("xai_passes_package_conformance", async () => {
    const result = await packageConformance(xaiDefinition, { config: { apiKey: "env:PRISM_TEST_XAI_CONFORMANCE" } });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("xai_passes_provider_conformance", async () => {
    const key = "sk-xai-canary-key-should-not-surface";
    let captured: Headers | undefined;
    const fetchImpl = (async (_input: unknown, init: RequestInit) => {
      captured = new Headers(init.headers);
      return ok(completion());
    }) as typeof fetch;
    await providerConformance(() => createXaiProvider({ apiKey: key, fetch: fetchImpl }), {
      request,
      secrets: [key],
      headers: {
        owned: { "content-type": "application/json", authorization: `Bearer ${key}` },
        caller: { authorization: "hijack", "content-type": "text/plain", "x-trace": "1" },
        captured: () => captured,
      },
      expect: { text: "hello" },
    });
  });

  it("xai_default_refs_are_the_vendor_env_var_and_keyring_entry", () => {
    assert.equal(XAI_DEFAULT_API_KEY_REF, "env:XAI_API_KEY");
    assert.equal(XAI_DEFAULT_ACCESS_TOKEN_REF, "keyring:xai");
    const properties = xaiDefinition.config?.properties;
    assert.equal(properties?.apiKey?.default, XAI_DEFAULT_API_KEY_REF);
    assert.equal(properties?.apiKey?.["x-prism-secret"], true);
    assert.equal(properties?.accessToken?.default, XAI_DEFAULT_ACCESS_TOKEN_REF);
    assert.equal(properties?.accessToken?.["x-prism-secret"], true);
  });

  it("xai_missing_key_notes_status_and_does_not_fail_create_agent", async () => {
    const agent = await createAgent({
      model: { provider: "xai", model: model.model },
      packages: [xai({ apiKey: UNSET_REF })],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.message === `xai: no API key at ${UNSET_REF}`);
      assert.equal(notes.length, 1, "a missing key is a status note, not a failed load");
      assert.equal(notes[0]?.level, "warn");
      const session = await agent.session();
      const result = await session.run("hi");
      assert.equal(result.status, "failed");
      assert.equal((result as { error?: { code?: string } }).error?.code, "credential_unavailable");
    } finally {
      await agent.dispose();
    }
  });

  it("xai_literal_api_key_fails_config_validation", async () => {
    await assert.rejects(
      () => createAgent({ model: { provider: "xai", model: model.model }, packages: [xai({ apiKey: "sk-literal-value" })] }),
      (error: { code?: string }) => error.code === "secret_literal",
    );
  });

  it("xai_package_registers_its_provider_and_setup_does_not_fetch", async () => {
    const previous = process.env.PRISM_TEST_XAI_KEY;
    process.env.PRISM_TEST_XAI_KEY = "prism-test-xai-key";
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return ok(completion());
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "xai", model: model.model },
      packages: [xai({ fetch: fetchImpl, apiKey: "env:PRISM_TEST_XAI_KEY" })],
    });
    try {
      assert.equal(fetches, 0, "setup must not fetch");
      const session = await agent.session();
      await session.run("hi").catch(() => undefined);
      assert.ok(fetches > 0, "a run reaches the vendor transport");
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_XAI_KEY;
      else process.env.PRISM_TEST_XAI_KEY = previous;
    }
  });

  it("xai_models_lists_through_the_vendor_endpoint_only_when_asked", async () => {
    const previous = process.env.PRISM_TEST_XAI_KEY;
    process.env.PRISM_TEST_XAI_KEY = "prism-test-xai-key";
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ object: "list", data: [{ id: "xai-discovery-probe", object: "model" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "xai", model: model.model },
      packages: [xai({ fetch: fetchImpl, apiKey: "env:PRISM_TEST_XAI_KEY" })],
    });
    try {
      assert.deepEqual(urls, [], "no discovery at setup");
      const listed = await agent.models.list();
      assert.deepEqual(urls, ["https://api.x.ai/v1/models"]);
      assert.ok(listed.some((entry) => entry.model === "xai-discovery-probe"), "the discovered model is listed");
      assert.ok(listed.some((entry) => entry.model === model.model), "the configured model is always listed");
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_XAI_KEY;
      else process.env.PRISM_TEST_XAI_KEY = previous;
    }
  });

  it("xai_provider_resolves_its_model_without_a_host_provider", async () => {
    const previous = process.env.PRISM_TEST_XAI_KEY;
    process.env.PRISM_TEST_XAI_KEY = "prism-test-xai-key";
    let url = "";
    const agent = await createAgent({
      model,
      packages: [
        xai({
          apiKey: "env:PRISM_TEST_XAI_KEY",
          fetch: (async (input) => {
            url = String(input);
            return ok(completion());
          }) as typeof fetch,
        }),
      ],
    });
    try {
      const session = await agent.session();
      await session.run("hi").catch(() => undefined);
      assert.match(url, /\/chat\/completions$/);
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_XAI_KEY;
      else process.env.PRISM_TEST_XAI_KEY = previous;
    }
  });

  it("xai_key_never_surfaces", async () => {
    const secret = "sk-xai-canary-key-should-not-surface";
    const previous = process.env.PRISM_TEST_XAI_CANARY;
    process.env.PRISM_TEST_XAI_CANARY = secret;
    const agent = await createAgent({
      model: { provider: "xai", model: model.model },
      packages: [
        xai({
          apiKey: "env:PRISM_TEST_XAI_CANARY",
          fetch: (async () => ok(completion())) as typeof fetch,
        }),
      ],
    });
    try {
      const session = await agent.session();
      const events: unknown[] = [];
      const reader = (async () => {
        for await (const event of session.subscribe()) events.push(event);
      })();
      await session.run("hi").catch(() => undefined);
      await reader;
      assert.equal((JSON.stringify(agent.inspect()) + JSON.stringify(events)).includes(secret), false);
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_XAI_CANARY;
      else process.env.PRISM_TEST_XAI_CANARY = previous;
    }
  });

  it("xai_oauth_uses_host_ui_and_fails_closed_without_ui", async () => {
    const { agent, method, urls } = await oauthMethod();
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
    assert.deepEqual(urls, ["https://auth.x.ai/oauth2/device/code", "https://auth.x.ai/oauth2/token"]);
    assert.deepEqual(
      requests.map((request) => request.kind),
      ["open-url"],
    );
    assert.equal((requests[0] as { url: string }).url, "https://example.test/device");
    assert.equal(stored.length, 1, "the login persists exactly one credential");
    assert.equal(stored[0]?.ref, XAI_DEFAULT_ACCESS_TOKEN_REF);
    assert.equal(stored[0]?.secret.value, "supergrok-access-token");
    assert.equal(stored[0]?.secret.metadata?.refresh, "supergrok-refresh-token", "the refresh token survives in metadata");
    assert.equal(JSON.stringify(requests).includes("supergrok-access-token"), false, "no token reaches a host.ui request");

    const failing = await oauthMethod();
    const rejected: string[] = [];
    try {
      await assert.rejects(
        () =>
          failing.method.login({
            host: {},
            credentials: {
              async store(ref) {
                rejected.push(ref);
              },
              async delete() {},
            },
          }),
        (error: { code?: string }) => error.code === "oauth_unavailable",
      );
    } finally {
      await failing.agent.dispose();
    }
    assert.deepEqual(rejected, [], "a fail-closed login stores nothing");
  });

  it("xai_oauth_access_token_is_preferred_over_the_api_key", async () => {
    const previousToken = process.env.PRISM_TEST_XAI_OAUTH_TOKEN;
    const previousKey = process.env.PRISM_TEST_XAI_OAUTH_KEY;
    process.env.PRISM_TEST_XAI_OAUTH_TOKEN = "supergrok-access-token";
    process.env.PRISM_TEST_XAI_OAUTH_KEY = "sk-xai-api-key";
    let authorization = "";
    const agent = await createAgent({
      model: { provider: "xai", model: model.model },
      packages: [
        xai({
          apiKey: "env:PRISM_TEST_XAI_OAUTH_KEY",
          accessToken: "env:PRISM_TEST_XAI_OAUTH_TOKEN",
          fetch: (async (_input: RequestInfo | URL, init: RequestInit) => {
            authorization = new Headers(init.headers).get("authorization") ?? "";
            return ok(completion());
          }) as typeof fetch,
        }),
      ],
    });
    try {
      const session = await agent.session();
      await session.run("hi").catch(() => undefined);
      assert.equal(authorization, "Bearer supergrok-access-token");
    } finally {
      await agent.dispose();
      for (const [name, value] of [
        ["PRISM_TEST_XAI_OAUTH_TOKEN", previousToken],
        ["PRISM_TEST_XAI_OAUTH_KEY", previousKey],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
