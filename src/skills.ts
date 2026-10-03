import type { Skill, SkillRegistry, ToolDefinition } from "./contracts.js";
import { assertCanRegister, type DuplicateRegistrationOptions } from "./registry-options.js";

export interface ResolveActiveSkillsOptions {
  readonly registry: SkillRegistry;
  readonly names?: readonly string[];
  readonly tools?: readonly ToolDefinition[];
}

export interface SkillRegistryOptions extends DuplicateRegistrationOptions {}

export function createSkillRegistry(skills: readonly Skill[] = [], options: SkillRegistryOptions = {}): SkillRegistry {
  const byName = new Map<string, Skill>();

  const registry: SkillRegistry = {
    register(skill) {
      assertCanRegister(byName, skill.name, "skill", skill.name, options.duplicate);
      byName.set(skill.name, skill);
    },
    get(name) {
      return byName.get(name);
    },
    resolve(name) {
      const skill = byName.get(name);
      if (!skill) throw new Error(`Unknown skill: ${name}`);
      return skill;
    },
    list() {
      return [...byName.values()];
    },
    unregister(name) {
      return byName.delete(name);
    },
  };

  for (const skill of skills) registry.register(skill);
  return registry;
}

export function resolveActiveSkills(options: ResolveActiveSkillsOptions): readonly Skill[] {
  const toolNames = new Set((options.tools ?? []).map((tool) => tool.name));
  return (options.names ?? []).map((name) => {
    const skill = options.registry.resolve(name);
    assertSkillTools(skill, toolNames);
    return skill;
  });
}

/**
 * Every configured skill is active (roadmap §2.3 has no per-run skill narrowing): validate each
 * skill's `toolNames` requirement against the run's tools without rebuilding a registry.
 */
export function resolveAllActiveSkills(skills: readonly Skill[], tools: readonly ToolDefinition[]): readonly Skill[] {
  const toolNames = new Set(tools.map((tool) => tool.name));
  for (const skill of skills) assertSkillTools(skill, toolNames);
  return skills;
}

function assertSkillTools(skill: Skill, toolNames: ReadonlySet<string>): void {
  const missingTool = skill.toolNames?.find((toolName) => !toolNames.has(toolName));
  if (missingTool) throw new Error(`Skill ${skill.name} requires inactive tool: ${missingTool}`);
}
