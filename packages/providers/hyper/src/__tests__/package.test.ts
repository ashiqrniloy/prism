import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgent, type ModelConfig, type ProviderRequest } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import { providerConformance } from "@arnilo/prism/provider-kit";
import hyperDefinition, { hyper, createHyperProvider, hyperModels, HYPER_DEFAULT_API_KEY_REF } from "../index.js";

const UNSET_REF = "env:PRISM_TEST_UNSET_HYPER_KEY";

const model: ModelConfig = {
  provider: "hyper",
  model: "deepseek-v4-pro",
  capabilities: { input: ["text"], output: ["text"], reasoning: true, tools: true, streaming: true },
  compat: { route: "openai", preserveThinking: true },
  cache: { kind: "implicit" },
  limits: { contextWindow: 1_000_000, maxOutputTokens: 384_000 },
};

const anthropicModel: ModelConfig = {
  ...model,
  model: "qwen3.6-plus",
  compat: { route: "anthropic", preserveThinking: true },
  cache: { kind: "cache_control", maxBreakpoints: 4 },
};

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

function anthropicSse(): ReadableStream<Uint8Array> {
  const text = [
    { type: "content_block_start", index: 0, content_block: { type: "text" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } },
    { type: "content_block_stop", index: 0 },
    { type: "message.delta", usage: { input_tokens: 4, output_tokens: 3 } },
    { type: "message_stop" },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`${text}data: [DONE]\n\n`));
      controller.close();
    },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("@arnilo/prism-provider-hyper package", () => {
  it("hyper_passes_package_conformance", async () => {
    const result = await packageConformance(hyperDefinition, { config: { apiKey: "env:PRISM_TEST_HYPER_CONFORMANCE" } });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("hyper_passes_provider_conformance", async () => {
    const key = "sk-hyper-canary-key-should-not-surface";
    let captured: Headers | undefined;
    const fetchImpl = (async (_input: unknown, init: RequestInit) => {
      captured = new Headers(init.headers);
      return ok(completion());
    }) as typeof fetch;
    await providerConformance(() => createHyperProvider({ apiKey: async () => key, fetch: fetchImpl }), {
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

  it("hyper_passes_recorded_conformance", async () => {
    const key = "sk-hyper-conformance-key-should-not-surface";
    const result = await providerConformance((fetchImpl) => createHyperProvider({ apiKey: async () => key, fetch: fetchImpl }), {
      recordings: new URL("./wire/", import.meta.url),
      models: hyperModels,
      secrets: [key],
    });
    assert.equal(result.ok, true);
  });

  it("hyper_default_api_key_ref_is_the_vendor_env_var", () => {
    assert.equal(HYPER_DEFAULT_API_KEY_REF, "env:HYPER_API_KEY");
    assert.equal(hyperDefinition.config?.properties?.apiKey?.default, HYPER_DEFAULT_API_KEY_REF);
    assert.equal(hyperDefinition.config?.properties?.apiKey?.["x-prism-secret"], true);
  });

  it("hyper_missing_key_notes_status_and_does_not_fail_create_agent", async () => {
    const agent = await createAgent({
      model: { provider: "hyper", model: model.model },
      packages: [hyper({ apiKey: UNSET_REF })],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.message === `hyper: no API key at ${UNSET_REF}`);
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

  it("hyper_literal_api_key_fails_config_validation", async () => {
    await assert.rejects(
      () => createAgent({ model: { provider: "hyper", model: model.model }, packages: [hyper({ apiKey: "sk-literal-value" })] }),
      (error: { code?: string }) => error.code === "secret_literal",
    );
  });

  it("hyper_package_registers_its_provider_and_setup_does_not_fetch", async () => {
    const previous = process.env.PRISM_TEST_HYPER_KEY;
    process.env.PRISM_TEST_HYPER_KEY = "prism-test-hyper-key";
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return ok(completion());
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "hyper", model: model.model },
      packages: [hyper({ fetch: fetchImpl, apiKey: "env:PRISM_TEST_HYPER_KEY" })],
    });
    try {
      // Setup resolves the ref (an env read) but never talks to the wire; discovery is caller-gated.
      assert.equal(fetches, 0, "setup must not fetch");
      const session = await agent.session();
      await session.run("hi").catch(() => undefined);
      assert.ok(fetches > 0, "a run reaches the vendor transport");
      assert.equal(
        agent.inspect().statusNotes.some((note) => note.message.includes("no API key")),
        false,
        "a resolvable ref records no warning",
      );
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_HYPER_KEY;
      else process.env.PRISM_TEST_HYPER_KEY = previous;
    }
  });

  it("hyper_models_lists_through_the_vendor_endpoint_only_when_asked", async () => {
    const previous = process.env.PRISM_TEST_HYPER_KEY;
    process.env.PRISM_TEST_HYPER_KEY = "prism-test-hyper-key";
    const urls: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/models"))
        return jsonResponse({ object: "list", data: [{ id: "hyper-discovered", object: "model", created: 1, owned_by: "hyper" }] });
      return ok(completion());
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "hyper", model: model.model },
      packages: [hyper({ apiKey: "env:PRISM_TEST_HYPER_KEY", fetch: fetchImpl })],
    });
    try {
      assert.deepEqual(urls, [], "setup must not discover");
      const listed = await agent.models.list();
      assert.deepEqual(urls, ["https://hyper.charm.land/v1/models"], "discovery runs only on agent.models.list()");
      assert.ok(listed.some((entry) => entry.model === "hyper-discovered"), "the live entry lists");
      assert.ok(listed.some((entry) => entry.model === model.model), "the configured model lists too");
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_HYPER_KEY;
      else process.env.PRISM_TEST_HYPER_KEY = previous;
    }
  });

  it("hyper_provider_resolves_its_model_without_a_host_provider", async () => {
    const previous = process.env.PRISM_TEST_HYPER_KEY;
    process.env.PRISM_TEST_HYPER_KEY = "prism-test-hyper-key";
    let url = "";
    const agent = await createAgent({
      model,
      packages: [
        hyper({
          apiKey: "env:PRISM_TEST_HYPER_KEY",
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
      if (previous === undefined) delete process.env.PRISM_TEST_HYPER_KEY;
      else process.env.PRISM_TEST_HYPER_KEY = previous;
    }
  });

  it("hyper_key_never_surfaces", async () => {
    const secret = "sk-hyper-canary-key-should-not-surface";
    const previous = process.env.PRISM_TEST_HYPER_CANARY;
    process.env.PRISM_TEST_HYPER_CANARY = secret;
    const agent = await createAgent({
      model: { provider: "hyper", model: model.model },
      packages: [
        hyper({
          apiKey: "env:PRISM_TEST_HYPER_CANARY",
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
      if (previous === undefined) delete process.env.PRISM_TEST_HYPER_CANARY;
      else process.env.PRISM_TEST_HYPER_CANARY = previous;
    }
  });

  it("hyper_anthropic_route_owns_x_api_key_and_anthropic_version", async () => {
    const key = "sk-hyper-anthropic-canary-key-should-not-surface";
    let captured: Headers | undefined;
    const fetchImpl = (async (_input: unknown, init: RequestInit) => {
      captured = new Headers(init.headers);
      return ok(anthropicSse());
    }) as typeof fetch;
    await providerConformance(() => createHyperProvider({ apiKey: async () => key, fetch: fetchImpl }), {
      request: { ...request, model: anthropicModel },
      secrets: [key],
      headers: {
        owned: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        caller: { "x-api-key": "hijack", "anthropic-version": "hijack", "x-trace": "1" },
        captured: () => captured,
      },
      expect: { text: "hello" },
    });
  });
});
