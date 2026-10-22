/**
 * The `coding.targets` service: for one of this package's tools, the absolute paths a call
 * touches and the roots that contain them. Approval (plan 154 Task 6) and the hard-deny hook
 * read it, so neither has to parse tool names or arguments.
 *
 * A call from a session bound to a worktree (plan 165 Task 7) reports that worktree as its root, so
 * approval and the hard-deny hook follow the session: inside the worktree for the bound session,
 * outside it for every other.
 */
import { isAbsolute, resolve } from "node:path";
import type { JsonObject } from "@arnilo/prism";

import type { WorkspaceService } from "./workspace/service.js";

export interface CodingTargets {
  /** Absolute paths the call touches. Empty for `shell`. */
  readonly paths: readonly string[];
  /** `root` plus every extra root, resolved. */
  readonly roots: readonly string[];
}

/** Argument keys holding paths, per registered tool. `shell` and `shell_output` have none. */
const PATH_ARG_KEYS: Readonly<Record<string, readonly string[]>> = {
  read: ["path"],
  write: ["path"],
  edit: ["path"],
  delete: ["path"],
  glob: ["path"],
  grep: ["path"],
  diagnostics: ["path"],
  move: ["from", "to"],
  shell: [],
  shell_output: [],
};

/** Every tool this package registers. */
export const CODING_TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(PATH_ARG_KEYS));

export type CodingTargetsFn = (name: string, args: JsonObject, context?: CodingTargetsContext) => CodingTargets | undefined;

/** The caller's identity, when it has one. Only `sessionId` can select a worktree. */
export interface CodingTargetsContext {
  readonly sessionId?: string;
}

/**
 * Build the service for `root` and `roots`. Unknown names return `undefined` (the tool is not
 * ours). A relative argument resolves against `root`, matching the tools' own cwd — or against the
 * calling session's worktree when `workspace` reports one, matching the routed tool's cwd.
 */
export function createCodingTargets(root: string, roots: readonly string[], workspace?: WorkspaceService): CodingTargetsFn {
  const resolvedRoot = resolve(root);
  const extraRoots = Object.freeze(roots.map((extra) => resolve(extra)));
  const rootTargets = Object.freeze([resolvedRoot, ...extraRoots]);
  return (name, args, context) => {
    const keys = PATH_ARG_KEYS[name];
    if (!keys) return undefined;
    const worktree = context?.sessionId === undefined ? undefined : workspace?.worktree.bound(context.sessionId);
    const cwd = worktree === undefined ? resolvedRoot : resolve(worktree.path);
    const allRoots = worktree === undefined ? rootTargets : Object.freeze([cwd, ...extraRoots]);
    const paths: string[] = [];
    for (const key of keys) {
      const value = args[key];
      if (typeof value === "string" && value.length > 0) {
        paths.push(isAbsolute(value) ? value : resolve(cwd, value));
      }
    }
    return { paths, roots: allRoots };
  };
}
