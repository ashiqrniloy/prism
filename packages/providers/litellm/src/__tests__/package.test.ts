import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent } from "@arnilo/prism";
import { providerConformance } from "@arnilo/prism/provider-kit";
import { packageConformance } from "@arnilo/prism/testing";
import { readFileSync } from "node:fs";
import definition, {
  createLiteLLMProvider,
  groupLiteLLMModelInfo,
  isLoopbackHost,
  LITELLM_DEFAULT_API_KEY_REF,
  LITELLM_DEFAULT_BASE_URL,
  type LiteLLMModelInfoEntry,
  litellm,
  listLiteLLMModels,
  mapLiteLLMUsage,
} from "../index.js";

const secret = "sk-litellm-test-canary-never-expose";
const modelInfo = JSON.parse(readFileSync(new URL("./wire/model-info.json", import.meta.url), "utf8")) as {
  data: LiteLLMModelInfoEntry[];
};
const discovered = groupLiteLLMModelInfo(modelInfo.data, { provider: "litellm" });
// Discovery claims no vision (the deployment leaves `supports_vision` null), so the image scenario
// runs on an explicit static model that does, the way a host overrides a discovered capability.
const conformanceModels = discovered.map((model) =>
  model.model === "prism-free/chat" ? { ...model, capabilities: { ...model.capabilities, input: ["text", "image"] } } : model,
);

function chatStream(): Response {
  return new Response(
    `data: ${JSON.stringify({
      choices: [{ delta: { content: "hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_tokens_details: { cached_tokens: 4 } },
    })}\n\ndata: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream", "x-litellm-call-id": "id", "x-litellm-model-id": "chat-scout" } },
  );
}

async function registeredProvider(options: {
  readonly config: Readonly<Record<string, unknown>>;
  readonly resolve: (ref: string) => Promise<{ type: string; value: string } | undefined>;
  readonly fetch?: typeof fetch;
  readonly notes?: { level: string; message: string }[];
}) {
  let provider: Awaited<ReturnType<typeof createLiteLLMProvider>> | undefined;
  const prism = {
    config: options.config,
    credentials: { resolve: options.resolve, store: async () => {}, delete: async () => {} },
    status: { note: (level: string, message: string) => options.notes?.push({ level, message }) },
    providers: {
      register: (value: typeof provider) => {
        provider = value;
      },
    },
  };
  const instance = litellm({
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    ...(options.config as Record<string, unknown>),
  });
  await instance.definition.setup(prism as never);
  assert.ok(provider, "the package registers a provider");
  return provider;
}

describe("LiteLLM package", () => {
  it("litellm_passes_package_conformance", async () => {
    const result = await packageConformance(definition, { config: { apiKey: "env:PRISM_TEST_UNSET_LITELLM_KEY" } });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("litellm_package_conformance_chat", async () => {
    const result = await providerConformance((fetch) => createLiteLLMProvider({ apiKey: async () => secret, fetch }), {
      recordings: new URL("./wire/chat/", import.meta.url),
      models: conformanceModels,
      secrets: [secret],
    });
    assert.equal(result.ok, true);
    const names = result.scenarios.map((scenario) => scenario.name);
    for (const name of ["text", "stream", "tool-loop", "thinking", "image", "cache"]) assert.ok(names.includes(name), name);
    for (const name of [
      "error-unauthorized",
      "error-unknown-model",
      "error-budget",
      "error-rate-limit",
      "error-cooldown",
      "error-overflow",
    ]) {
      assert.ok(names.includes(name), name);
    }
    // The cache scenario replays three turns in one file.
    assert.equal(result.scenarios.find((scenario) => scenario.name === "cache")?.events.filter((event) => event.type === "done").length, 3);

    const cache = result.scenarios.find((scenario) => scenario.name === "cache");
    const usage = cache?.events.find((event) => event.type === "usage");
    assert.equal(usage?.type === "usage" ? usage.usage.cacheReadTokens : undefined, 0, "the backend reports no cache hit");
  });

  it("litellm_default_refs_and_base", () => {
    assert.equal(LITELLM_DEFAULT_API_KEY_REF, "env:LITELLM_API_KEY");
    assert.equal(LITELLM_DEFAULT_BASE_URL, "http://127.0.0.1:4000");
    assert.equal(definition.config?.properties?.apiKey?.default, LITELLM_DEFAULT_API_KEY_REF);
    assert.equal(definition.config?.properties?.apiKey?.["x-prism-secret"], true);
    assert.equal(definition.config?.properties?.baseUrl?.default, undefined, "the base URL default is applied at setup, not in the schema");
  });

  it("litellm_rejects_insecure_remote_base_url", async () => {
    await assert.rejects(
      async () => registeredProvider({ config: { baseUrl: "http://proxy.example:4000" }, resolve: async () => undefined }),
      /ERR_LITELLM_INSECURE_BASE_URL/,
    );
    await assert.rejects(
      async () => registeredProvider({ config: { baseUrl: "ftp://127.0.0.1:4000" }, resolve: async () => undefined }),
      /ERR_LITELLM_INSECURE_BASE_URL/,
    );
    await assert.rejects(
      async () => registeredProvider({ config: { baseUrl: "http://user:pass@127.0.0.1:4000" }, resolve: async () => undefined }),
      /ERR_LITELLM_INSECURE_BASE_URL/,
    );
    for (const baseUrl of ["http://127.0.0.1:4000", "http://127.1.2.3:4000", "http://localhost:4000", "https://proxy.example"]) {
      const provider = await registeredProvider({ config: { baseUrl }, resolve: async () => undefined });
      assert.equal(provider.id, "litellm");
    }
    assert.equal(isLoopbackHost("127.0.0.53"), true);
    assert.equal(isLoopbackHost("128.0.0.1"), false);
    assert.equal(isLoopbackHost("127.0.0.1.example.com"), false);
    assert.equal(isLoopbackHost("[::1]"), true);
  });

  it("litellm_missing_key_notes_and_registers", async () => {
    const notes: { level: string; message: string }[] = [];
    const keyRef = "env:PRISM_TEST_UNSET_LITELLM_KEY";
    const provider = await registeredProvider({ config: { apiKey: keyRef }, resolve: async () => undefined, notes });
    assert.deepEqual(notes, [{ level: "info", message: `litellm: no key at ${keyRef}; requests are sent without Authorization` }]);
    assert.equal(provider.auth?.[0]?.kind, "api-key");
    assert.deepEqual(provider.auth?.[0], { kind: "api-key", ref: keyRef });
  });

  it("litellm_literal_api_key_fails_config_validation", async () => {
    await assert.rejects(
      () =>
        createAgent({
          model: { provider: "litellm", model: "prism-free/chat" },
          packages: [litellm({ apiKey: "sk-literal-value" })],
        }),
      (error: { code?: string }) => error.code === "secret_literal",
    );
  });

  it("litellm_secret_never_leaks", async () => {
    const previous = process.env.PRISM_TEST_LITELLM_CANARY;
    process.env.PRISM_TEST_LITELLM_CANARY = secret;
    const agent = await createAgent({
      model: { provider: "litellm", model: "prism-free/chat" },
      packages: [litellm({ apiKey: "env:PRISM_TEST_LITELLM_CANARY", fetch: (async () => chatStream()) as typeof fetch })],
    });
    try {
      const session = await agent.session();
      const events: unknown[] = [];
      const reader = (async () => {
        for await (const event of session.subscribe()) events.push(event);
      })();
      await session.run("hi").catch(() => undefined);
      await reader;
      const surfaced = JSON.stringify(agent.inspect()) + JSON.stringify(events);
      assert.equal(surfaced.includes(secret), false);
      assert.equal(surfaced.includes("authorization"), false, "no header travels in events");
      assert.equal(surfaced.includes('"litellm":{"callId"'), true, "the call id does surface, in usage metadata");
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_LITELLM_CANARY;
      else process.env.PRISM_TEST_LITELLM_CANARY = previous;
    }
  });

  it("litellm_discovery_uses_the_configured_key", async () => {
    const provider = await registeredProvider({
      config: { apiKey: "env:KEY", baseUrl: "http://127.0.0.1:4999" },
      resolve: async (ref) => (ref === "env:KEY" ? { type: "api_key", value: secret } : undefined),
      fetch: (async (input, init) => {
        assert.equal(String(input), "http://127.0.0.1:4999/model/info");
        assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${secret}`);
        return Response.json({ data: modelInfo.data });
      }) as typeof fetch,
    });
    const models = await provider.models!();
    assert.equal(models.length, 2);
    assert.equal(typeof mapLiteLLMUsage, "function");
    assert.equal(typeof listLiteLLMModels, "function");
  });
});
