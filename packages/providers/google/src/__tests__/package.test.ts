import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgent, type ModelConfig, type ProviderRequest } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import { providerConformance } from "@arnilo/prism/provider-kit";
import googleDefinition, {
  createGoogleGenerateContentProvider,
  createGoogleModelDiscovery,
  GOOGLE_DEFAULT_API_KEY_REF,
  GOOGLE_DEFAULT_BASE_URL,
  google,
  googleModels,
} from "../index.js";

const UNSET_REF = "env:PRISM_TEST_UNSET_GOOGLE_KEY";

const model: ModelConfig = googleModels[0] as ModelConfig;

const request: ProviderRequest = {
  model,
  messages: [
    { role: "system", content: [{ type: "text", text: "instructions" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ],
};

/** Google `streamGenerateContent?alt=sse` frames. */
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
      candidates: [{ content: { parts: [{ text: "hello" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    },
  ]);
}

function discoveryPayload(): Response {
  return new Response(JSON.stringify({ models: [{ name: "models/gemini-discovered", inputTokenLimit: 1_048_576 }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("@arnilo/prism-provider-google package", () => {
  it("google_passes_package_conformance", async () => {
    const result = await packageConformance(googleDefinition, { config: { apiKey: "env:PRISM_TEST_GOOGLE_CONFORMANCE" } });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("google_passes_provider_conformance", async () => {
    const key = "sk-google-canary-key-should-not-surface";
    let captured: Headers | undefined;
    const fetchImpl = (async (_input: unknown, init: RequestInit) => {
      captured = new Headers(init.headers);
      return ok(completion());
    }) as typeof fetch;
    await providerConformance(() => createGoogleGenerateContentProvider({ apiKey: key, fetch: fetchImpl }), {
      request,
      secrets: [key],
      headers: {
        owned: { "content-type": "application/json", "x-goog-api-key": key },
        caller: { "x-goog-api-key": "hijack", "content-type": "text/plain", "x-trace": "1" },
        captured: () => captured,
      },
      expect: { text: "hello" },
    });
  });

  it("google_default_api_key_ref_is_the_vendor_env_var", () => {
    assert.equal(GOOGLE_DEFAULT_API_KEY_REF, "env:GEMINI_API_KEY");
    assert.equal(googleDefinition.config?.properties?.apiKey?.default, GOOGLE_DEFAULT_API_KEY_REF);
    assert.equal(googleDefinition.config?.properties?.apiKey?.["x-prism-secret"], true);
    assert.equal(GOOGLE_DEFAULT_BASE_URL, "https://generativelanguage.googleapis.com/v1beta");
  });

  it("google_missing_key_notes_status_and_still_registers_the_provider", async () => {
    const agent = await createAgent({
      model: { provider: "google", model: model.model },
      packages: [google({ apiKey: UNSET_REF })],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.message === `google: no API key at ${UNSET_REF}`);
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

  it("google_literal_api_key_fails_config_validation", async () => {
    await assert.rejects(
      () => createAgent({ model: { provider: "google", model: model.model }, packages: [google({ apiKey: "gk-literal-value" })] }),
      (error: { code?: string }) => error.code === "secret_literal",
    );
  });

  it("google_package_registers_its_provider_and_setup_does_not_fetch", async () => {
    const previous = process.env.PRISM_TEST_GOOGLE_KEY;
    process.env.PRISM_TEST_GOOGLE_KEY = "prism-test-google-key";
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return ok(completion());
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "google", model: model.model },
      packages: [google({ fetch: fetchImpl, apiKey: "env:PRISM_TEST_GOOGLE_KEY" })],
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
      if (previous === undefined) delete process.env.PRISM_TEST_GOOGLE_KEY;
      else process.env.PRISM_TEST_GOOGLE_KEY = previous;
    }
  });

  it("google_models_lists_through_the_vendor_endpoint_only_when_asked", async () => {
    const previous = process.env.PRISM_TEST_GOOGLE_KEY;
    process.env.PRISM_TEST_GOOGLE_KEY = "prism-test-google-key";
    const urls: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      urls.push(String(input));
      return discoveryPayload();
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "google", model: model.model },
      packages: [google({ apiKey: "env:PRISM_TEST_GOOGLE_KEY", fetch: fetchImpl })],
    });
    try {
      assert.deepEqual(urls, [], "discovery never runs at setup");
      const listed = await agent.models.list();
      assert.deepEqual(urls, [`${GOOGLE_DEFAULT_BASE_URL}/models`]);
      assert.ok(listed.some((entry) => entry.model === "gemini-discovered"));
      assert.ok(listed.some((entry) => entry.model === model.model));
      // A configured catalog short-circuits the network entirely.
      const pinned = await createAgent({
        model: { provider: "google", model: model.model },
        packages: [google({ apiKey: "env:PRISM_TEST_GOOGLE_KEY", fetch: fetchImpl, models: [model] })],
      });
      try {
        urls.length = 0;
        const pinnedList = await pinned.models.list();
        assert.deepEqual(urls, [], "a configured models array must not fetch");
        assert.ok(pinnedList.some((entry) => entry.model === model.model));
      } finally {
        await pinned.dispose();
      }
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_GOOGLE_KEY;
      else process.env.PRISM_TEST_GOOGLE_KEY = previous;
    }
  });

  it("google_provider_resolves_its_model_without_a_host_provider", async () => {
    const previous = process.env.PRISM_TEST_GOOGLE_KEY;
    process.env.PRISM_TEST_GOOGLE_KEY = "prism-test-google-key";
    let url = "";
    const agent = await createAgent({
      model,
      packages: [
        google({
          apiKey: "env:PRISM_TEST_GOOGLE_KEY",
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
      assert.match(url, /\/v1beta\/models\/[^/]+:streamGenerateContent\?alt=sse$/);
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_GOOGLE_KEY;
      else process.env.PRISM_TEST_GOOGLE_KEY = previous;
    }
  });

  it("google_key_never_surfaces", async () => {
    const secret = "sk-google-canary-key-should-not-surface";
    const previous = process.env.PRISM_TEST_GOOGLE_CANARY;
    process.env.PRISM_TEST_GOOGLE_CANARY = secret;
    const agent = await createAgent({
      model: { provider: "google", model: model.model },
      packages: [
        google({
          apiKey: "env:PRISM_TEST_GOOGLE_CANARY",
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
      if (previous === undefined) delete process.env.PRISM_TEST_GOOGLE_CANARY;
      else process.env.PRISM_TEST_GOOGLE_CANARY = previous;
    }
  });

  it("google_exports_the_model_discovery_adapter", async () => {
    const fetchImpl = (async () => discoveryPayload()) as typeof fetch;
    const discovery = createGoogleModelDiscovery({ apiKey: "gk-test", fetch: fetchImpl });
    const result = await discovery.listModels();
    assert.equal(result.provenance.provider, "google");
    assert.equal(result.models[0]?.model, "gemini-discovered");
  });
});
