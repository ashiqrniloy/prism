import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgent, type ModelConfig, type ProviderRequest } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import { providerConformance } from "@arnilo/prism/provider-kit";
import clinepassDefinition, { clinepass, createClinePassProvider, clinePassModels, CLINEPASS_DEFAULT_API_KEY_REF } from "../index.js";

const UNSET_REF = "env:PRISM_TEST_UNSET_CLINEPASS_KEY";

const model: ModelConfig = clinePassModels[0] as ModelConfig;

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

describe("@arnilo/prism-provider-clinepass package", () => {
  it("clinepass_passes_package_conformance", async () => {
    const result = await packageConformance(clinepassDefinition, { config: { apiKey: "env:PRISM_TEST_CLINEPASS_CONFORMANCE" } });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("clinepass_passes_provider_conformance", async () => {
    const key = "sk-cline-canary-key-should-not-surface";
    let captured: Headers | undefined;
    const fetchImpl = (async (_input: unknown, init: RequestInit) => {
      captured = new Headers(init.headers);
      return ok(completion());
    }) as typeof fetch;
    await providerConformance(() => createClinePassProvider({ apiKey: key, fetch: fetchImpl }), {
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

  it("clinepass_default_api_key_ref_is_the_vendor_env_var", () => {
    assert.equal(CLINEPASS_DEFAULT_API_KEY_REF, "env:CLINEPASS_API_KEY");
    assert.equal(clinepassDefinition.config?.properties?.apiKey?.default, CLINEPASS_DEFAULT_API_KEY_REF);
    assert.equal(clinepassDefinition.config?.properties?.apiKey?.["x-prism-secret"], true);
  });

  it("clinepass_missing_key_notes_status_and_does_not_fail_create_agent", async () => {
    const agent = await createAgent({
      model: { provider: "clinepass", model: model.model },
      packages: [clinepass({ apiKey: UNSET_REF })],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.message === `clinepass: no API key at ${UNSET_REF}`);
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

  it("clinepass_literal_api_key_fails_config_validation", async () => {
    await assert.rejects(
      () => createAgent({ model: { provider: "clinepass", model: model.model }, packages: [clinepass({ apiKey: "sk-literal-value" })] }),
      (error: { code?: string }) => error.code === "secret_literal",
    );
  });

  it("clinepass_package_registers_its_provider_and_setup_does_not_fetch", async () => {
    const previous = process.env.PRISM_TEST_CLINEPASS_KEY;
    process.env.PRISM_TEST_CLINEPASS_KEY = "prism-test-clinepass-key";
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return ok(completion());
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "clinepass", model: model.model },
      packages: [clinepass({ fetch: fetchImpl, apiKey: "env:PRISM_TEST_CLINEPASS_KEY" })],
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
      if (previous === undefined) delete process.env.PRISM_TEST_CLINEPASS_KEY;
      else process.env.PRISM_TEST_CLINEPASS_KEY = previous;
    }
  });

  it("clinepass_models_returns_the_featured_catalog_without_fetching", async () => {
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return ok(completion());
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "clinepass", model: model.model },
      packages: [clinepass({ apiKey: "env:PRISM_TEST_CLINEPASS_KEY", fetch: fetchImpl })],
    });
    try {
      const listed = await agent.models.list();
      assert.equal(fetches, 0, "a static catalog never fetches");
      assert.ok(listed.some((entry) => entry.model === model.model));
    } finally {
      await agent.dispose();
    }
  });

  it("clinepass_provider_resolves_its_model_without_a_host_provider", async () => {
    const previous = process.env.PRISM_TEST_CLINEPASS_KEY;
    process.env.PRISM_TEST_CLINEPASS_KEY = "prism-test-clinepass-key";
    let url = "";
    const agent = await createAgent({
      model,
      packages: [
        clinepass({
          apiKey: "env:PRISM_TEST_CLINEPASS_KEY",
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
      if (previous === undefined) delete process.env.PRISM_TEST_CLINEPASS_KEY;
      else process.env.PRISM_TEST_CLINEPASS_KEY = previous;
    }
  });

  it("clinepass_key_never_surfaces", async () => {
    const secret = "sk-cline-canary-key-should-not-surface";
    const previous = process.env.PRISM_TEST_CLINEPASS_CANARY;
    process.env.PRISM_TEST_CLINEPASS_CANARY = secret;
    const agent = await createAgent({
      model: { provider: "clinepass", model: model.model },
      packages: [
        clinepass({
          apiKey: "env:PRISM_TEST_CLINEPASS_CANARY",
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
      if (previous === undefined) delete process.env.PRISM_TEST_CLINEPASS_CANARY;
      else process.env.PRISM_TEST_CLINEPASS_CANARY = previous;
    }
  });
});
