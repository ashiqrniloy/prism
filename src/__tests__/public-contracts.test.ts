import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  AgentConfig,
  AgentDefinition,
  AgentEvent,
  AIProvider,
  CommandDefinition,
  CompactionStrategy,
  ConfigLayer,
  ConfigProvider,
  ContextProvider,
  CredentialResolver,
  AssembleProviderInputOptions,
  DefaultInputBuildContext,
  Extension,
  InputBuilder,
  ManifestContributionDeclaration,
  ManifestResourceDeclaration,
  PrismManifest,
  PromptBuilder,
  ResourceLoader,
  SettingsProvider,
  Skill,
  StoreFactory,
  ToolDefinition,
} from "../index.js";
import { assembleProviderInput, createContributionRegistries, createDefaultInputBuilder, createDefaultPromptBuilder, createExtensionKernel, createToolRegistry, dispatchToolCall, filterTools, resolveContextProviders } from "../index.js";
import type { DispatchToolCallOptions, ToolFilter, ToolValidator } from "../index.js";

const provider: AIProvider = {
  id: "mock",
  async *generate() {
    yield { type: "done" };
  },
};

const context: ContextProvider = {
  name: "demo-context",
  resolve() {
    return [{ title: "Demo", content: "Public contract example." }];
  },
};

const tool: ToolDefinition = {
  name: "echo",
  parameters: { type: "object" },
  execute(_args, ctx) {
    return { toolCallId: ctx.toolCallId, name: "echo", value: "ok" };
  },
};

const skill: Skill = {
  name: "brief",
  instructions: "Answer briefly.",
  toolNames: ["echo"],
};

describe("public contracts", () => {
  it("host can configure agent with provider context skill and tool", () => {
    const config: AgentConfig = {
      id: "demo-agent",
      model: { provider: "mock", model: "demo-model" },
      provider,
      context: [context],
      skills: [skill],
      tools: [tool],
      metadata: { example: true },
    };

    assert.equal(config.provider?.id, "mock");
    assert.equal(config.context?.[0]?.name, "demo-context");
    assert.equal(Array.isArray(config.tools), true);
  });

  it("host can type extension resource settings and credentials", async () => {
    const extension: Extension = {
      name: "demo-extension",
      setup(api) {
        api.registerProvider(provider);
        api.registerContextProvider(context);
        api.registerSkill(skill);
        api.registerTool(tool);
      },
    };

    const resources: ResourceLoader = {
      async load(uri) {
        return { uri, mediaType: "text/plain", text: "example" };
      },
    };

    const settings: SettingsProvider = {
      get<T>(key: string) {
        return key === "demo.enabled" ? (true as T) : undefined;
      },
    };

    const credentials: CredentialResolver = {
      resolve() {
        return undefined;
      },
    };

    assert.equal(extension.name, "demo-extension");
    assert.equal((await resources.load("memory:demo")).text, "example");
    assert.equal(await settings.get("demo.enabled"), true);
    assert.equal(await credentials.resolve({ name: "demo" }), undefined);
  });

  it("host can type phase 2 contribution contracts", async () => {
    const command: CommandDefinition = {
      name: "say",
      execute() {
        return { name: "say", value: "ok" };
      },
    };
    const agentDefinition: AgentDefinition = {
      name: "agent",
      create() {
        return {
          config: { model: { provider: "mock", model: "demo" }, provider },
          createSession() {
            throw new Error("not implemented in public contract test");
          },
        };
      },
    };
    const inputBuilder: InputBuilder = {
      name: "input",
      build(input) {
        return typeof input === "string" ? [{ role: "user", content: [{ type: "text", text: input }] }] : [];
      },
    };
    const promptBuilder: PromptBuilder = { name: "prompt", build: (request) => request.messages };
    const compaction: CompactionStrategy = { name: "compact", compact: () => ({ summary: "ok" }) };
    const storeFactory: StoreFactory = { name: "memory", create: () => ({ append: async () => undefined, list: async () => [] }) };

    assert.equal(command.name, "say");
    assert.equal(agentDefinition.name, "agent");
    assert.equal((await inputBuilder.build("hi"))[0]?.role, "user");
    assert.equal(promptBuilder.name, "prompt");
    assert.equal((await compaction.compact({ sessionId: "s1", entries: [] })).summary, "ok");
    assert.equal((await storeFactory.create()).list("s1") instanceof Promise, true);
  });

  it("host can type phase 3 config and manifest contracts", async () => {
    const provider: ConfigProvider = {
      name: "host",
      load() {
        return { demo: { enabled: true } };
      },
    };
    const layer: ConfigLayer = { name: provider.name, config: (await provider.load()) ?? {} };
    const contribution: ManifestContributionDeclaration = { kind: "tool", name: "demo.echo", module: "./tool.js" };
    const resource: ManifestResourceDeclaration = { uri: "package://demo/prompt.md", purpose: "prompt" };
    const manifest: PrismManifest = {
      name: "demo-package",
      configDefaults: layer.config,
      contributions: [contribution],
      resources: [resource],
    };

    assert.equal(manifest.name, "demo-package");
    assert.equal(manifest.contributions?.[0]?.kind, "tool");
    assert.equal(manifest.resources?.[0]?.uri, "package://demo/prompt.md");
  });

  it("host can type phase 4 tool registry filters dispatch and contributions", async () => {
    const contributions = createContributionRegistries();
    const kernel = createExtensionKernel({ registries: contributions });
    await kernel.load([{ name: "tools", setup: (api) => { api.registerTool(tool); } }]);
    const registry = createToolRegistry([contributions.tools.resolve("echo")]);
    const filter: ToolFilter = { allow: ["echo"] };
    const validate: ToolValidator = (_tool, args) => typeof args.text === "string" ? undefined : "text is required";
    const options: DispatchToolCallOptions = {
      call: { type: "tool_call", id: "call_1", name: "echo", arguments: { text: "hi" } },
      registry,
      context: { sessionId: "s1", runId: "r1", toolCallId: "call_1" },
      filter,
      validate,
    };

    assert.equal(registry.resolve("echo"), tool);
    assert.deepEqual(filterTools(registry.list(), filter), [tool]);
    assert.equal((await dispatchToolCall(options)).name, "echo");
  });

  it("host can type phase 5 default input assembly", async () => {
    const context: DefaultInputBuildContext = {
      systemInstructions: "Follow host policy.",
      attachments: [{ name: "notes.md", text: "notes" }],
      toolResults: [{ toolCallId: "call_1", name: "echo", value: "ok" }],
      metadata: { requestId: "r1" },
    };

    const messages = await createDefaultInputBuilder().build("Hello", context);

    assert.equal(messages[0]?.role, "system");
    assert.equal(messages.at(-1)?.role, "tool");
  });

  it("host can type phase 5 context prompt assembly", async () => {
    const options: AssembleProviderInputOptions = {
      model: { provider: "mock", model: "demo" },
      input: "Hello",
      contextProviders: [context],
      promptBuilder: createDefaultPromptBuilder(),
      tools: [tool],
      skills: [skill],
    };

    assert.equal((await resolveContextProviders({ providers: [context], messages: [] })).length, 1);
    assert.equal((await assembleProviderInput(options)).model.model, "demo");
  });

  it("agent event narrows by type", () => {
    const event: AgentEvent = {
      type: "tool_execution_progress",
      sessionId: "s1",
      runId: "r1",
      toolCallId: "call_1",
      name: "echo",
      progress: { step: 1 },
    };

    if (event.type === "tool_execution_progress") {
      assert.equal(event.toolCallId, "call_1");
      return;
    }

    assert.fail("event did not narrow");
  });

  it("public contracts do not mention app-specific tool categories", () => {
    const files = [
      "src/index.ts",
      "src/contracts.ts",
      "dist/index.d.ts",
      "dist/contracts.d.ts",
    ];
    const banned = [
      /safe.?tool/i,
      /dangerous/i,
      /synapta/i,
      /shell/i,
      /filesystem/i,
      /browser/i,
    ];

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of banned) {
        assert.equal(pattern.test(text), false, `${file} matched ${pattern}`);
      }
    }
  });
});
