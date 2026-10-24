/**
 * Worktree isolation for a delegated coding child (plan 191 Task 5).
 *
 * The child's own `workspace` service binds one worktree to the child's session, and every inherited
 * coding tool already routes a bound session there (plan 165 Task 7): the delegate only has to *reach*
 * that service. A package sees the services the packages loaded before it provided, so the probe is
 * appended after the inherited instances. Nothing here names `tools-coding`: this is the same
 * `workspace` service contract `@arnilo/prism-workflows` consumes.
 */
import { definePackage, type PackageInstance } from "@arnilo/prism";

export interface IsolatedWorktree {
  readonly path: string;
  readonly branch: string;
  readonly base: string;
  /** The main tree's branch at creation; `HEAD` means it was detached and nothing can be merged into it. */
  readonly parentBranch: string;
  dispose(options?: { force?: boolean }): Promise<void>;
}

export interface IsolationMergeResult {
  readonly status: "merged" | "conflict";
  readonly commit?: string;
  readonly files?: readonly string[];
}

/** The parts of the `workspace` service isolation uses; structural, so this package imports no tool package. */
export interface IsolationWorkspace {
  readonly worktree: { create(request: { sessionId: string }): Promise<IsolatedWorktree> };
  merge(path: string, request: { into: string; commit?: { message: string } }): Promise<IsolationMergeResult>;
  /** Records pending changes on the worktree's branch, so a kept branch carries the work, not just its commits. */
  commit?(path: string, request: { message: string }): Promise<{ commit: string }>;
  diff?(path: string): Promise<{ changes: readonly { readonly path: string }[] }>;
}

/** What happened to an isolated child's branch; `skipped` and the two refusals keep it for a human. */
export type DelegationMerge =
  | { readonly status: "merged"; readonly commit: string; readonly files: readonly string[] }
  | { readonly status: "conflict"; readonly files: readonly string[]; readonly branch: string }
  | { readonly status: "refused"; readonly reason: string; readonly branch: string }
  | { readonly status: "skipped"; readonly branch: string };

/** Captures the child's `workspace` service during `createAgent`; `undefined` means the child has none. */
export function isolationProbe(capture: { workspace?: IsolationWorkspace }): PackageInstance {
  return definePackage({
    name: "@arnilo/prism-delegate-isolation",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      capture.workspace ??= prism.services.consume<IsolationWorkspace>("workspace");
    },
  })();
}

/** The merge commit's subject: which child, and the first line of what it was asked. */
export function mergeMessage(child: string, input: string): string {
  const first = input.trim().split("\n")[0]?.trim() ?? "";
  return `delegate(${child}): ${first.slice(0, 120) || "worktree change"}`;
}
