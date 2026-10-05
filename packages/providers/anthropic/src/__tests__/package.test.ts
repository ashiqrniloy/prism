import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgent } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import type { ModelConfig } from "@arnilo/prism";
import anthropicDefinition, { ANTHROPIC_DEFAULT_API_KEY_REF, anthropic, anthropicModels } from "../index.js";

const UNSET_REF = "env:PRISM_TEST_UNSET_ANTHROPIC_KEY";

describe("@arnilo/prism-provider-anthropic package", () => {
  it("anthropic_passes_package_conformance", async () => {
    const result = await packageConformance(anthropicDefinition, { config: { apiKey: "env:PRISM_TEST_ANTHROPIC_CONFORMANCE" } });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("anthropic_default_api_key_ref_is_the_vendor_env_var", () => {
    assert.equal(ANTHROPIC_DEFAULT_API_KEY_REF, "env:ANTHROPIC_API_KEY");
    assert.equal(anthropicDefinition.config?.properties?.apiKey?.default, ANTHROPIC_DEFAULT_API_KEY_REF);
    assert.equal(anthropicDefinition.config?.properties?.apiKey?.["x-prism-secret"], true);
  });

  it("anthropic_missing_key_notes_status_and_does_not_fail_create_agent", async () => {
    const agent = await createAgent({
      model: { provider: "anthropic", model: "claude-haiku-4-5" },
      packages: [anthropic({ apiKey: UNSET_REF })],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.message === `anthropic: no API key at ${UNSET_REF}`);
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

  it("anthropic_literal_api_key_fails_config_validation", async () => {
    await assert.rejects(
      () => createAgent({ model: { provider: "anthropic", model: "m" }, packages: [anthropic({ apiKey: "sk-ant-literal" })] }),
      (error: { code?: string }) => error.code === "secret_literal",
    );
  });

  it("anthropic_package_registers_its_provider_and_setup_does_not_fetch", async () => {
    const previous = process.env.PRISM_TEST_ANTHROPIC_KEY;
    process.env.PRISM_TEST_ANTHROPIC_KEY = "prism-test-anthropic-key";
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "anthropic", model: "claude-haiku-4-5" },
      packages: [anthropic({ fetch: fetchImpl, apiKey: "env:PRISM_TEST_ANTHROPIC_KEY" })],
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
      if (previous === undefined) delete process.env.PRISM_TEST_ANTHROPIC_KEY;
      else process.env.PRISM_TEST_ANTHROPIC_KEY = previous;
    }
  });

  it("anthropic_models_lists_through_the_vendor_endpoint_only_when_asked", async () => {
    const previous = process.env.PRISM_TEST_ANTHROPIC_KEY;
    process.env.PRISM_TEST_ANTHROPIC_KEY = "prism-test-anthropic-key";
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ data: [{ id: "claude-sonnet-5", display_name: "Sonnet 5" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const agent = await createAgent({
      model: { provider: "anthropic", model: "claude-haiku-4-5" },
      packages: [anthropic({ fetch: fetchImpl, apiKey: "env:PRISM_TEST_ANTHROPIC_KEY" })],
    });
    try {
      assert.deepEqual(urls, [], "no discovery at setup");
      const listed = await agent.models.list();
      assert.deepEqual(urls, ["https://api.anthropic.com/v1/models"]);
      assert.ok(listed.some((model) => model.model === "claude-sonnet-5"));
      assert.ok(listed.some((model) => model.model === "claude-haiku-4-5"), "the configured model is always listed");
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_ANTHROPIC_KEY;
      else process.env.PRISM_TEST_ANTHROPIC_KEY = previous;
    }
  });

  it("anthropic_provider_resolves_its_model_without_a_host_provider", async () => {
    const previous = process.env.PRISM_TEST_ANTHROPIC_KEY;
    process.env.PRISM_TEST_ANTHROPIC_KEY = "prism-test-anthropic-key";
    let url = "";
    const agent = await createAgent({
      model: anthropicModels[0] as ModelConfig,
      packages: [
        anthropic({
          apiKey: "env:PRISM_TEST_ANTHROPIC_KEY",
          fetch: (async (input) => {
            url = String(input);
            return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
          }) as typeof fetch,
        }),
      ],
    });
    try {
      const session = await agent.session();
      await session.run("hi").catch(() => undefined);
      assert.match(url, /anthropic\.com/);
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env.PRISM_TEST_ANTHROPIC_KEY;
      else process.env.PRISM_TEST_ANTHROPIC_KEY = previous;
    }
  });

  it("anthropic_key_never_surfaces", async () => {
    const secret = "sk-ant-api03-real-looking-key-should-not-surface";
    const previous = process.env.PRISM_TEST_ANTHROPIC_CANARY;
    process.env.PRISM_TEST_ANTHROPIC_CANARY = secret;
    const agent = await createAgent({
      model: { provider: "anthropic", model: "claude-haiku-4-5" },
      packages: [
        anthropic({
          apiKey: "env:PRISM_TEST_ANTHROPIC_CANARY",
          fetch: (async () => new Response("data: [DONE]\n\n", { status: 200 })) as typeof fetch,
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
      if (previous === undefined) delete process.env.PRISM_TEST_ANTHROPIC_CANARY;
      else process.env.PRISM_TEST_ANTHROPIC_CANARY = previous;
    }
  });
});
