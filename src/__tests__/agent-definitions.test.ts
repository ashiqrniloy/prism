import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Agent, AgentConfig, AgentDefinition, AgentDefinitionResolutionContext, AIProvider, ContextProvider, Skill, SkillRegistry, ToolDefinition, ToolRegistry } from "../index.js";
import {
  createAgent,
  createContributionRegistries,
  createSkillRegistry,
  createToolRegistry,
  resolveAgentDefinition,
} from "../index.js";

const provider: AIProvider = {
  id: "mock",
  async *generate() {
    yield { type: "done" };
  },
};

const echoTool: ToolDefinition = {
  name: "echo",
  execute(args, ctx) {
    return { toolCallId: ctx.toolCallId, name: "echo", value: args };
  },
};

const reverseTool: ToolDefinition = {
  name: "reverse",
  execute(args, ctx) {
    return { toolCallId: ctx.toolCallId, name: "reverse", value: args };
  },
};

const demoContext: ContextProvider = {
  name: "demo-context",
  resolve() {
    return [{ title: "Demo", content: "context block" }];
  },
};

const briefSkill: Skill = { name: "brief" };

const schemaSkill: Skill = {
  name: "schema",
  toolNames: ["echo"],
  context: [
    {
      name: "schema-context",
      resolve() {
        return [{ title: "Schema", content: "schema context" }];
      },
    },
  ],
};

function toolNames(tools: ToolRegistry | readonly ToolDefinition[] | undefined): string[] {
  if (!tools) return [];
  return "list" in tools ? tools.list().map((t) => t.name) : tools.map((t) => t.name);
}

function skillNames(skills: { list(): readonly Skill[] } | readonly Skill[] | undefined): string[] {
  if (!skills) return [];
  return "list" in skills ? skills.list().map((s) => s.name) : skills.map((s) => s.name);
}

async function resolve(def: AgentDefinition, context: AgentDefinitionResolutionContext): Promise<Agent> {
  const result = resolveAgentDefinition(def, context);
  return await result;
}

describe("resolveAgentDefinition", () => {
  it("declarative resolution produces a runnable agent", async () => {
    const registries = createContributionRegistries();
    registries.providers.register(provider);
    registries.models.register({ provider: "mock", model: "demo" });
    registries.tools.register(echoTool.name, echoTool);
    registries.skills.register(briefSkill.name, briefSkill);
    registries.contextProviders.register(demoContext.name, demoContext);

    const def: AgentDefinition = {
      name: "declarative",
      model: "mock/demo",
      tools: ["echo"],
      skills: ["brief"],
      context: ["demo-context"],
      instructions: "Be helpful.",
    };

    const agent = await resolve(def, { registries });
    assert.equal(agent.config.model.provider, "mock");
    assert.equal(agent.config.model.model, "demo");
    assert.equal(agent.config.provider?.id, "mock");
    assert.equal(agent.config.instructions, "Be helpful.");
    assert.deepEqual(toolNames(agent.config.tools), ["echo"]);
    assert.deepEqual(
      agent.config.context?.map((c) => c.name),
      ["demo-context"],
    );

    const session = agent.createSession();
    const events: unknown[] = [];
    const subscription = session.subscribe();
    const consume = (async () => {
      for await (const event of subscription) events.push(event);
    })();
    await session.run("hi");
    await consume;
    assert.ok(events.some((e) => (e as { type: string }).type === "agent_started"));
  });

  it("resolves model by id from registries.models", async () => {
    const registries = createContributionRegistries();
    registries.providers.register(provider);
    registries.models.register({ provider: "mock", model: "registered" });

    const def: AgentDefinition = {
      name: "model-by-id",
      model: "mock/registered",
    };

    const agent = await resolve(def, { registries });
    assert.equal(agent.config.model.model, "registered");
  });

  it("uses providerSource when registries.providers is absent", async () => {
    const def: AgentDefinition = {
      name: "provider-source",
      model: "mock/demo",
    };

    const agent = await resolve(def, { providerSource: () => provider });
    assert.equal(agent.config.providerSource?.({ provider: "mock", model: "demo" })?.id, "mock");
  });

  it("create() escape hatch returns custom agent and applies overrides", async () => {
    const customAgent = createAgent({
      model: { provider: "custom", model: "v1" },
      provider,
    });

    const def: AgentDefinition = {
      name: "custom",
      model: "mock/demo",
      create(config) {
        assert.equal(config!.model.provider, "mock");
        return customAgent;
      },
    };

    const agent = await resolve(def, {
      providerSource: () => provider,
      overrides: { model: { provider: "overridden", model: "v2" } },
    });
    assert.equal(agent.config.model.provider, "overridden");
    assert.equal(agent.config.model.model, "v2");
  });

  it("async create() escape hatch applies overrides", async () => {
    const def: AgentDefinition = {
      name: "async-custom",
      model: "mock/demo",
      async create() {
        return createAgent({ model: { provider: "custom", model: "v1" }, provider });
      },
    };

    const agent = await resolve(def, {
      providerSource: () => provider,
      overrides: { model: { provider: "overridden", model: "v2" } },
    });
    assert.equal(agent.config.model.provider, "overridden");
  });

  it("overrides swap model and drop tool", async () => {
    const registries = createContributionRegistries();
    registries.providers.register(provider);
    registries.models.register({ provider: "mock", model: "demo" });
    registries.tools.register(echoTool.name, echoTool);
    registries.tools.register(reverseTool.name, reverseTool);

    const def: AgentDefinition = {
      name: "override-test",
      model: "mock/demo",
      tools: ["echo", "reverse"],
    };

    const agent = await resolve(def, {
      registries,
      overrides: {
        model: { provider: "mock", model: "override" },
        tools: [echoTool],
      },
    });
    assert.equal(agent.config.model.model, "override");
    assert.deepEqual(toolNames(agent.config.tools), ["echo"]);
  });

  it("missing model throws before provider turn", () => {
    const def: AgentDefinition = { name: "no-model" };
    assert.throws(() => resolveAgentDefinition(def, {}), /has no model/);
  });

  it("unknown model id throws", () => {
    const registries = createContributionRegistries();
    const def: AgentDefinition = { name: "unknown-model", model: "mock/missing" };
    assert.throws(() => resolveAgentDefinition(def, { registries }), /Unknown model: mock\/missing/);
  });

  it("unknown tool name throws", () => {
    const registries = createContributionRegistries();
    registries.providers.register(provider);
    registries.models.register({ provider: "mock", model: "demo" });
    const def: AgentDefinition = { name: "unknown-tool", model: "mock/demo", tools: ["missing"] };
    assert.throws(() => resolveAgentDefinition(def, { registries }), /Unknown tool: missing/);
  });

  it("unknown skill name throws", () => {
    const registries = createContributionRegistries();
    registries.providers.register(provider);
    registries.models.register({ provider: "mock", model: "demo" });
    registries.tools.register(echoTool.name, echoTool);
    const def: AgentDefinition = { name: "unknown-skill", model: "mock/demo", skills: ["missing"] };
    assert.throws(() => resolveAgentDefinition(def, { registries }), /Unknown skill: missing/);
  });

  it("unknown context provider name throws", () => {
    const registries = createContributionRegistries();
    registries.providers.register(provider);
    registries.models.register({ provider: "mock", model: "demo" });
    const def: AgentDefinition = { name: "unknown-context", model: "mock/demo", context: ["missing"] };
    assert.throws(() => resolveAgentDefinition(def, { registries }), /Unknown context provider: missing/);
  });

  it("skill toolNames enforcement fails when demanded tool is not active", () => {
    const registries = createContributionRegistries();
    registries.providers.register(provider);
    registries.models.register({ provider: "mock", model: "demo" });
    registries.tools.register(reverseTool.name, reverseTool);
    registries.skills.register(schemaSkill.name, schemaSkill);

    const def: AgentDefinition = {
      name: "skill-toolnames",
      model: "mock/demo",
      tools: ["reverse"],
      skills: ["schema"],
    };

    assert.throws(
      () => resolveAgentDefinition(def, { registries }),
      /Skill schema requires inactive tool: echo/,
    );
  });

  it("host tool registry limits scope for declarative tool names", async () => {
    const hostTools = createToolRegistry([echoTool]);
    const registries = createContributionRegistries();
    registries.providers.register(provider);
    registries.models.register({ provider: "mock", model: "demo" });
    registries.tools.register(reverseTool.name, reverseTool);

    const def: AgentDefinition = {
      name: "host-tool-scope",
      model: "mock/demo",
      tools: ["reverse"],
    };

    assert.throws(() => resolveAgentDefinition(def, { registries, tools: hostTools }), /Unknown tool: reverse/);

    const allowed = await resolve(def, { registries, tools: createToolRegistry([reverseTool]) });
    assert.deepEqual(toolNames(allowed.config.tools), ["reverse"]);
  });

  it("omitted tools and skills activate nothing by default", async () => {
    const hostTools = createToolRegistry([echoTool, reverseTool]);
    const skillsRegistry = createSkillRegistry([briefSkill]);
    const def: AgentDefinition = { name: "explicit-default", model: "mock/demo" };

    const agent = await resolve(def, { tools: hostTools, skillsRegistry });

    assert.deepEqual(toolNames(agent.config.tools), []);
    assert.deepEqual(skillNames(agent.config.skills), []);
  });

  it("legacy opt-in activates all scoped tools and skills", async () => {
    const hostTools = createToolRegistry([echoTool, reverseTool]);
    const skillsRegistry = createSkillRegistry([briefSkill]);
    const def: AgentDefinition = { name: "legacy-passthrough", model: "mock/demo" };

    const agent = await resolve(def, { tools: hostTools, skillsRegistry, activateAllCapabilities: true });

    assert.deepEqual(toolNames(agent.config.tools), ["echo", "reverse"]);
    assert.deepEqual(skillNames(agent.config.skills), ["brief"]);
  });

  it("migration path prefers named tools and skills over legacy all-capabilities", async () => {
    const hostTools = createToolRegistry([echoTool, reverseTool]);
    const skillsRegistry = createSkillRegistry([briefSkill, schemaSkill]);

    const named = await resolve(
      { name: "doc", model: "mock/demo", tools: ["echo"], skills: ["brief"] },
      { tools: hostTools, skillsRegistry },
    );
    const legacy = await resolve(
      { name: "legacy", model: "mock/demo" },
      { tools: hostTools, skillsRegistry, activateAllCapabilities: true },
    );

    assert.deepEqual(toolNames(named.config.tools), ["echo"]);
    assert.deepEqual(skillNames(named.config.skills), ["brief"]);
    assert.deepEqual(toolNames(legacy.config.tools), ["echo", "reverse"]);
    assert.deepEqual(skillNames(legacy.config.skills), ["brief", "schema"]);
  });

  it("omitted capabilities do not list scoped registries unless legacy opt-in is set", async () => {
    const baseTools = createToolRegistry([echoTool, reverseTool]);
    const baseSkills = createSkillRegistry([briefSkill]);
    let toolListCalls = 0;
    let skillListCalls = 0;
    const trackedTools: ToolRegistry = { ...baseTools, list: () => { toolListCalls += 1; return baseTools.list(); } };
    const trackedSkills: SkillRegistry = { ...baseSkills, list: () => { skillListCalls += 1; return baseSkills.list(); } };

    await resolve({ name: "safe", model: "mock/demo" }, { tools: trackedTools, skillsRegistry: trackedSkills });

    assert.equal(toolListCalls, 0);
    assert.equal(skillListCalls, 0);

    await resolve(
      { name: "legacy", model: "mock/demo" },
      { tools: trackedTools, skillsRegistry: trackedSkills, activateAllCapabilities: true },
    );

    assert.ok(toolListCalls > 0);
    assert.ok(skillListCalls > 0);
  });
});
