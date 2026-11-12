/**
 * Branch-name rules for an `agentNode` worktree, checked without spawning git so a bad name fails at
 * definition (a string) or before the worktree is created (a function result). They are the
 * `git check-ref-format --branch` rules; the workspace service checks again with git itself.
 */
const MAX_BRANCH_BYTES = 255;

/** Why `name` is not a usable branch name, or `undefined` when it is. */
export function branchNameProblem(name: unknown): string | undefined {
  if (typeof name !== "string" || name.length === 0) return "must be a non-empty string";
  if (Buffer.byteLength(name, "utf8") > MAX_BRANCH_BYTES) return `must be at most ${MAX_BRANCH_BYTES} bytes`;
  if (name.startsWith("-")) return "must not start with '-'";
  if (name === "@" || name === "HEAD") return `must not be "${name}"`;
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) return "must not contain spaces, control characters or ~ ^ : ? * [ \\";
  if (name.includes("..") || name.includes("@{") || name.includes("//")) return "must not contain '..', '@{' or '//'";
  if (name.startsWith("/") || name.endsWith("/") || name.endsWith(".")) return "must not start or end with '/' or end with '.'";
  for (const part of name.split("/")) {
    if (part.startsWith(".") || part.endsWith(".lock")) return "no path component may start with '.' or end with '.lock'";
  }
  return undefined;
}

/** A commit-ish handed to `git worktree add`: never read as an option, one line. */
export function baseProblem(base: unknown): string | undefined {
  if (typeof base !== "string" || base.length === 0) return "must be a non-empty string";
  if (base.startsWith("-")) return "must not start with '-'";
  if (/[\x00-\x1f\x7f]/.test(base)) return "must not contain control characters";
  return undefined;
}
