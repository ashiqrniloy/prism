import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgent, type ModelConfig, type ProviderRequest } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import { providerConformance } from "@arnilo/prism/provider-kit";
import vertexDefinition, {
  createVertexProvider,
  VERTEX_DEFAULT_CREDENTIAL_REF,
  vertex,
  vertexOpenApiBaseUrl,
} from "../index.js";

const UNSET_REF = "env:PRISM_TEST_UNSET_VERTEX_TOKEN";

const model: ModelConfig = { provider: "vertex", model: "google/gemini-2.5-flash" };

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

describe("@arnilo/prism-provider-vertex package", () => {
  it("vertex_passes_package_conformance", async () => {
    const result = await packageConformance(vertexDefinition, {
      config: { project: "proj-1", location: "us-central1", credential: "env:PRISM_TEST_VERTEX_CONFORMANCE" },
    });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("vertex_passes_provider_conformance", async () => {
    const token = "ya29-vertex-canary-token-should-not-surface";
    let captured: Headers | undefined;
    const fetchImpl = (async (_input: unknown, init: RequestInit) => {
      captured = new Headers(init.headers);
      return ok(completion());
    }) as typeof fetch;
    await providerConformance(
      () => createVertexProvider({ projectId: "proj-1", location: "us-central1", credential: token, fetch: fetchImpl }),
      {
        request,
        secrets: [token],
        headers: {
          owned: { "content-type": "application/json", authorization: `Bearer ${token}` },
          caller: { authorization: "hijack", "content-type": "text/plain", "x-trace": "1" },
          captured: () => captured,
        },
        expect: { text: "hello" },
      },
    );
  });

  it("vertex_default_credential_ref_is_a_secret_ref", () => {
    assert.equal(VERTEX_DEFAULT_CREDENTIAL_REF, "env:PRISM_VERTEX_ACCESS_TOKEN");
    assert.equal(vertexDefinition.config?.properties?.credential?.default, VERTEX_DEFAULT_CREDENTIAL_REF);
    assert.equal(vertexDefinition.config?.properties?.credential?.["x-prism-secret"], true);
  });

  it("vertex_missing_credential_notes_status_and_still_registers_the_provider", async () => {
    const agent = await createAgent({
      model,
      packages: [vertex({ project: "proj-1", location: "us-central1", credential: UNSET_REF })],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.message === `vertex: no credential at ${UNSET_REF}`);
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

  it("vertex_literal_credential_fails_config_validation", async () => {
    await assert.rejects(
      () =>
        createAgent({
          model,
          packages: [vertex({ project: "proj-1", location: "us-central1", credential: "ya29-literal-value" })],
        }),
      (error: { code?: string }) => error.code === "secret_literal",
    );
  });

  it("vertex_requires_project_and_location", async () => {
    await assert.rejects(() => createAgent({ model, packages: [vertex({ location: "us-central1" })] }), /config needs project/);
    await assert.rejects(() => createAgent({ model, packages: [vertex({ project: "proj-1" })] }), /config needs location/);
  });

  it("vertex_rejects_a_non_https_endpoint_before_any_request", async () => {
    await assert.rejects(
      () => createAgent({ model, packages: [vertex({ project: "proj-1", location: "us-central1", endpoint: "http://vpc.local" })] }),
      /https/,
    );
  });

  it("vertex_package_registers_its_provider_and_setup_does_not_fetch", async () => {
    const previous = process.env.PRISM_TEST_VERTEX_TOKEN;
    process.env.PRISM_TEST_VERTEX_TOKEN = "ya29-test-token";
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return ok(completion());
    }) as typeof fetch;
    const agent = await createAgent({
      model,
      packages: [vertex({ project: "proj-1", location: "us-central1", credential: "env:PRISM_TEST_VERTEX_TOKEN", fetch: fetchImpl })],
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
      if (previous === undefined) delete process.env.PRISM_TEST_VERTEX_TOKEN;
      else process.env.PRISM_TEST_VERTEX_TOKEN = previous;
    }
  });

  it("vertex_models_returns_the_configured_catalog_without_fetching", async () => {
    const previous = process.env.PRISM_TEST_VERTEX_TOKEN;
    process.env.PRISM_TEST_VERTEX_TOKEN = "ya29-test-token";
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return ok(completion());
    }) as typeof fetch;
    const agent = await createAgent({
      model,
      packages: [
        vertex({
          project: "proj-1",
          location: "us-central1",
          credential: "env:PRISM_TEST_VERTEX_TOKEN",
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
      if (previous === undefined) delete process.env.PRISM_TEST_VERTEX_TOKEN;
      else process.env.PRISM_TEST_VERTEX_TOKEN = previous;
    }
  });

  it("vertex_provider_resolves_its_model_without_a_host_provider", async () => {
    const previous = process.env.PRISM_TEST_VERTEX_TOKEN;
    process.env.PRISM_TEST_VERTEX_TOKEN = "ya29-test-token";
    let url = "";
    const agent = await createAgent({
      model,
      packages: [
        vertex({
          project: "proj-1",
          location: "us-central1",
          credential: "env:PRISM_TEST_VERTEX_TOKEN",
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
      assert.equal(
        url,
        `${vertexOpenApiBaseUrl({ projectId: "proj-1", location: "us-central1" })}/chat/completions`,
      );
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_VERTEX_TOKEN;
      else process.env.PRISM_TEST_VERTEX_TOKEN = previous;
    }
  });

  it("vertex_credential_never_surfaces", async () => {
    const secret = "ya29-vertex-canary-token-should-not-surface";
    const previous = process.env.PRISM_TEST_VERTEX_CANARY;
    process.env.PRISM_TEST_VERTEX_CANARY = secret;
    const agent = await createAgent({
      model,
      packages: [
        vertex({
          project: "proj-1",
          location: "us-central1",
          credential: "env:PRISM_TEST_VERTEX_CANARY",
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
      if (previous === undefined) delete process.env.PRISM_TEST_VERTEX_CANARY;
      else process.env.PRISM_TEST_VERTEX_CANARY = previous;
    }
  });
});
