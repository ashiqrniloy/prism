/**
 * The `search_tools` activation tool for `@arnilo/prism-context-engineering` (plan 158 Task 7).
 *
 * The kernel built one `ToolSearchState` per run from the registry it owned. A package owns no
 * registry: the `context.build` handler is the only place that sees the tools a turn will actually
 * offer, so it publishes that turn's index into the session's live state and the tool reads it back.
 * The search therefore fails closed by construction — the index holds `draft.tools`, so a tool the
 * kernel hid with a `when` predicate or `disable.tools` is not in it and cannot be returned.
 *
 * The activated set is this package's in-memory `ActiveToolSet` (the ported tool reads it directly),
 * mirrored into session state after each activation so a reopened session keeps its activations.
 */
import type { JsonObject, SessionContext, SessionState, ToolDefinition } from "@arnilo/prism";
import type { ToolSearchState } from "./tool-search.js";
/** `ToolSearchState` with the two fields `publish` rewrites between turns. */
export type MutableToolSearchState = {
    -readonly [K in keyof ToolSearchState]: ToolSearchState[K];
};
export interface SearchToolsWiring {
    /** Publishes this turn's tool index for a session. Called by the `context.build` handler. */
    publish(session: SessionContext, tools: readonly ToolDefinition[], topK: number): void;
    /** The activation tool. Registered only when `toolSearch.disclosure === "search"`. */
    tool: ToolDefinition;
}
export declare function createSearchToolsWiring(options: {
    readonly activatedState: SessionState<JsonObject>;
    readonly states: Map<string, MutableToolSearchState>;
}): SearchToolsWiring;
