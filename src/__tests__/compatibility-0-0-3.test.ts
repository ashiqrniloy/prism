import assert from "node:assert/strict";
import { test } from "bun:test";
import { type AgentConfig, createAgent, createMemorySessionStore, createSecretRedactor, type ProviderRequestOptions, providerDone, providerTextDelta } from "../index.js";
import { createMockProvider } from "../testing/index.js";
import { providerPackage } from "../provider-kit/index.js";

// Compile + runtime fixture for documented 0.0.3 construction, with additive 0.0.4 options.
test("0.0.3 agent construction remains source compatible", async () => {
  const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
  const config: AgentConfig = {
    model: { provider: "mock", model: "demo", capabilities: { structuredOutput: "json_schema" } },
    packages: [providerPackage("test-provider", [provider])],
    slots: { store: createMemorySessionStore() },
    redactor: createSecretRedactor(["compat-secret"]),
  };
  const options: ProviderRequestOptions = {
    structuredOutput: {
      name: "compat_result",
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      strict: true,
    },
  };

  const session = await (await createAgent(config)).session({ id: "compat-0-0-3", create: true });
  await session.run("legacy input", { providerOptions: options });
  assert.equal((await session.entries()).at(-1)?.message?.role, "assistant");
});
