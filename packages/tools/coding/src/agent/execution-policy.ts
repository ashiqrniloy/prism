/**
 * Package-local execution policy (plan 155 Task 6).
 *
 * The kernel `ExecutionPolicy` export is retired: tool policy is a host `tool.call` hook, decided
 * from declared `effects` and roots. These types stay package-internal because the coding tools
 * accept an optional host-supplied policy for their sandbox and command-rule checks (plan 154
 * Task 1 (g)); they are no longer part of `@arnilo/prism`.
 */
import type { ToolResult } from "@arnilo/prism";

export type ExecutionRisk = "low" | "medium" | "high";

export interface ExecutionAction {
  readonly kind: "shell" | "read" | "write" | "edit" | string;
  readonly operation: string;
  readonly paths?: readonly string[];
  readonly command?: string;
  readonly risk?: ExecutionRisk;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExecutionDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly modified?: Partial<ExecutionAction>;
  /** When true, tool definitions should expose `exclusive: true` for pre-dispatch serialization. */
  readonly exclusive?: boolean;
}

export interface ExecutionPolicy {
  check(action: ExecutionAction): ExecutionDecision | Promise<ExecutionDecision>;
}

export class ExecutionDeniedError extends Error {
  readonly code = "ERR_PRISM_EXECUTION_DENIED";
  constructor(
    readonly action: ExecutionAction,
    readonly decision: ExecutionDecision,
  ) {
    super(decision.reason ?? `Execution denied for ${action.kind}:${action.operation}`);
    this.name = "ExecutionDeniedError";
  }
}

export async function checkExecution(policy: ExecutionPolicy | undefined, action: ExecutionAction): Promise<ExecutionDecision> {
  return policy ? await policy.check(action) : { allowed: true };
}

export function applyExecutionDecision(action: ExecutionAction, decision: ExecutionDecision): ExecutionAction {
  return decision.modified ? { ...action, ...decision.modified } : action;
}

export async function assertExecutionAllowed(policy: ExecutionPolicy | undefined, action: ExecutionAction): Promise<ExecutionAction> {
  const decision = await checkExecution(policy, action);
  if (!decision.allowed) throw new ExecutionDeniedError(action, decision);
  return applyExecutionDecision(action, decision);
}

export async function enforceExecutionPolicy(
  policy: ExecutionPolicy | undefined,
  action: ExecutionAction,
  toolCallId: string,
  toolName: string,
  /** Called once on policy denial so one site emits lifecycle permission_denied for every tool. */
  onDenied?: (input: { readonly toolCallId: string; readonly toolName: string; readonly reason: string }) => void,
): Promise<{ allowed: true; action: ExecutionAction } | { allowed: false; result: ToolResult }> {
  if (!policy) return { allowed: true, action };
  try {
    const allowedAction = await assertExecutionAllowed(policy, action);
    return { allowed: true, action: allowedAction };
  } catch (error) {
    const message =
      error instanceof ExecutionDeniedError
        ? (error.decision.reason ?? error.message)
        : error instanceof Error
          ? error.message
          : String(error);
    onDenied?.({ toolCallId, toolName, reason: message });
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
