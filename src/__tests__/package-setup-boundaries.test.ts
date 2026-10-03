import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { type Session, type AIProvider, createAgent, type ModelConfig, providerDone } from "../index.js";

// Optional-package setup invariants: every first-party capability package must
// import from its public entrypoint and set up inertly (no network, no provider
// invocation) so hosts can register it without side effects. Consolidated from
// the former phase12/13/14 boundary tests (plan 079, Task 5).

const providerPackages = [
  ["openai", "openaiPackage", "listOpenAIModels", { apiKey: "fake-openai-key" }],
  ["opencode-go", "opencodeGoPackage", "listOpenCodeGoModels", { apiKey: "fake-opencode-key" }],
  ["openrouter", "openrouterPackage", "listOpenRouterModels", { apiKey: "fake-openrouter-key" }],
  ["zai", "zaiPackage", "listZaiModels", { apiKey: "fake-zai-key" }],
  ["kimi", "kimiPackage", "listKimiModels", { kimiApiKey: "fake-kimi-key" }],
  ["neuralwatt", "neuralwattPackage", "listNeuralWattModels", { apiKey: "fake-neuralwatt-key" }],
] as const;

describe("optional package setup boundaries", () => {
  it("provider packages expose their public factory and discovery", async () => {
    for (const [name, factory, discovery] of providerPackages) {
      const mod = (await import(`../../packages/prism-providers/dist/${name}/index.js`)) as Record<string, unknown>;
      assert.equal(typeof mod[factory], "function", `missing ${factory}`);
      assert.equal(typeof mod[discovery], "function", `missing ${discovery}`);
    }
  });

  it("provider packages set up without network", async () => {
    for (const [name, factory, , options] of providerPackages) {
      let fetchCalls = 0;
      const specifier = `../../packages/prism-providers/dist/${name}/index.js`;
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
        observation: { provider: AIProvider; model: ModelConfig };
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
    } satisfies AIProvider;
    const session = await (await createAgent({ model: { provider: "mock", model: "memory" }, provider: workerProvider })).session({
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
      provider: workerProvider,
      packages: [observationalMemory({ recallTool: { getEntries: () => [] }, commands: { getEntries: () => [] } }) as never],
    });
    await loaded.dispose();
    assert.equal(providerCalls, 0);
  });
});
