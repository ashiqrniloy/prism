import { type PendingDecision, parseSuspendedRunEntry, type SessionEntry } from "@arnilo/prism";

/**
 * The decisions a session's branch is waiting on. `pendingSuspensionOf` is not public, so this applies its
 * tip rule over the public `parseSuspendedRunEntry`: skip `package_state`, then the newest entry must be a
 * `suspended_run`. Anything appended after it means that suspension was resolved or abandoned. A malformed
 * entry yields nothing, so it never resumes.
 */
export function pendingDecisionsOf(branch: readonly SessionEntry[]): readonly PendingDecision[] {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (!entry) continue;
    if (entry.kind === "package_state") continue;
    if (entry.kind !== "suspended_run") return [];
    try {
      return parseSuspendedRunEntry(entry).interruption.pendingDecisions ?? [];
    } catch {
      return [];
    }
  }
  return [];
}
