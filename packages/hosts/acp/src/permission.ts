import type { CreateElicitationRequest, ElicitationSchema, RequestPermissionResponse } from "@agentclientprotocol/sdk";
import type { ApprovalOutcome, Decision, PendingDecision } from "@arnilo/prism";

/** optionId is the SDK kind, so the response maps without a side table. */
export const PERMISSION_OPTIONS = [
  { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
  { optionId: "allow_always", name: "Allow always", kind: "allow_always" },
  { optionId: "reject_once", name: "Reject once", kind: "reject_once" },
  { optionId: "reject_always", name: "Reject always", kind: "reject_always" },
] as const;

const OUTCOMES: Readonly<Record<string, ApprovalOutcome>> = {
  allow_once: "allow_once",
  allow_always: "allow_for_run",
  reject_once: "reject_once",
  reject_always: "reject_for_run",
};

/** Cancelled, unknown optionId, or a client error is `reject_once`. Never an allow. */
export function decisionForPermission(pending: PendingDecision, response: RequestPermissionResponse | undefined): Decision {
  const selected = response?.outcome.outcome === "selected" ? response.outcome.optionId : undefined;
  return { approvalId: pending.approvalId, outcome: (selected && OUTCOMES[selected]) || "reject_once" };
}

export function elicitationRequest(
  sessionId: string,
  title: string,
  detail: string | undefined,
  schema: ElicitationSchema,
): CreateElicitationRequest {
  return {
    mode: "form",
    message: detail && detail.length > 0 ? `${title}\n${detail}` : title,
    requestedSchema: schema,
    sessionId,
  };
}
