import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, definePackage, type JsonObject, type ModelConfig, type ProviderRequest } from "@arnilo/prism";
import { collectProviderEvents, providerConformance } from "@arnilo/prism/provider-kit";
import { packageConformance } from "@arnilo/prism/testing";
import liquidDefinition, {
  createLiquidLocalProvider,
  createLiquidProvider,
  LIQUID_DEFAULT_API_KEY_REF,
  liquid,
  liquidLocalModels,
  liquidModels,
} from "../index.js";

const UNSET_REF = "env:PRISM_TEST_UNSET_LIQUID_KEY";

const model: ModelConfig = liquidModels[0] as ModelConfig;

const schema: JsonObject = {
  type: "object",
  properties: { verdict: { type: "string", enum: ["run", "reject", "ask"], description: "How should this be handled?" } },
};

const OK_RESPONSE = {
  model: "d1.1",
  answers: { verdict: { type: "choice", choice: "ask", probabilities: { ask: 0.84 }, confidence: 0.68 } },
  usage: { input_tokens: 96, output_tokens: 0 },
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

describe("@arnilo/prism-ai/liquid package", () => {
  it("liquid_passes_package_conformance", async () => {
    const result = await packageConformance(liquidDefinition, { config: { apiKey: "env:PRISM_TEST_LIQUID_CONFORMANCE" } });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("liquid_passes_provider_conformance", async () => {
    const key = "sk-liquid-canary-key-should-not-surface";
    let captured: Headers | undefined;
    const fetchImpl = (async (_input: unknown, init: RequestInit) => {
      captured = new Headers(init.headers);
      return ok();
    }) as typeof fetch;
    await providerConformance(() => createLiquidProvider({ apiKey: async () => key, fetch: fetchImpl }), {
      request,
      secrets: [key],
      headers: {
        owned: { "content-type": "application/json", authorization: `Bearer ${key}` },
        // The System One wire is not caller-header configurable: it sets content-type + bearer only.
        caller: {},
        captured: () => captured,
      },
    });
  });

  it("liquid_default_api_key_ref_is_the_vendor_env_var", () => {
    assert.equal(LIQUID_DEFAULT_API_KEY_REF, "env:LIQUID_API_KEY");
    assert.equal(liquidDefinition.config?.properties?.apiKey?.default, LIQUID_DEFAULT_API_KEY_REF);
    assert.equal(liquidDefinition.config?.properties?.apiKey?.["x-prism-secret"], true);
    assert.equal(liquidDefinition.config?.properties?.localApiKey?.["x-prism-secret"], true);
    assert.equal(liquidDefinition.config?.properties?.localApiKey?.default, undefined, "the local key is optional");
  });

  it("liquid_hosted_missing_key_notes_warn_and_still_lists_catalog", async () => {
    const agent = await createAgent({
      model: { provider: "liquid", model: model.model },
      packages: [liquid({ apiKey: UNSET_REF })],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.message === `liquid: no API key at ${UNSET_REF}`);
      assert.equal(notes.length, 1, "a missing hosted key is a status note, not a failed load");
      assert.equal(notes[0]?.level, "warn");
      const listed = await agent.models.list();
      assert.ok(listed.some((entry) => entry.provider === "liquid" && entry.model === model.model));
      assert.ok(listed.some((entry) => entry.provider === "liquid-local" && entry.model === liquidLocalModels[0]!.model));

      const session = await agent.session();
      const result = await session.run("hi");
      assert.equal(result.status, "failed");
      const message = String((result as { error?: { message?: string } }).error?.message);
      assert.match(message, /options\.structuredOutput/);
      assert.doesNotMatch(message, /Unknown provider/);
    } finally {
      await agent.dispose();
    }
  });

  it("liquid_local_sends_no_authorization_without_key", async () => {
    let capturedAuth: string | null = "initial";
    const provider = createLiquidLocalProvider({
      fetch: (async (_input: unknown, init?: RequestInit) => {
        capturedAuth = new Headers(init?.headers).get("authorization");
        return ok();
      }) as typeof fetch,
    });
    const events = await collectProviderEvents(provider, request);
    assert.equal(capturedAuth, null, "the local provider sends no authorization header without a key");
    assert.equal(events.at(-1)?.type, "done");
  });

  it("liquid_local_sends_bearer_with_local_api_key", async () => {
    const previous = process.env.PRISM_TEST_LIQUID_LOCAL_KEY;
    process.env.PRISM_TEST_LIQUID_LOCAL_KEY = "local-llama-key";
    let capturedAuth: string | null = null;
    let url = "";
    let api: any;
    const user = definePackage<any>({
      name: "@acme/liquid-local-probe",
      version: "1.0.0",
      requires: { api: 1 },
      setup: (a) => void (api = a),
      capabilities: ["models"],
    });
    const agent = await createAgent({
      model: { provider: "liquid-local", model: liquidLocalModels[0]!.model },
      packages: [
        liquid({
          hosted: false,
          localApiKey: "env:PRISM_TEST_LIQUID_LOCAL_KEY",
          fetch: (async (input: unknown, init?: RequestInit) => {
            url = String(input);
            capturedAuth = new Headers(init?.headers).get("authorization");
            return ok();
          }) as typeof fetch,
        }),
        user,
      ],
    });
    try {
      await api.models.decisions("liquid-local/d1-3B").decide({
        questions: { verdict: { type: "choice", instructions: "How?", criteria: { run: null, reject: null } } },
      });
      assert.equal(capturedAuth, "Bearer local-llama-key");
      assert.equal(url, "http://127.0.0.1:8080/v1/systemone");
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_LIQUID_LOCAL_KEY;
      else process.env.PRISM_TEST_LIQUID_LOCAL_KEY = previous;
    }
  });

  it("liquid_hosted_false_registers_only_local", async () => {
    const agent = await createAgent({
      model: { provider: "liquid-local", model: liquidLocalModels[0]!.model },
      packages: [liquid({ hosted: false, apiKey: UNSET_REF })],
    });
    try {
      const providers = new Set((await agent.models.list()).map((entry) => entry.provider));
      assert.deepEqual([...providers], ["liquid-local"]);
      assert.equal(
        agent.inspect().statusNotes.some((note) => note.message.includes("no API key")),
        false,
        "a local-only setup notes nothing about the hosted key",
      );
    } finally {
      await agent.dispose();
    }
  });

  it("liquid_rejects_literal_key", async () => {
    await assert.rejects(
      () => createAgent({ model: { provider: "liquid", model: model.model }, packages: [liquid({ apiKey: "sk-literal-value" })] }),
      (error: { code?: string }) => error.code === "secret_literal",
    );
  });

  it("liquid_unknown_config_field_fails_validation", async () => {
    await assert.rejects(
      () =>
        createAgent({
          model: { provider: "liquid", model: model.model },
          packages: [liquid({ unknownField: true } as never)],
        }),
      (error: { code?: string }) => error.code === "config_unknown_key",
    );
  });

  it("liquid_secret_never_surfaces_in_events_inspect_or_errors", async () => {
    const secret = "sk-liquid-canary-key-should-not-surface";
    const previous = process.env.PRISM_TEST_LIQUID_CANARY;
    process.env.PRISM_TEST_LIQUID_CANARY = secret;
    const agent = await createAgent({
      model: { provider: "liquid", model: model.model },
      packages: [
        liquid({
          apiKey: "env:PRISM_TEST_LIQUID_CANARY",
          fetch: (async () => ok()) as typeof fetch,
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
      if (previous === undefined) delete process.env.PRISM_TEST_LIQUID_CANARY;
      else process.env.PRISM_TEST_LIQUID_CANARY = previous;
    }
  });
});
