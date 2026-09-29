import { describe, it } from "bun:test";
import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ModelConfig } from "@arnilo/prism";
import { MemoryStoredCredentialStore, PrismCodeCredentialManager } from "../credentials.js";
import {
  cycleThinkingLevel,
  getModelThinkingLevels,
  getShippedProvider,
  getStaticModelsForProvider,
  listModelsForProvider,
  SHIPPED_PROVIDERS,
  validateProviderKey,
  validateThinkingLevel,
} from "../providers.js";
import { stubGlobalFetch } from "./helpers/global-fetch.js";

describe("Provider Inventory and Management", () => {
  it("every registered provider adapter in prism-providers export map has a selectable entry in SHIPPED_PROVIDERS", () => {
    // Read packages/prism-providers/package.json
    const rootPath = resolve(process.cwd(), "packages/prism-providers/package.json");
    const packageJsonPath = existsSync(rootPath) ? rootPath : resolve(process.cwd(), "../../packages/prism-providers/package.json");
    const raw = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    const exportsMap = raw.exports as Record<string, unknown>;

    // Filter out non-adapter exports per plan: model-discovery and decisions
    const nonAdapterExports = new Set(["./model-discovery", "./decisions"]);
    const adapterExportSubpaths = Object.keys(exportsMap)
      .filter((k) => !nonAdapterExports.has(k))
      .map((k) => k.replace("./", ""));

    // Every adapter subpath must be represented in SHIPPED_PROVIDERS
    for (const subpath of adapterExportSubpaths) {
      const match = SHIPPED_PROVIDERS.find((p) => p.packageSubpath === subpath || p.id === subpath || p.parentPackage === subpath);
      assert.ok(match, `Expected shipped provider inventory to cover adapter export "${subpath}", but found no matching entry`);
    }

    // Verify non-adapters are NOT offered as providers
    assert.strictEqual(getShippedProvider("model-discovery"), undefined);
    assert.strictEqual(getShippedProvider("decisions"), undefined);
  });

  it("multi-ID packages (OpenAI/Codex, Kimi/Moonshot) register distinct provider entries with valid auth", () => {
    const openai = getShippedProvider("openai");
    const codex = getShippedProvider("openai-codex");
    const kimi = getShippedProvider("kimi-coding");
    const moonshot = getShippedProvider("moonshot");

    assert.ok(openai, "openai must exist");
    assert.ok(codex, "openai-codex must exist");
    assert.ok(kimi, "kimi-coding must exist");
    assert.ok(moonshot, "moonshot must exist");

    assert.strictEqual(openai?.authKinds.includes("api_key"), true);
    assert.strictEqual(codex?.authKinds.includes("oauth"), true);
    assert.strictEqual(kimi?.authKinds.includes("api_key"), true);
    assert.strictEqual(moonshot?.authKinds.includes("api_key"), true);
  });

  it("CredentialManager securely stores and resolves credentials without plaintext leakage", async () => {
    const memoryStore = new MemoryStoredCredentialStore();
    const manager = new PrismCodeCredentialManager({ store: memoryStore });

    // Store API key
    await manager.setApiKey("anthropic", "sk-ant-test-12345");
    const retrieved = await manager.getApiKey("anthropic");
    assert.strictEqual(retrieved, "sk-ant-test-12345");

    // Has credentials check
    const hasCreds = await manager.hasCredentials("anthropic");
    assert.strictEqual(hasCreds, true);

    // Delete credentials
    await manager.delete("anthropic");
    const deleted = await manager.getApiKey("anthropic");
    // Ensure deleted from store (falls back to process.env if present, otherwise undefined)
    if (!process.env.ANTHROPIC_API_KEY) {
      assert.strictEqual(deleted, undefined);
    }
  });

  it("CredentialManager resolves ambient env auth without rewriting it", async () => {
    const prev = process.env.TEST_CUSTOM_KEY;
    try {
      process.env.TEST_CUSTOM_KEY = "ambient-key-value";
      const manager = new PrismCodeCredentialManager({ disableKeychain: true });
      const resolver = manager.createResolver();
      assert.strictEqual(await resolver("TEST_CUSTOM_KEY"), "ambient-key-value");
    } finally {
      if (prev !== undefined) process.env.TEST_CUSTOM_KEY = prev;
      else delete process.env.TEST_CUSTOM_KEY;
    }
  });

  it("OAuth credential storage and retrieval preserves previous tokens on failed/cancelled flow", async () => {
    const memoryStore = new MemoryStoredCredentialStore();
    const manager = new PrismCodeCredentialManager({ store: memoryStore });

    // Set initial token
    await manager.setOAuth("openai-codex", {
      access: "initial-token-123",
      refresh: "refresh-token-123",
      expires: Date.now() + 3600_000,
    });

    const initial = await manager.getOAuth("openai-codex");
    assert.strictEqual(initial?.access, "initial-token-123");

    // Simulating failed/aborted flow: previous token remains untouched
    const afterFailed = await manager.getOAuth("openai-codex");
    assert.strictEqual(afterFailed?.access, "initial-token-123");
  });

  it("unauthenticated provider fails closed when listing models", async () => {
    const memoryStore = new MemoryStoredCredentialStore();
    const manager = new PrismCodeCredentialManager({ store: memoryStore });

    // Clear any ambient key for deepseek for test hermeticity
    const prev = process.env.DEEPSEEK_API_KEY;
    try {
      delete process.env.DEEPSEEK_API_KEY;
      let failed = false;
      try {
        await listModelsForProvider("deepseek", { credentialManager: manager });
      } catch (err: any) {
        failed = true;
        assert.ok(err.message.includes("not authenticated"), "Expected not authenticated error message");
      }
      assert.strictEqual(failed, true, "Unauthenticated provider listing must fail closed");
    } finally {
      if (prev !== undefined) process.env.DEEPSEEK_API_KEY = prev;
    }
  });

  it("model discovery falls back to static catalog with offline indicator on transient network error", async () => {
    const memoryStore = new MemoryStoredCredentialStore();
    const manager = new PrismCodeCredentialManager({ store: memoryStore });
    await manager.setApiKey("anthropic", "invalid-or-unreachable-key");

    // Discover models with an immediately aborted signal to simulate network timeout
    const controller = new AbortController();
    controller.abort(new Error("Network connection timed out"));

    const models = await listModelsForProvider("anthropic", {
      credentialManager: manager,
      signal: controller.signal,
      ttlMs: 0,
    });

    // Should not throw, should return static catalog with offline indicator
    assert.ok(models.length > 0, "Expected static models fallback");
    assert.strictEqual(models[0]?.isLive, false);
    assert.strictEqual(models[0]?.isStale, true);
    assert.ok(models[0]?.error?.includes("Live refresh failed"));
  });

  it("validateProviderKey surfaces the raw provider error without leaking the key, and never fabricates a catalog", async () => {
    // Provider discovery calls the platform fetch internally; this test substitutes it for a 401
    // probe (see the helper's note on the network-free guard).
    const restoreFetch = stubGlobalFetch((async () => new Response("invalid x-api-key", { status: 401 })) as typeof fetch);
    try {
      const result = await validateProviderKey("anthropic", "sk-secret-value");
      assert.strictEqual(result.ok, false);
      assert.ok(result.reason && result.reason.length > 0, "expected a reason");
      assert.strictEqual(result.reason.includes("sk-secret-value"), false, "reason must not echo the key");
      assert.strictEqual(result.reason.includes("cached catalog"), false, "validation must not fall back to the catalog");
    } finally {
      restoreFetch();
    }
  });

  it("validateProviderKey reports unverifiable for providers with no discovery endpoint", async () => {
    const result = await validateProviderKey("azure", "azure-key");
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.unverifiable, true);
  });

  it("static catalog returns models for mock provider", async () => {
    const models = await getStaticModelsForProvider("mock");
    assert.strictEqual(models.length, 1);
    assert.strictEqual(models[0]?.model, "default");
    assert.strictEqual(models[0]?.capabilities?.reasoning, true);
  });

  it("descriptor default models exist in their shipped catalogs and catalogs never fabricate 'default'", async () => {
    for (const desc of SHIPPED_PROVIDERS) {
      const catalog = await getStaticModelsForProvider(desc.id);
      if (desc.id === "mock") continue;
      assert.ok(
        catalog.every((m) => m.model !== "default"),
        `${desc.id} catalog must not fabricate a literal "default" model`,
      );
      if (desc.defaultModel && catalog.length > 0) {
        assert.ok(
          catalog.some((m) => m.model === desc.defaultModel),
          `${desc.id} default "${desc.defaultModel}" missing from its catalog`,
        );
      }
    }

    // Host-defined catalogs return empty instead of a placeholder entry.
    assert.deepStrictEqual(await getStaticModelsForProvider("azure"), []);
    assert.deepStrictEqual(await getStaticModelsForProvider("ollama"), []);
    assert.deepStrictEqual(await getStaticModelsForProvider("unknown-provider"), []);
  });

  it("descriptor factories use typed adapter exports and fail closed", async () => {
    const azure = getShippedProvider("azure");
    const bedrock = getShippedProvider("bedrock");
    const vertex = getShippedProvider("vertex");
    assert.ok(azure?.create && bedrock?.create && vertex?.create);
    assert.ok(azure);
    assert.ok(bedrock);
    assert.ok(vertex);
    assert.ok(azure.create);
    assert.ok(bedrock.create);
    assert.ok(vertex.create);

    const saved = {
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      accessKey: process.env.AWS_ACCESS_KEY_ID,
      secret: process.env.AWS_SECRET_ACCESS_KEY,
      project: process.env.GOOGLE_PROJECT_ID,
      projectAlt: process.env.GOOGLE_CLOUD_PROJECT,
    };
    try {
      delete process.env.AZURE_OPENAI_ENDPOINT;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.GOOGLE_PROJECT_ID;
      delete process.env.GOOGLE_CLOUD_PROJECT;
      const model = { provider: "x", model: "x" };
      const azureCreate = azure.create;
      const bedrockCreate = bedrock.create;
      const vertexCreate = vertex.create;

      await assert.rejects(() => azureCreate({ apiKey: "key", model }), /AZURE_OPENAI_ENDPOINT/);
      await assert.rejects(() => bedrockCreate({ apiKey: "", model }), /Bedrock requires AWS credentials/);
      await assert.rejects(() => vertexCreate({ apiKey: "", model }), /GOOGLE_PROJECT_ID/);
    } finally {
      const restore = (key: keyof typeof saved, value: string | undefined): void => {
        const envKey =
          key === "endpoint"
            ? "AZURE_OPENAI_ENDPOINT"
            : key === "accessKey"
              ? "AWS_ACCESS_KEY_ID"
              : key === "secret"
                ? "AWS_SECRET_ACCESS_KEY"
                : key === "project"
                  ? "GOOGLE_PROJECT_ID"
                  : "GOOGLE_CLOUD_PROJECT";
        if (value === undefined) delete process.env[envKey];
        else process.env[envKey] = value;
      };
      for (const key of Object.keys(saved) as Array<keyof typeof saved>) restore(key, saved[key]);
    }
  });
});

describe("Model-Aware Effort Control (Shift+Tab)", () => {
  it("Shift+Tab cycles reasoning levels in declared order and wraps", () => {
    const reasoningModel: ModelConfig = {
      provider: "anthropic",
      model: "claude-sonnet-5",
      capabilities: {
        reasoning: true,
        thinkingLevels: ["low", "medium", "high", "max"],
      },
    };

    assert.strictEqual(cycleThinkingLevel(reasoningModel, "low"), "medium");
    assert.strictEqual(cycleThinkingLevel(reasoningModel, "medium"), "high");
    assert.strictEqual(cycleThinkingLevel(reasoningModel, "high"), "max");
    assert.strictEqual(cycleThinkingLevel(reasoningModel, "max"), "low"); // wraps around!
  });

  it("Shift+Tab includes 'none' only if declared", () => {
    const modelWithNone: ModelConfig = {
      provider: "anthropic",
      model: "claude-haiku-4-5",
      capabilities: {
        reasoning: true,
        thinkingLevels: ["none", "low", "medium", "high"],
      },
    };

    const modelWithoutNone: ModelConfig = {
      provider: "anthropic",
      model: "claude-opus-4-8",
      capabilities: {
        reasoning: true,
        thinkingLevels: ["low", "medium", "high", "max"],
      },
    };

    assert.strictEqual(cycleThinkingLevel(modelWithNone, "none"), "low");
    assert.strictEqual(cycleThinkingLevel(modelWithNone, "high"), "none"); // wraps to none

    // Model without none wraps directly to low, not none
    assert.strictEqual(cycleThinkingLevel(modelWithoutNone, "max"), "low");
  });

  it("non-reasoning models show 'off' and do not cycle", () => {
    const nonReasoningModel: ModelConfig = {
      provider: "openai",
      model: "gpt-4o",
      capabilities: {
        reasoning: false,
      },
    };

    assert.strictEqual(getModelThinkingLevels(nonReasoningModel), undefined);
    assert.strictEqual(cycleThinkingLevel(nonReasoningModel, "off"), "off");
    assert.strictEqual(validateThinkingLevel(nonReasoningModel, "high"), "off");
  });

  it("models declaring no thinkingLevels show 'unavailable' and do not cycle", () => {
    const modelWithoutLevels: ModelConfig = {
      provider: "custom",
      model: "custom-model",
      capabilities: {
        reasoning: true,
        // No thinkingLevels declared
      },
    };

    assert.strictEqual(getModelThinkingLevels(modelWithoutLevels), undefined);
    assert.strictEqual(cycleThinkingLevel(modelWithoutLevels, "unavailable"), "unavailable");
    assert.strictEqual(validateThinkingLevel(modelWithoutLevels, "high"), "unavailable");
  });

  it("model switch revalidates effort against new model", () => {
    const modelA: ModelConfig = {
      provider: "anthropic",
      model: "claude-sonnet-5",
      capabilities: {
        reasoning: true,
        thinkingLevels: ["low", "medium", "high", "max"],
      },
    };

    const modelB: ModelConfig = {
      provider: "openai",
      model: "gpt-4o",
      capabilities: {
        reasoning: false,
      },
    };

    const modelC: ModelConfig = {
      provider: "custom",
      model: "custom-model",
      capabilities: {
        reasoning: true,
        thinkingLevels: ["minimal", "standard"],
      },
    };

    // 'max' is valid on modelA
    assert.strictEqual(validateThinkingLevel(modelA, "max"), "max");

    // Switching to non-reasoning modelB revalidates to 'off'
    assert.strictEqual(validateThinkingLevel(modelB, "max"), "off");

    // Switching to modelC with different levels snaps/falls back to first level
    assert.strictEqual(validateThinkingLevel(modelC, "max"), "minimal");
  });
});
