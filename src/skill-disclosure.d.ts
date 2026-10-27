import type { Message, Skill } from "./contracts.js";
export type SkillsDisclosure = "progressive" | "eager";
export declare const EMPTY_SKILL_DESCRIPTION: "(no description)";
export declare const DEFAULT_MAX_SKILL_CATALOG_ENTRIES = 64;
export declare const DEFAULT_MAX_SKILL_DESCRIPTION_BYTES = 512;
export declare const DEFAULT_MAX_SKILL_INSTRUCTION_BYTES = 32768;
export declare const HARD_MAX_SKILL_INSTRUCTION_BYTES = 262144;
export interface LoadedSkillSet {
    has(name: string): boolean;
    /** Record a load; the optional run id keeps compaction re-attach run-scoped. */
    add(name: string, runId?: string): void;
    list(): readonly string[];
    clear(): void;
    /** Name→run view; optional so an existing host implementation keeps compiling. */
    entries?(): readonly {
        readonly name: string;
        readonly runId?: string;
    }[];
    remove?(name: string): void;
}
export declare function createLoadedSkillSet(): LoadedSkillSet;
export interface SkillRenderContext {
    readonly disclosure?: SkillsDisclosure;
    readonly loaded?: LoadedSkillSet;
    /** Budget demotion: render catalog-only even when eager/loaded. */
    readonly demotedBodies?: ReadonlySet<string>;
}
export declare function resolveSkillsDisclosure(run?: SkillsDisclosure, agent?: SkillsDisclosure): SkillsDisclosure;
export declare function capSkillCatalog(skills: readonly Skill[]): readonly Skill[];
/** Skills that should appear in prompt assembly for the given disclosure mode. */
export declare function selectSkillsForPrompt(skills: readonly Skill[], context?: SkillRenderContext): readonly Skill[];
export declare function skillHasRenderableBody(skill: Skill, context?: SkillRenderContext): boolean;
export declare function skillPromptText(skill: Skill, context?: SkillRenderContext): string | undefined;
export declare function skillMessages(skills: readonly Skill[] | undefined, context?: SkillRenderContext): Message[];
