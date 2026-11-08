import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent } from "@arnilo/prism";
import { providerConformance } from "@arnilo/prism/provider-kit";
import { packageConformance } from "@arnilo/prism/testing";
import definition, {
  createKiloProvider,
  KILO_DEFAULT_API_KEY_REF,
  KILO_DEFAULT_CREDENTIAL_REF,
  kilo,
  kiloModels,
  listKiloModels,
  mapKiloModel,
} from "../index.js";

const [chatModel, responsesModel, messagesModel] = kiloModels as [
  (typeof kiloModels)[number],
  (typeof kiloModels)[number],
  (typeof kiloModels)[number],
];
const secret = "sk-kilo-test-canary-never-expose";

function chatStream(): Response {
  return new Response(
    `data: ${JSON.stringify({
      choices: [{ delta: { content: "hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_tokens_details: { cached_tokens: 4 }, cost: 0 },
    })}\n\ndata: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}

describe("Kilo package", () => {
  it("kilo_passes_package_conformance", async () => {
    const result = await packageConformance(definition);
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("kilo_package_conformance_three_routes", async () => {
    const result = await providerConformance((fetch) => createKiloProvider({ apiKey: async () => secret, fetch }), {
      recordings: new URL("./wire/", import.meta.url),
      models: [chatModel, responsesModel, messagesModel],
      secrets: [secret],
    });
    assert.equal(result.ok, true);
    const names = result.scenarios.map((scenario) => scenario.name);
    const count = (name: string) => names.filter((scenario) => scenario === name).length;
    assert.equal(count("text"), 3);
    assert.equal(count("cache"), 3);
    assert.equal(count("tool-loop"), 3);
    assert.equal(count("thinking"), 3);
    assert.equal(count("image"), 3);
    assert.equal(count("structured-output"), 2, "Messages has no structured-output field");
    assert.ok(names.includes("error-unauthorized"));
    assert.ok(names.includes("error-credits"));
    assert.ok(names.includes("error-overflow"));
  });

  it("kilo_default_refs", () => {
    assert.equal(KILO_DEFAULT_API_KEY_REF, "env:KILO_API_KEY");
    assert.equal(KILO_DEFAULT_CREDENTIAL_REF, "keyring:kilo");
    assert.equal(definition.config?.properties?.apiKey?.default, KILO_DEFAULT_API_KEY_REF);
    assert.equal(definition.config?.properties?.credential?.default, KILO_DEFAULT_CREDENTIAL_REF);
    assert.equal(definition.config?.properties?.apiKey?.["x-prism-secret"], true);
  });

  it("kilo_declares_api_key_and_device_login", async () => {
    const provider = await registeredProvider({
      config: { apiKey: "env:KEY", credential: "keyring:kilo-test" },
      resolve: async (ref) => (ref === "keyring:kilo-test" ? { type: "bearer", value: "login-token" } : undefined),
    });
    assert.deepEqual(provider.auth?.[0], { kind: "api-key", ref: "env:KEY" });
    const oauth = provider.auth?.find((method) => method.kind === "oauth");
    assert.equal(oauth?.kind, "oauth");
    assert.equal(oauth?.id, "kilo");
    assert.equal(typeof oauth?.login, "function");
    assert.ok(definition.capabilities?.includes("credentials:write"), "a login writes the credential slot");
  });

  it("kilo_credential_resolution_order", async () => {
    const seen: { auth: string | null; org: string | null }[] = [];
    const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({ auth: headers.get("authorization"), org: headers.get("x-kilocode-organizationid") });
      return chatStream();
    }) as typeof fetch;

    // The key wins over the login; the login's stored organization applies when config does not override it.
    const keyed = await registeredProvider({
      config: { apiKey: "env:KEY", credential: "keyring:kilo-test" },
      fetch: fakeFetch,
      resolve: async (ref) => {
        if (ref === "env:KEY") return { type: "api_key", value: "key-token" };
        if (ref === "keyring:kilo-test") return { type: "bearer", value: "login-token", metadata: { organizationId: "login-org" } };
        return undefined;
      },
    });
    await collect(keyed, chatModel);
    assert.deepEqual(seen.at(-1), { auth: "Bearer key-token", org: "login-org" });

    // Without a key, the login is the source; config.organizationId overrides the stored organization.
    const loginOnly = await registeredProvider({
      config: { apiKey: "env:KEY", credential: "keyring:kilo-test", organizationId: "config-org" },
      fetch: fakeFetch,
      resolve: async (ref) =>
        ref === "keyring:kilo-test" ? { type: "bearer", value: "login-token", metadata: { organizationId: "login-org" } } : undefined,
    });
    await collect(loginOnly, chatModel);
    assert.deepEqual(seen.at(-1), { auth: "Bearer login-token", org: "config-org" });
  });

  it("kilo_missing_credential_notes_and_registers", async () => {
    const keyRef = "env:PRISM_TEST_UNSET_KILO_KEY";
    const credentialRef = "keyring:prism-test-kilo-unset";
    const agent = await createAgent({
      model: { provider: "kilo", model: chatModel.model },
      packages: [kilo({ apiKey: keyRef, credential: credentialRef })],
    });
    try {
      const notes = agent
        .inspect()
        .statusNotes.filter(
          (note) => note.message === `kilo: no API key at ${keyRef} and no login at ${credentialRef}; only :free models are reachable`,
        );
      assert.equal(notes.length, 1);
      assert.equal(notes[0]?.level, "warn");
      assert.ok(
        (await agent.models.list()).some((model) => model.model === chatModel.model),
        "the catalog still lists",
      );
    } finally {
      await agent.dispose();
    }
  });

  it("kilo_literal_api_key_fails_config_validation", async () => {
    await assert.rejects(
      () =>
        createAgent({
          model: { provider: "kilo", model: chatModel.model },
          packages: [kilo({ apiKey: "sk-literal-value" })],
        }),
      (error: { code?: string }) => error.code === "secret_literal",
    );
  });

  it("kilo_ignores_token_embedded_base_url", async () => {
    let url = "";
    const provider = createKiloProvider({
      resolveApiKey: () => "https://evil.example:abc",
      fetch: (async (input) => {
        url = String(input);
        return chatStream();
      }) as typeof fetch,
    });
    for await (const _event of provider.generate({
      model: chatModel,
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })) {
      // drain
    }
    assert.equal(url, "https://ai-gateway.kilo.ai/api/v1/chat/completions");
  });

  it("kilo_key_never_surfaces", async () => {
    const previous = process.env.PRISM_TEST_KILO_CANARY;
    process.env.PRISM_TEST_KILO_CANARY = secret;
    const agent = await createAgent({
      model: { provider: "kilo", model: chatModel.model },
      packages: [kilo({ apiKey: "env:PRISM_TEST_KILO_CANARY", fetch: (async () => chatStream()) as typeof fetch })],
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
      if (previous === undefined) delete process.env.PRISM_TEST_KILO_CANARY;
      else process.env.PRISM_TEST_KILO_CANARY = previous;
    }
  });

  it("list_kilo_models_maps_catalog", async () => {
    const original = mapKiloModel({
      id: "anthropic/claude-haiku-5.5",
      name: "Claude Haiku 5.5",
      context_length: 1_000_000,
      top_provider: { max_completion_tokens: 128_000 },
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      supported_parameters: ["tools", "reasoning", "structured_outputs"],
      pricing: { prompt: "0.0000001", completion: "0.0000005", input_cache_read: "0.00000001", input_cache_write: "0.000000125" },
      opencode: { ai_sdk_provider: "anthropic" },
      isFree: false,
      mayTrainOnYourPrompts: false,
    });
    assert.equal(original.compat?.route, "messages");
    assert.equal(original.limits?.maxOutputTokens, 128_000);
    assert.deepEqual(original.capabilities?.input, ["text", "image"]);
    assert.equal(original.capabilities?.tools, true);
    assert.equal(original.capabilities?.reasoning, true);
    assert.equal(original.capabilities?.structuredOutput, "json_schema");
    assert.ok(Math.abs((original.cost?.input ?? 0) - 0.1) < 1e-9);
    assert.equal(original.cost?.output, 0.5);
    assert.equal(original.cost?.cacheRead, 0.01);
    assert.equal(original.cost?.cacheWrite, 0.125);
    assert.equal(original.compat?.isFree, undefined);
    const free = mapKiloModel({
      id: "~anthropic/claude-haiku-latest",
      alias_target: "anthropic/claude-haiku-5.5",
      supported_parameters: [],
      opencode: { ai_sdk_provider: "openrouter" },
      isFree: true,
      mayTrainOnYourPrompts: true,
    });
    assert.equal(free.compat?.route, "chat");
    assert.equal(free.compat?.isFree, true);
    assert.equal(free.compat?.mayTrainOnYourPrompts, true);
    assert.equal(free.compat?.aliasTarget, "anthropic/claude-haiku-5.5");
    assert.equal(free.capabilities?.tools, true, "an empty parameter list claims tools");
    assert.equal(free.limits?.maxOutputTokens, undefined, "no 20% guess");

    const urls: string[] = [];
    const models = await listKiloModels({
      apiKey: async () => secret,
      organizationId: "org 1",
      fetch: (async (url, init) => {
        urls.push(String(url));
        assert.equal(new Headers(init?.headers).get("X-KILOCODE-ORGANIZATIONID"), "org 1");
        return Response.json({ data: [{ id: "openai/gpt-6-luna", opencode: { ai_sdk_provider: "openai" }, context_length: 1_050_000 }] });
      }) as typeof fetch,
    });
    assert.deepEqual(urls, ["https://ai-gateway.kilo.ai/api/v1/organizations/org%201/models"]);
    assert.equal(models[0]?.compat?.route, "responses");
  });

  it("kilo_overflow_classified_and_recovered", async () => {
    const { kiloOverflowSession } = await import("./overflow-session.js");
    await kiloOverflowSession({
      path: "/api/v1/chat/completions",
      status: 400,
      contentType: "application/json",
      responseBody:
        '{"error":{"message":"This endpoint\'s maximum context length is 65536 tokens. However, you requested about 88052 tokens ...","code":400},"error_type":"context_length_exceeded"}',
    });
  });

  async function registeredProvider(options: {
    readonly config: Readonly<Record<string, unknown>>;
    readonly resolve: (ref: string) => Promise<{ type: string; value: string; metadata?: Readonly<Record<string, unknown>> } | undefined>;
    readonly fetch?: typeof fetch;
  }): Promise<import("@arnilo/prism").ModelProvider> {
    let provider: import("@arnilo/prism").ModelProvider | undefined;
    const prism = {
      config: options.config,
      credentials: { resolve: options.resolve, store: async () => {}, delete: async () => {} },
      status: { note: () => {} },
      providers: {
        register: (value: import("@arnilo/prism").ModelProvider) => {
          provider = value;
        },
      },
    };
    const instance = kilo({
      ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
      ...(options.config as Record<string, unknown>),
    });
    await instance.definition.setup(prism as never);
    assert.ok(provider, "the package registers a provider");
    return provider;
  }

  async function collect(provider: import("@arnilo/prism").ModelProvider, model: (typeof kiloModels)[number]): Promise<void> {
    for await (const _event of provider.generate({ model, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] })) {
      // drain
    }
  }
});
