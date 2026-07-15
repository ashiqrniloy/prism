import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAgent,
  createMemorySessionStore,
  createMockProvider,
  createSecretRedactor,
  providerDone,
  providerTextDelta,
  type AgentConfig,
  type ProviderRequestOptions,
} from "../index.js";

// Compile + runtime fixture for documented 0.0.3 construction, with additive 0.0.4 options.
test("0.0.3 agent construction remains source compatible", async () => {
  const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
  const config: AgentConfig = {
    model: { provider: "mock", model: "demo", capabilities: { structuredOutput: "json_schema" } },
    provider,
    store: createMemorySessionStore(),
    redactor: createSecretRedactor(["compat-secret"]),
    loop: { strategy: "single-shot", toolConcurrency: 2 },
  };
  const options: ProviderRequestOptions = {
    structuredOutput: {
      name: "compat_result",
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      strict: true,
    },
  };

  const session = createAgent(config).createSession({ id: "compat-0-0-3" });
  await session.run("legacy input", { providerOptions: options });
  assert.equal((await session.entries()).at(-1)?.message?.role, "assistant");
});
