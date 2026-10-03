import { createAgent } from "./agents.js";
import type {
  Agent,
  AgentConfig,
  AgentDefinition,
  AgentDefinitionResolutionContext,
  AIProvider,
  ModelConfig,
  Skill,
  ToolDefinition,
  ToolRegistry,
} from "./contracts.js";
import { resolveActiveSkills } from "./skills.js";
import { createToolRegistry } from "./tools.js";

/** Resolve an {@link AgentDefinition} into a runnable {@link Agent}.
 *
 *  If the definition provides a `create()` escape hatch, that factory is called
 *  with a config built from the declarative fields and `context.overrides` are
 *  merged into the returned agent. Otherwise the declarative fields are resolved
 *  against the supplied registries and turned into an agent via
 *  {@link createAgent}.
 *
 *  The host controls scope by which registries it passes. Missing dependencies
 *  fail closed at resolution time, before any provider turn. */
export function resolveAgentDefinition(def: AgentDefinition, context: AgentDefinitionResolutionContext): Promise<Agent> | Agent {
  const baseConfig = buildBaseConfig(def, context);
  if (def.create) {
    const agentOrPromise = def.create(baseConfig);
    return applyAgentOverrides(agentOrPromise, context.overrides);
  }
  return createAgent(applyConfigOverrides(baseConfig, context.overrides));
}

function buildBaseConfig(def: AgentDefinition, context: AgentDefinitionResolutionContext): AgentConfig {
  // Model precedence: explicit def.model wins; a definition without a model
  // falls back to context.overrides.model (host-injected selection). Neither
  // present still fails closed in resolveModel.
  const model = resolveModel(def.name, def.model ?? context.overrides?.model, context);
  const tools = resolveTools(def.tools, context);
  const skills = resolveSkills(def.skills, tools, context);
  return {
    model,
    ...resolveProviderOptions(model, context),
    ...(tools !== undefined && { tools: { add: tools.list() } }),
    ...(skills !== undefined && { skills: { add: skills } }),
    ...(def.systemPrompt !== undefined && { systemPrompt: def.systemPrompt }),
    ...(def.instructions !== undefined && { instructions: def.instructions }),
    ...(def.attentionCompiler !== undefined && { attentionCompiler: def.attentionCompiler }),
    ...(def.metadata !== undefined && { metadata: def.metadata }),
  };
}

function resolveModel(agentName: string, model: ModelConfig | string | undefined, context: AgentDefinitionResolutionContext): ModelConfig {
  if (!model) throw new Error(`Agent "${agentName}" has no model`);
  if (typeof model !== "string") return model;
  const slash = model.indexOf("/");
  if (slash === -1) {
    throw new Error(`Unknown model: ${model}`);
  }
  const provider = model.slice(0, slash);
  const modelId = model.slice(slash + 1);
  return { provider, model: modelId };
}

function resolveProviderOptions(
  model: ModelConfig,
  context: AgentDefinitionResolutionContext,
): { provider?: AIProvider; providerSource?: (model: ModelConfig) => AIProvider | undefined } | undefined {
  if (context.providerSource) {
    return { providerSource: context.providerSource };
  }
  return undefined;
}

function resolveTools(names: readonly string[] | undefined, context: AgentDefinitionResolutionContext): ToolRegistry | undefined {
  const source = context.tools;
  if (!names) {
    if (!context.activateAllCapabilities) return undefined;
    if (!source) return undefined;
    return asToolRegistry(source);
  }
  if (!source) throw new Error("No tool registry in scope");
  const available = listFromToolSource(source);
  const resolved = names.map((name) => {
    const tool = available.find((item) => item.name === name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool;
  });
  return createToolRegistry(resolved);
}

function asToolRegistry(source: unknown): ToolRegistry {
  if (hasList(source)) {
    return createToolRegistry(source.list());
  }
  return createToolRegistry(source as readonly ToolDefinition[]);
}

function listFromToolSource(source: unknown): readonly ToolDefinition[] {
  if (hasList(source)) {
    return source.list();
  }
  return source as readonly ToolDefinition[];
}

function hasList(value: unknown): value is { list(): readonly ToolDefinition[] } {
  return typeof value === "object" && value !== null && "list" in value && typeof (value as { list?: unknown }).list === "function";
}

function resolveSkills(
  names: readonly string[] | undefined,
  tools: ToolRegistry | undefined,
  context: AgentDefinitionResolutionContext,
): readonly Skill[] | undefined {
  const registry = context.skillsRegistry;
  if (!names && !context.activateAllCapabilities) return undefined;
  if (!registry) {
    if (!names) return undefined;
    throw new Error("No skill registry in scope");
  }
  const toolList = tools?.list() ?? [];
  const activeNames = names ?? registry.list().map((skill) => skill.name);
  return resolveActiveSkills({ registry, names: activeNames, tools: toolList });
}

function applyConfigOverrides(config: AgentConfig, overrides: Partial<AgentConfig> | undefined): AgentConfig {
  if (!overrides) return config;
  return { ...config, ...overrides };
}

function applyAgentOverrides(agent: Agent | Promise<Agent>, overrides: Partial<AgentConfig> | undefined): Agent | Promise<Agent> {
  if (!overrides) return agent;
  if (agent instanceof Promise) {
    return agent.then((resolved) => createAgent({ ...resolved.config, ...overrides }));
  }
  return createAgent({ ...agent.config, ...overrides });
}
