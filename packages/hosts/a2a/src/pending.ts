import { type PendingDecision, parseSuspendedRunEntry, type SessionEntry } from "@arnilo/prism";

// Third copy of this tip rule (remote/src/pending.ts, headless/src/pending.ts); see plan 236 Further Actions.

/**
 * The suspension a session's branch is waiting on, with its run id. `pendingSuspensionOf` is not public, so
 * this applies its tip rule over the public `parseSuspendedRunEntry`: skip `package_state`, then the newest
 * entry must be a `suspended_run`. Anything appended after it means the suspension was resolved or abandoned.
 * A malformed entry yields nothing, so it never resumes.
 */
export function suspensionOf(
  branch: readonly SessionEntry[],
): { readonly runId: string; readonly pending: readonly PendingDecision[] } | undefined {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (!entry) continue;
    if (entry.kind === "package_state") continue;
    if (entry.kind !== "suspended_run") return undefined;
    try {
      const parsed = parseSuspendedRunEntry(entry);
      const pending = parsed.interruption.pendingDecisions ?? [];
      return pending.length === 0 ? undefined : { runId: parsed.runId, pending };
    } catch {
      return undefined;
    }
  }
  return undefined;
}
