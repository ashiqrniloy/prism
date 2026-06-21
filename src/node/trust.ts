import { isAbsolute, relative, resolve, dirname, basename, join } from "node:path";
import { realpath } from "node:fs/promises";
import type { TrustPolicy } from "../security.js";

export interface PathTrustPolicyOptions {
  readonly trustedRoots: readonly string[];
}

export function isPathInside(root: string, target: string): boolean {
  const from = resolve(root);
  const to = resolve(target);
  const rel = relative(from, to);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Async path-inside check that resolves symlinks on both root and target.
 *  Fails closed (returns false) if the root cannot be resolved, if realpath fails
 *  for another reason, or if the resolved target escapes the resolved root.
 *  If the target itself does not exist, its parent directory is resolved instead
 *  so that write-time trust checks can still validate the path.
 */
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
    if (!isMissingFile(error)) return false;
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

export function createPathTrustPolicy(options: PathTrustPolicyOptions): TrustPolicy {
  return {
    async check(request) {
      for (const root of options.trustedRoots) {
        if (await isPathInsideReal(root, request.target)) {
          return { trusted: true };
        }
      }
      return { trusted: false, reason: `Path is outside trusted roots: ${request.target}` };
    },
  };
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
