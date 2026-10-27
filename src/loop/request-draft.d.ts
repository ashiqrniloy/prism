/** Request-shaping shared by the run loop and the session's overflow recovery (plan 194 Task 3). */
import type { ProviderRequest } from "../contracts.js";
import type { ContextDraft, HookBus } from "../hooks/index.js";
/** The draft a `context.build` handler sees for one assembled request. */
export declare function draftFromRequest(request: ProviderRequest): ContextDraft;
/** Render a `context.build` draft back onto the assembled request. */
export declare function applyDraft(request: ProviderRequest, draft: ContextDraft): ProviderRequest;
/**
 * Run the public request pipeline on an already-assembled request: `context.build` then
 * `model.request`, including the secrets a transform declared. Used per turn and, after an
 * overflow compaction, to rebuild the request from the shrunken branch.
 */
export declare function applyRequestTransforms(hooks: HookBus, scope: {
    readonly sessionId: string;
    readonly runId: string;
}, request: ProviderRequest): Promise<{
    readonly request: ProviderRequest;
    readonly secrets: (string | undefined)[];
}>;
