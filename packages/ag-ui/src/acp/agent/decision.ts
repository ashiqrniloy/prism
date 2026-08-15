/** decision (0.2.5 plan 025 Task 1 split). Moved verbatim from agent.ts; public surface unchanged behind the barrel. */
import type { AgentEvent, RunDecision } from "@arnilo/prism";
import type { RequestPermissionResponse } from "@agentclientprotocol/sdk";

const ACP_OUTCOMES = {
  "allow-once": "allow_once",
  "allow-for-run": "allow_for_run",
  "reject-once": "reject_once",
  "reject-for-run": "reject_for_run",
} as const;

/**
 * Map the ACP permission selection onto the shared decision batch. Cancelled (or any
 * unrecognized selection) stays deny-closed via the legacy terminal deny. Without a
 * pending-decision set (legacy state) only the legacy binary resume is possible.
 */
export function decisionFor(
  response: RequestPermissionResponse,
  interruption: Extract<AgentEvent, { readonly type: "agent_suspended" }>["interruption"],
): { readonly decision: "approve" | "deny" } | { readonly decisions: readonly RunDecision[] } {
  if (response.outcome.outcome !== "selected") return { decision: "deny" };
  const outcome = ACP_OUTCOMES[response.outcome.optionId as keyof typeof ACP_OUTCOMES];
  const pending = interruption.pendingDecisions;
  if (!outcome || !pending?.length) {
    return { decision: response.outcome.optionId === "allow-once" ? "approve" : "deny" };
  }
  return { decisions: pending.map((decision) => ({ approvalId: decision.approvalId, outcome })) };
}
