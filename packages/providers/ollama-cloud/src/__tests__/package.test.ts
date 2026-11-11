import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, type ModelConfig, type ProviderRequest } from "@arnilo/prism";
import { providerConformance } from "@arnilo/prism/provider-kit";
import { packageConformance } from "@arnilo/prism/testing";
import ollamaCloudDefinition, {
  createOllamaCloudProvider,
  OLLAMA_CLOUD_DEFAULT_API_KEY_REF,
  ollamaCloud,
  ollamaCloudModels,
} from "../index.js";

const UNSET_REF = "env:PRISM_TEST_UNSET_OLLAMA_CLOUD_KEY";
const model: ModelConfig = ollamaCloudModels[0]!;

const request: ProviderRequest = {
  model,
  messages: [
    { role: "system", content: [{ type: "text", text: "instructions" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ],
  options: { sessionId: "sess-1" },
};

function completion(): Response {
  return new Response(
    '{"model":"gemma4:31b","message":{"role":"assistant","content":"hello"},"done":true,"done_reason":"stop","prompt_eval_count":1,"prompt_eval_cached_count":0,"eval_count":1}\n',
    { headers: { "content-type": "application/x-ndjson" } },
  );
}

describe("@arnilo/prism-ai/ollama-cloud package", () => {
  it("ollama-cloud_passes_package_conformance", async () => {
    const result = await packageConformance(ollamaCloudDefinition, {
      config: { apiKey: "env:PRISM_TEST_OLLAMA_CLOUD_CONFORMANCE" },
    });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("ollama-cloud_passes_provider_conformance", async () => {
    const key = "sk-ollama-cloud-conformance-canary";
    let captured: Headers | undefined;
    const fetchImpl = (async (_input: unknown, init: RequestInit) => {
      captured = new Headers(init.headers);
      return completion();
    }) as typeof fetch;
    const result = await providerConformance(() => createOllamaCloudProvider({ apiKey: async () => key, fetch: fetchImpl }), {
      request,
      secrets: [key],
      headers: {
        owned: { "content-type": "application/json", authorization: `Bearer ${key}` },
        caller: { authorization: "hijack", "content-type": "text/plain", "x-trace": "1" },
        captured: () => captured,
      },
      expect: { text: "hello" },
    });
    assert.equal(result.ok, true);
  });

  it("ollama_cloud_passes_recorded_conformance", async () => {
    const key = "sk-ollama-cloud-recorded-canary";
    const result = await providerConformance((fetchImpl) => createOllamaCloudProvider({ apiKey: async () => key, fetch: fetchImpl }), {
      recordings: new URL("./wire/", import.meta.url),
      models: ollamaCloudModels,
      secrets: [key],
    });
    assert.equal(result.ok, true);
  });

  it("ollama-cloud_default_api_key_ref_is_the_vendor_env_var", () => {
    assert.equal(OLLAMA_CLOUD_DEFAULT_API_KEY_REF, "env:OLLAMA_API_KEY");
    assert.equal(ollamaCloudDefinition.config?.properties?.apiKey?.default, OLLAMA_CLOUD_DEFAULT_API_KEY_REF);
    assert.equal(ollamaCloudDefinition.config?.properties?.apiKey?.["x-prism-secret"], true);
    assert.equal(ollamaCloudDefinition.config?.properties?.route?.default, "native");
  });

  it("ollama_missing_key_notes_and_registers", async () => {
    const agent = await createAgent({
      model: { provider: "ollama-cloud", model: model.model },
      packages: [ollamaCloud({ apiKey: UNSET_REF })],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.message === `ollama-cloud: no API key at ${UNSET_REF}`);
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

  it("ollama-cloud_literal_api_key_fails_config_validation", async () => {
    await assert.rejects(
      () =>
        createAgent({ model: { provider: "ollama-cloud", model: model.model }, packages: [ollamaCloud({ apiKey: "sk-literal-value" })] }),
      (error: { code?: string }) => error.code === "secret_literal",
    );
  });

  it("ollama_cloud_setup_does_not_fetch_and_models_lists_on_demand", async () => {
    const previous = process.env.PRISM_TEST_OLLAMA_CLOUD_KEY;
    process.env.PRISM_TEST_OLLAMA_CLOUD_KEY = "prism-test-ollama-cloud-key";
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      if (String(input).endsWith("/api/tags")) {
        return new Response(
          JSON.stringify({ models: [{ model: "gemma4:31b", capabilities: ["completion", "tools", "thinking", "vision"] }] }),
          {
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response(
        JSON.stringify({ capabilities: ["completion", "tools", "thinking", "vision"], model_info: { "gemma4.context_length": 262_144 } }),
        { headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "ollama-cloud", model: model.model },
      packages: [ollamaCloud({ fetch: fetchImpl, apiKey: "env:PRISM_TEST_OLLAMA_CLOUD_KEY" })],
    });
    try {
      assert.deepEqual(urls, [], "setup must not fetch");
      const listed = await agent.models.list();
      assert.deepEqual(urls, ["https://ollama.com/api/tags", "https://ollama.com/api/show"]);
      assert.ok(listed.some((entry) => entry.model === "gemma4:31b" && entry.limits?.contextWindow === 262_144));
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_OLLAMA_CLOUD_KEY;
      else process.env.PRISM_TEST_OLLAMA_CLOUD_KEY = previous;
    }
  });
});
