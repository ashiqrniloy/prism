import { type PendingDecision, parseSuspendedRunEntry, type RunStateBounds, type SessionEntry } from "@arnilo/prism";

/**
 * The decisions a session's branch is waiting on. `pendingSuspensionOf` is not public, so this applies its
 * tip rule over the public `parseSuspendedRunEntry`: skip `package_state`, then the newest entry must be a
 * `suspended_run`. Anything appended after it means that suspension was resolved or abandoned. A malformed
 * entry yields nothing, so it never resumes.
 */
/** `bounds` are the agent's run-state bounds (`runStateBounds(resolveCeilings(agent.config.ceilings))`), so a host with raised ceilings reads its own suspensions. */
export function pendingDecisionsOf(branch: readonly SessionEntry[], bounds?: RunStateBounds): readonly PendingDecision[] {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (!entry) continue;
    if (entry.kind === "package_state") continue;
    if (entry.kind !== "suspended_run") return [];
    try {
      return parseSuspendedRunEntry(entry, bounds).interruption.pendingDecisions ?? [];
    } catch {
      return [];
    }
  }
  return [];
}
