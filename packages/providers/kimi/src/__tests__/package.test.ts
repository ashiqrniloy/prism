import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgent, type ModelConfig, type ProviderRequest } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import { providerConformance } from "@arnilo/prism/provider-kit";
import kimiDefinition, {
  createKimiCodingProvider,
  KIMI_DEFAULT_API_KEY_REF,
  kimi,
  kimiCodingModels,
  MOONSHOT_DEFAULT_API_KEY_REF,
} from "../index.js";

const UNSET_REF = "env:PRISM_TEST_UNSET_KIMI_KEY";

const model: ModelConfig = kimiCodingModels[0] as ModelConfig;

const request: ProviderRequest = {
  model,
  messages: [
    { role: "system", content: [{ type: "text", text: "instructions" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ],
};

/** Anthropic Messages frames: the Kimi For Coding route speaks the Messages wire. */
function messagesSse(): ReadableStream<Uint8Array> {
  const text =
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n' +
    'data: {"type":"message_stop"}\n\n';
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

describe("@arnilo/prism-provider-kimi package", () => {
  it("kimi_passes_package_conformance", async () => {
    const result = await packageConformance(kimiDefinition, { config: { kimiApiKey: "env:PRISM_TEST_KIMI_CONFORMANCE" } });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("kimi_passes_provider_conformance", async () => {
    const key = "sk-kimi-canary-key-should-not-surface";
    let captured: Headers | undefined;
    const fetchImpl = (async (_input: unknown, init: RequestInit) => {
      captured = new Headers(init.headers);
      return ok(messagesSse());
    }) as typeof fetch;
    await providerConformance(() => createKimiCodingProvider({ apiKey: key, fetch: fetchImpl }), {
      request,
      secrets: [key],
      headers: {
        owned: {
          "content-type": "application/json",
          "user-agent": "KimiCLI/1.5",
          authorization: `Bearer ${key}`,
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        caller: { authorization: "hijack", "x-api-key": "hijack", "content-type": "text/plain", "x-trace": "1" },
        captured: () => captured,
      },
      expect: { text: "hello" },
    });
  });

  it("kimi_default_refs_are_the_two_vendor_env_vars", () => {
    assert.equal(KIMI_DEFAULT_API_KEY_REF, "env:KIMI_API_KEY");
    assert.equal(MOONSHOT_DEFAULT_API_KEY_REF, "env:MOONSHOT_API_KEY");
    const properties = kimiDefinition.config?.properties;
    assert.equal(properties?.kimiApiKey?.default, KIMI_DEFAULT_API_KEY_REF);
    assert.equal(properties?.kimiApiKey?.["x-prism-secret"], true);
    assert.equal(properties?.moonshotApiKey?.default, MOONSHOT_DEFAULT_API_KEY_REF);
    assert.equal(properties?.moonshotApiKey?.["x-prism-secret"], true);
  });

  it("kimi_missing_key_notes_status_and_does_not_fail_create_agent", async () => {
    const agent = await createAgent({
      model: { provider: "kimi-coding", model: model.model },
      packages: [kimi({ kimiApiKey: UNSET_REF })],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.message === `kimi-coding: no API key at ${UNSET_REF}`);
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

  it("kimi_literal_api_key_fails_config_validation", async () => {
    await assert.rejects(
      () => createAgent({ model: { provider: "kimi-coding", model: model.model }, packages: [kimi({ kimiApiKey: "sk-literal-value" })] }),
      (error: { code?: string }) => error.code === "secret_literal",
    );
  });

  it("kimi_registers_kimi_coding_and_optional_moonshot_without_fetching", async () => {
    const previous = process.env.PRISM_TEST_KIMI_KEY;
    process.env.PRISM_TEST_KIMI_KEY = "prism-test-kimi-key";
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return ok(messagesSse());
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "kimi-coding", model: model.model },
      packages: [kimi({ fetch: fetchImpl, kimiApiKey: "env:PRISM_TEST_KIMI_KEY" })],
    });
    try {
      assert.equal(fetches, 0, "setup must not fetch");
      assert.equal(agent.models.resolve("kimi-coding/k3").provider.id, "kimi-coding");
      assert.throws(() => agent.models.resolve("moonshot/kimi-k2.7-code"), /Unknown provider/);
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_KIMI_KEY;
      else process.env.PRISM_TEST_KIMI_KEY = previous;
    }
  });

  it("kimi_coding_models_returns_the_featured_catalog_without_fetching", async () => {
    let fetches = 0;
    const agent = await createAgent({
      model: { provider: "kimi-coding", model: model.model },
      packages: [
        kimi({
          kimiApiKey: "env:PRISM_TEST_KIMI_KEY",
          fetch: (async () => {
            fetches += 1;
            return ok(messagesSse());
          }) as typeof fetch,
        }),
      ],
    });
    try {
      const listed = await agent.models.list();
      assert.equal(fetches, 0, "a static catalog never fetches");
      assert.ok(listed.some((entry) => entry.model === model.model));
    } finally {
      await agent.dispose();
    }
  });

  it("kimi_moonshot_models_lists_through_the_open_platform_endpoint_only_when_asked", async () => {
    const previous = process.env.PRISM_TEST_MOONSHOT_KEY;
    process.env.PRISM_TEST_MOONSHOT_KEY = "prism-test-moonshot-key";
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ object: "list", data: [{ id: "kimi-discovery-probe", object: "model" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "kimi-coding", model: model.model },
      packages: [
        kimi({
          includeMoonshotModels: true,
          kimiApiKey: "env:PRISM_TEST_KIMI_KEY",
          moonshotApiKey: "env:PRISM_TEST_MOONSHOT_KEY",
          fetch: fetchImpl,
        }),
      ],
    });
    try {
      assert.deepEqual(urls, [], "no discovery at setup");
      assert.equal(agent.models.resolve("moonshot/kimi-k2.7-code").provider.id, "moonshot");
      const listed = await agent.models.list();
      assert.deepEqual(urls, ["https://api.moonshot.ai/v1/models"]);
      assert.ok(listed.some((entry) => entry.model === "kimi-discovery-probe"), "the discovered model is listed");
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_MOONSHOT_KEY;
      else process.env.PRISM_TEST_MOONSHOT_KEY = previous;
    }
  });

  it("kimi_provider_resolves_its_model_without_a_host_provider", async () => {
    const previous = process.env.PRISM_TEST_KIMI_KEY;
    process.env.PRISM_TEST_KIMI_KEY = "prism-test-kimi-key";
    let url = "";
    const agent = await createAgent({
      model,
      packages: [
        kimi({
          kimiApiKey: "env:PRISM_TEST_KIMI_KEY",
          fetch: (async (input) => {
            url = String(input);
            return ok(messagesSse());
          }) as typeof fetch,
        }),
      ],
    });
    try {
      const session = await agent.session();
      await session.run("hi").catch(() => undefined);
      assert.match(url, /\/messages$/);
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_KIMI_KEY;
      else process.env.PRISM_TEST_KIMI_KEY = previous;
    }
  });

  it("kimi_key_never_surfaces", async () => {
    const secret = "sk-kimi-canary-key-should-not-surface";
    const previous = process.env.PRISM_TEST_KIMI_CANARY;
    process.env.PRISM_TEST_KIMI_CANARY = secret;
    const agent = await createAgent({
      model: { provider: "kimi-coding", model: model.model },
      packages: [
        kimi({
          kimiApiKey: "env:PRISM_TEST_KIMI_CANARY",
          fetch: (async () => ok(messagesSse())) as typeof fetch,
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
      if (previous === undefined) delete process.env.PRISM_TEST_KIMI_CANARY;
      else process.env.PRISM_TEST_KIMI_CANARY = previous;
    }
  });
});
