import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  AgentConfig,
  AgentDefinition,
  AgentEvent,
  AgentSessionCloneOptions,
  AgentSessionForkOptions,
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
  PromptTemplateOptions,
  ResourceLoader,
  SettingsProvider,
  Skill,
  SessionEntry,
  SessionStore,
  SkillRegistry,
  StoreFactory,
  ToolDefinition,
} from "../index.js";
import { assembleProviderInput, createAgent, createAgentSession, createContributionRegistries, createDefaultInputBuilder, createDefaultPromptBuilder, createExtensionKernel, createMemorySessionStore, createSessionEntry, createSkillRegistry, createToolRegistry, dispatchToolCall, filterTools, rebuildSessionContext, renderPromptTemplate, resolveActiveSkills, resolveContextProviders } from "../index.js";
import type { DispatchToolCallOptions, SessionContextSnapshot, ToolFilter, ToolValidator } from "../index.js";

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

  it("host can type phase 5 skill registry", () => {
    const registry: SkillRegistry = createSkillRegistry([skill]);
    const active = resolveActiveSkills({ registry, names: ["brief"], tools: [tool] });

    assert.equal(registry.resolve("brief"), skill);
    assert.deepEqual(active, [skill]);
  });

  it("host can type phase 5 prompt template rendering", async () => {
    const options: PromptTemplateOptions = { missing: "throw" };
    const prompt = renderPromptTemplate("Hello {{name}}", { name: "world" }, options);
    const messages = await createDefaultInputBuilder().build(prompt);

    assert.equal(messages[0]?.role, "user");
    assert.equal(messages[0]?.content[0]?.type === "text" ? messages[0].content[0].text : undefined, "Hello world");
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

  it("host can type phase 5 extension contribution wiring", async () => {
    const extension: Extension = { name: "phase5", setup(api) {
      api.registerInputBuilder({ name: "input", build: () => [{ role: "user", content: [{ type: "text", text: "from extension" }] }] });
      api.registerPromptBuilder({ name: "prompt", build: (request) => request.messages });
      api.registerContextProvider(context);
      api.registerSkill(skill);
    } };
    const kernel = createExtensionKernel();
    await kernel.load([extension]);
    const skillRegistry = createSkillRegistry([kernel.registries.skills.resolve("brief")]);
    const selectedSkills = resolveActiveSkills({ registry: skillRegistry, names: ["brief"], tools: [tool] });
    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Hello",
      inputBuilder: kernel.registries.inputBuilders.resolve("input"),
      promptBuilder: kernel.registries.promptBuilders.resolve("prompt"),
      contextProviders: [kernel.registries.contextProviders.resolve("demo-context")],
      skills: selectedSkills,
      tools: [tool],
      middleware: kernel.middleware,
    });

    assert.equal(request.context?.[0]?.title, "Demo");
  });

  it("host can create minimal phase 6 agent sessions", async () => {
    const definition: AgentDefinition = {
      name: "runtime-agent",
      create: () => createAgent({ model: { provider: "mock", model: "demo" }, provider }),
    };
    const agent = await definition.create();
    const session = createAgentSession({ agent, id: "s1", leafId: undefined });
    const forkOptions: AgentSessionForkOptions = { leafId: undefined };
    const cloneOptions: AgentSessionCloneOptions = { id: "s2" };

    assert.equal(agent.config.provider?.id, "mock");
    assert.equal(session.id, "s1");
    assert.equal(session.fork(forkOptions).id, "s1");
    assert.equal((await session.clone(cloneOptions)).id, "s2");
  });

  it("public contracts accept branch aware session entries", () => {
    const root: SessionEntry = createSessionEntry({
      id: "entry_1",
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:00.000Z",
      kind: "message",
      message: { role: "user", content: [{ type: "text", text: "Hi" }] },
    });
    const label: SessionEntry = createSessionEntry({ id: "entry_2", parentId: root.id, sessionId: "s1", timestamp: root.timestamp, kind: "label", label: "demo" });
    const snapshot: SessionContextSnapshot = rebuildSessionContext([root, label], { leafId: label.id });

    assert.equal(snapshot.leafId, "entry_2");
    assert.equal(snapshot.messages[0]?.role, "user");
  });

  it("public contracts can use memory store as session store", async () => {
    const store: SessionStore = createMemorySessionStore();
    const factory: StoreFactory = { name: "memory", create: () => createMemorySessionStore() };
    const item = createSessionEntry({ id: "memory_1", sessionId: "s1", kind: "custom", data: { ok: true } });

    await store.append(item);

    assert.equal((await store.get?.("memory_1"))?.id, item.id);
    assert.equal((await factory.create()).list("s1") instanceof Promise, true);
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
