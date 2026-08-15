/** permission-elicit (0.2.5 plan 025 Task 1 split). Moved verbatim from agent.ts; public surface unchanged behind the barrel. */
import type {
  AgentContext,
  CreateElicitationRequest,
  CreateElicitationResponse,
  ElicitationSchema,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import { methods } from "@agentclientprotocol/sdk";
import type { AgentEvent, JsonObject, RunDecision } from "@arnilo/prism";
import { resolveAgUiLimits } from "../../limits.js";
import type { AcpStreamBudget, ElicitationPendingDecision } from "./types.js";
import { notify } from "./forward-notify.js";
import { truncate } from "./abort-truncate.js";

export async function permission(
  client: AgentContext,
  sessionId: string,
  event: Extract<AgentEvent, { readonly type: "agent_suspended" }>,
  budget: AcpStreamBudget,
  limits: ReturnType<typeof resolveAgUiLimits>,
): Promise<RequestPermissionResponse> {
  const toolCallId = truncate(event.interruption.toolCallId ?? `prism:${event.runId}:${event.version}`, limits.maxTextBytes);
  await notify(
    client,
    sessionId,
    { sessionUpdate: "tool_call", toolCallId, title: "Approval required", kind: "other", status: "pending" },
    budget,
    limits,
  );
  try {
    return await client.request(methods.client.session.requestPermission, {
      sessionId,
      toolCall: { toolCallId, title: "Approval required", kind: "other", status: "pending" },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "allow-for-run", name: "Allow for run", kind: "allow_always" },
        { optionId: "reject-once", name: "Reject once", kind: "reject_once" },
        { optionId: "reject-for-run", name: "Reject for run", kind: "reject_always" },
      ],
    });
  } catch {
    return { outcome: { outcome: "cancelled" } };
  }
}

/**
 * Elicitation flow (client advertised elicitation, all-elicitation batch): a pending
 * form elicitation surfaces as `elicitation/create` with the decision's bounded
 * schema; accept carries the typed payload, any decline/cancel denies. Errors and
 * unrecognized responses deny (fail closed). Never forwards raw tool arguments.
 */
export async function elicit(
  client: AgentContext,
  sessionId: string,
  event: Extract<AgentEvent, { readonly type: "agent_suspended" }>,
  decision: ElicitationPendingDecision,
  budget: AcpStreamBudget,
  limits: ReturnType<typeof resolveAgUiLimits>,
): Promise<CreateElicitationResponse> {
  const toolCallId = truncate(
    decision.toolCallId ?? event.interruption.toolCallId ?? `prism:${event.runId}:${event.version}`,
    limits.maxTextBytes,
  );
  await notify(
    client,
    sessionId,
    { sessionUpdate: "tool_call", toolCallId, title: "Input required", kind: "other", status: "pending" },
    budget,
    limits,
  );
  const request: CreateElicitationRequest = {
    mode: "form",
    message: truncate(event.interruption.reason, limits.maxTextBytes),
    requestedSchema: (decision.elicitationSchema ?? { type: "object" }) as ElicitationSchema,
    sessionId,
    ...(toolCallId ? { toolCallId } : {}),
  };
  try {
    return await client.request(methods.client.elicitation.create, request);
  } catch {
    return { action: "cancel" };
  }
}

/** Maps elicitation responses onto the shared decision batch; accept carries the payload, everything else denies. */
export function decisionForElicitation(
  responses: readonly CreateElicitationResponse[],
  decisions: readonly ElicitationPendingDecision[],
): { readonly decision: "approve" | "deny" } | { readonly decisions: readonly RunDecision[] } {
  const mapped = decisions.map((decision, index) => {
    const response = responses[index];
    if (response?.action === "accept") {
      return {
        approvalId: decision.approvalId,
        outcome: "allow_once" as const,
        ...(response.content ? { elicitation: response.content as JsonObject } : {}),
      };
    }
    return { approvalId: decision.approvalId, outcome: "reject_once" as const };
  });
  return { decisions: mapped };
}
