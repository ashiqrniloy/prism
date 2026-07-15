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
  constructor(readonly action: ExecutionAction, readonly decision: ExecutionDecision) {
    super(decision.reason ?? `Execution denied for ${action.kind}:${action.operation}`);
    this.name = "ExecutionDeniedError";
  }
}

export async function checkExecution(
  policy: ExecutionPolicy | undefined,
  action: ExecutionAction,
): Promise<ExecutionDecision> {
  return policy ? await policy.check(action) : { allowed: true };
}

export function applyExecutionDecision(
  action: ExecutionAction,
  decision: ExecutionDecision,
): ExecutionAction {
  return decision.modified ? { ...action, ...decision.modified } : action;
}

export async function assertExecutionAllowed(
  policy: ExecutionPolicy | undefined,
  action: ExecutionAction,
): Promise<ExecutionAction> {
  const decision = await checkExecution(policy, action);
  if (!decision.allowed) throw new ExecutionDeniedError(action, decision);
  return applyExecutionDecision(action, decision);
}
