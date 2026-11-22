import { type PendingDecision, parseSuspendedRunEntry, type RunStateBounds, type SessionEntry } from "@arnilo/prism";

/** `bounds` are the agent's run-state bounds (`runStateBounds(resolveCeilings(agent.config.ceilings))`), so a host with raised ceilings reads its own suspensions. */
export function pendingDecisionsOf(branch: readonly SessionEntry[], bounds?: RunStateBounds): readonly PendingDecision[] {
  for (let index = branch.length - 1; index >= 0; index--) {
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
