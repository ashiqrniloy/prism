import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgent, type JsonObject, type ModelConfig, type ProviderRequest } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import { collectProviderEvents, providerConformance } from "@arnilo/prism/provider-kit";
import layaDefinition, { laya, createLayaProvider, layaModels, LAYA_DEFAULT_API_KEY_REF } from "../index.js";

const UNSET_REF = "env:PRISM_TEST_UNSET_LAYA_KEY";

const model: ModelConfig = layaModels[0] as ModelConfig;

const schema: JsonObject = {
  type: "object",
  properties: { verdict: { type: "string", enum: ["run", "reject"], description: "How should this be handled?" } },
};

const OK_RESPONSE = {
  model: "laya-router-picked",
  answers: { verdict: { type: "choice", choice: "reject" } },
  usage: { input_tokens: 12, output_tokens: 4 },
};

const request: ProviderRequest = {
  model,
  messages: [
    { role: "system", content: [{ type: "text", text: "instructions" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ],
  options: { structuredOutput: { name: "decision", schema } },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function ok(_body?: unknown): Response {
  return jsonResponse(OK_RESPONSE);
}

function completion(): Response {
  return jsonResponse(OK_RESPONSE);
}

describe("@arnilo/prism-provider-laya package", () => {
  it("laya_passes_package_conformance", async () => {
    const result = await packageConformance(layaDefinition, { config: { apiKey: "env:PRISM_TEST_LAYA_CONFORMANCE" } });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("laya_passes_provider_conformance", async () => {
    const key = "sk-laya-canary-key-should-not-surface";
    let captured: Headers | undefined;
    const fetchImpl = (async (_input: unknown, init: RequestInit) => {
      captured = new Headers(init.headers);
      return ok(completion());
    }) as typeof fetch;
    await providerConformance(() => createLayaProvider({ apiKey: async () => key, fetch: fetchImpl }), {
      request,
      secrets: [key],
      headers: {
        owned: { "content-type": "application/json", authorization: `Bearer ${key}` },
        // The System One wire is not caller-header configurable: it sets content-type + bearer only,
        // so there is no non-owned caller header to forward.
        caller: {},
        captured: () => captured,
      },
    });
  });

  it("laya_default_api_key_ref_is_the_vendor_env_var", () => {
    assert.equal(LAYA_DEFAULT_API_KEY_REF, "env:LAYA_API_KEY");
    assert.equal(layaDefinition.config?.properties?.apiKey?.default, LAYA_DEFAULT_API_KEY_REF);
    assert.equal(layaDefinition.config?.properties?.apiKey?.["x-prism-secret"], true);
  });

  it("laya_without_key_sends_no_auth_and_notes_nothing", async () => {
    let capturedAuth: string | null = "initial";
    const agent = await createAgent({
      model: { provider: "laya", model: model.model },
      packages: [
        laya({
          apiKey: UNSET_REF,
          fetch: (async (_input: unknown, init?: RequestInit) => {
            capturedAuth = new Headers(init?.headers).get("authorization");
            return ok(completion());
          }) as typeof fetch,
        }),
      ],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.message.includes("no API key"));
      assert.equal(notes.length, 0, "a missing key notes nothing for Laya");
      // Registration and the curated catalog must not depend on the credential.
      const listed = await agent.models.list();
      assert.ok(listed.some((entry) => entry.model === model.model), "the catalog still lists");

      const events = await collectProviderEvents(createLayaProvider({
        fetch: (async (_input: unknown, init?: RequestInit) => {
          capturedAuth = new Headers(init?.headers).get("authorization");
          return ok(completion());
        }) as typeof fetch,
      }), request);
      assert.equal(capturedAuth, null, "sends no authorization header without key");
      assert.equal(events.at(-1)?.type, "done");
    } finally {
      await agent.dispose();
    }
  });


  it("laya_literal_api_key_fails_config_validation", async () => {
    await assert.rejects(
      () => createAgent({ model: { provider: "laya", model: model.model }, packages: [laya({ apiKey: "sk-literal-value" })] }),
      (error: { code?: string }) => error.code === "secret_literal",
    );
  });

  it("laya_package_registers_its_provider_and_setup_does_not_fetch", async () => {
    const previous = process.env.PRISM_TEST_LAYA_KEY;
    process.env.PRISM_TEST_LAYA_KEY = "prism-test-laya-key";
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return ok(completion());
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "laya", model: model.model },
      packages: [laya({ fetch: fetchImpl, apiKey: "env:PRISM_TEST_LAYA_KEY" })],
    });
    try {
      // Setup resolves the ref (an env read) but never talks to the wire; discovery is caller-gated.
      assert.equal(fetches, 0, "setup must not fetch");
      const session = await agent.session();
      await session.run("hi").catch(() => undefined);
      assert.equal(fetches, 0, "a decision model fails its gates before any fetch");
      assert.equal(
        agent.inspect().statusNotes.some((note) => note.message.includes("no API key")),
        false,
        "a resolvable ref records no warning",
      );
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_LAYA_KEY;
      else process.env.PRISM_TEST_LAYA_KEY = previous;
    }
  });

  it("laya_models_returns_the_curated_catalog_without_fetching", async () => {
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return ok();
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "laya", model: model.model },
      packages: [laya({ apiKey: "env:PRISM_TEST_LAYA_KEY", fetch: fetchImpl })],
    });
    try {
      const listed = await agent.models.list();
      assert.equal(fetches, 0, "a curated catalog never fetches");
      assert.ok(listed.some((entry) => entry.model === model.model));
    } finally {
      await agent.dispose();
    }
  });

  it("laya_provider_resolves_its_model_without_a_host_provider", async () => {
    const previous = process.env.PRISM_TEST_LAYA_KEY;
    process.env.PRISM_TEST_LAYA_KEY = "prism-test-laya-key";
    let url = "";
    const fetchImpl = (async (input: unknown) => {
      url = String(input);
      return ok(completion());
    }) as typeof fetch;
    const agent = await createAgent({
      model,
      packages: [laya({ apiKey: "env:PRISM_TEST_LAYA_KEY", fetch: fetchImpl })],
    });
    try {
      // The package registered the provider under the model's own id, so a session run reaches it
      // instead of failing with `Unknown provider`.
      const session = await agent.session();
      const result = await session.run("hi");
      assert.equal(result.status, "failed");
      assert.doesNotMatch(String((result as { error?: { message?: string } }).error?.message), /Unknown provider/);
      // A decision request (the only shape this vendor serves) reaches the vendor transport with a key
      // read from the same ref the package resolves.
      const events = await collectProviderEvents(
        createLayaProvider({ apiKey: async () => process.env.PRISM_TEST_LAYA_KEY, fetch: fetchImpl }),
        request,
      );
      assert.match(url, /\/v1\/systemone$/);
      assert.equal(events.at(-1)?.type, "done");
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_LAYA_KEY;
      else process.env.PRISM_TEST_LAYA_KEY = previous;
    }
  });
  it("laya_key_never_surfaces", async () => {
    const secret = "sk-laya-canary-key-should-not-surface";
    const previous = process.env.PRISM_TEST_LAYA_CANARY;
    process.env.PRISM_TEST_LAYA_CANARY = secret;
    const agent = await createAgent({
      model: { provider: "laya", model: model.model },
      packages: [
        laya({
          apiKey: "env:PRISM_TEST_LAYA_CANARY",
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
      if (previous === undefined) delete process.env.PRISM_TEST_LAYA_CANARY;
      else process.env.PRISM_TEST_LAYA_CANARY = previous;
    }
  });
});
