import type { Skill, SkillRegistry, ToolDefinition } from "./contracts.js";
import { type DuplicateRegistrationOptions } from "./registry-options.js";
export interface ResolveActiveSkillsOptions {
    readonly registry: SkillRegistry;
    readonly names?: readonly string[];
    readonly tools?: readonly ToolDefinition[];
}
export interface SkillRegistryOptions extends DuplicateRegistrationOptions {
}
/**
 * Whether two registrations are the same skill: same name, same source file, same body. A child that
 * inherits the parent's skills and a package that discovers the same `SKILL.md` re-register one skill,
 * not two; a same-name skill from another path or with another body is still a conflict.
 */
export declare function isSameSkill(a: Skill, b: Skill): boolean;
export declare function createSkillRegistry(skills?: readonly Skill[], options?: SkillRegistryOptions): SkillRegistry;
export declare function resolveActiveSkills(options: ResolveActiveSkillsOptions): readonly Skill[];
/**
 * Every configured skill is active (roadmap §2.3 has no per-run skill narrowing): validate each
 * skill's `toolNames` requirement against the run's tools without rebuilding a registry.
 */
export declare function resolveAllActiveSkills(skills: readonly Skill[], tools: readonly ToolDefinition[]): readonly Skill[];
