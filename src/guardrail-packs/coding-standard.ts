import { resolve as resolvePath, sep } from "node:path";
import type { JsonObject } from "../contracts-core/content.js";
import { GuardrailPackError } from "./errors.js";
import type { GuardrailPackDefinition } from "./types.js";

/** File-mutating prism coding tool names (plan 092 Task 1: `shell`/`read` are not mutations). */
const MUTATING_TOOLS = ["write", "edit", "delete", "move"] as const;
const PATH_ARGS = ["path", "paths", "from", "to"] as const;
const TEST_FILE_PATTERN = /(^|[\\/])(?:__tests__|tests?|specs?)[\\/]|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const MAX_ROOTS = 16;

function pathStrings(args: JsonObject): readonly string[] {
  const paths: string[] = [];
  for (const key of PATH_ARGS) {
    const value = args[key];
    if (typeof value === "string") paths.push(value);
    else if (Array.isArray(value)) paths.push(...value.filter((item): item is string => typeof item === "string"));
  }
  return paths;
}

function readRoots(value: unknown, cwd: string): readonly string[] {
  if (value === undefined) return [cwd];
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ROOTS) {
    throw new GuardrailPackError(`coding-standard options.roots must be a non-empty string array (max ${MAX_ROOTS})`);
  }
  return value.map((root) => {
    if (typeof root !== "string" || !root.trim())
      throw new GuardrailPackError("coding-standard options.roots entries must be non-empty strings");
    return resolvePath(cwd, root);
  });
}

/** Lazy containment: no symlink resolution (a link inside a root can still point out); execution policy/sandbox remains the hard boundary. */
function outsideRoots(candidate: string, roots: readonly string[], cwd: string): boolean {
  const resolved = resolvePath(cwd, candidate);
  return !roots.some((root) => resolved === root || resolved.startsWith(root.endsWith(sep) ? root : `${root}${sep}`));
}

/** Canned coding hygiene: file mutations confined to configured roots, test files read-only. */
export const codingStandardPack: GuardrailPackDefinition = {
  id: "coding-standard",
  version: 1,
  description: "Restricts file mutation to configured workspace roots and blocks test-file rewrites.",
  build(options) {
    const cwd = resolvePath(typeof options.cwd === "string" ? options.cwd : process.cwd());
    const roots = readRoots(options.roots, cwd);
    return {
      rules: [
        {
          id: "no-unrelated-file-edits",
          tool: MUTATING_TOOLS,
          reason: "File edits are restricted to the configured workspace roots",
          deny: (args) => pathStrings(args).some((candidate) => outsideRoots(candidate, roots, cwd)),
        },
        {
          id: "no-test-rewrites",
          tool: MUTATING_TOOLS,
          pattern: TEST_FILE_PATTERN,
          argPath: PATH_ARGS,
          reason: "Test files are read-only under this pack",
        },
      ],
    };
  },
};
