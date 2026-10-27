import type { TrustPolicy } from "../security.js";
export interface PathTrustPolicyOptions {
    readonly trustedRoots: readonly string[];
}
export declare function isPathInside(root: string, target: string): boolean;
/** Async path-inside check that resolves symlinks on both root and target.
 *  Fails closed (returns false) if the root cannot be resolved, if realpath fails
 *  for another reason, or if the resolved target escapes the resolved root.
 *  If the target itself does not exist, its parent directory is resolved instead
 *  so that write-time trust checks can still validate the path.
 */
export declare function isPathInsideReal(root: string, target: string): Promise<boolean>;
export declare function createPathTrustPolicy(options: PathTrustPolicyOptions): TrustPolicy;
