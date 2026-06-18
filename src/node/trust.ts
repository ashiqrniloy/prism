import { isAbsolute, relative, resolve } from "node:path";
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

export function createPathTrustPolicy(options: PathTrustPolicyOptions): TrustPolicy {
  const roots = options.trustedRoots.map((root) => resolve(root));
  return {
    check(request) {
      const trusted = roots.some((root) => isPathInside(root, request.target));
      return { trusted, reason: trusted ? undefined : `Path is outside trusted roots: ${request.target}` };
    },
  };
}
