/**
 * Merge one worktree's branch into another branch, reporting conflicts instead of resolving them.
 *
 * Everything is decided before anything moves. A dirty worktree is folded into a *dangling* commit
 * of its current state (the index is snapshotted first and restored if the merge turns out to
 * conflict), so a conflict leaves both trees, the index, and every ref byte-for-byte unchanged. A
 * clean probe is turned into a merge commit (`commit-tree`) and the target ref is advanced with a
 * compare-and-swap (`update-ref`); when the target is checked out somewhere, that worktree is
 * fast-forwarded instead so its index and files stay consistent with its HEAD.
 *
 * The service never pushes, never resolves a conflict, and never invents an identity.
 */
import { GitError, type GitOperations, type GitWorktreeEntry } from "../agent/git.js";
import { WorkspaceServiceError } from "./errors.js";

export interface WorkspaceMergeRequest {
  /** The branch the worktree's branch is merged into. */
  readonly into: string;
  /** Required when the worktree has uncommitted changes: it records them, and names the merge. */
  readonly commit?: { readonly message: string };
}

export type WorkspaceMergeResult =
  | { readonly status: "merged"; readonly commit: string }
  | { readonly status: "conflict"; readonly files: readonly string[] };

export interface MergeContext {
  /** The worktree being merged (its `cwd`). */
  readonly worktree: string;
  /** The branch checked out in that worktree. */
  readonly branch: string;
  /** Git operations for a path; the worktree's own instance is created on demand. */
  readonly gitFor: (path: string) => Promise<GitOperations>;
  /** `git worktree list` entries, used to find where `into` is checked out. */
  readonly worktrees: readonly GitWorktreeEntry[];
  /** The repository's configured commit identity, or undefined when it has none. */
  readonly identity: { readonly name: string; readonly email: string } | undefined;
  readonly signal?: AbortSignal;
}

export async function mergeWorktree(context: MergeContext, request: WorkspaceMergeRequest): Promise<WorkspaceMergeResult> {
  const { branch, signal } = context;
  if (request.into === branch) {
    throw new WorkspaceServiceError("workspace_merge_failed", "a worktree cannot be merged into its own branch");
  }

  const git = await context.gitFor(context.worktree);
  const dirty = await dirtyPaths(git, signal);
  if (dirty.length > 0 && request.commit === undefined) {
    throw new WorkspaceServiceError(
      "workspace_dirty",
      `the worktree has ${dirty.length} uncommitted change(s); pass commit to record them before merging`,
    );
  }

  // The tree being merged: the worktree's live state when it is dirty, else its branch tip.
  const message = request.commit?.message ?? `Merge ${branch} into ${request.into}`;
  let restore: string | undefined;
  let source = branch;
  if (dirty.length > 0) {
    requireIdentity(context.identity);
    restore = await git.writeTree({ signal });
    await git.stageAll({ signal });
    const staged = await git.writeTree({ signal });
    source = await git.commitTree({ tree: staged, parents: [branch], message, signal });
  }

  const abort = async (): Promise<void> => {
    // The index is the only thing the fold touched; put it back exactly as it was.
    if (restore !== undefined) await git.readTree({ tree: restore, signal }).catch(() => undefined);
  };

  const holder = context.worktrees.find((entry) => entry.branch === `refs/heads/${request.into}`);
  if (holder !== undefined) {
    const holderDirty = await dirtyPaths(await context.gitFor(holder.path), signal);
    if (holderDirty.length > 0) {
      await abort();
      throw new WorkspaceServiceError(
        "workspace_dirty_target",
        `${request.into} is checked out in ${holder.path}, which has uncommitted changes`,
      );
    }
  }

  let tree: string;
  let conflicts: readonly string[];
  try {
    ({ tree, conflicts } = await git.mergeTree({ into: request.into, from: source, signal }));
  } catch (error) {
    await abort();
    throw mapMergeError(error);
  }
  if (conflicts.length > 0) {
    await abort();
    return { status: "conflict", files: conflicts };
  }

  requireIdentity(context.identity);
  let commit: string;
  try {
    commit = await git.commitTree({ tree, parents: [request.into, source], message, signal });
  } catch (error) {
    await abort();
    throw mapMergeError(error);
  }

  try {
    if (holder === undefined) {
      await git.updateRef({ ref: `refs/heads/${request.into}`, to: commit, expected: request.into, signal });
    } else {
      await (await context.gitFor(holder.path)).fastForward({ to: commit, signal });
    }
    // Record the worktree's own state on its branch so its index and HEAD agree again.
    if (restore !== undefined) {
      await git.updateRef({ ref: `refs/heads/${branch}`, to: source, expected: branch, signal });
    }
  } catch (error) {
    throw new WorkspaceServiceError(
      "workspace_merge_failed",
      `could not advance ${request.into}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { status: "merged", commit };
}

/** A merge and a commit both need the repository's configured identity; neither invents one. */
export function requireIdentity(identity: MergeContext["identity"]): asserts identity is { name: string; email: string } {
  if (identity === undefined) {
    throw new WorkspaceServiceError("workspace_identity_missing", "no commit identity is configured for this repository");
  }
}

async function dirtyPaths(git: GitOperations, signal?: AbortSignal): Promise<string[]> {
  const status = await git.status({ signal });
  return status.entries.filter((entry) => entry.kind !== "ignored").map((entry) => entry.path);
}

function mapMergeError(error: unknown): WorkspaceServiceError {
  if (error instanceof WorkspaceServiceError) return error;
  if (error instanceof GitError) {
    const unsupported = error.exitCode === 129 || /unknown option|is not a git command/i.test(error.message);
    if (unsupported) {
      return new WorkspaceServiceError("workspace_git_unsupported", `git merge-tree is not supported here: ${error.message}`);
    }
    if (/auto-detect email|empty ident name/i.test(error.message)) {
      return new WorkspaceServiceError("workspace_identity_missing", "no commit identity is configured for this repository");
    }
    return new WorkspaceServiceError("workspace_merge_failed", error.message);
  }
  return new WorkspaceServiceError("workspace_merge_failed", error instanceof Error ? error.message : String(error));
}
