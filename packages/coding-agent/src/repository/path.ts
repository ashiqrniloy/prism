/** Repository path family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from repository.ts; public surface unchanged behind the barrel. */
import { DEFAULT_BINARY_SNIFF_BYTES } from "../limits.js";
import type { Dirent } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { resolveToCwd } from "../path-utils.js";
import type { RepoEntryKind } from "./types.js";
import { RepositoryError } from "./types.js";

export function toRepoRelative(root: string, absolutePath: string): string {
  const rel = relative(root, absolutePath);
  if (rel === "") return ".";
  return rel.split(sep).join("/");
}

export function isPathInsideRoot(root: string, target: string): boolean {
  const from = resolve(root);
  const to = resolve(target);
  if (to === from) return true;
  const rel = relative(from, to);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Resolve a list/search start path under the workspace root.
 * Symlink escapes fail closed after realpath when the path exists.
 */
export async function resolveRepoPath(
  root: string,
  inputPath: string | undefined,
): Promise<{
  absolute: string;
  relative: string;
  rootReal: string;
}> {
  const rootResolved = resolve(root);
  let rootReal: string;
  try {
    rootReal = await realpath(rootResolved);
  } catch {
    throw new RepositoryError(`workspace root is missing or unreadable: ${rootResolved}`);
  }

  if (!inputPath || inputPath === "." || inputPath === "./") {
    return { absolute: rootReal, relative: ".", rootReal };
  }

  const candidate = resolveToCwd(inputPath, rootReal);
  if (!isPathInsideRoot(rootReal, candidate)) {
    throw new RepositoryError(`path escapes workspace root: ${inputPath}`);
  }

  try {
    const real = await realpath(candidate);
    if (!isPathInsideRoot(rootReal, real)) {
      throw new RepositoryError(`path resolves outside workspace root: ${inputPath}`);
    }
    return { absolute: real, relative: toRepoRelative(rootReal, real), rootReal };
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    // ENOENT: allow listing a missing path to fail later with a clear error.
    return { absolute: candidate, relative: toRepoRelative(rootReal, candidate), rootReal };
  }
}

export function shouldSkipName(name: string, includeHidden: boolean, exclude: ReadonlySet<string>): boolean {
  if (name === "." || name === "..") return true;
  if (exclude.has(name)) return true;
  if (!includeHidden && name.startsWith(".")) return true;
  return false;
}

export function kindFromDirent(dirent: Dirent): RepoEntryKind {
  if (dirent.isSymbolicLink()) return "symlink";
  if (dirent.isDirectory()) return "directory";
  if (dirent.isFile()) return "file";
  return "other";
}

export function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new RepositoryError("Operation aborted");
}

export function assertDeadline(deadlineAt: number | undefined): void {
  if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
    throw new RepositoryError("Repository operation exceeded time limit");
  }
}

export function isBinaryBuffer(buffer: Buffer): boolean {
  const length = Math.min(buffer.length, DEFAULT_BINARY_SNIFF_BYTES);
  for (let i = 0; i < length; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}
