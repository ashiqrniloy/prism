import type { Skill, SkillRegistry, ToolDefinition } from "./contracts.js";
import { type LoadedSkillSet } from "./skill-disclosure.js";
export declare const DEFAULT_LOAD_SKILL_TOOL_NAME: "load_skill";
export declare const SKILL_LOAD_ERROR_CODE: "skill_load_failed";
/** HARD_MAX_SKILL_INSTRUCTION_BYTES (262_144) + a 1_024-byte header allowance. */
export declare const MAX_LOAD_SKILL_RESULT_BYTES = 263168;
export declare const MAX_PERSISTED_SKILL_BODIES = 64;
export declare const MAX_PERSISTED_SKILL_BODY_NAME_CHARS = 256;
export declare const MAX_PERSISTED_SKILL_BODY_BYTES = 262144;
export declare const HARD_MAX_PERSISTED_SKILL_BODY_TOTAL_BYTES: number;
/** One persisted loaded-skill body (plan 018 closeout `checkpoint-bodies`). */
export interface LoadedSkillBodiesEntry {
    readonly name: string;
    readonly instructions: string;
}
/** Fail-closed shape/cap validation for a persisted bodies payload (load and save sides). */
export declare function validateLoadedSkillBodies(value: unknown): asserts value is readonly LoadedSkillBodiesEntry[];
/**
 * Snapshot the exact instructions of every loaded skill (registry-independent).
 * Loaded names without instructions are skipped (they render no body anyway);
 * a restored body for a loaded name wins over the registry body.
 */
export declare function snapshotLoadedSkillBodies(skills: readonly Skill[], loaded: LoadedSkillSet, restored?: ReadonlyMap<string, string>): LoadedSkillBodiesEntry[];
/**
 * Apply persisted bodies to the skills a resumed session will render: replace the
 * instructions of known skills and append synthesized skills for names the live
 * registry no longer serves, so the exact loaded text renders registry-independently.
 */
export declare function applyRestoredSkillBodies(skills: readonly Skill[], bodies: readonly LoadedSkillBodiesEntry[]): readonly Skill[];
export declare class SkillLoadError extends Error {
    readonly code: "skill_load_failed";
    constructor(message: string);
}
export declare function isSkillLoadError(error: unknown): error is SkillLoadError;
export interface ResolveSkillLoadOptions {
    readonly registry: SkillRegistry;
    readonly name: string;
    readonly tools?: readonly ToolDefinition[];
    readonly loaded?: LoadedSkillSet;
    readonly activeSkillNames?: readonly string[];
    /** The tool answers an already-loaded skill as a normal result; direct callers keep the failure. */
    readonly allowLoaded?: boolean;
}
export declare function resolveSkillLoad(options: ResolveSkillLoadOptions): Skill;
export interface CreateLoadSkillToolOptions {
    readonly registry: SkillRegistry;
    readonly loaded?: LoadedSkillSet;
    readonly tools?: readonly ToolDefinition[];
    readonly name?: string;
}
export declare function createLoadSkillTool(options: CreateLoadSkillToolOptions): ToolDefinition;
