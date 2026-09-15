import type { Agent } from "@arnilo/prism";
import type { DelegationChildContext, DelegationCompletion } from "@arnilo/prism-core/runtime/supervisor";
import type { CodingWorkspaceLifecycle } from "./workspace-lifecycle.js";
import { WorkspaceError } from "./workspace-lifecycle.js";

/** Supervisor child context plus the isolated linked-worktree root the child must run in. */
export interface WorktreeChildContext extends DelegationChildContext {
  /** Isolated worktree path; pass this to the child's coding tools instead of the main checkout. */
  readonly cwd: string;
}

export interface WorktreeChildFactoryOptions {
  readonly workspaces: CodingWorkspaceLifecycle;
  /** Host-approved repository registration id for this child. */
  readonly repositoryId: string;
  /** Git branch for the isolated worktree. Default `agent/<delegationId>`. */
  readonly branch?: string;
}

export interface WorktreeChildFactory {
  createAgent(context: DelegationChildContext): Promise<Agent>;
  /** Pass as the supervisor's `hooks.after`; cleans up only workspaces this factory created. */
  after(completion: DelegationCompletion): Promise<void>;
}

/**
 * Opt-in worktree isolation for one allow-listed supervisor child (plan 078 Task 6).
 * The supervisor stays git-agnostic: the host wraps one catalog factory and wires `after`
 * as the supervisor's terminal hook. Worktrees are keyed by `delegationId`, so a resumed
 * suspended child re-creates the identical workspace instead of a second one.
 */
export function createWorktreeChildFactory(
  factory: (context: WorktreeChildContext) => Agent | Promise<Agent>,
  options: WorktreeChildFactoryOptions,
): WorktreeChildFactory {
  // In-process ownership of created workspaces: a supervisor restart leaves the record for
  // host reconciliation (workspaces.list/cleanup) instead of deleting a tree we cannot prove is ours.
  const owned = new Set<string>();
  return {
    async createAgent(context) {
      const record = await options.workspaces.create({
        taskId: context.delegationId,
        repositories: [{ repositoryId: options.repositoryId, branch: options.branch ?? `agent/${context.delegationId}` }],
        signal: context.signal,
      });
      const repository = record.repositories.find((item) => item.repositoryId === options.repositoryId);
      if (!repository) {
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", `workspace has no repository ${options.repositoryId}`);
      }
      owned.add(context.delegationId);
      return factory(Object.freeze({ ...context, cwd: repository.worktreePath }));
    },
    async after(completion) {
      // Not ours (shared-cwd child, foreign id, or an already-cleaned delegation): no Git mutation.
      if (!owned.delete(completion.delegationId)) return;
      await options.workspaces.cleanup({ taskId: completion.delegationId });
    },
  };
}
