import type { ContextBlock } from "./contracts.js";
import type { ContextDraft, HookRegistrar } from "./hooks/types.js";
/**
 * A named block of host text contributed to the provider view every turn. This is the shape
 * `InstructionInjector` and `ContextProvider` collapse to now that both are `context.build`
 * handlers (plan 145 Task 4): instructions and context blocks, nothing else. A source cannot grant
 * tools, skills, or permissions — it can only add text to the draft.
 */
export interface ContextSource {
    readonly name: string;
    readonly instructions?: string;
    readonly contextBlocks?: readonly ContextBlock[];
}
/**
 * Append `blocks` to a draft's context, or return `undefined` when there is nothing to add — the
 * transform's way of saying "no change", so the controller skips re-deriving the request.
 */
export declare function withContextBlocks(draft: ContextDraft, blocks: readonly ContextBlock[]): ContextDraft | undefined;
/**
 * Register `sources` as one `context.build` handler, in order: each source's instructions become a
 * system message at the stable-prefix boundary and its context blocks append to the draft's
 * context. The draft is the provider view only, so nothing here reaches the store.
 *
 * Register once per registrar. An empty list registers nothing, so a host that configured no
 * sources keeps the exact pre-1.0 request bytes.
 */
export declare function registerContextSources(hooks: HookRegistrar, sources: readonly ContextSource[]): void;
