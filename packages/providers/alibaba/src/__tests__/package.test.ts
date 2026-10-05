import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgent, type ModelConfig, type ProviderRequest } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import { providerConformance } from "@arnilo/prism/provider-kit";
import alibabaDefinition, { alibaba, createAlibabaProvider, defineAlibabaModel, ALIBABA_DEFAULT_API_KEY_REF } from "../index.js";

const UNSET_REF = "env:PRISM_TEST_UNSET_ALIBABA_KEY";

const model: ModelConfig = defineAlibabaModel({ model: "qwen-plus", limits: { contextWindow: 131_072, maxOutputTokens: 8_192 } });

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

describe("@arnilo/prism-provider-alibaba package", () => {
  it("alibaba_passes_package_conformance", async () => {
    const result = await packageConformance(alibabaDefinition, { config: { apiKey: "env:PRISM_TEST_ALIBABA_CONFORMANCE" } });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("alibaba_passes_provider_conformance", async () => {
    const key = "sk-dashscope-canary-key-should-not-surface";
    let captured: Headers | undefined;
    const fetchImpl = (async (_input: unknown, init: RequestInit) => {
      captured = new Headers(init.headers);
      return ok(completion());
    }) as typeof fetch;
    await providerConformance(() => createAlibabaProvider({ apiKey: key, fetch: fetchImpl }), {
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

  it("alibaba_default_api_key_ref_is_the_vendor_env_var", () => {
    assert.equal(ALIBABA_DEFAULT_API_KEY_REF, "env:DASHSCOPE_API_KEY");
    assert.equal(alibabaDefinition.config?.properties?.apiKey?.default, ALIBABA_DEFAULT_API_KEY_REF);
    assert.equal(alibabaDefinition.config?.properties?.apiKey?.["x-prism-secret"], true);
  });

  it("alibaba_missing_key_notes_status_and_does_not_fail_create_agent", async () => {
    const agent = await createAgent({
      model: { provider: "alibaba", model: model.model },
      packages: [alibaba({ apiKey: UNSET_REF })],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.message === `alibaba: no API key at ${UNSET_REF}`);
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

  it("alibaba_literal_api_key_fails_config_validation", async () => {
    await assert.rejects(
      () => createAgent({ model: { provider: "alibaba", model: model.model }, packages: [alibaba({ apiKey: "sk-literal-value" })] }),
      (error: { code?: string }) => error.code === "secret_literal",
    );
  });

  it("alibaba_package_registers_its_provider_and_setup_does_not_fetch", async () => {
    const previous = process.env.PRISM_TEST_ALIBABA_KEY;
    process.env.PRISM_TEST_ALIBABA_KEY = "prism-test-alibaba-key";
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return ok(completion());
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "alibaba", model: model.model },
      packages: [alibaba({ fetch: fetchImpl, apiKey: "env:PRISM_TEST_ALIBABA_KEY" })],
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
      if (previous === undefined) delete process.env.PRISM_TEST_ALIBABA_KEY;
      else process.env.PRISM_TEST_ALIBABA_KEY = previous;
    }
  });

  it("alibaba_models_lists_through_the_vendor_endpoint_only_when_asked", async () => {
    const previous = process.env.PRISM_TEST_ALIBABA_KEY;
    process.env.PRISM_TEST_ALIBABA_KEY = "prism-test-alibaba-key";
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ object: "list", data: [{ id: "alibaba-discovered", object: "model", created: 1, owned_by: "alibaba" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "alibaba", model: model.model },
      packages: [alibaba({ fetch: fetchImpl, apiKey: "env:PRISM_TEST_ALIBABA_KEY" })],
    });
    try {
      assert.deepEqual(urls, [], "no discovery at setup");
      const listed = await agent.models.list();
      assert.deepEqual(urls, ["https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models"]);
      assert.ok(listed.some((entry) => entry.model === "alibaba-discovered"), "the discovered model is listed");
      assert.ok(listed.some((entry) => entry.model === model.model), "the configured model is always listed");
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_ALIBABA_KEY;
      else process.env.PRISM_TEST_ALIBABA_KEY = previous;
    }
  });

  it("alibaba_provider_resolves_its_model_without_a_host_provider", async () => {
    const previous = process.env.PRISM_TEST_ALIBABA_KEY;
    process.env.PRISM_TEST_ALIBABA_KEY = "prism-test-alibaba-key";
    let url = "";
    const agent = await createAgent({
      model,
      packages: [
        alibaba({
          apiKey: "env:PRISM_TEST_ALIBABA_KEY",
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
      if (previous === undefined) delete process.env.PRISM_TEST_ALIBABA_KEY;
      else process.env.PRISM_TEST_ALIBABA_KEY = previous;
    }
  });

  it("alibaba_key_never_surfaces", async () => {
    const secret = "sk-dashscope-canary-key-should-not-surface";
    const previous = process.env.PRISM_TEST_ALIBABA_CANARY;
    process.env.PRISM_TEST_ALIBABA_CANARY = secret;
    const agent = await createAgent({
      model: { provider: "alibaba", model: model.model },
      packages: [
        alibaba({
          apiKey: "env:PRISM_TEST_ALIBABA_CANARY",
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
      if (previous === undefined) delete process.env.PRISM_TEST_ALIBABA_CANARY;
      else process.env.PRISM_TEST_ALIBABA_CANARY = previous;
    }
  });
});
