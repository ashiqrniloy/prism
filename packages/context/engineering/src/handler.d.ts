/**
 * The package's one `context.build` handler (plan 158 Task 7).
 *
 * It composes the configured stages in a fixed order — **fold → tool search → attention or budget** —
 * so the order cannot drift with hook priorities, and there is no plugin registry for stages. The
 * handler runs at the lowest first-party priority (negative), so a budget or an attention pass sees
 * every block another `context.build` handler added this turn.
 *
 * Everything here changes the provider view only. The store keeps the full transcript: the handler
 * rewrites a clone of `draft.messages` and returns it, and the kernel's `message.append` path is
 * untouched. `context_engineering_fold_view_only` proves it.
 */
import type { ContextDraft, HookContext, HookRejection, JsonObject, JsonValue, Message, PackageAPI, SessionContext, SessionLog, SessionState } from "@arnilo/prism";
import type { AttentionCompiler } from "./attention-types.js";
import type { ContextEngineeringConfig, ResolvedContextEngineeringConfig } from "./config.js";
import { type ToolResultFoldInput } from "./fold.js";
import type { SearchToolsWiring } from "./search-tools.js";
/** The lowest first-party priority: nothing else registered by a package runs after this one. */
export declare const CONTEXT_ENGINEERING_PRIORITY = -1000;
export interface ContextEngineeringHandlerDeps {
    readonly prism: PackageAPI<ContextEngineeringConfig>;
    readonly config: ResolvedContextEngineeringConfig;
    /** Sticky frontier, one value per session. */
    readonly frontierState: SessionState<JsonObject>;
    /** Batch fold frontier (cleared tool-call ids), its own key and value. */
    readonly foldFrontierState: SessionState<JsonObject>;
    /** Folded bodies, one append per newly summarized result. */
    readonly foldLog: SessionLog<JsonValue>;
    /** Activated tool names, one value per session. */
    readonly activatedState: SessionState<JsonObject>;
    /** The fold's summarize function for one session (`"truncate"` or a model client call). */
    readonly summarizeFor: (session: SessionContext) => (input: ToolResultFoldInput) => Promise<string> | string;
    /** The compiled attention handle for one session, memoized by the caller. */
    readonly attentionCompilerFor: (session: SessionContext) => AttentionCompiler;
    /** The `search_tools` wiring, present only when the disclosure stage is configured. */
    readonly searchTools?: SearchToolsWiring;
}
export type ContextEngineeringHandler = (draft: ContextDraft, context: HookContext) => Promise<ContextDraft | undefined | HookRejection>;
export declare function createContextEngineeringHandler(deps: ContextEngineeringHandlerDeps): ContextEngineeringHandler;
/** The provider turn the draft belongs to: one per assistant reply already in the transcript. */
export declare function currentTurnOf(messages: readonly Message[]): number;
