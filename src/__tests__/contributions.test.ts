import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createContributionRegistries, createContributionRegistry } from "../index.js";
import type {
  AgentDefinition,
  AIProvider,
  CommandDefinition,
  CompactionStrategy,
  ContextProvider,
  CredentialResolver,
  InputBuilder,
  PromptBuilder,
  ResourceLoader,
  SettingsProvider,
  Skill,
  StoreFactory,
  ToolDefinition,
} from "../index.js";

const provider: AIProvider = {
  id: "mock",
  async *generate() {
    yield { type: "done" };
  },
};

const tool: ToolDefinition = {
  name: "echo",
  execute(_args, ctx) {
    return { toolCallId: ctx.toolCallId, name: "echo", value: "ok" };
  },
};

const contextProvider: ContextProvider = {
  name: "context",
  resolve() {
    return [{ content: "context" }];
  },
};

const skill: Skill = { name: "brief" };
const command: CommandDefinition = {
  name: "say",
  execute() {
    return { name: "say", value: "ok" };
  },
};
const agent: AgentDefinition = {
  name: "agent",
  create() {
    return {
      config: { model: { provider: "mock", model: "demo" }, provider },
      createSession() {
        throw new Error("not implemented in registry tests");
      },
    };
  },
};
const inputBuilder: InputBuilder = {
  name: "input",
  build(input) {
    return typeof input === "string" ? [{ role: "user", content: [{ type: "text", text: input }] }] : Array.isArray(input) ? input : [input];
  },
};
const promptBuilder: PromptBuilder = {
  name: "prompt",
  build(request) {
    return request.messages;
  },
};
const compactionStrategy: CompactionStrategy = {
  name: "compact",
  compact() {
    return { summary: "summary" };
  },
};
const storeFactory: StoreFactory = {
  name: "memory",
  create() {
    return { append: async () => undefined, list: async () => [] };
  },
};
const resourceLoader: ResourceLoader = {
  async load(uri) {
    return { uri, text: "resource" };
  },
};
const settingsProvider: SettingsProvider = { get: () => undefined };
const credentialResolver: CredentialResolver = { resolve: () => undefined };

describe("contribution registry", () => {
  it("registers gets resolves lists and replaces contributions", () => {
    const registry = createContributionRegistry<ToolDefinition>({ label: "tool" });
    const replacement = { ...tool, description: "replacement" };

    registry.register("echo", tool);
    registry.register("echo", replacement);

    assert.equal(registry.get("echo"), replacement);
    assert.equal(registry.resolve("echo"), replacement);
    assert.deepEqual(registry.list(), [replacement]);
  });

  it("unknown key fails closed", () => {
    const registry = createContributionRegistry<ToolDefinition>({ label: "tool" });

    assert.throws(() => registry.resolve("missing"), /Unknown tool: missing/);
  });

  it("registry bundles cover phase 2 categories", () => {
    const registries = createContributionRegistries();

    registries.providers.register(provider);
    registries.models.register({ provider: "mock", model: "demo" });
    registries.tools.register(tool.name, tool);
    registries.contextProviders.register(contextProvider.name, contextProvider);
    registries.skills.register(skill.name, skill);
    registries.commands.register(command.name, command);
    registries.agents.register(agent.name, agent);
    registries.inputBuilders.register(inputBuilder.name, inputBuilder);
    registries.promptBuilders.register(promptBuilder.name, promptBuilder);
    registries.compactionStrategies.register(compactionStrategy.name, compactionStrategy);
    registries.storeFactories.register(storeFactory.name, storeFactory);
    registries.resourceLoaders.register("memory", resourceLoader);
    registries.settingsProviders.register("settings", settingsProvider);
    registries.credentialResolvers.register("credentials", credentialResolver);

    assert.equal(registries.providers.resolve("mock"), provider);
    assert.equal(registries.models.resolve("mock", "demo").model, "demo");
    assert.equal(registries.tools.resolve("echo"), tool);
    assert.equal(registries.contextProviders.resolve("context"), contextProvider);
    assert.equal(registries.skills.resolve("brief"), skill);
    assert.equal(registries.commands.resolve("say"), command);
    assert.equal(registries.agents.resolve("agent"), agent);
    assert.equal(registries.inputBuilders.resolve("input"), inputBuilder);
    assert.equal(registries.promptBuilders.resolve("prompt"), promptBuilder);
    assert.equal(registries.compactionStrategies.resolve("compact"), compactionStrategy);
    assert.equal(registries.storeFactories.resolve("memory"), storeFactory);
    assert.equal(registries.resourceLoaders.resolve("memory"), resourceLoader);
    assert.equal(registries.settingsProviders.resolve("settings"), settingsProvider);
    assert.equal(registries.credentialResolvers.resolve("credentials"), credentialResolver);
  });

  it("separate registry bundles do not share state", () => {
    const first = createContributionRegistries();
    const second = createContributionRegistries();

    first.tools.register(tool.name, tool);

    assert.equal(second.tools.get(tool.name), undefined);
    assert.throws(() => second.tools.resolve(tool.name), /Unknown tool: echo/);
  });
});
