import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as { code?: unknown }).code === code;
}

export function isPathInside(root: string, target: string): boolean {
  const from = resolve(root);
  const to = resolve(target);
  const rel = relative(from, to);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * `realpath` of `target`, or, for a path that does not exist yet, the `realpath` of its nearest
 * existing ancestor joined with the missing tail, so a create under new directories is still checked
 * against the real location. The tail does not exist, so it holds no symlink. Any error other than
 * `ENOENT` (or reaching the filesystem root) returns `undefined`, which callers treat as outside.
 */
export async function realpathNearest(target: string): Promise<string | undefined> {
  const absolute = resolve(target);
  const tail: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      return join(await realpath(current), ...tail.reverse());
    } catch (error) {
      if (!isNodeErrorCode(error, "ENOENT")) return undefined;
      const parent = dirname(current);
      if (parent === current) return undefined;
      tail.push(basename(current));
      current = parent;
    }
  }
}

/** Resolve symlinks on root and target; fail closed when containment cannot be verified. */
export async function isPathInsideReal(root: string, target: string): Promise<boolean> {
  let from: string;
  try {
    from = await realpath(root);
  } catch {
    return false;
  }
  const to = await realpathNearest(target);
  return to !== undefined && isPathInside(from, to);
}

export async function assertPathInsideRoots(roots: readonly string[], target: string): Promise<boolean> {
  for (const root of roots) {
    if (await isPathInsideReal(root, target)) return true;
  }
  return false;
}
