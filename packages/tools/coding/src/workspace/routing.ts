/**
 * Per-session worktree routing (plan 165 Task 7).
 *
 * A session bound by `worktree.create({ sessionId })` runs every cwd-taking tool of this package
 * inside that session's worktree. The registered set wraps each base tool with one `execute` that
 * looks the calling session's worktree up and dispatches to the instance built for that worktree,
 * so no tool needs to know about sessions and no schema changes.
 *
 * The binding is the service's memory, keyed by session id: it is never read from tool arguments or
 * model output. An unbound session (or an unknown session id) falls through to the base tool.
 *
 * ```ts
 * const routing = createWorktreeRouting({ base, create: cwdTools, workspace });
 * prism.hooks.on("session.closed", (event) => routing.forget(event.sessionId), { id: "workspace-routing" });
 * for (const tool of routing.tools) prism.tools.register(tool);
 * ```
 */
import type { JsonObject, ToolDefinition, ToolExecutionContext, ToolResult } from "@arnilo/prism";

import type { WorkspaceService } from "./service.js";

export interface WorktreeRoutingOptions {
  /** The tool set built for the package root; registered as-is for a session without a worktree. */
  readonly base: readonly ToolDefinition[];
  /** Builds the cwd-taking tools for one directory. Called once per bound worktree. */
  readonly create: (cwd: string) => readonly ToolDefinition[];
  readonly workspace: WorkspaceService;
}

export interface WorktreeRouting {
  /** `base`, with every tool `create` also returns dispatched per session. */
  readonly tools: readonly ToolDefinition[];
  /** Drops one session's cached instances. Wire to `session.closed`. */
  forget(sessionId: string): void;
}

interface CachedTools {
  readonly path: string;
  readonly byName: ReadonlyMap<string, ToolDefinition>;
}

export function createWorktreeRouting(options: WorktreeRoutingOptions): WorktreeRouting {
  const cache = new Map<string, CachedTools>();

  /**
   * The tool instances for `sessionId`'s worktree, built on first use. A disposed worktree unbinds,
   * so the entry is dropped on the next call; a session rebound to another worktree rebuilds.
   */
  function instancesFor(sessionId: string): ReadonlyMap<string, ToolDefinition> | undefined {
    const worktree = options.workspace.worktree.bound(sessionId);
    if (worktree === undefined) {
      cache.delete(sessionId);
      return undefined;
    }
    const cached = cache.get(sessionId);
    if (cached !== undefined && cached.path === worktree.path) return cached.byName;
    const byName = new Map(options.create(worktree.path).map((tool) => [tool.name, tool]));
    cache.set(sessionId, { path: worktree.path, byName });
    return byName;
  }

  const tools = options.base.map((tool) => ({
    ...tool,
    async execute(args: JsonObject, context: ToolExecutionContext): Promise<ToolResult> {
      const instance = instancesFor(context.sessionId)?.get(tool.name);
      return await (instance ?? tool).execute(args, context);
    },
  }));

  return {
    tools,
    forget(sessionId) {
      cache.delete(sessionId);
    },
  };
}
