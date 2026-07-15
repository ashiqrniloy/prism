import { isAbsolute, relative, resolve, dirname, basename, join } from "node:path";
import { realpath } from "node:fs/promises";
import { isNodeErrorCode } from "@arnilo/prism/node/config";

export function isPathInside(root: string, target: string): boolean {
  const from = resolve(root);
  const to = resolve(target);
  const rel = relative(from, to);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Resolve symlinks on root and target; fail closed when containment cannot be verified. */
export async function isPathInsideReal(root: string, target: string): Promise<boolean> {
  let from: string;
  try {
    from = await realpath(root);
  } catch {
    return false;
  }

  let to: string | undefined;
  try {
    to = await realpath(target);
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) return false;
    const parent = dirname(target);
    try {
      const resolvedParent = await realpath(parent);
      to = join(resolvedParent, basename(target));
    } catch {
      return false;
    }
  }

  return isPathInside(from, to);
}

export async function assertPathInsideRoots(
  roots: readonly string[],
  target: string,
): Promise<boolean> {
  for (const root of roots) {
    if (await isPathInsideReal(root, target)) return true;
  }
  return false;
}

