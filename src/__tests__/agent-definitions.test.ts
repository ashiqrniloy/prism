import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type {
  Agent,
  AgentDefinition,
  AgentDefinitionResolutionContext,
  ModelProvider,
  Skill,
  SkillRegistry,
  ToolDefinition,
  ToolRegistry,
} from "../index.js";
import { createAgent, createSkillRegistry, createToolRegistry, resolveAgentDefinition } from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

const provider: ModelProvider = {
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

const briefSkill: Skill = { name: "brief" };

const schemaSkill: Skill = {
  name: "schema",
  toolNames: ["echo"],
};

function toolNames(tools: { readonly add?: readonly ToolDefinition[] } | ToolRegistry | readonly ToolDefinition[] | undefined): string[] {
  if (!tools) return [];
  if ("add" in tools && tools.add) return tools.add.map((t) => t.name);
  return "list" in tools ? tools.list().map((t) => t.name) : (tools as readonly ToolDefinition[]).map((t) => t.name);
}

function skillNames(skills: { readonly add?: readonly Skill[]; list?(): readonly Skill[] } | readonly Skill[] | undefined): string[] {
  if (!skills) return [];
  if ("add" in skills && skills.add) return skills.add.map((s) => s.name);
  if ("list" in skills && typeof skills.list === "function") return skills.list().map((s) => s.name);
  return (skills as readonly Skill[]).map((s) => s.name);
}

async function resolve(def: AgentDefinition, context: AgentDefinitionResolutionContext): Promise<Agent> {
  const result = resolveAgentDefinition(def, context);
  return await result;
}

describe("resolveAgentDefinition", () => {
  it("declarative resolution produces a runnable agent", async () => {
    const def: AgentDefinition = {
      name: "declarative",
      model: "mock/demo",
      tools: ["echo"],
      skills: ["brief"],
      instructions: "Be helpful.",
    };

    const agent = await resolve(def, {
      overrides: { packages: [providerPackage("test-provider", [provider])] },
      tools: [echoTool],
      skillsRegistry: createSkillRegistry([briefSkill]),
    });
    assert.equal(agent.config.model.provider, "mock");
    assert.equal(agent.config.model.model, "demo");
    assert.equal(agent.config.instructions, "Be helpful.");
    assert.deepEqual(toolNames(agent.config.tools), ["echo"]);

    const session = await agent.session();
    const events: unknown[] = [];
    const subscription = session.subscribe();
    const consume = (async () => {
      for await (const event of subscription) events.push(event);
    })();
    await session.run("hi");
    await consume;
    assert.ok(events.some((e) => (e as { type: string }).type === "run.started"));
  });

  it("resolves a provider/model string without a registry", async () => {
    const def: AgentDefinition = {
      name: "model-by-id",
      model: "mock/registered",
    };

    const agent = await resolve(def, {});
    assert.equal(agent.config.model.model, "registered");
  });

  it("create() escape hatch returns custom agent and applies overrides", async () => {
    const customAgent = await createAgent({
      model: { provider: "custom", model: "v1" },
      packages: [providerPackage("test-provider", [provider])],
    });

    const def: AgentDefinition = {
      name: "custom",
      model: "mock/demo",
      create(config) {
        assert.equal((config!.model as { provider: string }).provider, "mock");
        return customAgent;
      },
    };

    const agent = await resolve(def, {
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
        return await createAgent({ model: { provider: "custom", model: "v1" }, packages: [providerPackage("test-provider", [provider])] });
      },
    };

    const agent = await resolve(def, {
      overrides: { model: { provider: "overridden", model: "v2" } },
    });
    assert.equal(agent.config.model.provider, "overridden");
  });

  it("overrides swap model and drop tool", async () => {
    const def: AgentDefinition = {
      name: "override-test",
      model: "mock/demo",
      tools: ["echo", "reverse"],
    };

    const agent = await resolve(def, {
      tools: [echoTool, reverseTool],
      overrides: {
        model: { provider: "mock", model: "override" },
        tools: { add: [echoTool] },
      },
    });
    assert.equal(agent.config.model.model, "override");
    assert.deepEqual(toolNames(agent.config.tools), ["echo"]);
  });

  it("missing model throws before provider turn", () => {
    const def: AgentDefinition = { name: "no-model" };
    assert.throws(() => resolveAgentDefinition(def, {}), /has no model/);
  });

  // FEATURE-1 (integration findings, plan 050 Task 4): a definition
  // without a model resolves from context.overrides.model (host-injected
  // selection) instead of throwing. Explicit def.model keeps driving registry
  // resolution; overrides may still replace model post-resolution like any
  // other config field (see "overrides swap model" above).
  it("missing def.model resolves from overrides.model", async () => {
    const def: AgentDefinition = { name: "override-model", instructions: "Be brief." };
    const resolved = await resolveAgentDefinition(def, {
      overrides: { model: { provider: "mock", model: "demo" } },
    });
    assert.equal(resolved.config.model.provider, "mock");
    assert.equal(resolved.config.model.model, "demo");
  });

  it("missing def.model and no overrides.model still throws", () => {
    const def: AgentDefinition = { name: "no-model-anywhere" };
    assert.throws(() => resolveAgentDefinition(def, { overrides: { instructions: "late" } }), /Agent "no-model-anywhere" has no model/);
  });

  it("unknown model id throws", () => {
    const def: AgentDefinition = { name: "unknown-model", model: "missing" };
    assert.throws(() => resolveAgentDefinition(def, {}), /Unknown model: missing/);
  });

  it("unknown tool name throws", () => {
    const def: AgentDefinition = { name: "unknown-tool", model: "mock/demo", tools: ["missing"] };
    assert.throws(() => resolveAgentDefinition(def, { tools: [echoTool] }), /Unknown tool: missing/);
  });

  it("unknown skill name throws", () => {
    const def: AgentDefinition = { name: "unknown-skill", model: "mock/demo", skills: ["missing"] };
    assert.throws(
      () => resolveAgentDefinition(def, { skillsRegistry: createSkillRegistry([briefSkill]) }),
      /Unknown skill: missing/,
    );
  });

  it("skill toolNames enforcement fails when demanded tool is not active", () => {
    const def: AgentDefinition = {
      name: "skill-toolnames",
      model: "mock/demo",
      tools: ["reverse"],
      skills: ["schema"],
    };

    assert.throws(
      () =>
        resolveAgentDefinition(def, {
          tools: [reverseTool],
          skillsRegistry: createSkillRegistry([schemaSkill]),
        }),
      /Skill schema requires inactive tool: echo/,
    );
  });

  it("host tool registry limits scope for declarative tool names", async () => {
    const hostTools = createToolRegistry([echoTool]);

    const def: AgentDefinition = {
      name: "host-tool-scope",
      model: "mock/demo",
      tools: ["reverse"],
    };

    assert.throws(() => resolveAgentDefinition(def, { tools: hostTools }), /Unknown tool: reverse/);

    const allowed = await resolve(def, { tools: createToolRegistry([reverseTool]) });
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
    const trackedTools: ToolRegistry = {
      ...baseTools,
      list: () => {
        toolListCalls += 1;
        return baseTools.list();
      },
    };
    const trackedSkills: SkillRegistry = {
      ...baseSkills,
      list: () => {
        skillListCalls += 1;
        return baseSkills.list();
      },
    };

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
