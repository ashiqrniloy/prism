import type { ExternalActivity } from "../../loop/index.js";

type SubagentActivity = Extract<ExternalActivity, { kind: "subagent" }>;

export interface SubagentScopes {
  open(id: string, parentToolCallId?: string, name?: string): SubagentActivity;
  close(id: string, result?: string): SubagentActivity;
  /** Ids currently open, outermost first. */
  readonly active: () => readonly string[];
}

/**
 * Tracks nested sub-agent scopes for a driver and builds the `subagent` activities the controller turns into
 * nested event origins. Closing an id closes every scope opened inside it first, as the controller does.
 */
export function subagentScopes(): SubagentScopes {
  const stack: string[] = [];
  return {
    open(id, parentToolCallId, name) {
      stack.push(id);
      return { kind: "subagent", phase: "started", id, ...(name ? { name } : {}), ...(parentToolCallId ? { parentToolCallId } : {}) };
    },
    close(id, result) {
      const at = stack.lastIndexOf(id);
      if (at !== -1) stack.length = at;
      return { kind: "subagent", phase: "completed", id, ...(result !== undefined ? { result } : {}) };
    },
    active: () => [...stack],
  };
}
