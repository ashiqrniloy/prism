import { test } from "bun:test";
import assert from "node:assert/strict";
import { defineAgent } from "@arnilo/prism-agent-sdk";
import {
  applyFlagOverlay,
  autoDetectProvider,
  hasUsableProvider,
  MemoryStoredCredentialStore,
  type PrismCodeConfig,
  PrismCodeCredentialManager,
  PrismCodeExecutionError,
  parseFlags,
  resolveProvider,
} from "../index.js";

test("parseFlags extracts flags, options, and subcommands", () => {
  const flags = parseFlags([
    "-p",
    "inspect codebase",
    "--mode=print",
    "--config",
    "custom.json",
    "--session",
    "sess-123",
    "--model",
    "anthropic/claude-sonnet-4-5",
    "--no-agents-md",
  ]);

  assert.equal(flags.prompt, "inspect codebase");
  assert.equal(flags.mode, "print");
  assert.equal(flags.config, "custom.json");
  assert.equal(flags.session, "sess-123");
  assert.equal(flags.model, "anthropic/claude-sonnet-4-5");
  assert.equal(flags.noAgentsMd, true);
  assert.equal(flags.noSystemMd, false);
});

test("parseFlags handles acp subcommand", () => {
  const flags = parseFlags(["acp", "--config", "agent.json"]);
  assert.equal(flags.subcommand, "acp");
  assert.equal(flags.mode, "acp");
  assert.equal(flags.config, "agent.json");
});

test("parseFlags treats first positional argument as prompt if -p omitted", () => {
  const flags = parseFlags(["hello world", "--mode", "json"]);
  assert.equal(flags.prompt, "hello world");
  assert.equal(flags.mode, "json");
});

test("applyFlagOverlay overrides config values", () => {
  const baseConfig: PrismCodeConfig = {
    cwd: "/workspace",
    model: { provider: "openai", model: "gpt-4o" },
    instructions: {
      agentsMd: true,
      systemMd: true,
    },
  };

  const flags = parseFlags(["--model", "anthropic/claude-3-7-sonnet", "--no-agents-md"]);

  const overlaid = applyFlagOverlay(baseConfig, flags);

  assert.equal(overlaid.model?.provider, "anthropic");
  assert.equal(overlaid.model?.model, "claude-3-7-sonnet");
  assert.equal(overlaid.instructions?.agentsMd, false);
  assert.equal(overlaid.instructions?.systemMd, true);
});

test("hasUsableProvider identifies missing credentials vs mock/ollama", async () => {
  // Empty config -> false
  assert.equal(await hasUsableProvider({}), false);

  // Mock provider -> always usable
  assert.equal(await hasUsableProvider({ model: { provider: "mock", model: "test" } }), true);

  // Ollama -> always usable without api key
  assert.equal(await hasUsableProvider({ model: { provider: "ollama", model: "llama3" } }), true);

  // Anthropic without key in resolver -> false
  assert.equal(
    await hasUsableProvider({ model: { provider: "anthropic", model: "claude-sonnet-4-5" } }, { resolver: () => undefined }),
    false,
  );

  // Anthropic with key in resolver -> true
  assert.equal(
    await hasUsableProvider(
      { model: { provider: "anthropic", model: "claude-sonnet-4-5" } },
      {
        resolver: (ref) => (ref === "ANTHROPIC_API_KEY" ? "sk-ant-test" : undefined),
      },
    ),
    true,
  );

  // Custom credentialRef
  assert.equal(
    await hasUsableProvider(
      {
        model: { provider: "anthropic", model: "claude-sonnet-4-5" },
        credentialRef: "MY_CUSTOM_SECRET",
      },
      { resolver: (ref) => (ref === "MY_CUSTOM_SECRET" ? "secret-value" : undefined) },
    ),
    true,
  );
});

test("a stored key makes the provider usable and constructible without env vars", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const manager = new PrismCodeCredentialManager({ store: new MemoryStoredCredentialStore() });
    await manager.setApiKey("anthropic", "sk-ant-stored-only");
    const config = { model: { provider: "anthropic", model: "claude-sonnet-4-5" } };

    assert.equal(await hasUsableProvider(config, { credentialManager: manager }), true);
    const provider = await resolveProvider(config.model, { credentialManager: manager });
    assert.equal(provider.id, "anthropic");
  } finally {
    if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
  }
});

test("env auto-detection follows descriptor priority order and picks the catalog default", async () => {
  const manager = new PrismCodeCredentialManager({ disableKeychain: true });
  const saved = { ...process.env };
  try {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.XAI_API_KEY = "xai-test-key";
    process.env.OPENAI_API_KEY = "openai-test-key";

    const detected = await autoDetectProvider(manager);
    assert.equal(detected?.provider, "openai");
    assert.equal(detected?.model, "gpt-5.1");

    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
    const higher = await autoDetectProvider(manager);
    assert.equal(higher?.provider, "anthropic");
    assert.equal(higher?.model, "claude-sonnet-5");
  } finally {
    for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY"]) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("resolveProvider fails closed on a missing Azure endpoint and Bedrock AWS credentials", async () => {
  const savedEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const savedAccessKey = process.env.AWS_ACCESS_KEY_ID;
  const savedSecret = process.env.AWS_SECRET_ACCESS_KEY;
  try {
    delete process.env.AZURE_OPENAI_ENDPOINT;
    process.env.AZURE_OPENAI_API_KEY = "azure-resource-key";
    await assert.rejects(() => resolveProvider({ provider: "azure", model: "gpt-5.1" }), /AZURE_OPENAI_ENDPOINT/);

    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    await assert.rejects(() => resolveProvider({ provider: "bedrock", model: "x" }), /Bedrock requires AWS credentials/);
  } finally {
    if (savedEndpoint !== undefined) process.env.AZURE_OPENAI_ENDPOINT = savedEndpoint;
    else delete process.env.AZURE_OPENAI_ENDPOINT;
    delete process.env.AZURE_OPENAI_API_KEY;
    if (savedAccessKey !== undefined) process.env.AWS_ACCESS_KEY_ID = savedAccessKey;
    if (savedSecret !== undefined) process.env.AWS_SECRET_ACCESS_KEY = savedSecret;
  }
});

test("resolveProvider fails closed when explicit credentialRef is not found", async () => {
  await assert.rejects(
    async () => {
      await resolveProvider(
        { provider: "anthropic", model: "claude-sonnet-4-5" },
        { credentialRef: "MISSING_ENV_VAR", resolver: () => undefined },
      );
    },
    (err: unknown) => {
      assert(err instanceof PrismCodeExecutionError);
      assert.equal(err.code, "ERR_PRISM_CODE_EXECUTION");
      assert(err.message.includes("MISSING_ENV_VAR"));
      return true;
    },
  );
});

test("mock provider end-to-end run via defineAgent from config", async () => {
  const config: PrismCodeConfig = {
    cwd: process.cwd(),
    model: { provider: "mock", model: "mock-model" },
  };

  const modelConfig = config.model;
  if (!modelConfig) throw new Error("model required");
  const provider = await resolveProvider(modelConfig);
  const assembled = await defineAgent({
    provider,
    model: modelConfig,
    workspaceRoot: config.cwd,
    planes: {},
  });

  try {
    assert(assembled.agent);
    assert(typeof assembled.createSession === "function");
    const session = await assembled.createSession();
    assert(session);
    assert.equal(typeof session.prompt, "function");

    const result = await session.prompt("Ping test");
    assert(result);
  } finally {
    await assembled.dispose();
  }
});
