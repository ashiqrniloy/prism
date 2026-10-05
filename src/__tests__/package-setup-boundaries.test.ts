import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { type Session, type ModelProvider, createAgent, type ModelConfig, providerDone } from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

// Optional-package setup invariants: every first-party capability package must
// import from its public entrypoint and set up inertly (no network, no provider
// invocation) so hosts can register it without side effects. Consolidated from
// the former phase12/13/14 boundary tests (plan 079, Task 5).

// Plan 152 Tasks 3-4: the extracted provider packages publish TypeScript source, so each tuple
// carries its own entrypoint and factory name. Config is ref-only, so a literal key is replaced by
// an `env:` ref that never resolves — setup notes a warning and still registers.
const providerPackages = [
  ["openai", "openai", "listOpenAIModels", { apiKey: "env:PRISM_TEST_OPENAI_KEY" }, "../../packages/providers/openai/src/index.ts"],
  ["opencode-go", "opencodeGo", "listOpenCodeGoModels", { apiKey: "env:PRISM_TEST_OPENCODE_KEY" }, "../../packages/providers/opencode-go/src/index.ts"],
  ["openrouter", "openrouter", "listOpenRouterModels", { apiKey: "env:PRISM_TEST_OPENROUTER_KEY" }, "../../packages/providers/openrouter/src/index.ts"],
  ["zai", "zai", "listZaiModels", { apiKey: "env:PRISM_TEST_ZAI_KEY" }, "../../packages/providers/zai/src/index.ts"],
  ["kimi", "kimi", "listKimiModels", { kimiApiKey: "env:PRISM_TEST_KIMI_KEY" }, "../../packages/providers/kimi/src/index.ts"],
  ["neuralwatt", "neuralwatt", "listNeuralWattModels", { apiKey: "env:PRISM_TEST_NEURALWATT_KEY" }, "../../packages/providers/neuralwatt/src/index.ts"],
  ["deepseek", "deepseek", "listDeepSeekModels", { apiKey: "env:PRISM_TEST_DEEPSEEK_KEY" }, "../../packages/providers/deepseek/src/index.ts"],
  ["xai", "xai", "listXaiModels", { apiKey: "env:PRISM_TEST_XAI_KEY" }, "../../packages/providers/xai/src/index.ts"],
  ["alibaba", "alibaba", "listAlibabaModels", { apiKey: "env:PRISM_TEST_ALIBABA_KEY" }, "../../packages/providers/alibaba/src/index.ts"],
  ["ollama", "ollama", "listOllamaModels", {}, "../../packages/providers/ollama/src/index.ts"],
  ["clinepass", "clinepass", "clinePassModels", { apiKey: "env:PRISM_TEST_CLINEPASS_KEY" }, "../../packages/providers/clinepass/src/index.ts"],
  ["commandcode", "commandcode", "listCommandCodeModels", { apiKey: "env:PRISM_TEST_COMMANDCODE_KEY" }, "../../packages/providers/commandcode/src/index.ts"],
  ["hyper", "hyper", "listHyperModels", { apiKey: "env:PRISM_TEST_HYPER_KEY" }, "../../packages/providers/hyper/src/index.ts"],
  ["laya", "laya", "layaModels", { apiKey: "env:PRISM_TEST_LAYA_KEY" }, "../../packages/providers/laya/src/index.ts"],
  ["typesafe", "typesafe", "typeSafeModels", { apiKey: "env:PRISM_TEST_TYPESAFE_KEY" }, "../../packages/providers/typesafe/src/index.ts"],
  // Plan 152 Task 6: cloud/adapter vendors.
  ["google", "google", "listGoogleModels", { apiKey: "env:PRISM_TEST_GOOGLE_KEY" }, "../../packages/providers/google/src/index.ts"],
  ["vertex", "vertex", "VERTEX_DEFAULT_CREDENTIAL_REF", { project: "p", location: "us-central1", credential: "env:PRISM_TEST_VERTEX_KEY" }, "../../packages/providers/vertex/src/index.ts"],
  ["azure", "azure", "AZURE_DEFAULT_CREDENTIAL_REF", { resourceName: "demo", deployment: "d1", credential: "env:PRISM_TEST_AZURE_KEY" }, "../../packages/providers/azure/src/index.ts"],
  ["bedrock", "bedrock", "BEDROCK_DEFAULT_ACCESS_KEY_ID_REF", { region: "us-east-1", accessKeyId: "env:PRISM_TEST_BEDROCK_KEY", secretAccessKey: "env:PRISM_TEST_BEDROCK_SECRET" }, "../../packages/providers/bedrock/src/index.ts"],
  ["ai-sdk", "aiSdk", "AI_SDK_PEER", {}, "../../packages/providers/ai-sdk/src/index.ts"],
] as const;

describe("optional package setup boundaries", () => {
  it("provider packages expose their public factory and discovery", async () => {
    for (const [, factory, discovery, , specifier] of providerPackages) {
      const mod = (await import(specifier)) as Record<string, unknown>;
      assert.equal(typeof mod[factory], "function", `missing ${factory}`);
      assert.ok(mod[discovery] !== undefined, `missing ${discovery}`);
    }
  });

  it("provider packages set up without network", async () => {
    for (const [, factory, , options, specifier] of providerPackages) {
      let fetchCalls = 0;
      const mod = (await import(specifier)) as Record<string, (options: unknown) => unknown>;
      const instance = mod[factory]!({
        ...options,
        fetch: (() => {
          fetchCalls++;
          throw new Error("network disabled");
        }) as typeof fetch,
      });
      const agent = await createAgent({
        model: { provider: "probe", model: "probe" },
        packages: [instance as never],
      });
      await agent.dispose();
      assert.equal(fetchCalls, 0, `${specifier} setup called fetch`);
    }
  });

  it("compaction-llm exposes its public entrypoint and sets up inert", async () => {
    const mod = (await import("../../packages/memory/" + "dist/compaction/llm/index.js")) as Record<string, unknown>;
    for (const name of [
      "createLlmCompactor",
      "llmCompaction",
      "prepareLlmCompaction",
      "serializeCompactionConversation",
      "collectFileOperations",
      "estimateEntryTokens",
    ])
      assert.equal(typeof mod[name], "function", `missing ${name}`);
    assert.equal(typeof mod.SUMMARIZATION_SYSTEM_PROMPT, "string");

    type LlmCompactionModule = {
      createLlmCompactor(options: unknown): unknown;
      llmCompaction: { (): unknown };
    };
    const { llmCompaction, createLlmCompactor } = mod as unknown as LlmCompactionModule;
    let calls = 0;
    const options = {
      summaryProvider: () => {
        calls++;
        throw new Error("provider factory should not run during setup");
      },
      credential: () => {
        calls++;
        return "fake-key";
      },
      summaryModel: { provider: "mock", model: "summary" },
    };
    createLlmCompactor(options);
    const agent = await createAgent({ model: { provider: "mock", model: "summary" }, packages: [llmCompaction as never] });
    await agent.dispose();
    assert.equal(calls, 0);
  });

  it("observational-memory exposes its public entrypoint and sets up inert", async () => {
    const mod = (await import("../../packages/memory/" + "dist/compaction/observational-memory/index.js")) as Record<string, unknown>;
    for (const name of [
      "createObservationalMemoryRuntime",
      "createObservationalMemoryCompactor",
      "observationalMemory",
      "foldObservationalMemoryLedger",
      "buildObservationalMemoryProjection",
      "renderObservationalMemory",
      "recallObservationalMemory",
      "createRecallMemoryTool",
      "createMemoryStatusCommand",
      "createMemoryViewCommand",
      "createObservationalMemoryCommands",
      "resolveObservationalMemorySettings",
      "createMemoryId",
    ])
      assert.equal(typeof mod[name], "function", `missing ${name}`);
    assert.equal(mod.packageName, "@arnilo/prism-memory/compaction/observational-memory");

    type ObservationalMemoryModule = {
      createObservationalMemoryRuntime(options: {
        session: Session;
        appendEntry(entry: unknown): Promise<void>;
        observation: { provider: ModelProvider; model: ModelConfig };
      }): { status(): { inFlight: boolean } };
      observationalMemory(options: {
        recallTool: { getEntries(): readonly unknown[] };
        commands: { getEntries(): readonly unknown[] };
      }): unknown;
    };
    const { observationalMemory, createObservationalMemoryRuntime } = mod as unknown as ObservationalMemoryModule;
    let providerCalls = 0;
    const workerProvider = {
      id: "mock",
      async *generate() {
        providerCalls++;
        yield providerDone();
      },
    } satisfies ModelProvider;
    const session = await (await createAgent({ model: { provider: "mock", model: "memory" }, packages: [providerPackage("test-provider", [workerProvider])] })).session({
      id: "s1",
      create: true,
    });
    const runtime = createObservationalMemoryRuntime({
      session,
      appendEntry: async () => {
        throw new Error("append should not run during construction");
      },
      observation: { provider: workerProvider, model: { provider: "mock", model: "memory" } },
    });
    assert.equal(runtime.status().inFlight, false);
    const loaded = await createAgent({
      model: { provider: "mock", model: "memory" },
      packages: [observationalMemory({ recallTool: { getEntries: () => [] }, commands: { getEntries: () => [] } }) as never, providerPackage("test-provider", [workerProvider])],
    });
    await loaded.dispose();
    assert.equal(providerCalls, 0);
  });
});
