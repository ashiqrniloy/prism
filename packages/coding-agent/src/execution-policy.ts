import type { ExecutionAction, ExecutionPolicy } from "@arnilo/prism";
import { assertExecutionAllowed, ExecutionDeniedError } from "@arnilo/prism";
import type { ToolResult } from "@arnilo/prism";

export async function enforceExecutionPolicy(
  policy: ExecutionPolicy | undefined,
  action: ExecutionAction,
  toolCallId: string,
  toolName: string,
): Promise<{ allowed: true; action: ExecutionAction } | { allowed: false; result: ToolResult }> {
  if (!policy) return { allowed: true, action };
  try {
    const allowedAction = await assertExecutionAllowed(policy, action);
    return { allowed: true, action: allowedAction };
  } catch (error) {
    const message =
      error instanceof ExecutionDeniedError
        ? error.decision.reason ?? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      allowed: false,
      result: {
        toolCallId,
        name: toolName,
        content: [{ type: "text", text: message }],
        error: { message },
      },
    };
  }
}
