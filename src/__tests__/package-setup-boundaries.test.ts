import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgentSession,
  type AIProvider,
  createAgent,
  createExtensionKernel,
  type Extension,
  type ModelConfig,
  providerDone,
} from "../index.js";

// Optional-package setup invariants: every first-party capability package must
// import from its public entrypoint and set up inertly (no network, no provider
// invocation) so hosts can register it without side effects. Consolidated from
// the former phase12/13/14 boundary tests (plan 079, Task 5).

const providerPackages = [
  ["openai", "createOpenAIProviderPackage", "listOpenAIModels", { apiKey: "fake-openai-key" }],
  ["opencode-go", "createOpenCodeGoProviderPackage", "listOpenCodeGoModels", { apiKey: "fake-opencode-key" }],
  ["openrouter", "createOpenRouterProviderPackage", "listOpenRouterModels", { apiKey: "fake-openrouter-key" }],
  ["zai", "createZaiProviderPackage", "listZaiModels", { apiKey: "fake-zai-key" }],
  ["kimi", "createKimiProviderPackage", "listKimiModels", { kimiApiKey: "fake-kimi-key" }],
  ["neuralwatt", "createNeuralWattProviderPackage", "listNeuralWattModels", { apiKey: "fake-neuralwatt-key" }],
] as const;

describe("optional package setup boundaries", () => {
  it("provider packages expose their public factory and discovery", async () => {
    for (const [name, factory, discovery] of providerPackages) {
      const mod = (await import(`../../packages/prism-providers/dist/${name}/index.js`)) as Record<string, unknown>;
      assert.equal(typeof mod[factory], "function", `missing ${factory}`);
      assert.equal(typeof mod[discovery], "function", `missing ${discovery}`);
    }
  });

  it("provider packages set up without network and register auth", async () => {
    for (const [name, factory, , options] of providerPackages) {
      let fetchCalls = 0;
      const registered: unknown[] = [];
      const specifier = `../../packages/prism-providers/dist/${name}/index.js`;
      const mod = (await import(specifier)) as Record<string, (options: unknown) => { setup(api: unknown): unknown }>;
      await mod[factory]!({
        ...options,
        fetch: (() => {
          fetchCalls++;
          throw new Error("network disabled");
        }) as typeof fetch,
      }).setup({
        registerProvider: (item: unknown) => registered.push(item),
        registerModel: (item: unknown) => registered.push(item),
        registerAuthMethod: (item: unknown) => registered.push(item),
      });
      assert.equal(fetchCalls, 0, `${specifier} setup called fetch`);
      assert.ok(
        registered.some(
          (item) => typeof item === "object" && item !== null && "kind" in item && (item.kind === "api_key" || item.kind === "oauth"),
        ),
        `${specifier} did not register auth`,
      );
    }
  });

  it("compaction-llm exposes its public entrypoint and sets up inert", async () => {
    const mod = (await import("../../packages/memory/" + "dist/compaction/llm/index.js")) as Record<string, unknown>;
    for (const name of [
      "createLlmCompactionStrategy",
      "createLlmCompactionExtension",
      "prepareLlmCompaction",
      "serializeCompactionConversation",
      "collectFileOperations",
      "estimateEntryTokens",
    ])
      assert.equal(typeof mod[name], "function", `missing ${name}`);
    assert.equal(typeof mod.SUMMARIZATION_SYSTEM_PROMPT, "string");

    type LlmCompactionModule = {
      createLlmCompactionStrategy(options: unknown): unknown;
      createLlmCompactionExtension(options: unknown): Extension;
    };
    const { createLlmCompactionExtension, createLlmCompactionStrategy } = mod as unknown as LlmCompactionModule;
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
    createLlmCompactionStrategy(options);
    await createExtensionKernel().load([createLlmCompactionExtension(options)]);
    assert.equal(calls, 0);
  });

  it("observational-memory exposes its public entrypoint and sets up inert", async () => {
    const mod = (await import("../../packages/memory/" + "dist/compaction/observational-memory/index.js")) as Record<string, unknown>;
    for (const name of [
      "createObservationalMemoryRuntime",
      "createObservationalMemoryCompactionStrategy",
      "createObservationalMemoryExtension",
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
        session: AgentSession;
        appendEntry(entry: unknown): Promise<void>;
        observation: { provider: AIProvider; model: ModelConfig };
      }): { status(): { inFlight: boolean } };
      createObservationalMemoryExtension(options: {
        recallTool: { getEntries(): readonly unknown[] };
        commands: { getEntries(): readonly unknown[] };
      }): Extension;
    };
    const { createObservationalMemoryExtension, createObservationalMemoryRuntime } = mod as unknown as ObservationalMemoryModule;
    let providerCalls = 0;
    const workerProvider = {
      id: "mock",
      async *generate() {
        providerCalls++;
        yield providerDone();
      },
    } satisfies AIProvider;
    const session = createAgent({ model: { provider: "mock", model: "memory" }, provider: workerProvider }).createSession({ id: "s1" });
    const runtime = createObservationalMemoryRuntime({
      session,
      appendEntry: async () => {
        throw new Error("append should not run during construction");
      },
      observation: { provider: workerProvider, model: { provider: "mock", model: "memory" } },
    });
    assert.equal(runtime.status().inFlight, false);
    await createExtensionKernel().load([
      createObservationalMemoryExtension({ recallTool: { getEntries: () => [] }, commands: { getEntries: () => [] } }),
    ]);
    assert.equal(providerCalls, 0);
  });
});
