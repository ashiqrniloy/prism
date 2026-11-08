import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent } from "@arnilo/prism";
import { providerConformance } from "@arnilo/prism/provider-kit";
import { packageConformance } from "@arnilo/prism/testing";
import definition, {
  COMMAND_CODE_DEFAULT_API_KEY_REF,
  commandCodeModels,
  commandcode,
  createCommandCodeProvider,
  listCommandCodeModels,
  mapCommandCodeModel,
} from "../index.js";

const [chatModel, responsesModel, messagesModel] = commandCodeModels as [
  (typeof commandCodeModels)[number],
  (typeof commandCodeModels)[number],
  (typeof commandCodeModels)[number],
];
const secret = "sk-cc-test-canary-never-expose";

function chatStream(): Response {
  return new Response(
    `data: ${JSON.stringify({
      choices: [{ delta: { content: "hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_tokens_details: { cached_tokens: 4 } },
    })}\n\ndata: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}

describe("Command Code package", () => {
  it("commandcode_passes_package_conformance", async () => {
    const result = await packageConformance(definition);
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("commandcode_package_conformance_three_routes", async () => {
    const result = await providerConformance((fetch) => createCommandCodeProvider({ apiKey: async () => secret, fetch }), {
      recordings: new URL("./wire/", import.meta.url),
      models: [chatModel, responsesModel, messagesModel],
      secrets: [secret],
    });
    assert.equal(result.ok, true);
    // Scenario names are file basenames, so the three routes are counted, not prefixed.
    const names = result.scenarios.map((scenario) => scenario.name);
    const count = (name: string) => names.filter((scenario) => scenario === name).length;
    assert.equal(count("text"), 3, `one text scenario per route: ${names.join(",")}`);
    assert.equal(count("cache"), 3, "one 3-turn cache scenario per route");
    assert.equal(count("tool-loop"), 3);
    assert.equal(count("thinking"), 3);
    assert.equal(count("structured-output"), 2, "Messages has no structured-output field");
    assert.ok(names.includes("error-rate-limited"));
  });

  it("commandcode_default_api_key_ref_is_the_vendor_env_var", () => {
    assert.equal(COMMAND_CODE_DEFAULT_API_KEY_REF, "env:COMMAND_CODE_API_KEY");
    assert.equal(definition.config?.properties?.apiKey?.default, COMMAND_CODE_DEFAULT_API_KEY_REF);
    assert.equal(definition.config?.properties?.apiKey?.["x-prism-secret"], true);
    assert.equal(definition.config?.properties?.zdr?.default, false);
  });

  it("commandcode_missing_key_notes_and_registers", async () => {
    const ref = "env:PRISM_TEST_UNSET_COMMANDCODE_KEY";
    const agent = await createAgent({
      model: { provider: "commandcode", model: chatModel.model },
      packages: [commandcode({ apiKey: ref })],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.message === `commandcode: no API key at ${ref}`);
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

  it("commandcode_literal_api_key_fails_config_validation", async () => {
    await assert.rejects(
      () =>
        createAgent({
          model: { provider: "commandcode", model: chatModel.model },
          packages: [commandcode({ apiKey: "sk-literal-value" })],
        }),
      (error: { code?: string }) => error.code === "secret_literal",
    );
  });

  it("commandcode_setup_does_not_fetch_and_discovery_is_caller_gated", async () => {
    const previous = process.env.PRISM_TEST_COMMANDCODE_DISCOVERY;
    process.env.PRISM_TEST_COMMANDCODE_DISCOVERY = "prism-test-key";
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/models")) {
        return Response.json({
          object: "list",
          data: [{ id: "commandcode-discovered", name: "Discovered", context_length: 262144, supported_endpoints: ["/chat/completions"] }],
        });
      }
      return chatStream();
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "commandcode", model: chatModel.model },
      packages: [commandcode({ fetch: fetchImpl, apiKey: "env:PRISM_TEST_COMMANDCODE_DISCOVERY" })],
    });
    try {
      assert.deepEqual(urls, [], "no discovery at setup");
      const listed = await agent.models.list();
      assert.deepEqual(urls, ["https://api.commandcode.ai/provider/v1/models"]);
      assert.ok(
        listed.some((entry) => entry.model === "commandcode-discovered"),
        "the discovered model is listed",
      );
      assert.ok(
        listed.some((entry) => entry.model === chatModel.model),
        "the configured model is always listed",
      );
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_COMMANDCODE_DISCOVERY;
      else process.env.PRISM_TEST_COMMANDCODE_DISCOVERY = previous;
    }
  });

  it("commandcode_key_never_surfaces", async () => {
    const previous = process.env.PRISM_TEST_COMMANDCODE_CANARY;
    process.env.PRISM_TEST_COMMANDCODE_CANARY = secret;
    const agent = await createAgent({
      model: { provider: "commandcode", model: chatModel.model },
      packages: [
        commandcode({
          apiKey: "env:PRISM_TEST_COMMANDCODE_CANARY",
          fetch: (async () => chatStream()) as typeof fetch,
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
      if (previous === undefined) delete process.env.PRISM_TEST_COMMANDCODE_CANARY;
      else process.env.PRISM_TEST_COMMANDCODE_CANARY = previous;
    }
  });

  it("list_commandcode_models_maps_supported_endpoints", async () => {
    const models = await listCommandCodeModels({
      apiKey: async () => secret,
      fetch: (async (url, init) => {
        assert.equal(String(url), "https://api.commandcode.ai/provider/v1/models");
        assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${secret}`);
        return Response.json({
          object: "list",
          data: [
            { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", context_length: 1_000_000, supported_endpoints: ["/messages"] },
            { id: "vendor/dual", context_length: 100_000, supported_endpoints: ["/chat/completions", "/responses"] },
            { id: "vendor/chat-only", context_length: 200_000, supported_endpoints: ["/chat/completions"] },
          ],
        });
      }) as typeof fetch,
    });
    assert.deepEqual(
      models.map((model) => [model.model, model.compat?.route]),
      [
        ["claude-haiku-5-5", "anthropic"],
        ["vendor/dual", "responses"],
        ["vendor/chat-only", "openai"],
      ],
    );
    assert.equal(models[0]?.limits?.maxOutputTokens, 128_000);
    assert.equal(models[2]?.limits?.contextWindow, 200_000);
    assert.equal(models[1]?.limits?.maxOutputTokens, undefined, "an unpublished cap is left undefined");
  });

  it("commandcode_catalog_declares_context_windows", () => {
    for (const model of commandCodeModels) {
      assert.equal(typeof model.limits?.contextWindow, "number", `${model.model} must declare a context window`);
      assert.equal(model.cost?.currency, "USD");
      assert.equal(model.compat?.pricing_source, "https://commandcode.ai/docs/resources/pricing-limits");
    }
    assert.equal(mapCommandCodeModel({ id: "unknown/model" }).limits?.contextWindow, undefined);
  });
});
