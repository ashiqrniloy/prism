import type { Message, ProviderRequest, Skill } from "./contracts.js";
import type { ContextDraft, HookRegistrar } from "./hooks/types.js";
import { skillMessages, type SkillRenderContext } from "./skill-disclosure.js";

interface Catalog {
  readonly skills: readonly Skill[];
  readonly context: SkillRenderContext;
}

/**
 * Per-request rendering state, carried from input assembly to the `kernel:context.build` handler.
 * A `WeakMap` keyed on the request object keeps the skill bodies off the public `ContextDraft`:
 * a handler cannot inject skills, only the kernel's own registration can render them.
 */
const catalogs = new WeakMap<ProviderRequest, Catalog>();
const CATALOG = Symbol("skills-catalog");
type CatalogDraft = ContextDraft & { readonly [CATALOG]?: Catalog };

/** Internal per-request rendering state; never serialized, persisted, or shared across sessions. */
export function deferSkillCatalog(request: ProviderRequest, skills: readonly Skill[], context: SkillRenderContext): void {
  catalogs.set(request, { skills, context });
}

export function skillCatalogDraft(request: ProviderRequest): { readonly [CATALOG]?: Catalog } {
  const catalog = catalogs.get(request);
  return catalog ? { [CATALOG]: catalog } : {};
}

/**
 * The kernel's own `context.build` registration (roadmap §2.4 "Replaces: skills catalog"). The
 * catalog is rendered at the stable-prefix boundary, so skills move ahead of context blocks
 * (plan 148 Task 1(h)). Named `kernel:context.build`, so `inspect().hooks` lists it and
 * `disable.hooks` can remove it.
 */
export function registerSkillCatalog(hooks: HookRegistrar): void {
  hooks.on("context.build", (draft: CatalogDraft): ContextDraft | undefined => {
    const catalog = draft[CATALOG];
    if (!catalog) return undefined;
    const rendered = skillMessages(catalog.skills, catalog.context);
    if (!rendered.length) return undefined;
    const boundary = draft.messages.findIndex((message) => message.role !== "system");
    const at = boundary < 0 ? draft.messages.length : boundary;
    const messages: readonly Message[] = [...draft.messages.slice(0, at), ...rendered, ...draft.messages.slice(at)];
    return { ...draft, messages };
  });
}
