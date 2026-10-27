/**
 * Host helpers for the `tool.call` gate. `interruptBeforeTool` retired in favour of a host
 * `tool.call` hook returning `{ ask }` (roadmap §2.4); {@link askEveryTool} is that hook for a host
 * that gates every tool.
 */
import type { HookRegistrar } from "./types.js";
/**
 * Host hook registrar that asks before every tool call. The kernel resolves each ask with an inline
 * `host.ui` confirm when a UI is attached, and otherwise suspends the run.
 */
export declare function askEveryTool(reason?: string): (hooks: HookRegistrar) => void;
