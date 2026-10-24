/**
 * The `coding.targets` service: for one of this package's tools, the absolute paths a call
 * touches and the roots that contain them. Approval (plan 154 Task 6) and the hard-deny hook
 * read it, so neither has to parse tool names or arguments.
 *
 * A call from a session bound to a worktree (plan 165 Task 7) reports that worktree as its root, so
 * approval and the hard-deny hook follow the session: inside the worktree for the bound session,
 * outside it for every other.
 *
 * Read-effect tools also get one read-only root per effective skill directory (plan 190 Task 6), so
 * a skill's `references/` files can be read without granting any write access outside the workspace.
 */
import { dirname, isAbsolute, resolve } from "node:path";
import type { JsonObject, Skill } from "@arnilo/prism";

import type { WorkspaceService } from "./workspace/service.js";

export interface CodingTargets {
  /** Absolute paths the call touches. Empty for `shell`. */
  readonly paths: readonly string[];
  /** `root` plus every extra root, resolved; read-effect tools also get each skill's directory. */
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

/** Read-effect tools that may read a skill's directory; a write to one stays outside the roots. */
const SKILL_READ_TOOL_NAMES: ReadonlySet<string> = new Set(["read", "glob", "grep", "diagnostics"]);
const NO_SKILL_ROOTS: readonly string[] = Object.freeze([]);

/**
 * Build the service for `root` and `roots`. Unknown names return `undefined` (the tool is not
 * ours). A relative argument resolves against `root`, matching the tools' own cwd — or against the
 * calling session's worktree when `workspace` reports one, matching the routed tool's cwd.
 *
 * `skills` is read lazily, after setup, and only for read-effect tools. The derived directories are
 * cached until the effective list's paths change; a skill without an absolute path contributes
 * nothing. Reads fail soft, so a host that cannot list skills keeps the coding roots.
 */
export function createCodingTargets(
  root: string,
  roots: readonly string[],
  workspace?: WorkspaceService,
  skills?: () => readonly Skill[],
): CodingTargetsFn {
  const resolvedRoot = resolve(root);
  const extraRoots = Object.freeze(roots.map((extra) => resolve(extra)));
  const rootTargets = Object.freeze([resolvedRoot, ...extraRoots]);
  let cachedSignature: string | undefined;
  let cachedSkillRoots: readonly string[] = NO_SKILL_ROOTS;
  const skillRoots = (): readonly string[] => {
    if (skills === undefined) return NO_SKILL_ROOTS;
    let list: readonly Skill[];
    try {
      list = skills();
    } catch {
      return cachedSkillRoots;
    }
    // The public skills API has no change signal, so reading the list is the only way to notice a
    // registration; only its path signature and the derived directories are cached.
    const signature = JSON.stringify(list.map((skill) => skill.path ?? null));
    if (signature === cachedSignature) return cachedSkillRoots;
    const dirs = new Set<string>();
    for (const skill of list) {
      if (skill.path !== undefined && isAbsolute(skill.path)) dirs.add(dirname(skill.path));
    }
    cachedSignature = signature;
    cachedSkillRoots = Object.freeze([...dirs]);
    return cachedSkillRoots;
  };
  return (name, args, context) => {
    const keys = PATH_ARG_KEYS[name];
    if (!keys) return undefined;
    const worktree = context?.sessionId === undefined ? undefined : workspace?.worktree.bound(context.sessionId);
    const cwd = worktree === undefined ? resolvedRoot : resolve(worktree.path);
    const baseRoots = worktree === undefined ? rootTargets : Object.freeze([cwd, ...extraRoots]);
    const extraSkillRoots = SKILL_READ_TOOL_NAMES.has(name) ? skillRoots() : NO_SKILL_ROOTS;
    const allRoots = extraSkillRoots.length === 0 ? baseRoots : Object.freeze([...baseRoots, ...extraSkillRoots]);
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
