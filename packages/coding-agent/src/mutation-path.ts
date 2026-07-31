import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { resolveToCwd } from "./path-utils.js";

function isPathInsideRoot(root: string, target: string): boolean {
  const from = resolve(root);
  const to = resolve(target);
  if (to === from) return true;
  const rel = relative(from, to);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR")
  );
}

/**
 * Resolve a mutation target under `root`. Symlink paths are kept as the link
 * location (not followed). Non-symlink existing paths are realpath'd.
 */
export async function resolveContainedMutationPath(root: string, inputPath: string, options?: { allowMissing?: boolean }): Promise<string> {
  const rootResolved = resolve(root);
  let rootReal: string;
  try {
    rootReal = await realpath(rootResolved);
  } catch {
    throw new Error(`workspace root is missing or unreadable: ${rootResolved}`);
  }

  const candidate = resolveToCwd(inputPath, rootReal);
  if (!isPathInsideRoot(rootReal, candidate)) {
    throw new Error(`path escapes workspace root: ${inputPath}`);
  }

  try {
    const st = await lstat(candidate);
    if (st.isSymbolicLink()) return candidate;
    const real = await realpath(candidate);
    if (!isPathInsideRoot(rootReal, real)) {
      throw new Error(`path resolves outside workspace root: ${inputPath}`);
    }
    return real;
  } catch (error) {
    if (options?.allowMissing && isMissingPathError(error)) return candidate;
    throw error;
  }
}
