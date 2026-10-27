import type { ProviderRequest, Skill } from "./contracts.js";
import type { HookRegistrar } from "./hooks/types.js";
import { type SkillRenderContext } from "./skill-disclosure.js";
interface Catalog {
    readonly skills: readonly Skill[];
    readonly context: SkillRenderContext;
}
declare const CATALOG: unique symbol;
/** Internal per-request rendering state; never serialized, persisted, or shared across sessions. */
export declare function deferSkillCatalog(request: ProviderRequest, skills: readonly Skill[], context: SkillRenderContext): void;
export declare function skillCatalogDraft(request: ProviderRequest): {
    readonly [CATALOG]?: Catalog;
};
/**
 * The kernel's own `context.build` registration (roadmap §2.4 "Replaces: skills catalog"). The
 * catalog is rendered at the stable-prefix boundary, so skills move ahead of context blocks
 * (plan 148 Task 1(h)). Named `kernel:context.build`, so `inspect().hooks` lists it and
 * `disable.hooks` can remove it.
 */
export declare function registerSkillCatalog(hooks: HookRegistrar): void;
export {};
