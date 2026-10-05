import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgent, type ModelConfig, type ProviderRequest } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import { providerConformance } from "@arnilo/prism/provider-kit";
import ollamaDefinition, { ollama, createOllamaProvider, defineOllamaModel } from "../index.js";

const model: ModelConfig = defineOllamaModel({ model: "gpt-oss:20b" });

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

describe("@arnilo/prism-provider-ollama package", () => {
  it("ollama_passes_package_conformance", async () => {
    const result = await packageConformance(ollamaDefinition, { config: { apiKey: "env:PRISM_TEST_OLLAMA_CONFORMANCE" } });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("ollama_passes_provider_conformance", async () => {
    const key = "ollama-canary-key-should-not-surface";
    let captured: Headers | undefined;
    const fetchImpl = (async (_input: unknown, init: RequestInit) => {
      captured = new Headers(init.headers);
      return ok(completion());
    }) as typeof fetch;
    await providerConformance(() => createOllamaProvider({ apiKey: key, fetch: fetchImpl }), {
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

  it("ollama_api_key_is_optional_with_no_default_and_no_status_note", async () => {
    assert.equal(ollamaDefinition.config?.properties?.apiKey?.default, undefined);
    assert.equal(ollamaDefinition.config?.properties?.apiKey?.["x-prism-secret"], true);
    const agent = await createAgent({
      model: { provider: "ollama", model: model.model },
      packages: [ollama({ fetch: (async () => ok(completion())) as typeof fetch })],
    });
    try {
      assert.deepEqual(agent.inspect().statusNotes, [], "an absent optional key is not a warning");
      const session = await agent.session();
      await session.run("hi").catch(() => undefined);
    } finally {
      await agent.dispose();
    }
  });

  it("ollama_literal_api_key_fails_config_validation", async () => {
    await assert.rejects(
      () => createAgent({ model: { provider: "ollama", model: model.model }, packages: [ollama({ apiKey: "sk-literal-value" })] }),
      (error: { code?: string }) => error.code === "secret_literal",
    );
  });

  it("ollama_package_registers_its_provider_and_setup_does_not_fetch", async () => {
    const previous = process.env.PRISM_TEST_OLLAMA_KEY;
    process.env.PRISM_TEST_OLLAMA_KEY = "prism-test-ollama-key";
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return ok(completion());
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "ollama", model: model.model },
      packages: [ollama({ fetch: fetchImpl })],
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
      if (previous === undefined) delete process.env.PRISM_TEST_OLLAMA_KEY;
      else process.env.PRISM_TEST_OLLAMA_KEY = previous;
    }
  });

  it("ollama_models_lists_through_the_vendor_endpoint_only_when_asked", async () => {
    const previous = process.env.PRISM_TEST_OLLAMA_KEY;
    process.env.PRISM_TEST_OLLAMA_KEY = "prism-test-ollama-key";
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ object: "list", data: [{ id: "ollama-discovered", object: "model", created: 1, owned_by: "ollama" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "ollama", model: model.model },
      packages: [ollama({ fetch: fetchImpl })],
    });
    try {
      assert.deepEqual(urls, [], "no discovery at setup");
      const listed = await agent.models.list();
      assert.deepEqual(urls, ["https://ollama.com/v1/models"]);
      assert.ok(listed.some((entry) => entry.model === "ollama-discovered"), "the discovered model is listed");
      assert.ok(listed.some((entry) => entry.model === model.model), "the configured model is always listed");
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_OLLAMA_KEY;
      else process.env.PRISM_TEST_OLLAMA_KEY = previous;
    }
  });

  it("ollama_provider_resolves_its_model_without_a_host_provider", async () => {
    const previous = process.env.PRISM_TEST_OLLAMA_KEY;
    process.env.PRISM_TEST_OLLAMA_KEY = "prism-test-ollama-key";
    let url = "";
    const agent = await createAgent({
      model,
      packages: [
        ollama({
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
      if (previous === undefined) delete process.env.PRISM_TEST_OLLAMA_KEY;
      else process.env.PRISM_TEST_OLLAMA_KEY = previous;
    }
  });

  it("ollama_key_never_surfaces", async () => {
    const secret = "ollama-canary-key-should-not-surface";
    const previous = process.env.PRISM_TEST_OLLAMA_CANARY;
    process.env.PRISM_TEST_OLLAMA_CANARY = secret;
    const agent = await createAgent({
      model: { provider: "ollama", model: model.model },
      packages: [
        ollama({
          apiKey: "env:PRISM_TEST_OLLAMA_CANARY",
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
      if (previous === undefined) delete process.env.PRISM_TEST_OLLAMA_CANARY;
      else process.env.PRISM_TEST_OLLAMA_CANARY = previous;
    }
  });
});
