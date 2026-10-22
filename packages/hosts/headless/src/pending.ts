import { type PendingDecision, parseSuspendedRunEntry, type SessionEntry } from "@arnilo/prism";

export function pendingDecisionsOf(branch: readonly SessionEntry[]): readonly PendingDecision[] {
  for (let index = branch.length - 1; index >= 0; index--) {
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
