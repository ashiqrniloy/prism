import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgent, type ModelConfig, type ProviderRequest } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import { providerConformance } from "@arnilo/prism/provider-kit";
import azureDefinition, {
  AZURE_DEFAULT_CREDENTIAL_REF,
  AZURE_OPENAI_DEFAULT_API_VERSION,
  azure,
  azureChatCompletionsUrl,
  createAzureOpenAIProvider,
} from "../index.js";

const UNSET_REF = "env:PRISM_TEST_UNSET_AZURE_KEY";

const model: ModelConfig = { provider: "azure", model: "gpt-4o" };

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

describe("@arnilo/prism-provider-azure package", () => {
  it("azure_passes_package_conformance", async () => {
    const result = await packageConformance(azureDefinition, {
      config: { resourceName: "demo", deployment: "d1", credential: "env:PRISM_TEST_AZURE_CONFORMANCE" },
    });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("azure_passes_provider_conformance", async () => {
    const key = "sk-azure-canary-key-should-not-surface";
    let captured: Headers | undefined;
    const fetchImpl = (async (_input: unknown, init: RequestInit) => {
      captured = new Headers(init.headers);
      return ok(completion());
    }) as typeof fetch;
    await providerConformance(
      () => createAzureOpenAIProvider({ endpoint: "https://demo.openai.azure.com", deployment: "d1", credential: key, fetch: fetchImpl }),
      {
        request,
        secrets: [key],
        headers: {
          owned: { "content-type": "application/json", authorization: `Bearer ${key}` },
          caller: { authorization: "hijack", "content-type": "text/plain", "x-trace": "1" },
          captured: () => captured,
        },
        expect: { text: "hello" },
      },
    );
  });

  it("azure_default_credential_ref_and_api_version_are_declared", () => {
    assert.equal(AZURE_DEFAULT_CREDENTIAL_REF, "env:AZURE_OPENAI_API_KEY");
    assert.equal(azureDefinition.config?.properties?.credential?.default, AZURE_DEFAULT_CREDENTIAL_REF);
    assert.equal(azureDefinition.config?.properties?.credential?.["x-prism-secret"], true);
    assert.equal(AZURE_OPENAI_DEFAULT_API_VERSION, "2024-10-21");
  });

  it("azure_resource_name_builds_the_public_host", () => {
    assert.equal(
      azureChatCompletionsUrl({ endpoint: "https://demo.openai.azure.com", deployment: "d1" }),
      `https://demo.openai.azure.com/openai/deployments/d1/chat/completions?api-version=${AZURE_OPENAI_DEFAULT_API_VERSION}`,
    );
  });

  it("azure_requires_exactly_one_endpoint_or_resource_name", async () => {
    await assert.rejects(
      () => createAgent({ model, packages: [azure({ endpoint: "https://demo.openai.azure.com", resourceName: "demo" })] }),
      /either endpoint or resourceName/,
    );
    await assert.rejects(() => createAgent({ model, packages: [azure({})] }), /needs resourceName or endpoint/);
  });

  it("azure_missing_credential_notes_status_and_still_registers_the_provider", async () => {
    const agent = await createAgent({
      model,
      packages: [azure({ resourceName: "demo", deployment: "d1", credential: UNSET_REF })],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.message === `azure: no credential at ${UNSET_REF}`);
      assert.equal(notes.length, 1, "a missing credential is a status note, not a failed load");
      assert.equal(notes[0]?.level, "warn");
      const session = await agent.session();
      const result = await session.run("hi");
      assert.equal(result.status, "failed");
      assert.equal((result as { error?: { code?: string } }).error?.code, "credential_unavailable");
    } finally {
      await agent.dispose();
    }
  });

  it("azure_literal_credential_fails_config_validation", async () => {
    await assert.rejects(
      () => createAgent({ model, packages: [azure({ resourceName: "demo", deployment: "d1", credential: "sk-literal-value" })] }),
      (error: { code?: string }) => error.code === "secret_literal",
    );
  });

  it("azure_package_registers_its_provider_and_setup_does_not_fetch", async () => {
    const previous = process.env.PRISM_TEST_AZURE_KEY;
    process.env.PRISM_TEST_AZURE_KEY = "prism-test-azure-key";
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return ok(completion());
    }) as typeof fetch;
    const agent = await createAgent({
      model,
      packages: [azure({ resourceName: "demo", deployment: "d1", credential: "env:PRISM_TEST_AZURE_KEY", fetch: fetchImpl })],
    });
    try {
      assert.equal(fetches, 0, "setup must not fetch");
      const session = await agent.session();
      await session.run("hi").catch(() => undefined);
      assert.ok(fetches > 0, "a run reaches the vendor transport");
      assert.equal(
        agent.inspect().statusNotes.some((note) => note.message.includes("no credential")),
        false,
        "a resolvable ref records no warning",
      );
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_AZURE_KEY;
      else process.env.PRISM_TEST_AZURE_KEY = previous;
    }
  });

  it("azure_models_returns_the_configured_catalog_without_fetching", async () => {
    const previous = process.env.PRISM_TEST_AZURE_KEY;
    process.env.PRISM_TEST_AZURE_KEY = "prism-test-azure-key";
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return ok(completion());
    }) as typeof fetch;
    const agent = await createAgent({
      model,
      packages: [
        azure({
          resourceName: "demo",
          deployment: "d1",
          credential: "env:PRISM_TEST_AZURE_KEY",
          fetch: fetchImpl,
          models: [model],
        }),
      ],
    });
    try {
      const listed = await agent.models.list();
      assert.equal(fetches, 0, "a static catalog never fetches");
      assert.ok(listed.some((entry) => entry.model === model.model));
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_AZURE_KEY;
      else process.env.PRISM_TEST_AZURE_KEY = previous;
    }
  });

  it("azure_provider_resolves_its_model_without_a_host_provider", async () => {
    const previous = process.env.PRISM_TEST_AZURE_KEY;
    process.env.PRISM_TEST_AZURE_KEY = "prism-test-azure-key";
    let url = "";
    const agent = await createAgent({
      model,
      packages: [
        azure({
          resourceName: "demo",
          deployment: "d1",
          credential: "env:PRISM_TEST_AZURE_KEY",
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
      assert.match(url, /^https:\/\/demo\.openai\.azure\.com\/openai\/deployments\/d1\/chat\/completions\?api-version=/);
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_AZURE_KEY;
      else process.env.PRISM_TEST_AZURE_KEY = previous;
    }
  });

  it("azure_api_key_auth_style_sends_the_api_key_header", async () => {
    const previous = process.env.PRISM_TEST_AZURE_KEY;
    process.env.PRISM_TEST_AZURE_KEY = "prism-test-azure-key";
    let captured: Headers | undefined;
    const agent = await createAgent({
      model,
      packages: [
        azure({
          resourceName: "demo",
          deployment: "d1",
          credential: "env:PRISM_TEST_AZURE_KEY",
          authStyle: "api-key",
          fetch: (async (_input, init) => {
            captured = new Headers(init?.headers);
            return ok(completion());
          }) as typeof fetch,
        }),
      ],
    });
    try {
      const session = await agent.session();
      await session.run("hi").catch(() => undefined);
      assert.equal(captured?.get("api-key"), "prism-test-azure-key");
      assert.equal(captured?.get("authorization"), null);
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_AZURE_KEY;
      else process.env.PRISM_TEST_AZURE_KEY = previous;
    }
  });

  it("azure_credential_never_surfaces", async () => {
    const secret = "sk-azure-canary-key-should-not-surface";
    const previous = process.env.PRISM_TEST_AZURE_CANARY;
    process.env.PRISM_TEST_AZURE_CANARY = secret;
    const agent = await createAgent({
      model,
      packages: [
        azure({
          resourceName: "demo",
          deployment: "d1",
          credential: "env:PRISM_TEST_AZURE_CANARY",
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
      if (previous === undefined) delete process.env.PRISM_TEST_AZURE_CANARY;
      else process.env.PRISM_TEST_AZURE_CANARY = previous;
    }
  });
});
