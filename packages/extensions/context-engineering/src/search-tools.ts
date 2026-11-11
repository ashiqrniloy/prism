/**
 * The `search_tools` activation tool for `@arnilo/prism-extensions/context-engineering` (plan 158 Task 7).
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
import { createActiveToolSet, createSearchToolsTool, createToolSearchIndex, SEARCH_TOOLS_TOOL_NAME } from "./tool-search.js";
import { readActivatedNames, writeActivatedNames } from "./state.js";

/** `ToolSearchState` with the two fields `publish` rewrites between turns. */
export type MutableToolSearchState = { -readonly [K in keyof ToolSearchState]: ToolSearchState[K] };

export interface SearchToolsWiring {
  /** Publishes this turn's tool index for a session. Called by the `context.build` handler. */
  publish(session: SessionContext, tools: readonly ToolDefinition[], topK: number): void;
  /** The activation tool. Registered only when `toolSearch.disclosure === "search"`. */
  tool: ToolDefinition;
}

export function createSearchToolsWiring(options: {
  readonly activatedState: SessionState<JsonObject>;
  readonly states: Map<string, MutableToolSearchState>;
}): SearchToolsWiring {
  /** One live state per session, created on the first publish and mutated in place after that. */
  const stateFor = (session: SessionContext): MutableToolSearchState => {
    const existing = options.states.get(session.id);
    if (existing) return existing;
    const created: MutableToolSearchState = {
      index: createToolSearchIndex([], (tool) => tool.name === SEARCH_TOOLS_TOOL_NAME),
      activated: createActiveToolSet(),
      topK: 1,
    };
    for (const name of readActivatedNames(options.activatedState.get(session))) created.activated.add(name);
    options.states.set(session.id, created);
    return created;
  };

  // The ported tool holds one state object; the facade forwards to the session `execute` selected.
  const cell: { current?: MutableToolSearchState } = {};
  const facade: ToolSearchState = {
    get index() {
      return current(cell).index;
    },
    get activated() {
      return current(cell).activated;
    },
    get topK() {
      return current(cell).topK;
    },
  };
  const base = createSearchToolsTool(facade);
  const tool: ToolDefinition = {
    ...base,
    execute: async (args, context) => {
      const session = context.session;
      if (!session) return base.execute(args, context);
      const state = stateFor(session);
      cell.current = state;
      const result = base.execute(args, context);
      if (state.activated.list().length > 0) await options.activatedState.set(session, writeActivatedNames(state.activated.list()));
      return result;
    },
  };

  return {
    publish: (session, tools, topK) => {
      const state = stateFor(session);
      state.index = createToolSearchIndex(tools, (tool) => tool.name === SEARCH_TOOLS_TOOL_NAME);
      state.topK = topK;
    },
    tool,
  };
}

function current(cell: { current?: MutableToolSearchState }): MutableToolSearchState {
  if (!cell.current) throw new Error("search_tools has no published index for this session");
  return cell.current;
}
